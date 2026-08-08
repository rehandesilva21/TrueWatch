import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

import base64
import cv2
import numpy as np
import mediapipe as mp
import statistics
import time
import requests
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from mediapipe.tasks.python.vision import FaceLandmarker, FaceLandmarkerOptions, RunningMode

from modules.vision.face_tracker import (
    enhance_frame, draw_landmarks, get_landmark_px,
    get_gaze_ratio, get_head_pose,
    run_eye_condition_check, run_calibration,
    MODEL_PATH, LEFT_IRIS, LEFT_EYE_LEFT,
    LEFT_EYE_RIGHT, UPPER_LIP, LOWER_LIP
)
from modules.vision.lip_detector import LipMovementDetector, get_lip_distance
from modules.vision.identity_verifier import IdentityVerifier
from modules.vision.object_detector import ObjectDetector
from modules.vision.hand_tracker import HandTracker
from modules.fusion.feature_extractor import extract_frame_features, SlidingWindowBuffer
from modules.fusion.lstm_model import load_fusion_model
from modules.audio.sound_classifier import AudioMonitor
from backend.utils.incident_logger import IncidentLogger
from backend.utils.tab_monitor import TabMonitor


# ──────────────────────────────────────────────────────────────
# API LOGGING HELPER — fire-and-forget POSTs to Flask/MySQL
# ──────────────────────────────────────────────────────────────
API_BASE = "http://localhost:5001/api"

def post_to_api(endpoint, payload, session_token):
    """
    Non-blocking POST to the Flask API. Never crashes the main loop
    if the API is down — the local JSON log (IncidentLogger) always
    remains the source of truth; this is a secondary DB write.
    """
    if not session_token:
        return
    try:
        payload = dict(payload)
        payload["session_token"] = session_token
        requests.post(f"{API_BASE}/{endpoint}", json=payload, timeout=0.5)
    except Exception:
        pass


