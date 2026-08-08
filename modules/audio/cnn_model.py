import os
import tensorflow as tf
from tensorflow.keras import layers, models

MODEL_SAVE_PATH = "models/audio_cnn.keras"
N_MELS          = 64
TIME_STEPS      = 216   # ~5 sec at hop_length=512, sr=22050
NUM_CLASSES     = 4      # silence, ambient, paper, loud


def build_audio_cnn():
    model = models.Sequential([
        layers.Input(shape=(N_MELS, TIME_STEPS, 1)),

        layers.Conv2D(16, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),

        layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),

        layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),

        layers.GlobalAveragePooling2D(),
        layers.Dense(32, activation="relu"),
        layers.Dropout(0.4),
        layers.Dense(NUM_CLASSES, activation="softmax"),
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def save_audio_model(model):
    os.makedirs("models", exist_ok=True)
    model.save(MODEL_SAVE_PATH)
    print(f"Audio CNN saved to {MODEL_SAVE_PATH}")


def load_audio_model():
    if os.path.exists(MODEL_SAVE_PATH):
        return tf.keras.models.load_model(MODEL_SAVE_PATH)
    print("No trained audio CNN found — run notebooks/05_audio_model_training.py first.")
    return build_audio_cnn()