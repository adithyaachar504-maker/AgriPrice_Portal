/* ============================================================
   AgriPrice Portal - server.js
   Node.js + MySQL (XAMPP) + Python soil model bridge
   ============================================================ */

const express = require('express');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const mysql   = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3000;

// Load .env
try {
  const fs  = require('fs');
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  env.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
} catch (e) {}

const GEMINI_API_KEY  = process.env.GEMINI_API_KEY  || '';
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const PYTHON_API_URL  = process.env.PYTHON_API_URL  || 'http://localhost:5000';

// ── AUTO-START PYTHON MODEL ───────────────────────────────────
const { spawn } = require('child_process');
let pythonReady = false;
let pyProcess   = null;

function startPythonModel() {
  const pythonDir  = path.join(__dirname, 'python_model');
  const scriptPath = path.join(pythonDir, 'app.py');
  const reqFile    = path.join(pythonDir, 'requirements.txt');
  const pyCmd      = process.platform === 'win32' ? 'python' : 'python3';
  const pipCmd     = process.platform === 'win32' ? 'pip'    : 'pip3';

  console.log('  Python Model : Installing dependencies...');

  // Step 1: install requirements first, then start
  const installProc = spawn(pipCmd, ['install', 'flask', 'flask-cors', 'pandas', 'scikit-learn', 'PyPDF2', '--quiet'], {
    cwd: pythonDir, stdio: 'pipe', shell: false,
  });

  installProc.on('close', () => {
    console.log('  Python Model : Starting...');
    pyProcess = spawn(pyCmd, [scriptPath], {
      cwd:   pythonDir,
      stdio: 'pipe',
      shell: false,
    });

  pyProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('  [Python] ' + msg);
    if (msg.includes('5000') || msg.includes('running') || msg.includes('Trained')) {
      pythonReady = true;
    }
  });

  pyProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    // Flask prints startup info to stderr — mark ready when we see port 5000
    if (msg.includes('5000') || msg.includes('Running on')) {
      pythonReady = true;
      console.log('  Python Model : Ready on port 5000 ✅');
    }
    if (msg && !msg.includes('WARNING') && !msg.includes('Debugger') && !msg.includes('Restarker') && !msg.includes('Running on') && !msg.includes('Press CTRL')) {
      console.log('  [Python] ' + msg);
    }
  });

  pyProcess.on('close', (code) => {
    pythonReady = false;
    if (code !== 0 && code !== null) {
      console.log('  [Python] Stopped (code ' + code + '). Will use fallback results.');
    }
  });

  pyProcess.on('error', (err) => {
    pythonReady = false;
    console.log('  Python Model : Failed to start — ' + err.message);
    console.log('  Tip: Make sure Python is installed.');
  });

  process.on('exit',    () => { if(pyProcess) pyProcess.kill(); });
  process.on('SIGINT',  () => { if(pyProcess) pyProcess.kill(); process.exit(); });
  process.on('SIGTERM', () => { if(pyProcess) pyProcess.kill(); process.exit(); });

  }); // end installProc.on close
}

// Wait for Python to be ready before accepting requests
function waitForPython(maxWaitMs = 15000) {
  return new Promise((resolve) => {
    if (pythonReady) return resolve(true);
    const start    = Date.now();
    const interval = setInterval(() => {
      if (pythonReady) {
        clearInterval(interval);
        return resolve(true);
      }
      if (Date.now() - start > maxWaitMs) {
        clearInterval(interval);
        return resolve(false);
      }
    }, 200);
  });
}

startPythonModel();


// ── DATABASE ──────────────────────────────────────────────────
let db;
const fallbackUsers = new Map();
seedFallbackUser();

function normalizePhone(phone) {
  return (phone || '').toString().trim().replace(/\D/g, '');
}

function seedFallbackUser() {
  const demoUser = {
    id: 1,
    name: 'Demo Farmer',
    phone: '9999999999',
    password: '1234',
    role: 'farmer',
    location: 'Bangalore',
  };
  fallbackUsers.set(normalizePhone(demoUser.phone), demoUser);
  return demoUser;
}

function getFallbackUser(phone, password) {
  const normalizedPhone = normalizePhone(phone);
  const user = fallbackUsers.get(normalizedPhone);
  if (!user) return null;
  if (user.password !== password) return null;
  return { ...user, phone: normalizedPhone };
}

