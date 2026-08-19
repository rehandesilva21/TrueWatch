import os
import tensorflow as tf
from tensorflow.keras import layers, models

# Anchored to this file's own location, not the current working directory —
# matches the same pattern already used in audio_inference.py's MODEL_DIR.
# A relative path here silently breaks depending on how/where Flask is
# launched from, which is exactly what caused weights to "not be found"
# despite genuinely existing on disk.
MODEL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)
MODEL_SAVE_PATH   = os.path.join(MODEL_DIR, "audio_cnn.keras")
WEIGHTS_SAVE_PATH = os.path.join(MODEL_DIR, "audio_cnn.weights.h5")

N_MELS      = 64
TIME_STEPS  = 216
NUM_CLASSES = 4


def build_audio_cnn():
    inputs = layers.Input(shape=(N_MELS, TIME_STEPS, 1))

    x = layers.Conv2D(32, (3, 3), padding="same", activation="relu")(inputs)
    x = layers.BatchNormalization()(x)
    x = layers.MaxPooling2D((2, 2))(x)
    x = layers.Dropout(0.2)(x)

    x = layers.Conv2D(64, (3, 3), padding="same", activation="relu")(x)
    x = layers.BatchNormalization()(x)
    x = layers.MaxPooling2D((2, 2))(x)
    x = layers.Dropout(0.25)(x)

    x = layers.Conv2D(128, (3, 3), padding="same", activation="relu")(x)
    x = layers.BatchNormalization()(x)
    x = layers.MaxPooling2D((2, 2))(x)
    x = layers.Dropout(0.3)(x)

    x = layers.Conv2D(256, (3, 3), padding="same", activation="relu")(x)
    x = layers.BatchNormalization()(x)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.4)(x)

    x = layers.Dense(256, activation="relu")(x)
    x = layers.Dropout(0.5)(x)
    outputs = layers.Dense(NUM_CLASSES, activation="softmax")(x)

    model = models.Model(inputs, outputs)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.0005),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def load_audio_cnn():
    model = build_audio_cnn()
    if os.path.exists(WEIGHTS_SAVE_PATH):
        model.load_weights(WEIGHTS_SAVE_PATH)
        print(f"Loaded audio CNN weights from {WEIGHTS_SAVE_PATH}")
    else:
        print(f"WARNING: {WEIGHTS_SAVE_PATH} not found — using untrained CNN.")
    return model