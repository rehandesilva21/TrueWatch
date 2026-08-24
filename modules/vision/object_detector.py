import os
import cv2
cv2.setNumThreads(1)
from ultralytics import settings as ultra_settings
ultra_settings.update({"sync": False})

from ultralytics import YOLO
import torch
torch.set_num_threads(1)  
                             

import numpy as np

PROHIBITED_CLASSES = {
    "cell phone": "PHONE",
    "book":       "BOOK",
    "laptop":     "SECOND_DEVICE",
    "tablet":     "SECOND_DEVICE",
    "remote":     "REMOTE",
}

CONFIDENCE_THRESHOLD = 0.45
HAND_PROXIMITY_PX    = 120 
_MODELS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "models",
)
YOLO_WEIGHTS_PATH = os.path.join(_MODELS_DIR, "yolov8n.pt")


class ObjectDetector:
   

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
        
        self.load()

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