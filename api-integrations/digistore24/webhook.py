from flask import Flask, request, jsonify
import os

app = Flask(__name__)

DIGISTORE_API_KEY = os.environ.get("DIGISTORE_API_KEY")

@app.route("/webhook", methods=["POST"])
def webhook():
    event = request.json
    # TODO: Produktanlage, Userverwaltung, Lizenzhandling
    print("Empfangenes Event:", event)
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(port=5000, host="0.0.0.0")
