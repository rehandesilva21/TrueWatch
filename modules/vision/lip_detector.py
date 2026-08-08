import statistics

# ─── Lip landmark indices (MediaPipe 478 landmarks) ────────────
# Upper lip top and lower lip bottom give maximum open/close range
UPPER_LIP_TOP    = 13
LOWER_LIP_BOTTOM = 14
LEFT_LIP_CORNER  = 61
RIGHT_LIP_CORNER = 291

# Extra points for better accuracy
UPPER_LIP_INNER  = 312
LOWER_LIP_INNER  = 317

def get_lip_distance(landmarks, w, h):
    """Calculate vertical distance between upper and lower lip."""
    upper = landmarks[UPPER_LIP_TOP]
    lower = landmarks[LOWER_LIP_BOTTOM]
    left  = landmarks[LEFT_LIP_CORNER]
    right = landmarks[RIGHT_LIP_CORNER]

    # Lip opening in pixels
    lip_open = abs(lower.y - upper.y) * h

    # Normalize by mouth width so face distance from camera doesn't matter
    mouth_width = abs(right.x - left.x) * w
    if mouth_width == 0:
        return 0.0

    return lip_open / mouth_width  # ratio: ~0.0 closed, ~0.3+ open


class LipMovementDetector:
    def __init__(self):
        self.baseline_ratio  = None
        self.baseline_std    = None
        self.tolerance       = None
        self.history         = []       # recent lip ratios
        self.HISTORY_SIZE    = 30       # rolling window (~2 sec)
        self.movement_frames = 0
        self.ALERT_THRESHOLD = 20       # frames of sustained movement

    # ── Calibration ────────────────────────────────────────────
    def calibrate(self, samples):
        """Called with list of lip ratio samples from calibration phase."""
        self.baseline_ratio = sum(samples) / len(samples)
        std = statistics.stdev(samples) if len(samples) > 1 else 0.02
        self.tolerance = max(std * 3.0, 0.04)  # minimum tolerance 0.04
        print(f"Lip baseline: {self.baseline_ratio:.3f} ± {self.tolerance:.3f}")

    # ── Per-frame update ────────────────────────────────────────
    def update(self, lip_ratio):
        """
        Feed one frame's lip ratio.
        Returns: (is_moving, current_ratio, alert)
        """
        if self.baseline_ratio is None:
            return False, lip_ratio, False

        # Rolling history for smoothing
        self.history.append(lip_ratio)
        if len(self.history) > self.HISTORY_SIZE:
            self.history.pop(0)

        smoothed = sum(self.history) / len(self.history)
        deviated = abs(smoothed - self.baseline_ratio) > self.tolerance

        if deviated:
            self.movement_frames += 1
        else:
            self.movement_frames = max(0, self.movement_frames - 1)

        alert = self.movement_frames >= self.ALERT_THRESHOLD
        return deviated, smoothed, alert