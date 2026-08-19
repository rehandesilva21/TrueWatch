"""
Audio ensemble inference for TrueWatch.

Loads the CNN + LightGBM models trained in Colab and exposes predict()
functions for use in backend/app.py (or wherever the live audio pipeline
calls into the audio module).

Expects these 5 files to exist in MODEL_DIR (downloaded from your Drive
TrueWatch_models folder after the Colab run):
    audio_cnn.keras
    audio_lgbm.pkl
    audio_scaler.pkl
    audio_label_encoder.pkl
    ensemble_weight.txt
"""

import os
import pickle
import numpy as np
from tensorflow.keras.models import load_model
from modules.audio.cnn_model import load_audio_cnn

from modules.audio.esc50_loader import (
    load_audio_fixed,
    extract_mel_spectrogram_from_array,
    handcrafted_features,
)

MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)

_cnn = None
_lgbm = None
_scaler = None
_label_encoder = None
_best_w = None


def load_ensemble(model_dir=MODEL_DIR):
    global _cnn, _lgbm, _scaler, _label_encoder, _best_w

    _cnn = load_audio_cnn()   # CHANGED from: load_model(os.path.join(model_dir, "audio_cnn.keras"))
    with open(os.path.join(model_dir, "audio_lgbm.pkl"), "rb") as f:
        _lgbm = pickle.load(f)
    with open(os.path.join(model_dir, "audio_scaler.pkl"), "rb") as f:
        _scaler = pickle.load(f)
    with open(os.path.join(model_dir, "audio_label_encoder.pkl"), "rb") as f:
        _label_encoder = pickle.load(f)

    weight_path = os.path.join(model_dir, "ensemble_weight.txt")
    if os.path.exists(weight_path):
        with open(weight_path) as f:
            _best_w = float(f.read().strip())
    else:
        _best_w = 0.5

    print(f"Audio ensemble loaded from {model_dir} (CNN weight = {_best_w:.2f})")


def _ensure_loaded():
    if _cnn is None:
        raise RuntimeError(
            "Audio ensemble not loaded. Call load_ensemble() once at startup "
            "before predict_from_array() / predict_from_file()."
        )


def predict_proba_from_array(y_audio):
    """Returns the class-probability vector (shape: [n_classes]) for a
    raw, already fixed-length audio array."""
    _ensure_loaded()

    logmel = extract_mel_spectrogram_from_array(y_audio)[np.newaxis, ..., np.newaxis]
    hand = _scaler.transform(handcrafted_features(y_audio)[np.newaxis, :])

    cnn_proba = _cnn.predict(logmel, verbose=0)
    lgbm_proba = _lgbm.predict_proba(hand)

    return (_best_w * cnn_proba + (1 - _best_w) * lgbm_proba)[0]


def predict_from_array(y_audio):
    """Returns (predicted_label: str, confidence: float) for a raw audio
    array (already loaded, any length — will be padded/truncated for you)."""
    _ensure_loaded()
    y_fixed = _fix_length(y_audio)
    proba = predict_proba_from_array(y_fixed)
    idx = int(np.argmax(proba))
    label = _label_encoder.inverse_transform([idx])[0]
    return label, float(proba[idx])


def predict_from_file(filepath):
    """Convenience wrapper: loads a WAV file from disk and predicts."""
    y_audio = load_audio_fixed(filepath)
    return predict_from_array(y_audio)


def _fix_length(y_audio):
    from modules.audio.esc50_loader import FIXED_LEN
    if len(y_audio) < FIXED_LEN:
        return np.pad(y_audio, (0, FIXED_LEN - len(y_audio)))
    return y_audio[:FIXED_LEN]


if __name__ == "__main__":
    # Quick smoke test — swap in a real WAV path from your project
    load_ensemble()
    label, conf = predict_from_file("data/external/esc50/ESC-50-master/audio/1-100032-A-0.wav")
    print(f"Predicted: {label}  (confidence: {conf:.3f})")