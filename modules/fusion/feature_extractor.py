import numpy as np

# ─── Feature vector definition ─────────────────────────────────
# Each frame becomes a 10-dimensional vector combining every
# signal TrueWatch already produces. The LSTM learns patterns
# ACROSS a window of frames rather than judging each one alone.

FEATURE_NAMES = [
    "gaze_deviation",      # 0.0–1.0+ normalized distance from baseline
    "head_deviation",      # 0.0–1.0+ normalized distance from baseline
    "lip_movement",        # 0 or 1 — sustained lip movement flag
    "absent_flag",         # 0 or 1 — no face in frame
    "multi_face_flag",     # 0 or 1 — more than one face
    "audio_severity",      # 0=silence .. 1=loud, ordinal scale /4
    "audio_alert_flag",    # 0 or 1 — audio classifier fired
    "identity_mismatch",   # 0 or 1 — face doesn't match registered student
    "object_in_use",       # 0 or 1 — prohibited item near hand
    "tab_switch_flag",     # 0 or 1 — browser/app focus lost
]

AUDIO_SEVERITY_MAP = {
    "silence": 0.0, "ambient": 0.1, "whisper": 0.5,
    "speech":  0.6, "paper":   0.4, "loud":    1.0,
}


def extract_frame_features(
    gaze, baseline_gaze, gaze_tol,
    head, baseline_head, head_tol,
    lip_alert, face_count,
    audio_class, audio_alert,
    identity_mismatch, object_in_use, tab_switch,
):
    """
    Build one feature vector for the current frame from
    TrueWatch's existing per-model outputs. Called once per
    frame inside the main loop, fed into the sliding window.
    """
    gaze_dev = abs(gaze - baseline_gaze) / max(gaze_tol, 1e-6)
    head_dev = abs(head - baseline_head) / max(head_tol, 1e-6)

    vector = np.array([
        min(gaze_dev, 3.0) / 3.0,                        # clip + normalize
        min(head_dev, 3.0) / 3.0,
        1.0 if lip_alert else 0.0,
        1.0 if face_count == 0 else 0.0,
        1.0 if face_count > 1 else 0.0,
        AUDIO_SEVERITY_MAP.get(audio_class, 0.0),
        1.0 if audio_alert else 0.0,
        1.0 if identity_mismatch else 0.0,
        1.0 if object_in_use else 0.0,
        1.0 if tab_switch else 0.0,
    ], dtype=np.float32)

    return vector


class SlidingWindowBuffer:
    """
    Maintains the last N frames of features for the LSTM.
    The paper uses a 15-frame window — enough to capture a
    sustained behaviour without reacting to single-frame noise.
    """

    def __init__(self, window_size=15, n_features=10):
        self.window_size = window_size
        self.n_features  = n_features
        self.buffer      = np.zeros((window_size, n_features), dtype=np.float32)
        self.filled      = 0

    def push(self, feature_vector):
        """Shift buffer left, add new frame at the end."""
        self.buffer = np.roll(self.buffer, -1, axis=0)
        self.buffer[-1] = feature_vector
        self.filled = min(self.filled + 1, self.window_size)

    def is_ready(self):
        """Only trust predictions once the window has real data."""
        return self.filled >= self.window_size

    def get_window(self):
        """Returns shape (1, window_size, n_features) for model input."""
        return self.buffer.reshape(1, self.window_size, self.n_features)