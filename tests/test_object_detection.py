import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

import cv2
import mediapipe as mp
from modules.vision.object_detector import ObjectDetector
from modules.vision.hand_tracker import HandTracker

def test_object_detection():
    detector     = ObjectDetector()
    hand_tracker = HandTracker()
    cap          = cv2.VideoCapture(0)

    print("Hold up your phone or a book. Press Q to quit.")
    print("First run downloads YOLO weights (~6MB)...")

    while True:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        h, w  = frame.shape[:2]

        # Object detection
        detections = detector.detect(frame)

        # Hand tracking
        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        hands  = hand_tracker.detect(mp_img)
        hand_tracker.draw(frame, hands, w, h)

        # Check proximity
        detections = detector.check_hand_proximity(detections, hands, w, h)

        # Draw results
        for det in detections:
            x1, y1, x2, y2 = det["box"]
            color = (0, 0, 255) if det["in_use"] else (0, 165, 255)
            label = f"{det['class']} {'IN USE' if det['in_use'] else 'visible'} ({det['confidence']:.0%})"

            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(frame, label, (x1, y1 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        cv2.putText(frame, f"Objects detected: {len(detections)}",
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        cv2.imshow("Object Detection Test", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    test_object_detection()