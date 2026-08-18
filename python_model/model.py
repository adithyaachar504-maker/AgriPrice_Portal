import os
import re
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.neural_network import MLPClassifier
from PyPDF2 import PdfReader

# ── Load dataset using absolute path ──
_dir  = os.path.dirname(os.path.abspath(__file__))
data  = pd.read_csv(os.path.join(_dir, "dataset.csv"))

X = data.iloc[:, :-1]   # N, P, K, temperature, humidity, ph, rainfall
y = data.iloc[:, -1]    # label (crop name)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)

model = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=500, random_state=42)
model.fit(X_train_scaled, y_train)

print(f"  [Model] Trained on {len(X_train)} samples — ready!")

# ══════════════════════════════════════
# MANUAL PREDICTION
# ══════════════════════════════════════
def predict_manual(N, P, K, temperature, humidity, ph, rainfall=202.0):
    features     = [float(N), float(P), float(K), float(temperature), float(humidity), float(ph), float(rainfall)]
    input_scaled = scaler.transform([features])
    prediction   = model.predict(input_scaled)
    return str(prediction[0]), [float(x) for x in features]


# ══════════════════════════════════════
# PDF EXTRACTION
# ══════════════════════════════════════
def extract_from_pdf(pdf_path):
    """Extract N, P, K, temperature, humidity, ph from PDF text."""
    try:
        reader = PdfReader(pdf_path)
        text   = ""
        for page in reader.pages:
            text += page.extract_text() or ""

        # Try to find labeled values first (e.g. "Nitrogen: 120")
        patterns = {
            "N":    r'(?:nitrogen|N)[^\d]*(\d+\.?\d*)',
            "P":    r'(?:phosphorus|phosphorous|P)[^\d]*(\d+\.?\d*)',
            "K":    r'(?:potassium|K)[^\d]*(\d+\.?\d*)',
            "ph":   r'(?:pH|ph)[^\d]*(\d+\.?\d*)',
            "temp": r'(?:temperature|temp)[^\d]*(\d+\.?\d*)',
            "hum":  r'(?:humidity|moisture)[^\d]*(\d+\.?\d*)',
        }

        extracted = {}
        for key, pat in patterns.items():
            match = re.search(pat, text, re.IGNORECASE)
            if match:
                extracted[key] = float(match.group(1))

        N    = extracted.get("N",    90.0)
        P    = extracted.get("P",    42.0)
        K    = extracted.get("K",    43.0)
        ph   = extracted.get("ph",    6.5)
        temp = extracted.get("temp", 25.0)
        hum  = extracted.get("hum",  60.0)

        return [N, P, K, temp, hum, ph, 202.0]

    except Exception as e:
        print(f"  [PDF] Extraction error: {e}")
        return None


# ══════════════════════════════════════
# IMAGE EXTRACTION (no API — reads text from image filename hint)
# Uses default values since no API is available
# ══════════════════════════════════════
def extract_from_image(image_path):
    """
    Without an API, we cannot read values from an image.
    Returns None so the caller falls back to default values.
    """
    print(f"  [Image] No API configured — using default soil values for prediction.")
    return None


# ══════════════════════════════════════
# MAIN PREDICT FUNCTION
# ══════════════════════════════════════
def predict(image_path=None, pdf_path=None):
    """
    Predict crop from image or PDF.
    - PDF: extracts values via text parsing
    - Image: uses default values (no API needed)
    """

    # PDF input
    if pdf_path:
        extracted = extract_from_pdf(pdf_path)
        if extracted:
            extracted     = [float(x) for x in extracted]
            input_scaled  = scaler.transform([extracted])
            prediction    = model.predict(input_scaled)
            return str(prediction[0]), extracted

    # Image input — no API, use defaults
    if image_path:
        features     = [90.0, 42.0, 43.0, 25.0, 60.0, 6.5, 202.0]
        input_scaled = scaler.transform([features])
        prediction   = model.predict(input_scaled)
        return str(prediction[0]), features

    # Fallback — first row of dataset
    sample       = X.iloc[0:1]
    features     = [float(x) for x in sample.iloc[0].values.tolist()]
    input_scaled = scaler.transform(sample)
    prediction   = model.predict(input_scaled)
    return str(prediction[0]), features


# ══════════════════════════════════════
# TEST
# ══════════════════════════════════════
if __name__ == "__main__":
    crop, feat = predict_manual(N=90, P=42, K=43, temperature=21, humidity=82, ph=6.5)
    print(f"  Test prediction → {crop}")
