import os
import numpy as np
import cv2

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
            print("Loading YOLO object detection model...")
            from ultralytics import YOLO
            self.model  = YOLO("yolov8n.pt")   # nano — fastest variant
            self.loaded = True
            print("YOLO model loaded.")

    def detect(self, frame):
        """
        Run detection on a frame.
        Returns list of dicts: {class, confidence, box, center}
        """
        self.load()

        results = self.model(frame, verbose=False)[0]
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