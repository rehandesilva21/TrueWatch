import os
import statistics
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode
from modules.vision.lip_detector import LipMovementDetector, get_lip_distance

MODEL_PATH = "models/face_landmarker.task"

# ─── Landmark indices ──────────────────────────────────────────
LEFT_IRIS      = 473
LEFT_EYE_LEFT  = 263
LEFT_EYE_RIGHT = 362
NOSE_TIP       = 1
LEFT_EAR       = 234
RIGHT_EAR      = 454
UPPER_LIP      = 13
LOWER_LIP      = 14

def get_landmark_px(landmark, w, h):
    return int(landmark.x * w), int(landmark.y * h)

def get_gaze_ratio(iris, eye_left, eye_right):
    eye_width = abs(eye_right[0] - eye_left[0])
    if eye_width == 0:
        return 0.5
    return (iris[0] - eye_left[0]) / eye_width

def get_head_pose(landmarks, w, h):
    nose  = get_landmark_px(landmarks[NOSE_TIP], w, h)
    left  = get_landmark_px(landmarks[LEFT_EAR],  w, h)
    right = get_landmark_px(landmarks[RIGHT_EAR], w, h)
    total = abs(nose[0] - left[0]) + abs(nose[0] - right[0])
    if total == 0:
        return 0.5
    return abs(nose[0] - left[0]) / total

def draw_landmarks(frame, face_landmarks_list, w, h):
    for face_landmarks in face_landmarks_list:
        for lm in face_landmarks:
            cv2.circle(frame, (int(lm.x * w), int(lm.y * h)), 1, (0, 255, 0), -1)

# ──────────────────────────────────────────────────────────────
# CLAHE LOW-LIGHT ENHANCEMENT
# ──────────────────────────────────────────────────────────────
def enhance_frame(frame):
    """
    Apply CLAHE to the luminance channel only.
    Improves face detection in low-light without
    distorting colours or over-brightening good light.
    """
    lab   = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)

    # CLAHE on L channel only
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l)

    # Detect light level from original L channel
    avg_brightness = np.mean(l)

    # Only apply enhancement if frame is dark (below 100/255)
    if avg_brightness < 100:
        lab_enhanced = cv2.merge([l_enhanced, a, b])
        enhanced = cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)
        return enhanced, True, avg_brightness
    else:
        return frame, False, avg_brightness


