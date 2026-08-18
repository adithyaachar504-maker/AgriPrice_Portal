# 🌱 SoilSense — AI Soil Fertility Prediction

Free AI tool for farmers to upload soil test reports and get instant fertility predictions and crop recommendations.

**Powered by: Google Gemini API (FREE)**

---

## 📁 Project Structure

```
soilsense/
├── index.html      ← Frontend HTML structure
├── style.css       ← All styles & design
├── app.js          ← Frontend JavaScript logic
├── server.js       ← Node.js backend (calls Gemini API)
├── package.json    ← Dependencies
└── README.md       ← This file
```

---

## 🚀 How to Run

### Step 1 — Install Node.js
Download from: https://nodejs.org (choose LTS version)

### Step 2 — Install dependencies
Open terminal in this folder and run:
```bash
npm install
```

### Step 3 — Start the server
```bash
node server.js
```

### Step 4 — Open in browser
Go to: **http://localhost:3000**

---

## 🔑 Get Your FREE Gemini API Key

1. Go to **https://aistudio.google.com**
2. Sign in with your Google account
3. Click **"Get API Key"**
4. Copy and paste it into SoilSense when prompted

✅ No credit card needed. 15 requests/min free.

---

## 🌍 Features

- 📷 Upload soil test report photo or PDF
- 🧪 Manual input for NPK, pH, Moisture, Temperature
- 🤖 AI reads and extracts values automatically
- 🌾 Fertility rating: Poor / Moderate / Good / Excellent
- 🌱 Crop recommendations with match scores
- 🌍 5 languages: English, Hindi, Swahili, French, Spanish
- 🖨️ Print-friendly results

---

## 🌐 Deploy Online (Free)

### Option A — Railway.app
1. Push code to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Done! You get a public URL.

### Option B — Render.com
1. Push to GitHub
2. render.com → New Web Service → Connect repo
3. Start command: `node server.js`

---

## 📞 How Farmers Access It
- Share the URL with farmers via WhatsApp
- They open it on any phone browser (no app needed)
- Works offline-ready for manual input
-