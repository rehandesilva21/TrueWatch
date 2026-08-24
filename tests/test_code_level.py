
import numpy as np
import pytest


# ── Enum validation (backend/models.py) ────────────────────────────────

def test_valid_exam_type_constructs():
    from backend.models import ExamType
    assert ExamType("mcq") == ExamType.MCQ
    assert ExamType("document") == ExamType.DOCUMENT


def test_invalid_exam_type_raises_valueerror():
    from backend.models import ExamType
    with pytest.raises(ValueError):
        ExamType("quiz")


def test_invalid_user_role_raises_valueerror():
    from backend.models import UserRole
    with pytest.raises(ValueError):
        UserRole("superadmin")


# ── Password hashing (backend/models.py — User) ─────────────────────────

def test_password_is_hashed_not_stored_in_plaintext():
    from backend.models import User, UserRole
    user = User(name="Test", email="t@test.com", role=UserRole.STUDENT)
    user.set_password("mypassword123")
    assert user.password != "mypassword123"
    assert user.check_password("mypassword123") is True


def test_wrong_password_is_rejected():
    from backend.models import User, UserRole
    user = User(name="Test", email="t@test.com", role=UserRole.STUDENT)
    user.set_password("correct-password")
    assert user.check_password("wrong-password") is False


# ── Object detector hand-proximity math (modules/vision/object_detector.py) ──
# Tested without ever calling .load() / .detect() — those require the real
# YOLO weights and are exercised separately as manual/live tests (see
# Section 7's Test Cases table). check_hand_proximity() is pure geometry
# and numpy, and can be tested completely independently of YOLO.

def test_hand_within_proximity_marks_object_in_use():
    from modules.vision.object_detector import ObjectDetector, HAND_PROXIMITY_PX
    detector = ObjectDetector()
    detections = [{"class": "PHONE", "center": (100, 100)}]

    class FakeLandmark:
        def __init__(self, x, y): self.x, self.y = x, y
    # Wrist landmark placed well within HAND_PROXIMITY_PX of the object
    hand = [FakeLandmark(100 / 640, 100 / 480)]

    result = detector.check_hand_proximity(detections, [hand], w=640, h=480)
    assert result[0]["in_use"] is True
    assert result[0]["min_hand_distance"] < HAND_PROXIMITY_PX


def test_hand_far_from_object_marks_not_in_use():
    from modules.vision.object_detector import ObjectDetector
    detector = ObjectDetector()
    detections = [{"class": "PHONE", "center": (50, 50)}]

    class FakeLandmark:
        def __init__(self, x, y): self.x, self.y = x, y
    # Wrist landmark placed at the opposite corner of the frame
    hand = [FakeLandmark(600 / 640, 450 / 480)]

    result = detector.check_hand_proximity(detections, [hand], w=640, h=480)
    assert result[0]["in_use"] is False


def test_no_hands_visible_marks_all_objects_not_in_use():
    from modules.vision.object_detector import ObjectDetector
    detector = ObjectDetector()
    detections = [{"class": "BOOK", "center": (200, 200)}]
    result = detector.check_hand_proximity(detections, [], w=640, h=480)
    assert result[0]["in_use"] is False
    assert result[0]["min_hand_distance"] == float("inf")


# ── Calibration deviation logic (mirrors ExamRoom.jsx's threshold rule) ──
# The production version of this logic runs in JavaScript (frontend/
# student/src/pages/ExamRoom.jsx); this test validates the identical rule
# expressed in Python, confirming the underlying threshold behaviour is
# correct and giving the backend an equivalent, independently-testable
# reference implementation.

def calibration_deviation(value, baseline, tolerance):
    return abs(value - baseline) > tolerance


def test_value_within_tolerance_is_not_a_deviation():
    assert calibration_deviation(value=0.52, baseline=0.50, tolerance=0.10) is False


def test_value_outside_tolerance_is_a_deviation():
    assert calibration_deviation(value=0.75, baseline=0.50, tolerance=0.10) is True


def test_widened_tolerance_for_eye_condition_prevents_false_flag():
    """Directly validates the fairness requirement from Section 4.3.2: a
    student with a declared eye condition uses a wider tolerance, so the
    identical gaze deviation that would flag a non-widened profile must
    NOT flag a widened one."""
    gaze_value, baseline = 0.68, 0.50
    standard_tolerance = 0.10
    widened_tolerance   = 0.10 * 2.5  # matches Calibration.jsx's eye-condition multiplier

    assert calibration_deviation(gaze_value, baseline, standard_tolerance) is True
    assert calibration_deviation(gaze_value, baseline, widened_tolerance) is False