# ──────────────────────────────────────────────────────────────
# EYE CONDITION PRE-EXAM REGISTRATION
# ──────────────────────────────────────────────────────────────
def run_eye_condition_check(cap):
    """
    Ask candidate if they have any eye conditions before
    calibration. If yes, apply wider tolerances.
    Returns: (has_condition, tolerance_multiplier)
    """
    print("\n--- Eye Condition Registration ---")

    tolerance_multiplier = 1.0
    has_condition        = False
    selected             = None
    options = [
        ("No eye conditions",               1.0),
        ("Strabismus (crossed eyes)",        2.5),
        ("Nystagmus (involuntary movement)", 3.0),
        ("Squint",                           2.0),
        ("Other / Unsure",                   2.0),
    ]

    while selected is None:
        # Build selection screen
        screen = np.zeros((480, 720, 3), dtype=np.uint8)

        cv2.putText(screen, "TrueWatch — Pre-Exam Eye Condition Registration",
                    (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        cv2.putText(screen, "Do you have any eye conditions? Press the number key to select:",
                    (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
        cv2.putText(screen, "This ensures TrueWatch monitors you fairly.",
                    (20, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1)

        for i, (label, _) in enumerate(options):
            y = 160 + i * 50
            cv2.rectangle(screen, (40, y - 25), (680, y + 15), (40, 40, 40), -1)
            cv2.rectangle(screen, (40, y - 25), (680, y + 15), (80, 80, 80), 1)
            cv2.putText(screen, f"  [{i+1}]  {label}",
                        (50, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (220, 220, 220), 1)

        cv2.putText(screen, "Press 1-5 to select",
                    (20, 440), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 200, 100), 1)

        cv2.imshow("TrueWatch - Proctoring Monitor", screen)
        key = cv2.waitKey(0) & 0xFF

        # Map key press to option
        for i in range(len(options)):
            if key == ord(str(i + 1)):
                selected             = i
                tolerance_multiplier = options[i][1]
                has_condition        = i > 0
                print(f"Selected: {options[i][0]} | Tolerance multiplier: {tolerance_multiplier}x")

    # Show confirmation
    confirm = np.zeros((200, 720, 3), dtype=np.uint8)
    label, _ = options[selected]
    cv2.putText(confirm, f"Registered: {label}",
                (20, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 100), 2)
    cv2.putText(confirm, "Tolerances adjusted. Press any key to start calibration.",
                (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)
    cv2.imshow("TrueWatch - Proctoring Monitor", confirm)
    cv2.waitKey(2000)

    return has_condition, tolerance_multiplier


# ──────────────────────────────────────────────────────────────
# CALIBRATION
# ──────────────────────────────────────────────────────────────
def run_calibration(landmarker, cap, lip_detector, tolerance_multiplier=1.0):
    print("Starting calibration...")
    CALIBRATION_FRAMES = 60
    gaze_samples = []
    head_samples = []
    lip_samples  = []
    collected    = 0

    while collected < CALIBRATION_FRAMES:
        ret, frame = cap.read()
        if not ret:
            continue

        frame            = cv2.flip(frame, 1)
        frame, enhanced, brightness = enhance_frame(frame)
        h, w             = frame.shape[:2]
        rgb              = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img           = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result           = landmarker.detect(mp_img)

        if result.face_landmarks and len(result.face_landmarks) == 1:
            lm        = result.face_landmarks[0]
            left_iris = get_landmark_px(lm[LEFT_IRIS],      w, h)
            l_eye_l   = get_landmark_px(lm[LEFT_EYE_LEFT],  w, h)
            l_eye_r   = get_landmark_px(lm[LEFT_EYE_RIGHT], w, h)
            gaze_samples.append(get_gaze_ratio(left_iris, l_eye_l, l_eye_r))
            head_samples.append(get_head_pose(lm, w, h))
            lip_samples.append(get_lip_distance(lm, w, h))
            collected += 1

        # Progress bar
        progress = int((collected / CALIBRATION_FRAMES) * w)
        cv2.rectangle(frame, (0, h - 30), (progress, h), (0, 200, 0), -1)
        cv2.putText(frame, "CALIBRATION: Look straight, keep mouth closed",
                    (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
        cv2.putText(frame, f"Hold still... {collected}/{CALIBRATION_FRAMES}",
                    (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)

        # Show light level indicator
        light_label = f"Light: {'LOW - Enhancing' if enhanced else 'Good'} ({brightness:.0f}/255)"
        light_color = (0, 165, 255) if enhanced else (0, 200, 0)
        cv2.putText(frame, light_label,
                    (20, 125), cv2.FONT_HERSHEY_SIMPLEX, 0.5, light_color, 1)

        cv2.imshow("TrueWatch - Proctoring Monitor", frame)
        cv2.waitKey(1)

    # Compute baselines with tolerance multiplier applied
    baseline_gaze = sum(gaze_samples) / len(gaze_samples)
    baseline_head = sum(head_samples) / len(head_samples)

    gaze_std = statistics.stdev(gaze_samples) if len(gaze_samples) > 1 else 0.05
    head_std = statistics.stdev(head_samples) if len(head_samples) > 1 else 0.05

    # Apply eye condition multiplier to tolerances
    gaze_tol = max(gaze_std * 2.5, 0.10) * tolerance_multiplier
    head_tol = max(head_std * 2.5, 0.08) * tolerance_multiplier

    lip_detector.calibrate(lip_samples)

    print(f"Gaze baseline : {baseline_gaze:.3f} ± {gaze_tol:.3f}")
    print(f"Head baseline : {baseline_head:.3f} ± {head_tol:.3f}")
    print(f"Tolerance multiplier applied: {tolerance_multiplier}x")
    print("Calibration complete!")

    return baseline_gaze, baseline_head, gaze_tol, head_tol


# ──────────────────────────────────────────────────────────────
# MAIN TRACKER
# ──────────────────────────────────────────────────────────────
def run_face_tracker():
    if not os.path.exists(MODEL_PATH):
        print(f"Model not found at {MODEL_PATH}")
        exit(1)

    options = FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=RunningMode.IMAGE,
        num_faces=2,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_face_blendshapes=False,
        output_facial_transformation_matrixes=False,
    )

    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Cannot access webcam.")
        return

    print("TrueWatch v0.5 — Full Model 1 + CLAHE + Eye Condition Support")

    lip_detector = LipMovementDetector()

    with FaceLandmarker.create_from_options(options) as landmarker:

        # ── Step 1: Eye condition registration ────────────
        has_condition, tol_multiplier = run_eye_condition_check(cap)

        # ── Step 2: Calibration ───────────────────────────
        baseline_gaze, baseline_head, gaze_tol, head_tol = run_calibration(
            landmarker, cap, lip_detector, tol_multiplier
        )

        print("Monitoring started. Press Q to quit.")

        gaze_alert_frames = 0
        head_alert_frames = 0
        absent_frames     = 0
        ALERT_THRESHOLD   = 20

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)

            # ── CLAHE enhancement ──────────────────────────
            frame, enhanced, brightness = enhance_frame(frame)

            h, w   = frame.shape[:2]
            rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = landmarker.detect(mp_img)

            face_count = len(result.face_landmarks) if result.face_landmarks else 0
            alerts     = []

            # ── No face ────────────────────────────────────
            if face_count == 0:
                absent_frames += 1
                if absent_frames >= ALERT_THRESHOLD:
                    alerts.append(("ABSENT: No face in frame!", (0, 0, 255)))
            else:
                absent_frames = 0

            # ── Multiple faces ─────────────────────────────
            if face_count > 1:
                alerts.append((f"ALERT: {face_count} faces detected!", (0, 100, 255)))

            # ── Per-face analysis ──────────────────────────
            if face_count >= 1:
                draw_landmarks(frame, result.face_landmarks, w, h)
                lm = result.face_landmarks[0]

                left_iris = get_landmark_px(lm[LEFT_IRIS],      w, h)
                l_eye_l   = get_landmark_px(lm[LEFT_EYE_LEFT],  w, h)
                l_eye_r   = get_landmark_px(lm[LEFT_EYE_RIGHT], w, h)
                gaze      = get_gaze_ratio(left_iris, l_eye_l, l_eye_r)
                head      = get_head_pose(lm, w, h)
                lip_ratio = get_lip_distance(lm, w, h)
                _, _, lip_alert = lip_detector.update(lip_ratio)

                # Gaze alert
                if abs(gaze - baseline_gaze) > gaze_tol:
                    gaze_alert_frames += 1
                    if gaze_alert_frames >= ALERT_THRESHOLD:
                        alerts.append(("GAZE: Looking away!", (0, 165, 255)))
                else:
                    gaze_alert_frames = max(0, gaze_alert_frames - 1)

                # Head alert
                if abs(head - baseline_head) > head_tol:
                    head_alert_frames += 1
                    if head_alert_frames >= ALERT_THRESHOLD:
                        alerts.append(("HEAD: Turned away!", (0, 165, 255)))
                else:
                    head_alert_frames = max(0, head_alert_frames - 1)

                # Lip alert
                if lip_alert:
                    alerts.append(("LIP: Possible whispering!", (0, 200, 255)))

                # Lip landmark highlight
                ul        = get_landmark_px(lm[UPPER_LIP], w, h)
                ll        = get_landmark_px(lm[LOWER_LIP], w, h)
                lip_color = (0, 200, 255) if lip_alert else (100, 100, 100)
                cv2.circle(frame, ul, 4, lip_color, -1)
                cv2.circle(frame, ll, 4, lip_color, -1)
                cv2.line(frame, ul, ll, lip_color, 2)

                # Debug bar
                cv2.putText(frame,
                    f"Gaze:{gaze:.2f}(b:{baseline_gaze:.2f}) "
                    f"Head:{head:.2f}(b:{baseline_head:.2f}) "
                    f"Lip:{lip_ratio:.3f}",
                    (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (150, 150, 150), 1)

            # ── Light indicator (top right corner) ─────────
            light_txt   = "ENHANCING" if enhanced else f"Light OK"
            light_color = (0, 165, 255) if enhanced else (0, 200, 0)
            cv2.putText(frame, light_txt, (w - 150, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, light_color, 1)

            # ── Eye condition badge ────────────────────────
            if has_condition:
                cv2.putText(frame, "EYE CONDITION: Wide tolerance active",
                            (w - 310, 40), cv2.FONT_HERSHEY_SIMPLEX,
                            0.38, (200, 150, 255), 1)

            # ── Status ─────────────────────────────────────
            if not alerts:
                cv2.putText(frame, "OK: Candidate focused",
                            (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 0), 2)
            else:
                for i, (msg, color) in enumerate(alerts):
                    cv2.putText(frame, msg, (20, 40 + i * 40),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.75, color, 2)

            # ── Legend ─────────────────────────────────────
            legend = [
                ("G = Gaze away",    (0, 165, 255)),
                ("H = Head turned",  (0, 165, 255)),
                ("L = Lip movement", (0, 200, 255)),
                ("A = Absent",       (0, 0,   255)),
                ("M = Multi-face",   (0, 100, 255)),
            ]
            for i, (txt, col) in enumerate(legend):
                cv2.putText(frame, txt, (w - 200, 70 + i * 22),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, col, 1)

            cv2.putText(frame, "TrueWatch v0.5 | Press Q to quit",
                        (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX,
                        0.45, (150, 150, 150), 1)

            cv2.imshow("TrueWatch - Proctoring Monitor", frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    cap.release()
    cv2.destroyAllWindows()
    print("TrueWatch stopped.")

if __name__ == "__main__":
    run_face_tracker()

def run_identity_registration(cap, verifier):
    """
    Capture and register the student's reference face if not
    already registered. Runs once per student, first session only.
    """
    if verifier.registered:
        print(f"Identity already registered for student {verifier.student_id}")
        return

    print("Registering identity reference...")

    while True:
        ret, frame = cap.read()
        if not ret:
            continue

        frame = cv2.flip(frame, 1)
        h, w  = frame.shape[:2]

        cv2.putText(frame, "IDENTITY SETUP: Look at camera, press SPACE to capture",
                    (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 255, 255), 2)
        cv2.putText(frame, "This photo confirms it's really you during the exam",
                    (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        cv2.imshow("TrueWatch - Proctoring Monitor", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(' '):
            success = verifier.register(frame)
            if success:
                # Confirmation screen
                confirm = frame.copy()
                cv2.putText(confirm, "Identity registered successfully!",
                            (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.imshow("TrueWatch - Proctoring Monitor", confirm)
                cv2.waitKey(1500)
                break
            else:
                cv2.putText(frame, "No clear face detected — try again",
                            (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)