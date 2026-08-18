/* ============================================================
   AgriPrice Portal - app.js
   All data stored in MySQL via server API
   ============================================================ */

let selectedCrop = '';
let weatherData  = null;
let mapInstance  = null;
let mapMarkers   = [];
let currentUser  = null;
let currentOrderListing = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupCropButtons();
  setupPHSlider();
  setupAnalyzeButton();
  setupResetButton();
  setupLocationDetect();

  // Restore session from sessionStorage (survives page refresh, not tab close)
  const saved = sessionStorage.getItem('agri_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    showNavUser();
  }
});

// ── SESSION ───────────────────────────────────────────────────
function saveSession(user) {
  currentUser = user;
  sessionStorage.setItem('agri_user', JSON.stringify(user));
}

function clearSession() {
  currentUser = null;
  sessionStorage.removeItem('agri_user');
}

function showNavUser() {
  if (!currentUser) return;
  document.getElementById('navUser').style.display   = 'flex';
  document.getElementById('navUserName').textContent = currentUser.name + ' (' + currentUser.role + ')';
}

// ── API HELPER ────────────────────────────────────────────────
async function api(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ══════════════════════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════════════════════
async function register() {
  const name     = document.getElementById('regName').value.trim();
  const phone    = document.getElementById('regPhone').value.trim();
  const location = document.getElementById('regLocation').value.trim();
  const role     = document.getElementById('regRole').value;
  const password = document.getElementById('regPassword').value;
  const errEl    = document.getElementById('registerError');
  errEl.textContent = '';

  try {
    const data = await api('POST', '/api/auth/register', { name, phone, password, role, location });
    saveSession(data.user);
    afterLogin(data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

async function login() {
  const phone    = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  const errEl    = document.getElementById('loginError');
  errEl.textContent = '';

  try {
    const data = await api('POST', '/api/auth/login', { phone, password });
    saveSession(data.user);
    afterLogin(data.user);
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function logout() {
  clearSession();
  document.getElementById('authScreen').style.display      = 'block';
  document.getElementById('farmerDashboard').style.display = 'none';
  document.getElementById('buyerDashboard').style.display  = 'none';
  document.getElementById('navUser').style.display         = 'none';
  ['loginPhone','loginPassword','regName','regPhone','regLocation','regPassword']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('loginError').textContent    = '';
  document.getElementById('registerError').textContent = '';
}

function afterLogin(user) {
  document.getElementById('authScreen').style.display = 'none';
  showNavUser();

  if (user.role === 'farmer') {
    document.getElementById('farmerDashboard').style.display = 'block';
    document.getElementById('buyerDashboard').style.display  = 'none';
    document.getElementById('farmerWelcome').textContent     = 'Welcome, ' + user.name + '! (' + (user.location || '') + ')';
    renderMyListings();
    renderFarmerOrders();
    loadFarmerNotifications();
  } else {
    document.getElementById('buyerDashboard').style.display  = 'block';
    document.getElementById('farmerDashboard').style.display = 'none';
    document.getElementById('buyerWelcome').textContent      = 'Welcome, ' + user.name + '! Find fresh produce near you.';
    renderBuyerListings();
    renderMyOrders();
    loadBuyerNotifications();
    setTimeout(initMarketMap, 400);
  }
}

function showAuthTab(tab) {
  document.getElementById('loginForm').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('loginTabBtn').classList.toggle('active',    tab === 'login');
  document.getElementById('registerTabBtn').classList.toggle('active', tab === 'register');
}

// ══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
async function loadFarmerNotifications() {
  if (!currentUser) return;
  try {
    const notifs = await api('GET', `/api/notifications?userId=${currentUser.id}`);
    const unread = notifs.filter(n => !n.is_read).length;
    const badge  = document.getElementById('notifCount');
    badge.textContent   = unread;
    badge.style.display = unread > 0 ? 'inline-block' : 'none';
  } catch (e) {}
}

async function loadBuyerNotifications() {
  if (!currentUser) return;
  try {
    const notifs = await api('GET', `/api/notifications?userId=${currentUser.id}`);
    const unread = notifs.filter(n => !n.is_read).length;
    const badge  = document.getElementById('buyerNotifCount');
    badge.textContent   = unread;
    badge.style.display = unread > 0 ? 'inline-block' : 'none';
  } catch (e) {}
}

async function toggleNotifications() {
  const panel  = document.getElementById('notifPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) await renderNotifications('farmer');
}

async function toggleBuyerNotifications() {
  const panel  = document.getElementById('buyerNotifPanel');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) await renderNotifications('buyer');
}

async function renderNotifications(role) {
  if (!currentUser) return;
  const listId = role === 'farmer' ? 'notifList' : 'buyerNotifList';
  const el     = document.getElementById(listId);
  try {
    const notifs = await api('GET', `/api/notifications?userId=${currentUser.id}`);
    // Mark as read
    await api('PATCH', `/api/notifications/read?userId=${currentUser.id}`);
    if (role === 'farmer') loadFarmerNotifications();
    else loadBuyerNotifications();

    if (!notifs.length) { el.innerHTML = '<p class="empty-msg" style="padding:12px;">No notifications yet.</p>'; return; }
    el.innerHTML = notifs.map(n => `
      <div class="notif-item notif-${n.type}">
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${new Date(n.created_at).toLocaleString('en-IN')}</div>
      </div>`).join('');
  } catch (e) { el.innerHTML = '<p class="empty-msg" style="padding:12px;">Could not load notifications.</p>'; }
}

async function clearNotifications() {
  if (!currentUser) return;
  try {
    await api('DELETE', `/api/notifications?userId=${currentUser.id}`);
    document.getElementById('notifList').innerHTML = '<p class="empty-msg" style="padding:12px;">No notifications.</p>';
    document.getElementById('notifCount').style.display = 'none';
  } catch (e) {}
}

async function clearBuyerNotifications() {
  if (!currentUser) return;
  try {
    await api('DELETE', `/api/notifications?userId=${currentUser.id}`);
    document.getElementById('buyerNotifList').innerHTML = '<p class="empty-msg" style="padding:12px;">No notifications.</p>';
    document.getElementById('buyerNotifCount').style.display = 'none';
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
//  LISTINGS
// ══════════════════════════════════════════════════════════════
async function addListing() {
  if (!currentUser) return;
  const name  = document.getElementById('listCropName').value.trim();
  const qty   = document.getElementById('listQty').value.trim();
  const price = document.getElementById('listPrice').value.trim();
  const loc   = document.getElementById('listLocation').value.trim() || currentUser.location || '';
  const date  = document.getElementById('listDate').value;
  const desc  = document.getElementById('listDesc').value.trim();

  if (!name || !qty || !price) { alert('Please fill in Crop Name, Quantity and Price.'); return; }

  const cropEmojis = {
    rice:'🌾',wheat:'🌿',maize:'🌽',cotton:'🌸',sugarcane:'🎋',
    soybean:'🫘',tomato:'🍅',potato:'🥔',onion:'🧅',
    vegetables:'🥬',fruits:'🍎',groundnut:'🥜',default:'🌱'
  };
  const emoji = cropEmojis[name.toLowerCase()] || cropEmojis.default;

  let lat = null, lng = null;
  if (loc) {
    const coords = await geocodeLocation(loc);
    if (coords) { lat = coords.lat; lng = coords.lng; }
  }

  try {
    await api('POST', '/api/listings', {
      farmerId: currentUser.id, farmerName: currentUser.name,
      farmerContact: currentUser.phone, name, emoji,
      qty: parseFloat(qty), price: parseFloat(price),
      location: loc, description: desc, availableUntil: date || null, lat, lng,
    });
    ['listCropName','listQty','listPrice','listDate','listDesc'].forEach(id => {
      document.getElementById(id).value = '';
    });
    renderMyListings();
    updateMapMarkers();
    alert('Listing added successfully!');
  } catch (err) { alert('Error: ' + err.message); }
}

async function deleteListing(id) {
  if (!confirm('Remove this listing?')) return;
  try {
    await api('DELETE', `/api/listings/${id}`, { farmerId: currentUser.id });
    renderMyListings();
    updateMapMarkers();
  } catch (err) { alert('Error: ' + err.message); }
}

async function renderMyListings() {
  if (!currentUser) return;
  const el = document.getElementById('myListings');
  el.innerHTML = '<p class="empty-msg">Loading...</p>';
  try {
    const listings = await api('GET', `/api/listings/my?farmerId=${currentUser.id}`);
    // Update stats
    const orders  = await api('GET', `/api/orders/farmer?farmerId=${currentUser.id}`);
    const pending = orders.filter(o => o.status === 'Pending');
    document.getElementById('statListings').textContent = listings.length;
    document.getElementById('statOrders').textContent   = orders.length;
    document.getElementById('statPending').textContent  = pending.length;

    if (!listings.length) { el.innerHTML = '<p class="empty-msg">No listings yet. Add your first crop above!</p>'; return; }
    el.innerHTML = listings.map(l => `
      <div class="listing-item">
        <div class="listing-emoji">${l.emoji}</div>
        <div class="listing-info">
          <div class="listing-name">${l.name}</div>
          <div class="listing-meta">&#128230; ${l.qty} kg &nbsp;&middot;&nbsp; &#8377;${l.price}/kg &nbsp;&middot;&nbsp; &#128205; ${l.location}</div>
          ${l.available_until ? '<div class="listing-meta">Until: ' + l.available_until.split('T')[0] + '</div>' : ''}
          ${l.description ? '<div class="listing-desc">' + l.description + '</div>' : ''}
        </div>
        <div class="listing-actions">
          <span class="listing-value">&#8377;${(l.qty * l.price).toLocaleString('en-IN')}</span>
          <button class="btn-delete" onclick="deleteListing(${l.id})">Remove</button>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = '<p class="empty-msg">Error loading listings.</p>'; }
}

// ══════════════════════════════════════════════════════════════
//  ORDERS
// ══════════════════════════════════════════════════════════════
function openOrderModal(listingId, cropName, cropEmoji, price, location, farmerName, farmerId, farmerContact, availableQty) {
  currentOrderListing = { id: listingId, name: cropName, emoji: cropEmoji, price, location, farmerName, farmerId, farmerContact, qty: availableQty };

  document.getElementById('orderModalContent').innerHTML = `
    <div class="order-modal-item">
      <span class="buyer-emoji">${cropEmoji}</span>
      <div>
        <div class="buyer-name">${cropName}</div>
        <div class="buyer-location">&#128205; ${location} &nbsp;&middot;&nbsp; &#8377;${price}/kg</div>
        <div class="buyer-location">Farmer: ${farmerName}</div>
      </div>
    </div>`;

  document.getElementById('orderQty').value  = '';
  document.getElementById('orderMsg').value  = '';
  document.getElementById('orderModal').style.display = 'flex';
}

function closeOrderModal() {
  document.getElementById('orderModal').style.display = 'none';
  currentOrderListing = null;
}

async function confirmOrder() {
  if (!currentUser || !currentOrderListing) return;
  const qty = parseFloat(document.getElementById('orderQty').value);
  const msg = document.getElementById('orderMsg').value.trim();
  const l   = currentOrderListing;

  if (!qty || qty <= 0) { alert('Please enter a valid quantity.'); return; }
  if (qty > l.qty) { alert('Requested quantity exceeds available stock (' + l.qty + ' kg).'); return; }

  try {
    await api('POST', '/api/orders', {
      buyerId: currentUser.id, buyerName: currentUser.name, buyerPhone: currentUser.phone,
      farmerId: l.farmerId, farmerName: l.farmerName, farmerContact: l.farmerContact,
      listingId: l.id, cropName: l.name, cropEmoji: l.emoji,
      qty, pricePerKg: l.price, totalPrice: qty * l.price,
      location: l.location, message: msg,
    });
    closeOrderModal();
    renderMyOrders();
    alert('Order placed! The farmer will contact you at ' + l.farmerContact);
  } catch (err) { alert('Error: ' + err.message); }
}

async function updateOrderStatus(orderId, status) {
  try {
    await api('PATCH', `/api/orders/${orderId}/status`, { status, buyerId: currentUser?.id });
    renderFarmerOrders();
  } catch (err) { alert('Error: ' + err.message); }
}

async function renderFarmerOrders() {
  if (!currentUser) return;
  const el = document.getElementById('farmerOrders');
  try {
    const orders = await api('GET', `/api/orders/farmer?farmerId=${currentUser.id}`);
    if (!orders.length) { el.innerHTML = '<p class="empty-msg">No orders yet.</p>'; return; }
    el.innerHTML = orders.map(o => `
      <div class="order-item">
        <div class="order-top">
          <span class="order-emoji">${o.crop_emoji}</span>
          <div class="order-info">
            <div class="order-title">${o.crop_name} &mdash; ${o.qty} kg</div>
            <div class="order-meta">Buyer: ${o.buyer_name} &nbsp;&middot;&nbsp; &#128222; ${o.buyer_phone}</div>
            <div class="order-meta">Total: <strong>&#8377;${parseFloat(o.total_price).toLocaleString('en-IN')}</strong> &nbsp;&middot;&nbsp; ${new Date(o.placed_at).toLocaleString('en-IN')}</div>
            ${o.message ? '<div class="order-msg-text">&#128172; ' + o.message + '</div>' : ''}
          </div>
          <span class="order-status status-${o.status.toLowerCase()}">${o.status}</span>
        </div>
        ${o.status === 'Pending' ? `
          <div class="order-btns">
            <button class="btn-confirm" onclick="updateOrderStatus(${o.id},'Confirmed')">&#10003; Confirm</button>
            <button class="btn-deliver" onclick="updateOrderStatus(${o.id},'Delivered')">&#128230; Delivered</button>
            <button class="btn-cancel-order" onclick="updateOrderStatus(${o.id},'Cancelled')">&#10060; Cancel</button>
          </div>` : o.status === 'Confirmed' ? `
          <div class="order-btns">
            <button class="btn-deliver" onclick="updateOrderStatus(${o.id},'Delivered')">&#128230; Mark Delivered</button>
          </div>` : ''}
      </div>`).join('');
  } catch (err) { el.innerHTML = '<p class="empty-msg">Error loading orders.</p>'; }
}

async function renderMyOrders() {
  if (!currentUser) return;
  const el = document.getElementById('myOrders');
  try {
    const orders = await api('GET', `/api/orders/buyer?buyerId=${currentUser.id}`);
    if (!orders.length) { el.innerHTML = '<p class="empty-msg">No orders placed yet.</p>'; return; }
    el.innerHTML = orders.map(o => `
      <div class="order-item">
        <div class="order-top">
          <span class="order-emoji">${o.crop_emoji}</span>
          <div class="order-info">
            <div class="order-title">${o.crop_name} &mdash; ${o.qty} kg</div>
            <div class="order-meta">Farmer: ${o.farmer_name} &nbsp;&middot;&nbsp; &#128222; ${o.farmer_contact}</div>
            <div class="order-meta">Total: <strong>&#8377;${parseFloat(o.total_price).toLocaleString('en-IN')}</strong></div>
            <div class="order-meta">&#128205; ${o.location}</div>
          </div>
          <span class="order-status status-${o.status.toLowerCase()}">${o.status}</span>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = '<p class="empty-msg">Error loading orders.</p>'; }
}

// ══════════════════════════════════════════════════════════════
//  BUYER LISTINGS
// ══════════════════════════════════════════════════════════════
function filterListings() { renderBuyerListings(); }

async function renderBuyerListings() {
  const query = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const sort  = document.getElementById('sortSelect')?.value || 'newest';
  const el    = document.getElementById('buyerListings');

  try {
    let listings = await api('GET', '/api/listings');
    // Filter out own listings
    listings = listings.filter(l =>
      l.farmer_id !== currentUser?.id &&
      (l.name.toLowerCase().includes(query) || (l.location || '').toLowerCase().includes(query))
    );
    if (sort === 'price-asc')  listings.sort((a,b) => a.price - b.price);
    if (sort === 'price-desc') listings.sort((a,b) => b.price - a.price);

    if (!listings.length) { el.innerHTML = '<p class="empty-msg" style="padding:32px 0;">No produce listed yet. Check back soon!</p>'; return; }

    el.innerHTML = listings.map(l => `
      <div class="buyer-card">
        <div class="buyer-card-top">
          <span class="buyer-emoji">${l.emoji}</span>
          <div>
            <div class="buyer-name">${l.name}</div>
            <div class="buyer-location">&#128205; ${l.location}</div>
            <div class="buyer-location">Farmer: ${l.farmer_name}</div>
          </div>
          <div class="buyer-price">&#8377;${l.price}<span>/kg</span></div>
        </div>
        <div class="buyer-details">
          <span>&#128230; ${l.qty} kg available</span>
          ${l.available_until ? '<span>Until ' + l.available_until.split('T')[0] + '</span>' : ''}
          <span>Listed ${new Date(l.posted_at).toLocaleDateString('en-IN')}</span>
        </div>
        ${l.description ? '<div class="buyer-desc">' + l.description + '</div>' : ''}
        <div class="buyer-card-actions">
          <a href="tel:${l.farmer_contact}" class="btn-contact">&#128222; Call Farmer</a>
          <button class="btn-order" onclick="openOrderModal(${l.id},'${l.name}','${l.emoji}',${l.price},'${l.location}','${l.farmer_name}',${l.farmer_id},'${l.farmer_contact}',${l.qty})">&#128203; Place Order</button>
        </div>
      </div>`).join('');

    // Update map
    updateMapMarkersFromListings(listings);
  } catch (err) { el.innerHTML = '<p class="empty-msg">Error loading listings.</p>'; }
}

// ══════════════════════════════════════════════════════════════
//  MAP (Leaflet + OpenStreetMap)
// ══════════════════════════════════════════════════════════════
function initMarketMap() {
  const placeholder = document.getElementById('mapPlaceholder');
  if (mapInstance) { renderBuyerListings(); return; }
  if (placeholder) placeholder.style.display = 'none';

  mapInstance = L.map('marketMap').setView([15.3173, 75.7139], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 18,
  }).addTo(mapInstance);
}

function updateMapMarkersFromListings(listings) {
  if (!mapInstance) return;
  mapMarkers.forEach(m => mapInstance.removeLayer(m));
  mapMarkers = [];

  listings.forEach(l => {
    if (!l.lat || !l.lng) return;
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;background:#6fcf5a;border:2px solid #0a1a08;border-radius:50%;box-shadow:0 0 6px rgba(111,207,90,0.6)"></div>`,
      iconSize: [14,14], iconAnchor: [7,7],
    });
    const marker = L.marker([l.lat, l.lng], { icon }).addTo(mapInstance)
      .bindPopup(`<div style="font-family:sans-serif;min-width:160px;padding:4px">
        <strong>${l.emoji} ${l.name}</strong><br>
        <span style="color:#2d7a20">&#8377;${l.price}/kg &middot; ${l.qty}kg</span><br>
        &#128205; ${l.location}<br>
        Farmer: ${l.farmer_name}
      </div>`);
    mapMarkers.push(marker);
  });

  if (mapMarkers.length > 0) {
    mapInstance.fitBounds(L.featureGroup(mapMarkers).getBounds().pad(0.2));
  }
}

function updateMapMarkers() {
  api('GET', '/api/listings').then(listings => updateMapMarkersFromListings(listings)).catch(() => {});
}

async function geocodeLocation(locationStr) {
  try {
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(locationStr + ', India')}&format=json&limit=1`, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data && data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    return null;
  } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════════
function switchTab(tab) {
  const isSoil = tab === 'soil';
  document.getElementById('soilTab').style.display    = isSoil ? 'block' : 'none';
  document.getElementById('marketTab').style.display  = isSoil ? 'none'  : 'block';
  document.getElementById('heroSoil').style.display   = isSoil ? 'block' : 'none';
  document.getElementById('heroMarket').style.display = isSoil ? 'none'  : 'block';
  document.getElementById('tabSoil').classList.toggle('active', isSoil);
  document.getElementById('tabMarket').classList.toggle('active', !isSoil);
  setMobileTab(tab);

  if (!isSoil) {
    if (currentUser) {
      afterLogin(currentUser);
    } else {
      document.getElementById('authScreen').style.display      = 'block';
      document.getElementById('farmerDashboard').style.display = 'none';
      document.getElementById('buyerDashboard').style.display  = 'none';
    }
  }
}

function setMobileTab(tab) {
  const isSoil = tab === 'soil';
  const soilBtn   = document.getElementById('mobileTabSoil');
  const marketBtn = document.getElementById('mobileTabMarket');
  if (soilBtn)   soilBtn.classList.toggle('active', isSoil);
  if (marketBtn) marketBtn.classList.toggle('active', !isSoil);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ══════════════════════════════════════════════════════════════
//  WEATHER
// ══════════════════════════════════════════════════════════════
function setupLocationDetect() {
  const btn = document.getElementById('detectLocationBtn');
  if (btn) btn.addEventListener('click', detectLocation);
}

function detectLocation() {
  const btn    = document.getElementById('detectLocationBtn');
  const status = document.getElementById('weatherStatus');
  btn.textContent = 'Detecting...';
  btn.disabled    = true;
  status.textContent = '';

  if (!navigator.geolocation) {
    status.textContent = 'Geolocation not supported.';
    btn.textContent = 'Detect My Location'; btn.disabled = false; return;
  }

  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const d = await api('GET', `/api/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      if (d.temp !== null && d.temp !== undefined) {
        weatherData = d;
        document.getElementById('temperature').value   = d.temp;
        document.getElementById('locationInput').value = d.city || '';
        document.getElementById('weatherStatus').innerHTML =
          `<span class="weather-badge">&#127780; ${d.city} &mdash; ${d.temp}&deg;C, ${d.description}, Humidity: ${d.humidity}%</span>`;
        btn.textContent = '&#10003; Location Detected';
      } else {
        status.textContent = d.error || 'Could not fetch weather.';
        btn.textContent = 'Try Again'; btn.disabled = false;
      }
    } catch (e) {
      status.textContent = 'Weather fetch failed.';
      btn.textContent = 'Try Again'; btn.disabled = false;
    }
  }, () => {
    status.textContent = 'Location denied. Type your location below.';
    btn.textContent = 'Detect My Location'; btn.disabled = false;
  });
}

async function fetchWeatherByCity(city) {
  if (!city) return;
  try {
    const d = await api('GET', `/api/weather?location=${encodeURIComponent(city)}`);
    if (d.temp !== null && d.temp !== undefined) {
      weatherData = d;
      document.getElementById('temperature').value = d.temp;
      document.getElementById('weatherStatus').innerHTML =
        `<span class="weather-badge">&#127780; ${d.city} &mdash; ${d.temp}&deg;C, ${d.description}, Humidity: ${d.humidity}%</span>`;
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
//  SOIL ANALYSIS
// ══════════════════════════════════════════════════════════════
function setupCropButtons() {
  document.getElementById('cropGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.crop-btn');
    if (!btn) return;
    document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedCrop = btn.dataset.crop;
  });
}

function setupPHSlider() {
  document.getElementById('ph').addEventListener('input', (e) => {
    document.getElementById('phDisplay').textContent = parseFloat(e.target.value).toFixed(1);
  });
}

function collectFormData() {
  const N    = parseFloat(document.getElementById('nitrogen').value);
  const P    = parseFloat(document.getElementById('phosphorus').value);
  const K    = parseFloat(document.getElementById('potassium').value);
  const mois = parseFloat(document.getElementById('moisture').value);
  const temp = parseFloat(document.getElementById('temperature').value);
  const oc   = parseFloat(document.getElementById('organicCarbon').value);
  const ph   = parseFloat(document.getElementById('ph').value);
  return {
    N: isNaN(N)?null:N, P: isNaN(P)?null:P, K: isNaN(K)?null:K,
    moisture: isNaN(mois)?null:mois, temperature: isNaN(temp)?null:temp,
    organicCarbon: isNaN(oc)?null:oc,
    humidity: weatherData?.humidity || null,
    rainfall: weatherData?.rainfall || null,
    ph, soilType: document.getElementById('soilType').value || null,
    location: document.getElementById('locationInput').value.trim() || null,
    crop: selectedCrop,
    hasManualData: !isNaN(N) || !isNaN(P) || !isNaN(K),
  };
}

function setupAnalyzeButton() {
  document.getElementById('analyzeBtn').addEventListener('click', async () => {
    const formData = collectFormData();
    if (!formData.hasManualData) { showError('Please enter at least N, P, or K values.'); return; }
    showError('');
    startAnalyzing();
    try {
      const result = await api('POST', '/api/analyze', formData);
      setTimeout(() => { stopAnalyzing(); renderResults(result, formData.location); }, 3000);
    } catch (err) {
      stopAnalyzing();
      showError(err.message || 'Analysis failed.');
      document.getElementById('analyzeBtn').disabled = false;
    }
  });
}

function setupResetButton() {
  document.getElementById('resetBtn').addEventListener('click', () => {
    ['nitrogen','phosphorus','potassium','moisture','temperature','organicCarbon'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('ph').value = 6.5;
    document.getElementById('phDisplay').textContent = '6.5';
    document.getElementById('soilType').value = '';
    document.getElementById('locationInput').value = '';
    document.getElementById('weatherStatus').textContent = '';
    document.getElementById('detectLocationBtn').textContent = '&#127759; Detect My Location';
    document.getElementById('detectLocationBtn').disabled = false;
    document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('selected'));
    selectedCrop = ''; weatherData = null;
    document.getElementById('result').style.display       = 'none';
    document.getElementById('analyzeBtn').disabled        = false;
    document.getElementById('fertilizerCard').style.display = 'none';
    document.getElementById('soilTipsCard').style.display   = 'none';
    document.getElementById('mandiCard').style.display      = 'none';
    showError('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function startAnalyzing() {
  document.getElementById('analyzeBtn').disabled = true;
  document.getElementById('analyzingCard').classList.add('show');
  document.getElementById('result').style.display = 'none';
  document.querySelectorAll('.anim-step').forEach((s,i) => setTimeout(() => s.classList.add('done'), (i+1)*700));
}

function stopAnalyzing() {
  document.getElementById('analyzingCard').classList.remove('show');
  document.querySelectorAll('.anim-step').forEach(s => s.classList.remove('done'));
}

async function renderResults(data, location) {
  const map = { Poor:{cls:'poor',emoji:'🔴'}, Moderate:{cls:'moderate',emoji:'⚠️'}, Good:{cls:'good',emoji:'✅'}, Excellent:{cls:'excellent',emoji:'🌟'} };
  const r   = map[data.fertility_rating] || map['Moderate'];
  document.getElementById('verdictCard').className     = 'verdict-card ' + r.cls;
  document.getElementById('verdictEmoji').textContent  = r.emoji;
  document.getElementById('verdictRating').textContent = data.fertility_rating + ' Fertility';
  document.getElementById('verdictScore').textContent  = 'Overall Score: ' + data.score + '/100';
  document.getElementById('verdictDesc').textContent   = data.summary;

  if (weatherData) {
    document.getElementById('weatherResultBanner').innerHTML =
      `<span>&#127780;</span> <strong>${weatherData.city}</strong> &mdash; ${weatherData.temp}&deg;C &middot; ${weatherData.description} &middot; Humidity ${weatherData.humidity}%`;
    document.getElementById('weatherResultBanner').style.display = 'flex';
  }

  const color = s => s==='Optimal'?'#6fcf5a':(s==='Low'||s==='Acidic')?'#e05656':'#e8b84b';
  const sc    = (v,lo,hi) => (!v||isNaN(v))?50:v<lo?Math.max(10,(v/lo)*75):v>hi?Math.max(20,100-((v-hi)/hi)*40):80+((v-lo)/(hi-lo))*20;
  const ns = data.nutrient_status||{}, ex = data.extracted||{};

  document.getElementById('nutrientBars').innerHTML = [
    {icon:'N',  name:'Nitrogen (N)',    val:ex.N?ex.N+' kg/ha':'N/A',              status:ns.N||'-',             pct:sc(ex.N,80,200)},
    {icon:'P',  name:'Phosphorus (P)',  val:ex.P?ex.P+' kg/ha':'N/A',              status:ns.P||'-',             pct:sc(ex.P,20,80)},
    {icon:'K',  name:'Potassium (K)',   val:ex.K?ex.K+' kg/ha':'N/A',              status:ns.K||'-',             pct:sc(ex.K,100,350)},
    {icon:'OC', name:'Organic Carbon',  val:ex.organicCarbon?ex.organicCarbon+'%':'N/A', status:ns.organicCarbon||'-', pct:sc(ex.organicCarbon,0.5,2.0)},
    {icon:'pH', name:'Soil pH',         val:ex.pH?String(ex.pH):'N/A',             status:ns.pH||'-',            pct:sc(ex.pH,5.5,7.0)},
    {icon:'M',  name:'Moisture',        val:ex.moisture?ex.moisture+'%':'N/A',     status:ns.moisture||'-',      pct:sc(ex.moisture,20,60)},
  ].map(n => `
    <div class="nutrient-row">
      <div class="nutrient-icon">${n.icon}</div>
      <div class="nutrient-meta">
        <div class="nutrient-label">${n.name}
          <span>${n.val} &middot; <strong style="color:${color(n.status)}">${n.status}</strong></span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="background:${color(n.status)}" data-w="${Math.round(n.pct)}%"></div></div>
      </div>
    </div>`).join('');

  setTimeout(() => document.querySelectorAll('.bar-fill').forEach(el => { el.style.width = el.dataset.w; }), 120);

  const crops = data.crop_recommendations || [];
  const state = location ? location.split(',').pop().trim() : 'Karnataka';

  document.getElementById('cropRecs').innerHTML = crops.map(c => `
    <div class="crop-rec-item" id="crop-${c.name.replace(/\s/g,'-')}">
      <div class="rec-icon">${c.emoji}</div>
      <div class="rec-name">${c.name}</div>
      <span class="suitability-badge suit-${(c.suitability||'medium').toLowerCase()}">${c.suitability} Match</span>
      <div class="rec-reason">${c.reason}</div>
      <div class="mandi-price-inline" id="price-${c.name.replace(/\s/g,'-')}">
        <span class="price-loading">Fetching price...</span>
      </div>
    </div>`).join('');

  crops.forEach(async (c) => {
    try {
      const d  = await api('GET', `/api/mandi?crop=${encodeURIComponent(c.name)}&state=${encodeURIComponent(state)}`);
      const el = document.getElementById(`price-${c.name.replace(/\s/g,'-')}`);
      if (!el) return;
      if (d.success && d.records.length > 0) {
        const rec = d.records[0];
        el.innerHTML = `<span class="price-tag">&#128200; &#8377;${rec.modal}/q &middot; Min &#8377;${rec.min} &middot; Max &#8377;${rec.max} &middot; ${rec.market}</span>`;
      } else { el.innerHTML = ''; }
    } catch (e) { const el = document.getElementById(`price-${c.name.replace(/\s/g,'-')}`); if (el) el.innerHTML = ''; }
  });

  if (data.fertilizer_suggestions?.length) {
    document.getElementById('fertilizerCard').style.display = 'block';
    document.getElementById('fertilizerList').innerHTML = data.fertilizer_suggestions.map(f => `
      <div class="tip-item">
        <div class="tip-icon">&#129514;</div>
        <div class="tip-text"><strong>${f.name}</strong> &mdash; ${f.dosage}<br/><span class="tip-sub">${f.reason}</span></div>
      </div>`).join('');
  }

  if (data.soil_health_tips?.length) {
    document.getElementById('soilTipsCard').style.display = 'block';
    document.getElementById('soilTipsList').innerHTML = data.soil_health_tips.map((t,i) => `
      <div class="tip-item">
        <div class="tip-num">${i+1}</div>
        <div class="tip-text">${t}</div>
      </div>`).join('');
  }

  document.getElementById('aiText').textContent = data.detailed_advice || '';
  fetchMandiSummary(crops, state);

  document.getElementById('result').style.display = 'block';
  document.getElementById('analyzeBtn').disabled  = false;
  setTimeout(() => document.getElementById('result').scrollIntoView({ behavior:'smooth', block:'start' }), 100);
}

async function fetchMandiSummary(crops, state) {
  const card = document.getElementById('mandiCard');
  const list = document.getElementById('mandiList');
  card.style.display = 'block';
  list.innerHTML = '<p class="price-loading">Loading mandi prices...</p>';

  const rows = []; let hasLive = false;
  for (const c of crops) {
    try {
      const d = await api('GET', `/api/mandi?crop=${encodeURIComponent(c.name)}&state=${encodeURIComponent(state)}`);
      if (d.success && d.records.length) {
        if (d.source === 'live') hasLive = true;
        d.records.slice(0,2).forEach(rec => rows.push({ crop:c.name, emoji:c.emoji, source:d.source, ...rec }));
      }
    } catch (e) {}
  }

  if (!rows.length) { list.innerHTML = '<p class="price-na">Price data not available right now.</p>'; return; }

  const badge = hasLive
    ? '<span class="price-live-badge">&#128994; Live from Agmarknet</span>'
    : '<span class="price-ref-badge">&#128308; Reference prices</span>';

  list.innerHTML = `
    <div style="margin-bottom:10px">${badge}</div>
    <table class="mandi-table">
      <thead><tr><th>Crop</th><th>Market</th><th>Min (&#8377;/q)</th><th>Max (&#8377;/q)</th><th>Modal (&#8377;/q)</th><th>Date</th></tr></thead>
      <tbody>${rows.map(row => `
        <tr>
          <td>${row.emoji} ${row.crop}</td>
          <td>${row.market||'-'}</td>
          <td>&#8377;${row.min||'-'}</td>
          <td>&#8377;${row.max||'-'}</td>
          <td><strong style="color:var(--green)">&#8377;${row.modal||'-'}</strong></td>
          <td>${row.date||'-'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.classList.toggle('show', !!msg);
}
// ══════════════════════════════════════════════════════════════
//  SOIL REPORT UPLOAD (Image / PDF)
// ══════════════════════════════════════════════════════════════

function handleFileDrop(e) {
  e.preventDefault();
  document.getElementById('uploadDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) processUploadedFile(file);
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) processUploadedFile(file);
}

async function processUploadedFile(file) {
  const allowed = ['application/pdf'];
  if (!allowed.includes(file.type)) {
    showUploadStatus('error', '❌ Invalid file type. Please upload a PDF soil report file only.');
    return;
  }

  if (file.size > 10 * 1024 * 1024) {
    showUploadStatus('error', '❌ File too large. Max 10MB allowed.');
    return;
  }

  showUploadStatus('loading', `Analyzing ${file.name}...`);

  const formData = new FormData();
  formData.append('soilReport', file);

  try {
    const res  = await fetch('/api/upload-soil', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showUploadStatus('error', '❌ ' + (data.error || 'Analysis failed.'));
      return;
    }

    // ✅ Fill in the manual fields with extracted values
    if (data.N           != null) document.getElementById('nitrogen').value      = data.N;
    if (data.P           != null) document.getElementById('phosphorus').value    = data.P;
    if (data.K           != null) document.getElementById('potassium').value     = data.K;
    if (data.ph          != null) {
      document.getElementById('ph').value = data.ph;
      document.getElementById('phDisplay').textContent = parseFloat(data.ph).toFixed(1);
    }
    if (data.temperature != null) document.getElementById('temperature').value  = data.temperature;
    if (data.moisture    != null) document.getElementById('moisture').value      = data.moisture;
    if (data.organicCarbon != null) document.getElementById('organicCarbon').value = data.organicCarbon;

    showUploadStatus('success',
      `✅ Report analyzed! Predicted crop: ${data.predicted_crop || 'See results below'}. Values filled in — click Analyze.`
    );

    // Scroll to manual form so user can review
    document.getElementById('manualCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (e) {
    showUploadStatus('error', '❌ Upload failed. Make sure Python model is running on port 5000.');
  }
}

function showUploadStatus(type, msg) {
  const el = document.getElementById('uploadStatus');
  el.style.display = 'flex';
  el.className     = 'upload-status ' + type;
  if (type === 'loading') {
    el.innerHTML = `<div class="upload-spinner"></div><span>${msg}</span>`;
  } else {
    el.innerHTML = `<span>${msg}</span>`;
  }
}
