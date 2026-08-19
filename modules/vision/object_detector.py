import os

# ─── Thread-pool limits ──────────────────────────────────────────
# OpenCV and PyTorch (which YOLO uses) each spin up their own internal
# thread pools. On macOS, when both are active in the same process
# alongside TensorFlow/Keras and LightGBM (as they are here — this
# module gets imported into the same Flask process as the audio
# ensemble), PyTorch's thread pool initializing after OpenCV has already
# claimed threads is a known cause of a silent deadlock on the FIRST
# real computation — not at import time, not at model construction, but
# the moment actual inference math starts. This matches the exact
# symptom hit during development: ObjectDetector() constructed cleanly,
# "YOLO model loaded." printed, then the first .detect() call hung
# forever with no error, no crash, nothing. These two lines must run
# BEFORE cv2/torch are given a chance to claim their default thread
# pools, so they're placed at the very top of this module, ahead of the
# cv2/torch imports themselves.
import cv2
cv2.setNumThreads(1)

# ─── Disable Ultralytics' background analytics sync ──────────────
# Prevents YOLO's first instantiation from attempting a network call to
# Ultralytics' own servers, which can hang indefinitely on a restricted
# or slow network. Applied before importing YOLO itself so the setting
# takes effect before any sync attempt could be triggered.
from ultralytics import settings as ultra_settings
ultra_settings.update({"sync": False})

from ultralytics import YOLO
import torch
torch.set_num_threads(1)   # same class of fix as cv2.setNumThreads above,
                             # applied to PyTorch's own thread pool

import numpy as np


# ─── Prohibited items — subset of COCO classes YOLO already knows ──
# YOLOv8 pretrained on COCO already recognizes these — no custom
# training needed for the base detection, only for hand-distance logic
PROHIBITED_CLASSES = {
    "cell phone": "PHONE",
    "book":       "BOOK",
    "laptop":     "SECOND_DEVICE",
    "tablet":     "SECOND_DEVICE",
    "remote":     "REMOTE",
}

CONFIDENCE_THRESHOLD = 0.45
HAND_PROXIMITY_PX    = 120   # pixels — "actively holding" distance

# ─── Absolute path, anchored to this file's location ────────────
# A relative "yolov8n.pt" path resolves against whatever the current
# working directory happens to be when Flask starts — which previously
# produced two different weight files in two different folders
# depending on how the server was launched (project root vs backend/).
# Anchoring to this file's own location, same pattern as MODEL_DIR in
# audio_inference.py, removes that ambiguity entirely.
_MODELS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)
YOLO_WEIGHTS_PATH = os.path.join(_MODELS_DIR, "yolov8n.pt")


class ObjectDetector:
    """
    YOLO-based prohibited item detector with hand-proximity scoring.
    Distinguishes "item visible on desk" from "item actively in hand"
    to reduce false positives, following the AutoOEP paper's approach.
    """

    def __init__(self):
        self.model  = None
        self.loaded = False

    def load(self):
        """Lazy load — YOLO model only loads when first needed."""
        if not self.loaded:
            print(f"Loading YOLO object detection model from {YOLO_WEIGHTS_PATH}...")
            self.model  = YOLO(YOLO_WEIGHTS_PATH)
            self.loaded = True
            print("YOLO model loaded.")

    def detect(self, frame):
        """
        Run detection on a frame.
        Returns list of dicts: {class, confidence, box, center}
        """
        self.load()

        # device='cpu' explicitly — on Apple Silicon, Ultralytics can
        # auto-select the MPS (Metal) backend, which has its own history
        # of hangs/incompatibilities with certain operations. These
        # models are small enough that CPU inference is fast enough
        # regardless, so forcing CPU removes MPS as a variable entirely.
        results = self.model(frame, verbose=False, device='cpu')[0]
        detections = []

        for box in results.boxes:
            cls_id   = int(box.cls[0])
            cls_name = self.model.names[cls_id]
            conf     = float(box.conf[0])

            if cls_name not in PROHIBITED_CLASSES:
                continue
            if conf < CONFIDENCE_THRESHOLD:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2

            detections.append({
                "class":      PROHIBITED_CLASSES[cls_name],
                "raw_class":  cls_name,
                "confidence": conf,
                "box":        (int(x1), int(y1), int(x2), int(y2)),
                "center":     (center_x, center_y),
            })

        return detections

    def check_hand_proximity(self, detections, hand_landmarks_list, w, h):
        """
        For each detected object, check if any hand is close enough
        to count as "actively being used" rather than just present.

        hand_landmarks_list: list of MediaPipe hand landmark sets
        (from MediaPipe Hands, wrist landmark index 0 used as hand center)

        Returns updated detections with 'in_use' flag added.
        """
        for det in detections:
            obj_x, obj_y = det["center"]
            det["in_use"] = False
            det["min_hand_distance"] = float("inf")

            for hand_landmarks in hand_landmarks_list:
                # Wrist landmark (index 0) as hand reference point
                wrist = hand_landmarks[0]
                hand_x = wrist.x * w
                hand_y = wrist.y * h

                distance = np.sqrt(
                    (obj_x - hand_x) ** 2 + (obj_y - hand_y) ** 2
                )

                if distance < det["min_hand_distance"]:
                    det["min_hand_distance"] = distance

                if distance < HAND_PROXIMITY_PX:
                    det["in_use"] = True

        return detections