async function connectDB() {
  try {
    db = await mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      user:               process.env.DB_USER     || 'root',
      password:           process.env.DB_PASSWORD || '',
      port:               process.env.DB_PORT     || 3306,
      waitForConnections: true,
      connectionLimit:    10,
    });

    // Create database if not exists
    await db.query('CREATE DATABASE IF NOT EXISTS aggriprice');
    await db.query('USE aggriprice');

    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        phone      VARCHAR(15)  NOT NULL UNIQUE,
        password   VARCHAR(255) NOT NULL,
        role       ENUM('farmer','buyer') NOT NULL,
        location   VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS listings (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        farmer_id       INT NOT NULL,
        farmer_name     VARCHAR(100),
        farmer_contact  VARCHAR(15),
        name            VARCHAR(100) NOT NULL,
        emoji           VARCHAR(10),
        qty             DECIMAL(10,2) NOT NULL,
        price           DECIMAL(10,2) NOT NULL,
        location        VARCHAR(200),
        description     TEXT,
        available_until DATE,
        lat             DECIMAL(10,7),
        lng             DECIMAL(10,7),
        posted_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        buyer_id        INT NOT NULL,
        buyer_name      VARCHAR(100),
        buyer_phone     VARCHAR(15),
        farmer_id       INT NOT NULL,
        farmer_name     VARCHAR(100),
        farmer_contact  VARCHAR(15),
        listing_id      INT,
        crop_name       VARCHAR(100),
        crop_emoji      VARCHAR(10),
        qty             DECIMAL(10,2),
        price_per_kg    DECIMAL(10,2),
        total_price     DECIMAL(12,2),
        location        VARCHAR(200),
        message         TEXT,
        status          ENUM('Pending','Confirmed','Delivered','Cancelled') DEFAULT 'Pending',
        placed_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (buyer_id)  REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (farmer_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT NOT NULL,
        message    TEXT NOT NULL,
        type       VARCHAR(20),
        is_read    BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    console.log('  Database    : Connected & tables ready (XAMPP MySQL, aggriprice)');
  } catch (err) {
    console.error('  Database    : FAILED -', err.message);
    console.error('  Make sure XAMPP MySQL is running on port 3306');
    db = null;
  }

  if (!db) {
    seedFallbackUser();
    console.log('  Auth fallback: demo login enabled with phone 9999999999 and password 1234');
  }
}

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

function requireDB(req, res, next) {
  if (!db) return res.status(503).json({ error: 'Database not connected. Make sure XAMPP MySQL is running.' });
  next();
}

