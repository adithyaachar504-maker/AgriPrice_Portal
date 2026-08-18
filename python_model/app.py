import os
import sys
import subprocess

# Auto-install missing packages silently
def ensure(pkg):
    try:
        __import__(pkg.replace("-","_").split("[")[0])
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg, "--quiet"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

for pkg in ["flask", "flask-cors", "pandas", "scikit-learn", "PyPDF2"]:
    ensure(pkg)

from flask import Flask, request, jsonify
from flask_cors import CORS
from model import predict_manual, predict

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def to_float(val):
    """Convert numpy or any numeric type to plain Python float."""
    try:
        return round(float(val), 4)
    except:
        return 0.0

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})

@app.route("/api/analyze-soil", methods=["POST"])
def analyze_soil():
    d = request.get_json(force=True, silent=True) or {}
    try:
        N           = to_float(d.get("N")           or 90)
        P           = to_float(d.get("P")           or 42)
        K           = to_float(d.get("K")           or 43)
        temperature = to_float(d.get("temperature") or 25)
        moisture    = to_float(d.get("moisture")    or 60)
        ph          = to_float(d.get("ph")          or 6.5)
        rainfall    = to_float(d.get("rainfall")    or 202)

        predicted_crop, features = predict_manual(N, P, K, temperature, moisture, ph, rainfall)

        return jsonify({
            "success":        True,
            "predicted_crop": str(predicted_crop),
            "N":           to_float(features[0]),
            "P":           to_float(features[1]),
            "K":           to_float(features[2]),
            "temperature": to_float(features[3]),
            "moisture":    to_float(features[4]),
            "ph":          to_float(features[5]),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/upload-soil", methods=["POST"])
def upload_soil():
    file = request.files.get("soilReport")
    if not file or file.filename == "":
        return jsonify({"success": False, "error": "No file uploaded."}), 400

    fname = file.filename.lower()
    if not fname.endswith(".pdf"):
        return jsonify({"success": False, "error": "Invalid soil report file. Upload a PDF soil report only."}), 400

    safe_name = "upload_" + str(int(__import__("time").time())) + "_" + file.filename
    file_path = os.path.join(UPLOAD_FOLDER, safe_name)
    file.save(file_path)

    try:
        predicted_crop, features = predict(pdf_path=file_path)

        return jsonify({
            "success":        True,
            "predicted_crop": str(predicted_crop),
            "N":           to_float(features[0]),
            "P":           to_float(features[1]),
            "K":           to_float(features[2]),
            "temperature": to_float(features[3]),
            "moisture":    to_float(features[4]),
            "ph":          to_float(features[5]),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


if __name__ == "__main__":
    print("")
    print("  ========================================")
    print("  Python Soil Model — port 5000")
    print("  Trained MLP model — no API key needed")
    print("  ========================================")
    print("")
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
