import os
os.environ.setdefault('PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION', 'python')

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import urllib.request

HAND_MODEL_PATH = "models/hand_landmarker.task"


def download_hand_model():
    if not os.path.exists(HAND_MODEL_PATH):
        print("Downloading hand landmarker model...")
        url = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
        os.makedirs("models", exist_ok=True)
        try:
            urllib.request.urlretrieve(url, HAND_MODEL_PATH)
            print("Hand model downloaded.")
        except Exception as e:
            print(f"Download failed: {e}")
            print(f"Please download manually from:\n{url}")
            print(f"Save to: {HAND_MODEL_PATH}")


class HandTracker:
    def __init__(self):
        download_hand_model()
        self.landmarker = None
        if os.path.exists(HAND_MODEL_PATH):
            options = vision.HandLandmarkerOptions(
                base_options=python.BaseOptions(
                    model_asset_path=HAND_MODEL_PATH),
                running_mode=vision.RunningMode.IMAGE,
                num_hands=2,
                min_hand_detection_confidence=0.5,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5,
            )
            self.landmarker = vision.HandLandmarker.create_from_options(options)

    def detect(self, mp_image):
        """Returns list of hand landmark sets (empty list if none/unavailable)."""
        if self.landmarker is None:
            return []
        result = self.landmarker.detect(mp_image)
        return result.hand_landmarks if result.hand_landmarks else []

    def draw(self, frame, hand_landmarks_list, w, h):
        for hand in hand_landmarks_list:
            for lm in hand:
                x, y = int(lm.x * w), int(lm.y * h)
                cv2.circle(frame, (x, y), 3, (255, 200, 0), -1)