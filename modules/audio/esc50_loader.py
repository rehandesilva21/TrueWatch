import os
import numpy as np
import pandas as pd
import librosa

DATASET_ROOT = "data/external/esc50/ESC-50-master"
AUDIO_DIR    = os.path.join(DATASET_ROOT, "audio")
META_PATH    = os.path.join(DATASET_ROOT, "meta", "esc50.csv")

SAMPLE_RATE  = 22050
N_MELS       = 64
DURATION     = 5.0  # ESC-50 clips are all 5 seconds
FIXED_LEN    = int(SAMPLE_RATE * DURATION)

# ── Category mapping ────────────────────────────────────────
# ESC-50 has no direct "whisper", "paper rustling" or generic
# "speech" category (Piczak, 2015). We map the closest available
# classes onto TrueWatch's exam-relevant taxonomy. Whisper and
# paper-rustling classes are supplemented separately with custom
# recordings, documented as a scoping decision in the report.
CATEGORY_MAP = {
    # Closest available proxy for quiet human activity / ambient presence
    "breathing":        "ambient",
    "coughing":         "ambient",
    "footsteps":        "ambient",
    "drinking_sipping": "ambient",

    # Closest available proxy for "paper"-like rustling/handling sounds
    "keyboard_typing":  "paper",
    "mouse_click":      "paper",
    "door_wood_creaks": "paper",

    # Closest available proxy for louder, disruptive sound
    "clapping":        "loud",
    "laughing":         "loud",
    "crying_baby":      "loud",
    "sneezing":         "loud",
    "door_wood_knock":  "loud",

    # True silence / background proxy
    "rain":       "silence",
    "wind":       "silence",
    "sea_waves":  "silence",
}

TARGET_CLASSES = ["silence", "ambient", "paper", "loud"]


def load_metadata():
    df = pd.read_csv(META_PATH)
    df = df[df["category"].isin(CATEGORY_MAP.keys())].copy()
    df["target_class"] = df["category"].map(CATEGORY_MAP)
    print(f"Selected {len(df)} clips across {df['category'].nunique()} "
          f"ESC-50 categories, mapped to {df['target_class'].nunique()} target classes")
    print(df["target_class"].value_counts())
    return df


def load_audio_fixed(filepath, sr=SAMPLE_RATE, fixed_len=FIXED_LEN):
    """Load a WAV file and pad/truncate to a fixed length. Shared by both the
    mel-spectrogram (CNN) and hand-crafted (LightGBM) feature paths so both
    models see the exact same underlying audio."""
    y, _ = librosa.load(filepath, sr=sr, duration=DURATION)
    if len(y) < fixed_len:
        y = np.pad(y, (0, fixed_len - len(y)))
    else:
        y = y[:fixed_len]
    return y


def extract_mel_spectrogram(filepath):
    """Load a WAV file and convert to a fixed-size mel-spectrogram."""
    y = load_audio_fixed(filepath)
    return extract_mel_spectrogram_from_array(y)


def extract_mel_spectrogram_from_array(y, sr=SAMPLE_RATE, n_mels=N_MELS):
    """Same transform as extract_mel_spectrogram, but takes an already-loaded
    array. Used at inference time when audio comes from a live stream/buffer
    rather than a file on disk."""
    mel = librosa.feature.melspectrogram(
        y=y, sr=sr, n_mels=n_mels, fmax=8000,
        hop_length=512, n_fft=2048
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)
    mel_norm = (mel_db - mel_db.min()) / (mel_db.max() - mel_db.min() + 1e-6)
    return mel_norm.astype(np.float32)  # shape: (64, ~216)


def handcrafted_features(y, sr=SAMPLE_RATE):
    """MFCC/chroma/spectral-contrast/tonnetz/ZCR/RMS/centroid/bandwidth/rolloff
    statistics (mean + std each), feeding the LightGBM half of the ensemble.
    Must stay byte-for-byte identical to the version used in the training
    notebook or the LightGBM model will see out-of-distribution inputs."""
    feats = []
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=20)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    contrast = librosa.feature.spectral_contrast(y=y, sr=sr)
    tonnetz = librosa.feature.tonnetz(y=librosa.effects.harmonic(y), sr=sr)
    zcr = librosa.feature.zero_crossing_rate(y)
    rms = librosa.feature.rms(y=y)
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)

    for feat in [mfcc, chroma, contrast, tonnetz, zcr, rms, centroid, bandwidth, rolloff]:
        feats.append(feat.mean(axis=1))
        feats.append(feat.std(axis=1))
    return np.concatenate(feats).astype(np.float32)


def build_dataset():
    df = load_metadata()
    X, y = [], []

    for i, row in df.iterrows():
        filepath = os.path.join(AUDIO_DIR, row["filename"])
        try:
            mel = extract_mel_spectrogram(filepath)
            X.append(mel)
            y.append(TARGET_CLASSES.index(row["target_class"]))
        except Exception as e:
            print(f"Skipped {row['filename']}: {e}")

        if (i + 1) % 100 == 0:
            print(f"Processed {i + 1}/{len(df)} clips...")

    X = np.array(X)[..., np.newaxis]  # add channel dimension for CNN
    y = np.array(y)
    print(f"\nFinal dataset shape: {X.shape}, labels: {y.shape}")
    return X, y