# ──────────────────────────────────────────────────────────────
# IDENTITY REGISTRATION
# ──────────────────────────────────────────────────────────────
def run_identity_registration(cap, verifier):
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
        cv2.putText(frame, "Press Q to skip (not recommended)",
                    (20, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 150, 150), 1)

        cv2.imshow("TrueWatch - Proctoring Monitor", frame)
        key = cv2.waitKey(1) & 0xFF

        if key == ord(' '):
            success = verifier.register(frame)
            if success:
                confirm = frame.copy()
                cv2.putText(confirm, "Identity registered successfully!",
                            (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                cv2.imshow("TrueWatch - Proctoring Monitor", confirm)
                cv2.waitKey(1500)
                break
            else:
                cv2.putText(frame, "No clear face detected — try again",
                            (20, 130), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)
                cv2.imshow("TrueWatch - Proctoring Monitor", frame)
                cv2.waitKey(500)

        elif key == ord('q'):
            print("Identity registration skipped by user.")
            break


# ──────────────────────────────────────────────────────────────
# MAIN TRUEWATCH LOOP
# ──────────────────────────────────────────────────────────────
def run_truewatch(student_id=1, session_token=None):
    """
    session_token: pass the token returned by POST /api/session/start
    once your desktop app authenticates and starts a session via the
    Flask API. If None, all API logging calls are silently skipped
    and only the local JSON incident log is used (current behaviour).
    """
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

    cap                = cv2.VideoCapture(0)
    lip_detector       = LipMovementDetector()
    audio              = AudioMonitor()
    logger             = IncidentLogger(session_token=session_token)
    tab_monitor        = TabMonitor(incident_logger=logger)
    identity_verifier  = IdentityVerifier(student_id=student_id)
    object_detector    = ObjectDetector()
    hand_tracker       = HandTracker()
    fusion_model       = load_fusion_model()
    fusion_buffer      = SlidingWindowBuffer(window_size=15, n_features=10)

    if not cap.isOpened():
        print("Cannot access webcam.")
        return

    print("TrueWatch v1.1 — Full System + Database Logging")
    if session_token:
        print(f"Session token active — new signals will be saved to MySQL.")
    else:
        print("No session token — running in local-only mode (JSON log only).")

    OBJECT_CHECK_EVERY = 3
    FUSION_LOG_EVERY   = 30    # throttle fusion score DB writes (~every 2 sec at 15fps)
    frame_count        = 0
    last_detections     = []
    last_hands           = []
    session_start_time    = time.time()

    with FaceLandmarker.create_from_options(options) as landmarker:

        # ── Step 1: Identity registration (once per student) ──
        run_identity_registration(cap, identity_verifier)

        # ── Step 2: Eye condition registration ─────────────
        has_condition, tol_multiplier = run_eye_condition_check(cap)

        # ── Step 3: Audio calibration ───────────────────────
        print("Calibrating audio — stay quiet for 4 seconds...")
        audio.calibrate(duration_seconds=4)

        # ── Step 4: Visual calibration ──────────────────────
        baseline_gaze, baseline_head, gaze_tol, head_tol = run_calibration(
            landmarker, cap, lip_detector, tol_multiplier
        )

        # ── Step 5: Start background monitors ───────────────
        audio.start()
        tab_monitor.start()

        print("TrueWatch monitoring started. Press Q to quit.")

        gaze_alert_frames = 0
        head_alert_frames = 0
        absent_frames     = 0
        ALERT_THRESHOLD   = 20
        lip_ratio         = 0.0
        gaze              = 0.0
        head              = 0.0
        identity_status   = "Not checked yet"
        identity_color    = (150, 150, 150)
        fusion_score      = 0.0
        FRAME_PUSH_EVERY = 30

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            elapsed_secs = int(time.time() - session_start_time)

            frame                       = cv2.flip(frame, 1)
            frame, enhanced, brightness = enhance_frame(frame)
            h, w                        = frame.shape[:2]
            rgb                         = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_img                      = mp.Image(
                                            image_format=mp.ImageFormat.SRGB,
                                            data=rgb)
            result                      = landmarker.detect(mp_img)

            face_count   = len(result.face_landmarks) if result.face_landmarks else 0
            alerts       = []
            audio_result = audio.get_result()
            tab_status   = tab_monitor.get_status()
            lip_alert    = False
            frame_count += 1

            
            if frame_count % FRAME_PUSH_EVERY == 0 and session_token:
                _, buf = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
                b64 = base64.b64encode(buf).decode('utf-8')
                post_to_api("session/frame", {"frame": f"data:image/jpeg;base64,{b64}"}, session_token)

            # ── No face ────────────────────────────────────
            if face_count == 0:
                absent_frames += 1
                if absent_frames >= ALERT_THRESHOLD:
                    alerts.append(("ABSENT: No face in frame!", (0, 0, 255)))
                    logger.log("ABSENT", 0.99, frame, "No face detected")
            else:
                absent_frames = 0

            # ── Multiple faces ─────────────────────────────
            if face_count > 1:
                alerts.append((f"ALERT: {face_count} faces!", (0, 100, 255)))
                logger.log("MULTI_FACE", 0.99, frame,
                           f"{face_count} faces detected")

            # ── Vision analysis ────────────────────────────
            if face_count >= 1:
                draw_landmarks(frame, result.face_landmarks, w, h)
                lm        = result.face_landmarks[0]
                left_iris = get_landmark_px(lm[LEFT_IRIS],      w, h)
                l_eye_l   = get_landmark_px(lm[LEFT_EYE_LEFT],  w, h)
                l_eye_r   = get_landmark_px(lm[LEFT_EYE_RIGHT], w, h)
                gaze      = get_gaze_ratio(left_iris, l_eye_l, l_eye_r)
                head      = get_head_pose(lm, w, h)
                lip_ratio = get_lip_distance(lm, w, h)
                _, _, lip_alert = lip_detector.update(lip_ratio)

                if abs(gaze - baseline_gaze) > gaze_tol:
                    gaze_alert_frames += 1
                    if gaze_alert_frames >= ALERT_THRESHOLD:
                        alerts.append(("GAZE: Looking away!", (0, 165, 255)))
                        logger.log("GAZE", 0.85, frame,
                                   f"Gaze:{gaze:.2f} base:{baseline_gaze:.2f}")
                else:
                    gaze_alert_frames = max(0, gaze_alert_frames - 1)

                if abs(head - baseline_head) > head_tol:
                    head_alert_frames += 1
                    if head_alert_frames >= ALERT_THRESHOLD:
                        alerts.append(("HEAD: Turned away!", (0, 165, 255)))
                        logger.log("HEAD", 0.85, frame,
                                   f"Head:{head:.2f} base:{baseline_head:.2f}")
                else:
                    head_alert_frames = max(0, head_alert_frames - 1)

                if lip_alert:
                    alerts.append(("LIP: Possible whispering!", (0, 200, 255)))
                    logger.log("LIP", 0.75, frame, "Sustained lip movement")

                ul        = get_landmark_px(lm[UPPER_LIP], w, h)
                ll        = get_landmark_px(lm[LOWER_LIP], w, h)
                lip_color = (0, 200, 255) if lip_alert else (100, 100, 100)
                cv2.circle(frame, ul, 4, lip_color, -1)
                cv2.circle(frame, ll, 4, lip_color, -1)
                cv2.line(frame, ul, ll, lip_color, 2)

                # ── Identity verification (rate-limited) ────
                if identity_verifier.registered and face_count == 1:
                    if identity_verifier.should_check_now(time.time()):
                        is_match, distance, confidence = identity_verifier.verify(frame)
                        should_alert = identity_verifier.update_mismatch_state(is_match)

                        if is_match:
                            identity_status = f"Verified ({confidence:.0%})"
                            identity_color  = (0, 200, 0)
                        else:
                            identity_status = f"MISMATCH ({confidence:.0%})"
                            identity_color  = (0, 0, 255)

                        # ═══ DATABASE LOG: every identity check ═══
                        post_to_api("session/identity_check", {
                            "is_match":     is_match,
                            "distance":     distance,
                            "confidence":   confidence,
                            "elapsed_secs": elapsed_secs,
                        }, session_token)

                        if should_alert:
                            alerts.append((f"IDENTITY: Face mismatch! ({confidence:.0%})",
                                           (0, 0, 255)))
                            logger.log("IDENTITY_MISMATCH", 1.0 - confidence, frame,
                                       f"Distance: {distance:.3f}")

            # ── Object detection + hand proximity ──────────
            if frame_count % OBJECT_CHECK_EVERY == 0:
                detections = object_detector.detect(frame)
                last_hands = hand_tracker.detect(mp_img)
                detections = object_detector.check_hand_proximity(
                    detections, last_hands, w, h
                )
                last_detections = detections

                for det in detections:
                    if det["in_use"]:
                        alerts.append((
                            f"OBJECT: {det['class']} in use! ({det['confidence']:.0%})",
                            (0, 0, 255)
                        ))
                        logger.log("PROHIBITED_OBJECT", det["confidence"], frame,
                                   f"{det['class']} actively held, "
                                   f"distance={det['min_hand_distance']:.0f}px")
                    else:
                        alerts.append((
                            f"OBJECT: {det['class']} visible ({det['confidence']:.0%})",
                            (0, 165, 255)
                        ))

                    # ═══ DATABASE LOG: every object detection ═══
                    post_to_api("session/object_detection", {
                        "object_class":      det["class"],
                        "raw_class":         det["raw_class"],
                        "confidence":        det["confidence"],
                        "in_use":            det["in_use"],
                        "min_hand_distance": det["min_hand_distance"],
                        "elapsed_secs":      elapsed_secs,
                    }, session_token)

            # Draw persistent detections + hand landmarks every frame
            hand_tracker.draw(frame, last_hands, w, h)
            for det in last_detections:
                x1, y1, x2, y2 = det["box"]
                color = (0, 0, 255) if det["in_use"] else (0, 165, 255)
                label = f"{det['class']} {'IN USE' if det['in_use'] else 'visible'}"
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, label, (x1, y1 - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

            # ── Audio alerts ───────────────────────────────
            if audio_result["alert"]:
                cls  = audio_result["class"]
                conf = audio_result["confidence"]

                if cls == "loud":
                    alerts.append((f"LOUD: Loud voice! ({conf:.0%})",
                                   (0, 0, 255)))
                    logger.log("AUDIO_LOUD", conf, frame, "Loud voice")

                elif cls == "speech":
                    if lip_alert:
                        alerts.append((f"WHISPER: Voice+lip! ({conf:.0%})",
                                       (0, 50, 255)))
                        logger.log("AUDIO_WHISPER", conf, frame,
                                   "Voice + lip movement")
                    else:
                        alerts.append((f"AUDIO: Voice! ({conf:.0%})",
                                       (0, 100, 255)))
                        logger.log("AUDIO_SPEECH", conf, frame,
                                   "Voice detected")

                elif cls == "whisper":
                    if lip_alert:
                        alerts.append((f"WHISPER CONFIRMED! ({conf:.0%})",
                                       (0, 0, 255)))
                        logger.log("AUDIO_WHISPER", conf, frame,
                                   "Confirmed whisper")
                    else:
                        alerts.append((f"AUDIO: Whispering! ({conf:.0%})",
                                       (0, 140, 200)))
                        logger.log("AUDIO_WHISPER", conf, frame,
                                   "Whisper detected")

                elif cls == "paper":
                    alerts.append((f"AUDIO: Paper sound! ({conf:.0%})",
                                   (0, 165, 255)))
                    logger.log("AUDIO_PAPER", conf, frame, "Paper sound")

            # ── Tab switch alert ───────────────────────────
            if tab_status.get("alert"):
                app_name = tab_status.get("active_app", "unknown")
                alerts.append((f"TAB: Switched to {app_name}!",
                                (0, 0, 200)))

            # ── Temporal fusion score ───────────────────────
            identity_mismatch_flag = 1 if "MISMATCH" in identity_status else 0
            object_in_use_flag     = 1 if any(d["in_use"] for d in last_detections) else 0
            tab_switch_flag        = 1 if tab_status.get("alert") else 0

            frame_vector = extract_frame_features(
                gaze, baseline_gaze, gaze_tol,
                head, baseline_head, head_tol,
                lip_alert, face_count,
                audio_result["class"], audio_result["alert"],
                identity_mismatch_flag, object_in_use_flag, tab_switch_flag,
            )
            fusion_buffer.push(frame_vector)

            if fusion_buffer.is_ready():
                fusion_score = float(fusion_model.predict(
                    fusion_buffer.get_window(), verbose=0
                )[0][0])

                if fusion_score > 0.7:
                    alerts.append((f"FUSION: High cheat probability ({fusion_score:.0%})",
                                   (0, 0, 255)))
                    logger.log("FUSION_HIGH_RISK", fusion_score, frame,
                               "Sustained multi-signal anomaly pattern")

                # ═══ DATABASE LOG: fusion score (throttled) ═══
                if frame_count % FUSION_LOG_EVERY == 0:
                    post_to_api("session/fusion_score", {
                        "score":          fusion_score,
                        "feature_vector": frame_vector.tolist(),
                        "elapsed_secs":   elapsed_secs,
                    }, session_token)

            # ── Risk score overlay ─────────────────────────
            risk  = logger.get_risk_score()
            r_col = (0, 200, 0) if risk < 20 else \
                    (0, 165, 255) if risk < 50 else (0, 0, 255)
            cv2.putText(frame, f"Risk: {risk}/100",
                        (w - 160, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, r_col, 2)

            # ── Fusion score display ────────────────────────
            fusion_color = (0, 0, 255) if fusion_score > 0.7 else \
                            (0, 165, 255) if fusion_score > 0.4 else (0, 200, 0)
            fusion_label = f"Fusion: {fusion_score:.0%}" if fusion_buffer.is_ready() \
                            else "Fusion: warming up..."
            cv2.putText(frame, fusion_label,
                        (w - 200, h - 45),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, fusion_color, 1)

            # ── Status display ─────────────────────────────
            if not alerts:
                cv2.putText(frame, "OK: Candidate focused",
                            (20, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 200, 0), 2)
            else:
                for i, (msg, color) in enumerate(alerts[:5]):
                    cv2.putText(frame, msg, (20, 40 + i * 34),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

            # ── Identity status badge (top center) ─────────
            cv2.putText(frame, f"Identity: {identity_status}",
                        (w // 2 - 100, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, identity_color, 1)

            # ── Audio bar ──────────────────────────────────
            energy    = audio_result["energy"]
            cls_now   = audio_result["class"]
            bar_max   = 250
            bar_width = int(min(energy * 3000, bar_max))
            bar_colors = {
                "silence": (60,  60,  60),
                "ambient": (100, 100, 100),
                "whisper": (0,   200, 200),
                "speech":  (0,   100, 255),
                "loud":    (0,   0,   255),
                "paper":   (0,   165, 255),
            }
            bar_color = bar_colors.get(cls_now, (100, 100, 100))
            cv2.rectangle(frame, (20, h - 80),
                          (20 + bar_width, h - 65), bar_color, -1)
            cv2.rectangle(frame, (20, h - 80),
                          (20 + bar_max, h - 65), (60, 60, 60), 1)
            cv2.putText(frame,
                f"Audio: {cls_now.upper()} ({energy:.4f})",
                (20, h - 85),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, bar_color, 1)

            # ── Light + eye condition indicators ──────────
            light_txt   = "ENHANCING" if enhanced else "Light OK"
            light_color = (0, 165, 255) if enhanced else (0, 200, 0)
            cv2.putText(frame, light_txt, (w - 150, 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, light_color, 1)
            if has_condition:
                cv2.putText(frame, "EYE: Wide tolerance",
                            (w - 200, 40),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.38,
                            (200, 150, 255), 1)

            # ── Tab switch indicator ───────────────────────
            tab_app = tab_status.get("active_app", "")
            sw_cnt  = tab_status.get("switch_count", 0)
            cv2.putText(frame, f"App: {tab_app} | Switches: {sw_cnt}",
                        (20, h - 100),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, (150, 150, 150), 1)

            # ── Legend ─────────────────────────────────────
            legend = [
                ("G=Gaze",     (0, 165, 255)),
                ("H=Head",     (0, 165, 255)),
                ("L=Lip",      (0, 200, 255)),
                ("A=Absent",   (0, 0,   255)),
                ("M=Multi",    (0, 100, 255)),
                ("V=Voice",    (0,  50, 255)),
                ("P=Paper",    (0, 165, 255)),
                ("T=Tab",      (0,   0, 200)),
                ("I=Identity", (0,   0, 255)),
                ("O=Object",   (0, 165, 255)),
                ("F=Fusion",   (0,   0, 255)),
            ]
            for i, (txt, col) in enumerate(legend):
                cv2.putText(frame, txt, (w - 120, 70 + i * 19),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, col, 1)

            # ── Debug bar ──────────────────────────────────
            cv2.putText(frame,
                f"Gaze:{gaze:.2f} Head:{head:.2f} Lip:{lip_ratio:.3f}",
                (10, h - 50),
                cv2.FONT_HERSHEY_SIMPLEX, 0.38, (120, 120, 120), 1)

            cv2.putText(frame, "TrueWatch v1.1 | Press Q to quit",
                        (20, h - 20),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 150, 150), 1)

            cv2.imshow("TrueWatch - Proctoring Monitor", frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    # ── Cleanup ────────────────────────────────────────────
    audio.stop()
    tab_monitor.stop()
    cap.release()
    cv2.destroyAllWindows()

    logger.save_session()
    print("TrueWatch stopped.")


if __name__ == "__main__":
    from backend.utils.api_client import TrueWatchAPIClient
    import requests

    print("=" * 60)
    print("TrueWatch — Database-Connected Mode")
    print("=" * 60)

    client = TrueWatchAPIClient()
    email    = input("Email: ").strip()
    password = input("Password: ").strip()

    if not client.login(email, password):
        sys.exit(1)
    if client.user["role"] != "student":
        sys.exit(1)

    code = input("Enter the 6-character code shown on your exam screen: ").strip().upper()
    try:
        res = requests.post(
            "http://localhost:5001/api/session/join",
            headers={"Authorization": f"Bearer {client.token}"},
            json={"code": code}, timeout=5
        )
        res.raise_for_status()
        session_token = res.json()["session_token"]
        print(f"Linked to session {session_token[:12]}...")
    except Exception as e:
        print(f"Could not link session: {e}")
        sys.exit(1)

    try:
        run_truewatch(student_id=client.user["id"], session_token=session_token)
    finally:
        client.stop_session(session_token)