import os
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers, models

MODEL_SAVE_PATH = "models/fusion_lstm.keras"
WINDOW_SIZE     = 15
N_FEATURES      = 10


def build_fusion_model():
    """
    Temporal fusion model — combines a 15-frame window of all
    TrueWatch signals into a single cheat-probability score.

    Architecture follows the AutoOEP paper's approach: LSTM over
    a sliding window outperforms frame-by-frame rule threshold
    checking because it captures SUSTAINED patterns rather than
    single noisy frames.
    """
    model = models.Sequential([
        layers.Input(shape=(WINDOW_SIZE, N_FEATURES)),
        layers.LSTM(32, return_sequences=False),
        layers.Dropout(0.3),
        layers.Dense(16, activation="relu"),
        layers.Dropout(0.2),
        layers.Dense(1, activation="sigmoid"),   # cheat probability 0–1
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="binary_crossentropy",
        metrics=["accuracy",
                 tf.keras.metrics.Precision(name="precision"),
                 tf.keras.metrics.Recall(name="recall")],
    )
    return model


def load_fusion_model():
    """Load a trained model, or build a fresh untrained one."""
    if os.path.exists(MODEL_SAVE_PATH):
        print(f"Loading trained fusion model from {MODEL_SAVE_PATH}")
        return tf.keras.models.load_model(MODEL_SAVE_PATH)
    else:
        print("No trained fusion model found — using untrained architecture.")
        print("Run notebooks/04_fusion_model_training.ipynb once real data is collected.")
        return build_fusion_model()


def save_fusion_model(model):
    os.makedirs("models", exist_ok=True)
    model.save(MODEL_SAVE_PATH)
    print(f"Fusion model saved to {MODEL_SAVE_PATH}")