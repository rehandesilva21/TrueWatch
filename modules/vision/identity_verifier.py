import os
import numpy as np
import cv2

# ─── DeepFace lazy import (heavy — only load when needed) ─────
_deepface = None

def _get_deepface():
    global _deepface
    if _deepface is None:
        from deepface import DeepFace
        _deepface = DeepFace
    return _deepface


REFERENCE_DIR = "data/identity_references"
os.makedirs(REFERENCE_DIR, exist_ok=True)

# Similarity threshold — cosine distance below this = same person
# ArcFace typical threshold is ~0.68 for cosine distance
MATCH_THRESHOLD = 0.68


class IdentityVerifier:
    """
    Registers a reference face embedding for a student and verifies
    the live webcam feed matches that identity throughout the exam.
    """

    def __init__(self, student_id):
        self.student_id       = student_id
        self.reference_path   = os.path.join(
            REFERENCE_DIR, f"student_{student_id}_ref.jpg"
        )
        self.reference_embedding = None
        self.registered        = os.path.exists(self.reference_path)

        # Rolling verification state
        self.consecutive_mismatches = 0
        self.MISMATCH_THRESHOLD     = 5   # ~5 checks before flagging
        self.last_check_time        = 0
        self.CHECK_INTERVAL         = 10  # seconds between identity checks

    def register(self, frame):
        """
        Save a reference face image during pre-exam calibration.
        Called once, the first time a student uses TrueWatch.
        """
        DeepFace = _get_deepface()

        # Verify a face is actually detectable before saving
        try:
            faces = DeepFace.extract_faces(
                frame, detector_backend="opencv",
                enforce_detection=True
            )
        except Exception as e:
            print(f"Registration failed — no clear face detected: {e}")
            return False

        cv2.imwrite(self.reference_path, frame)
        self.registered = True
        print(f"Identity reference registered for student {self.student_id}")
        return True

    def verify(self, frame):
        """
        Compare current frame against the registered reference.
        Returns: (is_match, distance, confidence)
        """
        if not self.registered:
            return True, 0.0, 0.0  # nothing to compare against yet

        DeepFace = _get_deepface()

        try:
            result = DeepFace.verify(
                img1_path=frame,
                img2_path=self.reference_path,
                model_name="ArcFace",
                detector_backend="opencv",
                distance_metric="cosine",
                enforce_detection=True,
            )
            is_match   = result["verified"]
            distance   = result["distance"]
            confidence = max(0.0, 1.0 - (distance / MATCH_THRESHOLD))
            return is_match, distance, confidence

        except Exception:
            # No face found in current frame — handled by face_tracker's
            # own "absent" detection, not an identity mismatch
            return True, 0.0, 0.0

    def should_check_now(self, current_time):
        """Rate-limit checks — identity verification is expensive."""
        if current_time - self.last_check_time >= self.CHECK_INTERVAL:
            self.last_check_time = current_time
            return True
        return False

    def update_mismatch_state(self, is_match):
        """
        Track consecutive mismatches. Returns True if an alert
        should fire (avoids single false-negative triggering alarm).
        """
        if not is_match:
            self.consecutive_mismatches += 1
        else:
            self.consecutive_mismatches = 0

        return self.consecutive_mismatches >= self.MISMATCH_THRESHOLD