// ── HTTP HELPER ───────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response')); }
      });
    }).on('error', reject)
      .setTimeout(10000, function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const isHttps = url.startsWith('https');
    const lib     = isHttps ? https : http;
    const urlObj  = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (isHttps ? 443 : 80),
      path:     urlObj.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { name, phone, password, role, location } = req.body;
  if (!name || !phone || !password || !role) return res.status(400).json({ error: 'All fields required.' });
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone.length < 10) return res.status(400).json({ error: 'Enter a valid phone number.' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters.' });

  try {
    if (db) {
      try {
        const [existing] = await db.execute('SELECT id FROM users WHERE phone = ?', [normalizedPhone]);
        if (existing.length > 0) return res.status(400).json({ error: 'This phone number is already registered.' });

        const [result] = await db.execute(
          'INSERT INTO users (name, phone, password, role, location) VALUES (?, ?, ?, ?, ?)',
          [name, normalizedPhone, password, role, location || '']
        );
        const user = { id: result.insertId, name, phone: normalizedPhone, role, location: location || '' };
        return res.json({ success: true, user });
      } catch (err) {
        console.warn('Database auth failed, using fallback store:', err.message);
      }
    }

    if (fallbackUsers.has(normalizedPhone)) {
      return res.status(400).json({ error: 'This phone number is already registered.' });
    }

    const user = { id: Date.now(), name, phone: normalizedPhone, role, location: location || '' };
    fallbackUsers.set(normalizedPhone, { ...user, password });
    return res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password required.' });

  try {
    if (db) {
      try {
        const [rows] = await db.execute(
          'SELECT id, name, phone, role, location FROM users WHERE phone = ? AND password = ?',
          [normalizePhone(phone), password]
        );
        if (rows.length > 0) return res.json({ success: true, user: rows[0] });
      } catch (err) {
        console.warn('Database login failed, using fallback auth:', err.message);
      }
    }

    const user = getFallbackUser(phone, password);
    if (!user) return res.status(401).json({ error: 'Invalid phone number or password.' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  LISTINGS ROUTES
// ══════════════════════════════════════════════════════════════

app.get('/api/listings', requireDB, async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT * FROM listings ORDER BY posted_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/listings/my', requireDB, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM listings WHERE farmer_id = ? ORDER BY posted_at DESC',
      [req.query.farmerId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/listings', requireDB, async (req, res) => {
  const { farmerId, farmerName, farmerContact, name, emoji, qty, price, location, description, availableUntil, lat, lng } = req.body;
  if (!farmerId || !name || !qty || !price) return res.status(400).json({ error: 'Missing required fields.' });

  try {
    const [result] = await db.execute(
      `INSERT INTO listings (farmer_id, farmer_name, farmer_contact, name, emoji, qty, price, location, description, available_until, lat, lng)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [farmerId, farmerName, farmerContact, name, emoji, qty, price, location || '', description || '', availableUntil || null, lat || null, lng || null]
    );
    const [rows] = await db.execute('SELECT * FROM listings WHERE id = ?', [result.insertId]);
    res.json({ success: true, listing: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/listings/:id', requireDB, async (req, res) => {
  try {
    await db.execute('DELETE FROM listings WHERE id = ? AND farmer_id = ?', [req.params.id, req.body.farmerId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  ORDERS ROUTES
// ══════════════════════════════════════════════════════════════

app.post('/api/orders', requireDB, async (req, res) => {
  const { buyerId, buyerName, buyerPhone, farmerId, farmerName, farmerContact,
          listingId, cropName, cropEmoji, qty, pricePerKg, totalPrice, location, message } = req.body;
  try {
    const [result] = await db.execute(
      `INSERT INTO orders (buyer_id, buyer_name, buyer_phone, farmer_id, farmer_name, farmer_contact,
        listing_id, crop_name, crop_emoji, qty, price_per_kg, total_price, location, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [buyerId, buyerName, buyerPhone, farmerId, farmerName, farmerContact,
       listingId, cropName, cropEmoji, qty, pricePerKg, totalPrice, location, message || '']
    );
    await db.execute(
      'INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)',
      [farmerId, `New order from ${buyerName} for ${qty} kg of ${cropName} (₹${totalPrice})`, 'order']
    );
    res.json({ success: true, orderId: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/farmer', requireDB, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM orders WHERE farmer_id = ? ORDER BY placed_at DESC',
      [req.query.farmerId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/buyer', requireDB, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM orders WHERE buyer_id = ? ORDER BY placed_at DESC',
      [req.query.buyerId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/orders/:id/status', requireDB, async (req, res) => {
  const { status } = req.body;
  try {
    await db.execute('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
    const [orders] = await db.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length > 0) {
      const o = orders[0];
      const msgs = {
        'Confirmed': `Your order for ${o.qty} kg of ${o.crop_name} has been Confirmed!`,
        'Delivered': `Your order for ${o.crop_name} has been Delivered!`,
        'Cancelled': `Your order for ${o.crop_name} was Cancelled by the farmer.`,
      };
      if (msgs[status]) {
        await db.execute(
          'INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)',
          [o.buyer_id, msgs[status], status === 'Cancelled' ? 'cancel' : 'update']
        );
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════

app.get('/api/notifications', requireDB, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
      [req.query.userId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/notifications/read', requireDB, async (req, res) => {
  try {
    await db.execute('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.query.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notifications', requireDB, async (req, res) => {
  try {
    await db.execute('DELETE FROM notifications WHERE user_id = ?', [req.query.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  WEATHER API
// ══════════════════════════════════════════════════════════════

app.get('/api/weather', async (req, res) => {
  if (!WEATHER_API_KEY) return res.json({ error: 'Weather API key not configured', temp: null });
  try {
    let url;
    if (req.query.lat && req.query.lon) {
      url = `https://api.openweathermap.org/data/2.5/weather?lat=${req.query.lat}&lon=${req.query.lon}&appid=${WEATHER_API_KEY}&units=metric`;
    } else {
      url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(req.query.location || 'Bangalore')},IN&appid=${WEATHER_API_KEY}&units=metric`;
    }
    const data = await httpGet(url);
    if (data.cod !== 200) return res.json({ error: 'Location not found', temp: null });
    res.json({
      temp: Math.round(data.main.temp), humidity: data.main.humidity,
      rainfall: data.rain ? (data.rain['1h'] || data.rain['3h'] || 0) : 0,
      description: data.weather[0].description, city: data.name,
    });
  } catch (err) { res.json({ error: err.message, temp: null }); }
});

// ══════════════════════════════════════════════════════════════
//  MANDI PRICES
// ══════════════════════════════════════════════════════════════

const FALLBACK_PRICES = {
  'rice':       { min: 1800, max: 2200, modal: 2000, market: 'Bangalore' },
  'wheat':      { min: 2000, max: 2400, modal: 2200, market: 'Bangalore' },
  'maize':      { min: 1400, max: 1800, modal: 1600, market: 'Davangere' },
  'tomato':     { min: 800,  max: 2000, modal: 1200, market: 'Kolar'     },
  'cotton':     { min: 5500, max: 6500, modal: 6000, market: 'Raichur'   },
  'sugarcane':  { min: 280,  max: 320,  modal: 300,  market: 'Mandya'    },
  'soybean':    { min: 3800, max: 4400, modal: 4100, market: 'Gulbarga'  },
  'groundnut':  { min: 4500, max: 5500, modal: 5000, market: 'Chitradurga' },
  'onion':      { min: 600,  max: 1800, modal: 1200, market: 'Bangalore' },
  'potato':     { min: 700,  max: 1400, modal: 1000, market: 'Hassan'    },
  'vegetables': { min: 500,  max: 2000, modal: 1000, market: 'Bangalore' },
  'fruits':     { min: 1500, max: 4000, modal: 2500, market: 'Bangalore' },
};

app.get('/api/mandi', async (req, res) => {
  const crop  = req.query.crop  || 'Tomato';
  const state = req.query.state || 'Karnataka';
  const urls  = [
    `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=579b464db66ec23bdd000001cdd3946e44ce4aab825ef8fe01018ffd&format=json&filters[Commodity]=${encodeURIComponent(crop)}&filters[State]=${encodeURIComponent(state)}&limit=5`,
    `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=579b464db66ec23bdd000001cdd3946e44ce4aab825ef8fe01018ffd&format=json&filters[commodity]=${encodeURIComponent(crop)}&limit=10`,
  ];
  for (const url of urls) {
    try {
      const data = await httpGet(url);
      if (data.records && data.records.length > 0) {
        return res.json({ success: true, source: 'live', crop, state, records: data.records.map(r => ({
          market: r.Market || r.District || 'N/A',
          min:    r.Min_x0020_Price || r.Min_Price || '-',
          max:    r.Max_x0020_Price || r.Max_Price || '-',
          modal:  r.Modal_x0020_Price || r.Modal_Price || '-',
          date:   r.Arrival_Date || 'Recent',
        }))});
      }
    } catch (e) {}
  }
  const fb = FALLBACK_PRICES[crop.toLowerCase()] || FALLBACK_PRICES['vegetables'];
  res.json({ success: true, source: 'fallback', crop, state, records: [{ ...fb, date: 'Reference price' }] });
});

// ══════════════════════════════════════════════════════════════
//  SOIL ANALYSIS
//  Tries Python model first → falls back to Gemini → falls back local
// ══════════════════════════════════════════════════════════════

function buildGeminiPrompt(f) {
  const lines = [];
  if (f.N    != null) lines.push(`Nitrogen (N): ${f.N} kg/ha`);
  if (f.P    != null) lines.push(`Phosphorus (P): ${f.P} kg/ha`);
  if (f.K    != null) lines.push(`Potassium (K): ${f.K} kg/ha`);
  if (f.organicCarbon != null) lines.push(`Organic Carbon: ${f.organicCarbon}%`);
  if (f.moisture    != null) lines.push(`Moisture: ${f.moisture}%`);
  if (f.temperature != null) lines.push(`Temperature: ${f.temperature}C`);
  if (f.humidity    != null) lines.push(`Humidity: ${f.humidity}%`);
  if (f.rainfall    != null) lines.push(`Rainfall: ${f.rainfall}mm`);
  if (f.ph)       lines.push(`pH: ${f.ph}`);
  if (f.soilType) lines.push(`Soil Type: ${f.soilType}`);
  if (f.location) lines.push(`Location: ${f.location}`);
  if (f.crop)     lines.push(`Target crop: ${f.crop}`);

  return `You are AgriPrice Portal, an expert agricultural AI for Indian farmers.
Soil data: ${lines.join(', ')}
Respond ONLY with valid JSON (no markdown):
{"no_data":false,"fertility_rating":"Poor"|"Moderate"|"Good"|"Excellent","score":<0-100>,"summary":"<2 sentences>","extracted":{"N":<n>,"P":<n>,"K":<n>,"pH":<n>,"moisture":<n>,"temperature":<n>,"organicCarbon":<n>},"nutrient_status":{"N":"Low"|"Optimal"|"High","P":"Low"|"Optimal"|"High","K":"Low"|"Optimal"|"High","pH":"Acidic"|"Optimal"|"Alkaline","moisture":"Low"|"Optimal"|"High","organicCarbon":"Low"|"Optimal"|"High"},"crop_recommendations":[{"name":"<crop>","emoji":"<emoji>","suitability":"High"|"Medium"|"Low","reason":"<sentence>"},{"name":"<crop>","emoji":"<emoji>","suitability":"High"|"Medium"|"Low","reason":"<sentence>"},{"name":"<crop>","emoji":"<emoji>","suitability":"High"|"Medium"|"Low","reason":"<sentence>"},{"name":"<crop>","emoji":"<emoji>","suitability":"High"|"Medium"|"Low","reason":"<sentence>"}],"fertilizer_suggestions":[{"name":"<n>","dosage":"<dosage>","reason":"<reason>"},{"name":"<n>","dosage":"<dosage>","reason":"<reason>"},{"name":"<n>","dosage":"<dosage>","reason":"<reason>"}],"soil_health_tips":["<tip1>","<tip2>","<tip3>","<tip4>"],"detailed_advice":"<4-5 sentences>"}`;
}

function callGemini(parts) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ contents:[{parts}], generationConfig:{temperature:0.2,maxOutputTokens:1500} });
    const req  = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path:     `/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method:   'POST',
      headers:  { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) return reject(new Error(p.error.message));
          resolve(p?.candidates?.[0]?.content?.parts?.[0]?.text || '');
        } catch(e) { reject(new Error('Failed to parse Gemini response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body); req.end();
  });
}

function generateFallback(f) {
  const sc = (v,lo,hi) => (!v||isNaN(v))?50:v<lo?Math.max(10,(v/lo)*75):v>hi?Math.max(20,100-((v-hi)/hi)*40):80+((v-lo)/(hi-lo))*20;
  const nS=sc(f.N,80,200),pS=sc(f.P,20,80),kS=sc(f.K,100,350),phS=sc(f.ph,5.5,7.0),mS=sc(f.moisture,20,60);
  const s=Math.round(nS*.25+pS*.2+kS*.2+phS*.2+mS*.15);
  const r=s>=80?'Excellent':s>=60?'Good':s>=40?'Moderate':'Poor';
  return { no_data:false, fertility_rating:r, score:s,
    summary:`Your soil scores ${s}/100 — rated ${r}. ${s>=60?'Good for farming!':'Improvements needed.'}`,
    extracted:{N:f.N,P:f.P,K:f.K,pH:f.ph,moisture:f.moisture,temperature:f.temperature,organicCarbon:f.organicCarbon},
    nutrient_status:{N:nS<50?'Low':nS>85?'High':'Optimal',P:pS<50?'Low':pS>85?'High':'Optimal',K:kS<50?'Low':kS>85?'High':'Optimal',pH:phS<50?(f.ph<5.5?'Acidic':'Alkaline'):'Optimal',moisture:mS<50?'Low':mS>85?'High':'Optimal',organicCarbon:'Optimal'},
    crop_recommendations:[{name:'Rice',emoji:'🌾',suitability:'High',reason:'Good NPK for paddy.'},{name:'Wheat',emoji:'🌿',suitability:'High',reason:'Suitable nutrient levels.'},{name:'Maize',emoji:'🌽',suitability:'Medium',reason:'Good with potassium.'},{name:'Vegetables',emoji:'🥬',suitability:'Medium',reason:'Fertile soil helps leafy crops.'}],
    fertilizer_suggestions:[{name:'Urea',dosage:'50 kg/acre',reason:'Boost nitrogen.'},{name:'DAP',dosage:'25 kg/acre',reason:'Improve phosphorus.'},{name:'MOP',dosage:'20 kg/acre',reason:'Potassium support.'}],
    soil_health_tips:['Add organic compost.','Practice crop rotation.','Test soil every 6 months.','Avoid over-irrigation.'],
    detailed_advice:'Focus on balanced NPK. Check pH and adjust. Maintain proper irrigation. Rotate crops each season.',
  };
}

app.post('/api/analyze', async (req, res) => {
  const f = req.body;
  if (!f.hasManualData) return res.status(400).json({ error: 'Please enter at least N, P, or K values.' });

  // ── Wait for Python model to be ready (max 15 seconds) ──
  const ready = await waitForPython(15000);
  if (!ready) {
    console.log('  Python model not ready — returning fallback');
    return res.json(generateFallback(f));
  }

  // ── Call Python trained MLP model ──
  try {
    const pyResult = await httpPost(`${PYTHON_API_URL}/api/analyze-soil`, {
      N:           f.N           || 90,
      P:           f.P           || 42,
      K:           f.K           || 43,
      temperature: f.temperature || 25,
      moisture:    f.moisture    || 60,
      ph:          f.ph          || 6.5,
      rainfall:    202,
    });

    if (pyResult && pyResult.predicted_crop) {
      // Build full response from model prediction
      const crop     = pyResult.predicted_crop;
      const cropEmojis = { rice:'🌾', wheat:'🌿', maize:'🌽', corn:'🌽', cotton:'🌸', sugarcane:'🎋', soybean:'🫘', tomato:'🍅', potato:'🥔', onion:'🧅', groundnut:'🥜', mungbean:'🫘', blackgram:'🫘', lentil:'🟤', pomegranate:'🍎', mango:'🥭', grapes:'🍇', watermelon:'🍉', muskmelon:'🍈', apple:'🍎', orange:'🍊', papaya:'🍈', coconut:'🥥', banana:'🍌', coffee:'☕' };
      const emoji    = cropEmojis[crop.toLowerCase()] || '🌱';

      // Score based on input values
      const sc  = (v,lo,hi) => (!v||isNaN(v))?50:v<lo?Math.max(10,(v/lo)*75):v>hi?Math.max(20,100-((v-hi)/hi)*40):80+((v-lo)/(hi-lo))*20;
      const nS  = sc(f.N,80,200), pS=sc(f.P,20,80), kS=sc(f.K,100,350), phS=sc(f.ph,5.5,7.0), mS=sc(f.moisture,20,60);
      const score = Math.round(nS*.25 + pS*.2 + kS*.2 + phS*.2 + mS*.15);
      const rating  = score>=80?'Excellent':score>=60?'Good':score>=40?'Moderate':'Poor';

      const nSt = nS<50?'Low':nS>85?'High':'Optimal';
      const pSt = pS<50?'Low':pS>85?'High':'Optimal';
      const kSt = kS<50?'Low':kS>85?'High':'Optimal';
      const phSt = phS<50?(f.ph<5.5?'Acidic':'Alkaline'):'Optimal';
      const mSt = mS<50?'Low':mS>85?'High':'Optimal';

      const result = {
        no_data:          false,
        fertility_rating: rating,
        score:            score,
        summary:          `Your soil scores ${score}/100 (${rating}). Best crop match: ${crop}.`,
        extracted: {
          N: f.N, P: f.P, K: f.K,
          pH: f.ph, moisture: f.moisture,
          temperature: f.temperature,
          organicCarbon: f.organicCarbon || null,
        },
        nutrient_status: { N: nSt, P: pSt, K: kSt, pH: phSt, moisture: mSt, organicCarbon: 'Optimal' },
        crop_recommendations: [
          { name: crop,          emoji: emoji,  suitability: 'High',   reason: 'Top match from your trained ML model based on N, P, K, pH, moisture.' },
          { name: 'Vegetables',  emoji: '🥬',   suitability: 'Medium', reason: 'Suitable if soil amendments are applied.' },
          { name: 'Maize',       emoji: '🌽',   suitability: 'Medium', reason: 'Alternative crop for similar conditions.' },
          { name: 'Wheat',       emoji: '🌿',   suitability: 'Low',    reason: 'May need fertilizer adjustments.' },
        ],
        fertilizer_suggestions: [
          { name: 'Urea',  dosage: '50 kg/acre', reason: nSt==='Low'?'Nitrogen is low — boost it.':'Maintain nitrogen levels.' },
          { name: 'DAP',   dosage: '25 kg/acre', reason: pSt==='Low'?'Phosphorus is low.':'Good phosphorus support.' },
          { name: 'MOP',   dosage: '20 kg/acre', reason: kSt==='Low'?'Potassium needs improvement.':'Maintain potassium levels.' },
        ],
        soil_health_tips: [
          'Add organic compost to improve soil structure.',
          'Practice crop rotation each season.',
          'Test soil nutrients every 6 months.',
          phSt!=='Optimal'?`Adjust pH — current level is ${phSt}.`:'Maintain current pH level.',
        ],
        detailed_advice: `Based on your soil data, ${crop} is the best crop recommendation. ${rating === 'Excellent' || rating === 'Good' ? 'Your soil is in good condition.' : 'Consider improving nutrient levels before planting.'} Ensure proper irrigation and use recommended fertilizers for best yield.`,
      };

      return res.json(result);
    }
  } catch (e) {
    console.log('  Python model error:', e.message);
  }

  // ── Fallback if Python model is unavailable ──
  res.json(generateFallback(f));
});

// ══════════════════════════════════════════════════════════════
//  SOIL REPORT UPLOAD — saves file locally, sends to Python
// ══════════════════════════════════════════════════════════════
app.post('/api/upload-soil', (req, res) => {
  const busboy  = require('busboy');
  const fs      = require('fs');
  const os      = require('os');
  const bb      = busboy({ headers: req.headers });

  let filePath  = null;
  let fileName  = null;
  let writeStream = null;

  bb.on('file', (fieldname, file, info) => {
    fileName  = info.filename || ('upload_' + Date.now());
    filePath  = path.join(os.tmpdir(), 'soil_' + Date.now() + '_' + fileName);
    writeStream = fs.createWriteStream(filePath);
    file.pipe(writeStream);
  });

  bb.on('finish', () => {
    if (!filePath || !writeStream) {
      return res.status(400).json({ success: false, error: 'No file received.' });
    }

    // Wait for file to finish writing before sending to Python
    writeStream.on('finish', async () => {
      try {
        const FormData = require('form-data');
        const form     = new FormData();
        form.append('soilReport', fs.createReadStream(filePath), { filename: fileName });

        const pyUrl = new URL(`${PYTHON_API_URL}/api/upload-soil`);
        const opts  = {
          hostname: pyUrl.hostname,
          port:     parseInt(pyUrl.port) || 5000,
          path:     '/api/upload-soil',
          method:   'POST',
          headers:  form.getHeaders(),
        };

        const pyRes = await new Promise((resolve, reject) => {
          const httpLib = require('http');
          const req2    = httpLib.request(opts, (resp) => {
            let raw = '';
            resp.on('data', c => raw += c);
            resp.on('end', () => {
              try {
                const parsed = JSON.parse(raw);
                resolve(parsed);
              } catch(e) {
                console.log('[Upload] Raw Python response:', raw.substring(0, 200));
                reject(new Error('Could not parse Python response'));
              }
            });
          });
          req2.on('error', (err) => reject(new Error('Cannot connect to Python model: ' + err.message)));
          req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('Python model timeout')); });
          form.pipe(req2);
        });

        fs.unlink(filePath, () => {});
        return res.json(pyRes);

      } catch (e) {
        fs.unlink(filePath, () => {});
        console.log('[Upload] Error:', e.message);
        return res.status(500).json({ success: false, error: e.message });
      }
    });

    writeStream.on('error', (e) => {
      return res.status(500).json({ success: false, error: 'File write error: ' + e.message });
    });
  });

  bb.on('error', (e) => {
    return res.status(500).json({ success: false, error: 'Upload error: ' + e.message });
  });

  req.pipe(bb);
});

// ── Serve frontend ────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ── Start ─────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║     AgriPrice Portal is running!     ║');
    console.log(`  ║   Open: http://localhost:${PORT}          ║`);
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(GEMINI_API_KEY  ? '  Gemini API   : ✅ OK' : '  Gemini AI    : ❌ MISSING (add to .env)');
    console.log(WEATHER_API_KEY ? '  Weather API  : ✅ OK' : '  Weather API  : ❌ MISSING (add to .env)');
    console.log('  Maps         : ✅ Leaflet + OpenStreetMap');
    console.log('  Database     : ✅ XAMPP MySQL');
    console.log(`  Python Model : ℹ️  Run separately on port 5000`);
    console.log('');
    console.log('  To use Python soil model:');
    console.log('  → Run: python app.py   (in your python project folder)');
    console.log('');
  });
});
