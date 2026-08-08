import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

import cv2
from modules.vision.identity_verifier import IdentityVerifier

def test_identity():
    verifier = IdentityVerifier(student_id=999)
    cap = cv2.VideoCapture(0)

    print("Press SPACE to register your face, Q to quit")
    while True:
        ret, frame = cap.read()
        if not ret:
            continue
        frame = cv2.flip(frame, 1)

        status = "Registered" if verifier.registered else "Not registered — press SPACE"
        cv2.putText(frame, status, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        if verifier.registered:
            is_match, dist, conf = verifier.verify(frame)
            label = f"Match: {is_match} | Distance: {dist:.3f} | Conf: {conf:.0%}"
            color = (0, 200, 0) if is_match else (0, 0, 255)
            cv2.putText(frame, label, (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        cv2.imshow("Identity Test", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(' ') and not verifier.registered:
            verifier.register(frame)
        elif key == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    test_identity()