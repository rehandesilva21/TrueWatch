"""
Shared face-cropping helper for identity verification.

DeepFace's own face detector (`detector_backend="opencv"`) is a Haar-cascade
model that frequently fails on compressed, low-res webcam JPEG snapshots from
a browser canvas — that's the most common reason identity checks silently
come back inconclusive (is_match=None) instead of true/false.

MediaPipe's FaceLandmarker is already proven reliable elsewhere in this
project (gaze/head tracking runs on it continuously). This module reuses the
same model to find + tightly crop the face, so DeepFace only ever has to do
recognition (ArcFace) on a face we've already confirmed is there — call it
with detector_backend="skip" and enforce_detection=False downstream.
"""

import os
import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

MODEL_PATH = "models/face_landmarker.task"

_landmarker = None


def _get_landmarker():
    """Lazy singleton — loading the .task model is not cheap, do it once."""
    global _landmarker
    if _landmarker is None:
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError(f"Face landmarker model not found at {MODEL_PATH}")
        options = FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=RunningMode.IMAGE,
            num_faces=2,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        _landmarker = FaceLandmarker.create_from_options(options)
    return _landmarker


def crop_face(frame_bgr, margin=0.35):
    """
    Detects the largest face in frame_bgr and returns a tightly cropped
    BGR image around it (with a margin so ArcFace still has context),
    or None if no face was found.

    If multiple faces are detected, the largest one is used — for
    registration/verification we want "the" face, and a bigger face in
    frame is almost always the candidate rather than someone in the
    background.
    """
    landmarker = _get_landmarker()
    h, w = frame_bgr.shape[:2]
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_img)

    if not result.face_landmarks:
        return None

    best_box = None
    best_area = 0
    for face_landmarks in result.face_landmarks:
        xs = [lm.x * w for lm in face_landmarks]
        ys = [lm.y * h for lm in face_landmarks]
        x1, x2 = min(xs), max(xs)
        y1, y2 = min(ys), max(ys)
        area = (x2 - x1) * (y2 - y1)
        if area > best_area:
            best_area = area
            best_box = (x1, y1, x2, y2)

    x1, y1, x2, y2 = best_box
    bw, bh = x2 - x1, y2 - y1

    # Expand the tight landmark box by `margin` on each side — ArcFace
    # performs better with some context around the face, not just the
    # inner landmark region (which excludes ears/chin/forehead edges).
    x1 = max(0, int(x1 - bw * margin))
    y1 = max(0, int(y1 - bh * margin))
    x2 = min(w, int(x2 + bw * margin))
    y2 = min(h, int(y2 + bh * margin))

    if x2 <= x1 or y2 <= y1:
        return None

    return frame_bgr[y1:y2, x1:x2]
