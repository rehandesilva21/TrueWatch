import os
# MUST be the very first thing that runs, before any other import — this
# environment variable only takes effect if set before a native library
# reads it during its own initialization. Prevents an OpenMP-runtime
# conflict between TensorFlow (audio CNN) and LightGBM in this same
# process from aborting with a segmentation fault.
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION'] = 'python'

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from werkzeug.security import generate_password_hash, check_password_hash
import threading
import time
import secrets
import json
from datetime import datetime, timezone

def utcnow():
    """
    Timezone-naive UTC now — deliberately naive, not aware. MySQL
    DATETIME columns store no timezone info, so any value read back
    from the DB always comes back as a naive datetime. If this returned
    an aware datetime instead, mixing a fresh utcnow() with a value
    already loaded from the DB in the same request raises
    'TypeError: can't subtract offset-naive and offset-aware datetimes'
    the moment they're compared or subtracted — which is exactly what
    happened in generate_ai_summary(). Still computed from true UTC
    (avoids local-timezone bugs), just without the tzinfo marker, so it
    matches what the database actually gives back.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)

app      = Flask(__name__)
app.config['SECRET_KEY'] = 'truewatch-secret-key-2024'
CORS(app, origins="*")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# ─── Database + model imports ──────────────────────────────────
from backend.database import db, init_db
from backend.models import (
    User, Exam, ExamEnrollment, Session as DBSession,
    Incident, PlagiarismReport, CalibrationProfile,
    ExamQuestion, StudentAnswer, StudentGrade, Batch,
    IdentityCheck, ObjectDetectionEvent, FusionScore,
    UserRole, ExamStatus, ExamType, AssignmentType, SessionResult, RiskLevel
)
from modules.audio.audio_inference import load_ensemble, predict_from_file, predict_from_array
import numpy as np


def bootstrap():
    """
    All heavyweight, side-effecting startup work — DB connection, audio
    ensemble load+warmup, YOLO worker process start+warmup — lives here
    instead of at bare module level. macOS's 'spawn' multiprocessing
    start method re-imports this entire file fresh inside the child
    process to reconstruct its namespace; if this initialization ran
    unconditionally at module level, the child would re-run it too —
    which is exactly what caused duplicated "Database connected..." log
    lines and a "attempt to start a new process before bootstrapping
    finished" error the first time the YOLO worker process was added.
    Calling this only from inside `if __name__ == "__main__":` means the
    child's re-import sees __name__ as '__mp_main__', not '__main__', so
    it skips this function entirely instead of re-triggering it.
    """
    init_db(app)

    try:
        load_ensemble()

        _dummy_audio = np.zeros(int(22050 * 5), dtype=np.float32)  # 5s silence
        predict_from_array(_dummy_audio)
        print("Audio model warmed up.")
    except Exception as e:
        print(f"WARNING: Could not load audio ensemble models: {e}")
        print("Audio clip classification will be unavailable until models/audio/*.* files are present.")

    try:
        from modules.vision.yolo_worker import YoloWorkerHandle
        print("Starting isolated YOLO worker process...")
        app._yolo_worker = YoloWorkerHandle()
        _dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        app._yolo_worker.detect(_dummy_frame, timeout=30.0)
        print("YOLO worker warmed up and ready.")
    except Exception as e:
        print(f"WARNING: Could not start YOLO worker process: {e}")
        print("Object detection will be unavailable.")


# ─── Global proctoring state ───────────────────────────────────
proctoring_sessions = {}
_token_store        = {}

# ─── Native-model concurrency locks ─────────────────────────────
_object_detector_lock = threading.Lock()
_yolo_lock             = threading.Lock()
_arcface_lock          = threading.Lock()
_audio_lock            = threading.Lock()
_plagiarism_lock       = threading.Lock()


def require_auth(roles=None):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    user  = _token_store.get(token)
    if not user:
        return None, (jsonify({"error": "Unauthorized"}), 401)
    if roles and user.role.value not in roles:
        return None, (jsonify({"error": "Forbidden"}), 403)
    return user, None


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "service": "TrueWatch API v2.1"})


@app.route('/api/auth/login', methods=['POST'])
def login():
    data     = request.json or {}
    email    = data.get("email",    "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    user = User.query.filter_by(email=email, is_active=True).first()
    if not user or not user.check_password(password):
        return jsonify({"error": "Invalid email or password"}), 401

    token = secrets.token_hex(32)
    _token_store[token] = user

    return jsonify({"token": token, "user": user.to_dict()})


@app.route('/api/auth/logout', methods=['POST'])
def logout():
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    _token_store.pop(token, None)
    return jsonify({"status": "logged out"})


@app.route('/api/auth/me', methods=['GET'])
def me():
    user, err = require_auth()
    if err: return err
    return jsonify(user.to_dict())


@app.route('/api/auth/register', methods=['POST'])
def register():
    return jsonify({"error": "Self-registration is disabled. Ask your administrator to create your account."}), 403


@app.route('/api/admin/users', methods=['GET'])
def admin_get_users():
    user, err = require_auth(roles=["admin"])
    if err: return err
    role  = request.args.get("role")
    query = User.query
    if role:
        query = query.filter_by(role=UserRole(role))
    users = query.order_by(User.created_at.desc()).all()
    return jsonify({"users": [u.to_dict() for u in users]})


@app.route('/api/admin/users', methods=['POST'])
def admin_create_user():
    user, err = require_auth(roles=["admin"])
    if err: return err

    data     = request.json or {}
    name     = data.get("name",     "").strip()
    email    = data.get("email",    "").strip().lower()
    password = data.get("password", "")
    role     = data.get("role",     "student")
    batch_id = data.get("batch_id")

    if not name or not email or not password:
        return jsonify({"error": "Name, email, password required"}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email already exists"}), 409
    if batch_id is not None and not db.session.get(Batch, batch_id):
        return jsonify({"error": f"Batch {batch_id} does not exist"}), 400

    new_user = User(name=name, email=email, role=UserRole(role), batch_id=batch_id)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()
    return jsonify({"status": "created", "user": new_user.to_dict()}), 201


@app.route('/api/admin/users/<int:user_id>', methods=['PUT'])
def admin_update_user(user_id):
    user, err = require_auth(roles=["admin"])
    if err: return err

    target = User.query.get_or_404(user_id)
    data   = request.json or {}

    if "name"      in data: target.name      = data["name"]
    if "is_active" in data: target.is_active = data["is_active"]
    if "role"      in data: target.role      = UserRole(data["role"])
    if "password"  in data: target.set_password(data["password"])
    if "batch_id"  in data:
        batch_id = data["batch_id"]
        if batch_id is not None and not db.session.get(Batch, batch_id):
            return jsonify({"error": f"Batch {batch_id} does not exist"}), 400
        target.batch_id = batch_id

    db.session.commit()
    return jsonify({"status": "updated", "user": target.to_dict()})


@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    user, err = require_auth(roles=["admin"])
    if err: return err
    target = User.query.get_or_404(user_id)
    target.is_active = False
    db.session.commit()
    return jsonify({"status": "deactivated"})


@app.route('/api/admin/stats', methods=['GET'])
def admin_stats():
    user, err = require_auth(roles=["admin"])
    if err: return err
    return jsonify({
        "total_students":   User.query.filter_by(role=UserRole.STUDENT).count(),
        "total_lecturers":  User.query.filter_by(role=UserRole.LECTURER).count(),
        "total_batches":    Batch.query.count(),
        "total_exams":      Exam.query.count(),
        "total_sessions":   DBSession.query.count(),
        "flagged_sessions": DBSession.query.filter_by(
                                result=SessionResult.FLAGGED).count(),
    })


@app.route('/api/batches', methods=['GET'])
def list_batches():
    user, err = require_auth(roles=["admin", "lecturer"])
    if err: return err
    batches = Batch.query.order_by(Batch.name).all()
    return jsonify({"batches": [b.to_dict() for b in batches]})


@app.route('/api/batches', methods=['POST'])
def create_batch():
    user, err = require_auth(roles=["admin"])
    if err: return err

    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Batch name is required"}), 400

    batch = Batch(name=name, description=data.get("description", ""), created_by=user.id)
    db.session.add(batch)
    db.session.commit()
    return jsonify({"status": "created", "batch": batch.to_dict()}), 201


@app.route('/api/batches/<int:batch_id>', methods=['PUT'])
def update_batch(batch_id):
    user, err = require_auth(roles=["admin"])
    if err: return err

    batch = db.session.get(Batch, batch_id)
    if not batch:
        return jsonify({"error": "Batch not found"}), 404

    data = request.json or {}
    if "name"        in data: batch.name        = data["name"]
    if "description" in data: batch.description = data["description"]
    db.session.commit()
    return jsonify({"status": "updated", "batch": batch.to_dict()})


@app.route('/api/batches/<int:batch_id>', methods=['DELETE'])
def delete_batch(batch_id):
    user, err = require_auth(roles=["admin"])
    if err: return err

    batch = db.session.get(Batch, batch_id)
    if not batch:
        return jsonify({"error": "Batch not found"}), 404

    for student in batch.students:
        student.batch_id = None
    for exam in Exam.query.filter_by(batch_id=batch_id).all():
        exam.batch_id = None
        exam.assignment_type = AssignmentType.INDIVIDUAL

    db.session.delete(batch)
    db.session.commit()
    return jsonify({"status": "deleted"})


@app.route('/api/batches/<int:batch_id>/students', methods=['GET'])
def batch_students(batch_id):
    user, err = require_auth(roles=["admin", "lecturer"])
    if err: return err

    batch = db.session.get(Batch, batch_id)
    if not batch:
        return jsonify({"error": "Batch not found"}), 404

    return jsonify({"students": [s.to_dict() for s in batch.students]})


def sync_batch_enrollment(exam):
    if exam.assignment_type != AssignmentType.BATCH or not exam.batch_id:
        return 0
    students = User.query.filter_by(batch_id=exam.batch_id, role=UserRole.STUDENT).all()
    added = 0
    for s in students:
        existing = ExamEnrollment.query.filter_by(exam_id=exam.id, student_id=s.id).first()
        if not existing:
            db.session.add(ExamEnrollment(exam_id=exam.id, student_id=s.id))
            added += 1
    if added:
        db.session.commit()
    return added
@app.route('/api/exams', methods=['GET'])
def get_exams():
    user, err = require_auth()
    if err: return err

    if user.role == UserRole.STUDENT:
        enrollments = ExamEnrollment.query.filter_by(student_id=user.id).all()
        exam_ids    = [e.exam_id for e in enrollments]
        exams       = Exam.query.filter(
            Exam.id.in_(exam_ids)).order_by(Exam.start_time.desc()).all()
    elif user.role == UserRole.LECTURER:
        exams = Exam.query.filter_by(
            created_by=user.id).order_by(Exam.created_at.desc()).all()
    else:
        exams = Exam.query.order_by(Exam.created_at.desc()).all()

    return jsonify({"exams": [e.to_dict() for e in exams]})


@app.route('/api/exams', methods=['POST'])
def create_exam():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    data = request.json or {}

    exam_type_raw = data.get("exam_type", "mcq")
    try:
        exam_type = ExamType(exam_type_raw)
    except ValueError:
        return jsonify({"error": f"Invalid exam_type '{exam_type_raw}'. Must be 'mcq' or 'document'."}), 400

    assignment_type_raw = data.get("assignment_type", "individual")
    try:
        assignment_type = AssignmentType(assignment_type_raw)
    except ValueError:
        return jsonify({"error": f"Invalid assignment_type '{assignment_type_raw}'. Must be 'individual' or 'batch'."}), 400

    batch_id = data.get("batch_id")
    if assignment_type == AssignmentType.BATCH:
        if not batch_id:
            return jsonify({"error": "batch_id is required when assignment_type is 'batch'"}), 400
        if not db.session.get(Batch, batch_id):
            return jsonify({"error": f"Batch {batch_id} does not exist"}), 400

    exam = Exam(
        created_by      = user.id,
        title           = data.get("title",         "Untitled Exam"),
        exam_type       = exam_type,
        assignment_type = assignment_type,
        batch_id        = batch_id if assignment_type == AssignmentType.BATCH else None,
        description     = data.get("description",   ""),
        duration_mins   = data.get("duration_mins",  60),
        status          = ExamStatus.DRAFT,
    )
    if data.get("start_time"):
        exam.start_time = datetime.fromisoformat(data["start_time"])
    if data.get("end_time"):
        exam.end_time   = datetime.fromisoformat(data["end_time"])

    db.session.add(exam)
    db.session.commit()

    enrolled_count = sync_batch_enrollment(exam)

    return jsonify({"status": "created", "exam": exam.to_dict(), "batch_enrolled": enrolled_count}), 201


@app.route('/api/exams/<int:exam_id>', methods=['GET'])
def get_exam(exam_id):
    user, err = require_auth()
    if err: return err
    exam = Exam.query.get_or_404(exam_id)
    return jsonify(exam.to_dict())


@app.route('/api/exams/<int:exam_id>', methods=['PUT'])
def update_exam(exam_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    exam = Exam.query.get_or_404(exam_id)
    data = request.json or {}

    if "title"         in data: exam.title         = data["title"]
    if "exam_type"     in data:
        try:
            exam.exam_type = ExamType(data["exam_type"])
        except ValueError:
            return jsonify({"error": f"Invalid exam_type '{data['exam_type']}'. Must be 'mcq' or 'document'."}), 400
    if "assignment_type" in data or "batch_id" in data:
        new_assignment = data.get("assignment_type", exam.assignment_type.value)
        try:
            new_assignment = AssignmentType(new_assignment)
        except ValueError:
            return jsonify({"error": f"Invalid assignment_type '{new_assignment}'. Must be 'individual' or 'batch'."}), 400
        new_batch_id = data.get("batch_id", exam.batch_id)
        if new_assignment == AssignmentType.BATCH:
            if not new_batch_id:
                return jsonify({"error": "batch_id is required when assignment_type is 'batch'"}), 400
            if not db.session.get(Batch, new_batch_id):
                return jsonify({"error": f"Batch {new_batch_id} does not exist"}), 400
            exam.batch_id = new_batch_id
        else:
            exam.batch_id = None
        exam.assignment_type = new_assignment
    if "description"   in data: exam.description   = data["description"]
    if "duration_mins" in data: exam.duration_mins = data["duration_mins"]
    if "status"        in data: exam.status        = ExamStatus(data["status"])
    if "start_time" in data:
        exam.start_time = datetime.fromisoformat(data["start_time"]) if data["start_time"] else None
    if "end_time" in data:
        exam.end_time = datetime.fromisoformat(data["end_time"]) if data["end_time"] else None
    db.session.commit()

    enrolled_count = sync_batch_enrollment(exam)

    return jsonify({"status": "updated", "exam": exam.to_dict(), "batch_enrolled": enrolled_count})


@app.route('/api/exams/<int:exam_id>', methods=['DELETE'])
def delete_exam(exam_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err
    exam = Exam.query.get_or_404(exam_id)
    exam.status = ExamStatus.ARCHIVED
    db.session.commit()
    return jsonify({"status": "archived"})


@app.route('/api/exams/<int:exam_id>/enroll', methods=['POST'])
def enroll_students(exam_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    data        = request.json or {}
    student_ids = data.get("student_ids", [])
    enrolled    = []

    for sid in student_ids:
        existing = ExamEnrollment.query.filter_by(
            exam_id=exam_id, student_id=sid).first()
        if not existing:
            e = ExamEnrollment(exam_id=exam_id, student_id=sid)
            db.session.add(e)
            enrolled.append(sid)

    db.session.commit()
    return jsonify({"enrolled": enrolled, "count": len(enrolled)})


@app.route('/api/exams/<int:exam_id>/enroll-batch', methods=['POST'])
def enroll_batch(exam_id):
    """Re-sync a batch-assigned exam's enrollments — picks up any students
    added to the batch after the exam was created."""
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    exam = db.session.get(Exam, exam_id)
    if not exam:
        return jsonify({"error": "Exam not found"}), 404
    if exam.assignment_type != AssignmentType.BATCH or not exam.batch_id:
        return jsonify({"error": "This exam is not assigned to a batch"}), 400

    added = sync_batch_enrollment(exam)
    return jsonify({"status": "synced", "newly_enrolled": added})


@app.route('/api/exams/<int:exam_id>/students', methods=['GET'])
def get_exam_students(exam_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    enrollments = ExamEnrollment.query.filter_by(exam_id=exam_id).all()
    students    = []
    for e in enrollments:
        s    = db.session.get(User, e.student_id)
        sess = DBSession.query.filter_by(
            exam_id=exam_id, student_id=e.student_id
        ).order_by(DBSession.started_at.desc()).first()
        students.append({
            "student":    s.to_dict() if s else {},
            "enrollment": e.status,
            "session":    sess.to_dict() if sess else None,
        })
    return jsonify({"students": students})


@app.route('/api/exams/<int:exam_id>/questions', methods=['GET'])
def get_questions(exam_id):
    user, err = require_auth()
    if err: return err
    questions = ExamQuestion.query.filter_by(
        exam_id=exam_id).order_by(ExamQuestion.order_num).all()
    return jsonify({"questions": [q.to_dict() for q in questions]})


@app.route('/api/exams/<int:exam_id>/questions', methods=['POST'])
def add_question(exam_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    data = request.json or {}

    last = ExamQuestion.query.filter_by(
        exam_id=exam_id).order_by(
        ExamQuestion.order_num.desc()).first()
    order = (last.order_num + 1) if last else 1

    q = ExamQuestion(
        exam_id       = exam_id,
        question_text = data.get("question_text", ""),
        question_type = data.get("question_type", "mcq"),
        options       = data.get("options",       []),
        correct_answer= data.get("correct_answer", 0),
        marks         = data.get("marks",          5),
        order_num     = data.get("order_num",      order),
    )
    db.session.add(q)
    db.session.commit()
    return jsonify({"status": "created", "question": q.to_dict()}), 201


@app.route('/api/exams/<int:exam_id>/questions/<int:q_id>', methods=['PUT'])
def update_question(exam_id, q_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    q    = ExamQuestion.query.get_or_404(q_id)
    data = request.json or {}

    if "question_text"  in data: q.question_text  = data["question_text"]
    if "question_type"  in data: q.question_type  = data["question_type"]
    if "options"        in data: q.options        = data["options"]
    if "correct_answer" in data: q.correct_answer = data["correct_answer"]
    if "marks"          in data: q.marks          = data["marks"]

    db.session.commit()
    return jsonify({"status": "updated", "question": q.to_dict()})


@app.route('/api/exams/<int:exam_id>/questions/<int:q_id>', methods=['DELETE'])
def delete_question(exam_id, q_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err
    q = ExamQuestion.query.get_or_404(q_id)
    db.session.delete(q)
    db.session.commit()
    return jsonify({"status": "deleted"})


@app.route('/api/session/start', methods=['POST'])
def start_session():
    user, err = require_auth(roles=["student"])
    if err: return err

    data    = request.json or {}
    exam_id = data.get("exam_id")

    enrollment = ExamEnrollment.query.filter_by(
        exam_id=exam_id, student_id=user.id).first()
    if not enrollment:
        return jsonify({"error": "Not enrolled in this exam"}), 403

    existing = DBSession.query.filter_by(
        exam_id=exam_id, student_id=user.id
    ).order_by(DBSession.started_at.desc()).first()

    if existing and existing.ended_at is not None:
        return jsonify({"error": "You have already submitted this exam."}), 409

    from backend.utils.incident_logger import IncidentLogger
    from backend.utils.tab_monitor     import TabMonitor

    if existing:
        db_session = existing
        token      = existing.session_token
    else:
        token      = secrets.token_hex(16)
        db_session = DBSession(
            exam_id       = exam_id,
            student_id    = user.id,
            session_token = token,
            started_at    = utcnow(),
            result        = SessionResult.PENDING,
        )
        db.session.add(db_session)
        db.session.commit()

    enrollment.status = "started"
    db.session.commit()

    logger      = IncidentLogger(token)
    exam        = db.session.get(Exam, exam_id)
    tab_monitor = None
    if exam and exam.exam_type == ExamType.MCQ:
        tab_monitor = TabMonitor(incident_logger=logger)
        tab_monitor.start()

    proctoring_sessions[token] = {
        "logger":        logger,
        "tab_monitor":   tab_monitor,
        "db_session_id": db_session.id,
        "student_id":    user.id,
        "exam_id":       exam_id,
    }

    return jsonify({
        "status":        "started",
        "session_token": token,
        "db_session_id": db_session.id,
    })


@app.route('/api/session/stop', methods=['POST'])
def stop_session():
    user, err = require_auth(roles=["student"])
    if err: return err

    data    = request.json or {}
    token   = data.get("session_token")
    answers = data.get("answers", {})
    ps      = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"error": "Session not found"}), 404

    logger      = ps["logger"]
    tab_monitor = ps["tab_monitor"]
    db_sess_id  = ps["db_session_id"]

    if tab_monitor:
        tab_monitor.stop()

    logger.save_session()

    db_sess = db.session.get(DBSession, db_sess_id)
    if db_sess:
        db_sess.ended_at   = utcnow()
        db_sess.risk_score = logger.get_risk_score()
        db_sess.result     = (SessionResult.FLAGGED
                              if logger.get_risk_score() > 40
                              else SessionResult.PASS)

        incident_types = [inc["type"] for inc in logger.get_all()]
        for inc in logger.get_all():
            db_inc = Incident(
                session_id      = db_sess_id,
                type            = inc["type"],
                confidence      = inc["confidence"],
                elapsed_secs    = inc["elapsed_secs"],
                details         = inc["details"],
                screenshot_path = inc.get("screenshot"),
            )
            db.session.add(db_inc)

        questions = ExamQuestion.query.filter_by(exam_id=db_sess.exam_id).all()
        mcq_earned, mcq_total = 0, 0
        for q in questions:
            raw = answers.get(str(q.id))
            if raw is None and q.id in answers:
                raw = answers.get(q.id)
            if raw is None:
                continue

            sa = StudentAnswer(session_id=db_sess_id, question_id=q.id)
            if q.question_type == "mcq":
                try:
                    sa.selected_option = int(raw)
                except (TypeError, ValueError):
                    sa.selected_option = None
                sa.is_correct    = (sa.selected_option == q.correct_answer)
                sa.marks_awarded = q.marks if sa.is_correct else 0
                mcq_total  += q.marks
                mcq_earned += sa.marks_awarded
            else:
                sa.answer_text = str(raw)
                sa.is_correct  = None
            db.session.add(sa)

        db_sess.auto_score = round(100 * mcq_earned / mcq_total, 1) if mcq_total else None
        db_sess.ai_summary = db_sess.generate_ai_summary(incident_types)
        db.session.commit()

    enrollment = ExamEnrollment.query.filter_by(
        exam_id=db_sess.exam_id, student_id=user.id).first()
    if enrollment:
        enrollment.status = "completed"
        db.session.commit()

    proctoring_sessions.pop(token, None)

    return jsonify({
        "status":     "stopped",
        "risk_score": logger.get_risk_score(),
        "summary":    logger.get_summary(),
        "result":     db_sess.result.value if db_sess else "unknown",
        "auto_score": db_sess.auto_score   if db_sess else None,
    })


@app.route('/api/session/status', methods=['GET'])
def session_status():
    user, err = require_auth()
    if err: return err

    token = request.args.get("token")
    ps    = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"active": False})

    logger = ps["logger"]
    tab    = ps["tab_monitor"]

    return jsonify({
        "active":     True,
        "risk_score": logger.get_risk_score(),
        "summary":    logger.get_summary(),
        "incidents":  len(logger.get_all()),
        "tab_status": tab.get_status() if tab else {},
    })


@app.route('/api/session/incident', methods=['POST'])
def log_incident():
    data  = request.json or {}
    token = data.get("session_token")
    ps    = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"error": "Session not found"}), 404

    incident = ps["logger"].log(
        data.get("type",       "UNKNOWN"),
        data.get("confidence", 0.0),
        details=data.get("details", ""),
    )
    if incident:
        socketio.emit('incident', {
            **incident,
            "session_token": token,
            "student_id":    ps["student_id"],
        })

    return jsonify({"logged": True})


@app.route('/api/lecturer/sessions', methods=['GET'])
def lecturer_sessions():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    exam_id = request.args.get("exam_id")

    if exam_id:
        sessions = DBSession.query.filter_by(
            exam_id=int(exam_id)).order_by(
            DBSession.started_at.desc()).all()
    elif user.role == UserRole.ADMIN:
        sessions = DBSession.query.order_by(DBSession.started_at.desc()).all()
    else:
        my_exams = Exam.query.filter_by(created_by=user.id).all()
        exam_ids = [e.id for e in my_exams]
        sessions = DBSession.query.filter(
            DBSession.exam_id.in_(exam_ids)).order_by(
            DBSession.started_at.desc()).all()

    result = []
    for s in sessions:
        student = db.session.get(User, s.student_id)
        exam    = db.session.get(Exam, s.exam_id)
        grade   = StudentGrade.query.filter_by(session_id=s.id).first()
        plag    = PlagiarismReport.query.filter_by(session_id=s.id).first()
        result.append({
            **s.to_dict(),
            "student_name": student.name  if student else "Unknown",
            "student_email":student.email if student else "",
            "exam_title":   exam.title    if exam    else "Unknown",
            "grade":        grade.grade   if grade   else None,
            "originality":  plag.originality_score if plag else None,
            "plag_risk":    plag.risk_level.value   if plag else None,
            "file_name":    plag.file_name          if plag else None,
        })

    return jsonify({"sessions": result})


@app.route('/api/lecturer/session/<int:session_id>', methods=['GET'])
def lecturer_session_detail(session_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    sess    = DBSession.query.get_or_404(session_id)
    student = db.session.get(User, sess.student_id)
    exam    = db.session.get(Exam, sess.exam_id)
    plag    = PlagiarismReport.query.filter_by(session_id=session_id).all()
    grade   = StudentGrade.query.filter_by(session_id=session_id).first()

    answers = StudentAnswer.query.filter_by(session_id=session_id).all()
    answer_list = []
    for a in answers:
        q = db.session.get(ExamQuestion, a.question_id)
        answer_list.append(a.to_dict(question=q))
    if exam:
        order = {q.id: q.order_num for q in ExamQuestion.query.filter_by(exam_id=exam.id).all()}
        answer_list.sort(key=lambda a: order.get(a["question_id"], 0))

    return jsonify({
        "session":            sess.to_dict(),
        "student":            student.to_dict() if student else {},
        "exam":               exam.to_dict()    if exam    else {},
        "incidents":          [i.to_dict() for i in sess.incidents],
        "plagiarism_reports": [p.to_dict() for p in plag],
        "grade":              grade.to_dict()   if grade   else None,
        "answers":            answer_list,
    })


@app.route('/api/lecturer/live', methods=['GET'])
def lecturer_live():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    live = []
    for token, ps in proctoring_sessions.items():
        logger  = ps["logger"]
        student = db.session.get(User, ps["student_id"])
        live.append({
            "session_token": token,
            "student_id":    ps["student_id"],
            "student_name":  student.name if student else "Unknown",
            "risk_score":    logger.get_risk_score(),
            "incidents":     len(logger.get_all()),
            "summary":       logger.get_summary(),
            "has_frame":     bool(ps.get("last_frame")),
        })

    return jsonify({"live_sessions": live})


@app.route('/api/lecturer/live-frame/<token>', methods=['GET'])
def lecturer_live_frame(token):
    """Latest still frame received from this student's camera, for the
    live monitor grid. Not real-time video — the browser only posts a
    snapshot every few seconds — but it's genuine image data from the
    student's camera rather than a static placeholder."""
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    ps = proctoring_sessions.get(token)
    if not ps or not ps.get("last_frame"):
        return jsonify({"image": None}), 404

    return jsonify({
        "image":   ps["last_frame"],
        "age_secs": round(time.time() - ps.get("last_frame_at", time.time()), 1),
    })


@app.route('/api/lecturer/grade', methods=['POST'])
def send_grade():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    data       = request.json or {}
    session_id = data.get("session_id")
    grade      = data.get("grade")
    feedback   = data.get("feedback", "")

    if grade is None:
        return jsonify({"error": "Grade is required"}), 400

    sess = DBSession.query.get_or_404(session_id)

    existing = StudentGrade.query.filter_by(session_id=session_id).first()
    if existing:
        existing.grade    = grade
        existing.feedback = feedback
        existing.sent_at  = utcnow()
    else:
        new_grade = StudentGrade(
            session_id = session_id,
            student_id = sess.student_id,
            exam_id    = sess.exam_id,
            grade      = grade,
            feedback   = feedback,
            sent_by    = user.id,
        )
        db.session.add(new_grade)

    db.session.commit()

    socketio.emit('grade_received', {
        "student_id": sess.student_id,
        "exam_id":    sess.exam_id,
        "grade":      grade,
        "feedback":   feedback,
    })

    return jsonify({"status": "grade sent", "grade": grade})


@app.route('/api/lecturer/students', methods=['GET'])
def lecturer_students():
    """All active students available to enroll (any lecturer can enroll any
    student — students are created centrally by an admin, not per-lecturer)."""
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    students = User.query.filter_by(
        role=UserRole.STUDENT, is_active=True).order_by(User.name).all()
    return jsonify({"students": [s.to_dict() for s in students]})


@app.route('/api/student/results', methods=['GET'])
def student_results():
    user, err = require_auth(roles=["student"])
    if err: return err

    sessions = DBSession.query.filter_by(
        student_id=user.id).order_by(
        DBSession.started_at.desc()).all()

    results = []
    for s in sessions:
        exam  = db.session.get(Exam, s.exam_id)
        plag  = PlagiarismReport.query.filter_by(session_id=s.id).first()
        grade = StudentGrade.query.filter_by(session_id=s.id).first()

        results.append({
            "session_id":   s.id,
            "exam_id":      s.exam_id,
            "exam_title":   exam.title if exam else "Unknown",
            "submitted_at": s.ended_at.strftime("%d %b %Y %H:%M")
                            if s.ended_at else None,
            "completed":    s.ended_at is not None,
            "originality":  plag.originality_score  if plag  else None,
            "risk_score":   s.risk_score,
            "auto_score":   s.auto_score,
            "grade":        grade.grade              if grade else None,
            "feedback":     grade.feedback           if grade else None,
            "result":       s.result.value,
            "ai_summary":   s.ai_summary,
        })

    return jsonify({"results": results})


@app.route('/api/student/notifications', methods=['GET'])
def student_notifications():
    """Get unread grade notifications for student."""
    user, err = require_auth(roles=["student"])
    if err: return err

    grades = StudentGrade.query.filter_by(student_id=user.id).order_by(
        StudentGrade.sent_at.desc()).all()

    notifications = []
    for g in grades:
        exam = db.session.get(Exam, g.exam_id)
        notifications.append({
            "exam_title": exam.title if exam else "Unknown",
            "grade":      g.grade,
            "feedback":   g.feedback,
            "sent_at":    g.sent_at.strftime("%d %b %Y %H:%M"),
        })

    return jsonify({"notifications": notifications})


@app.route('/api/plagiarism/check', methods=['POST'])
def check_plagiarism():
    user, err = require_auth()
    if err: return err

    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file          = request.files['file']
    session_token = request.form.get("session_token", "")
    fname         = file.filename
    fpath         = os.path.join("data/uploads", fname)
    os.makedirs("data/uploads", exist_ok=True)
    file.save(fpath)

    from modules.nlp.plagiarism_detector import PlagiarismDetector, save_to_corpus
    detector = PlagiarismDetector()

    with _plagiarism_lock:
        report = detector.analyze(fpath, use_semantic=True)
    detector.save_report(report)

    save_to_corpus(fpath)

    ps = proctoring_sessions.get(session_token)
    if ps:
        db_report = PlagiarismReport(
            session_id        = ps["db_session_id"],
            student_id        = user.id,
            file_name         = fname,
            file_path         = fpath,
            originality_score = report.get("originality", 100.0),
            risk_level        = RiskLevel(report.get("risk_level", "LOW")),
            summary           = report.get("summary", ""),
            tfidf_matches     = report.get("tfidf_matches",    []),
            semantic_matches  = report.get("semantic_matches", []),
        )
        db.session.add(db_report)
        db.session.commit()

        socketio.emit('plagiarism_result', {
            "student_id":  user.id,
            "file_name":   fname,
            "originality": report.get("originality"),
            "risk_level":  report.get("risk_level"),
            "summary":     report.get("summary"),
        })

    return jsonify(report)


@app.route('/api/plagiarism/download/<int:session_id>', methods=['GET'])
def download_plagiarism_doc(session_id):
    """Lecturer downloads student's uploaded answer document."""
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    plag = PlagiarismReport.query.filter_by(session_id=session_id).first()
    if not plag or not os.path.exists(plag.file_path):
        return jsonify({"error": "Document not found"}), 404

    return send_file(
        plag.file_path,
        as_attachment=True,
        download_name=plag.file_name,
    )


@app.route('/api/plagiarism/corpus', methods=['POST'])
def add_to_corpus():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file  = request.files['file']
    fname = file.filename
    fpath = os.path.join("data/corpus", fname)
    os.makedirs("data/corpus", exist_ok=True)
    file.save(fpath)
    return jsonify({"status": "added to corpus", "file": fname})


@app.route('/api/plagiarism/corpus', methods=['GET'])
def list_corpus():
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    files = []
    corpus_path = "data/corpus"
    if os.path.exists(corpus_path):
        for f in os.listdir(corpus_path):
            fpath = os.path.join(corpus_path, f)
            files.append({
                "name": f,
                "size": os.path.getsize(fpath),
            })
    return jsonify({"files": files})


@app.route('/api/exams/<int:exam_id>/plagiarism/recheck', methods=['POST'])
def recheck_exam_plagiarism(exam_id):
    """
    Re-runs plagiarism analysis for every submission already checked in this
    exam, cross-comparing them against each other (not just the standing
    corpus) — catches copying between students that a check run at
    submission time would miss if the other student hadn't submitted yet.
    """
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    exam = db.session.get(Exam, exam_id)
    if not exam:
        return jsonify({"error": "Exam not found"}), 404

    session_ids = [s.id for s in DBSession.query.filter_by(exam_id=exam_id).all()]
    reports = PlagiarismReport.query.filter(
        PlagiarismReport.session_id.in_(session_ids)).all() if session_ids else []

    if not reports:
        return jsonify({"status": "done", "updated": 0, "skipped": [],
                         "message": "No submissions to recheck for this exam."})

    from modules.nlp.plagiarism_detector import PlagiarismDetector
    from modules.nlp.document_parser import read_document, clean_text

    detector = PlagiarismDetector()

    texts = {}
    for r in reports:
        if r.file_path and os.path.exists(r.file_path):
            raw = read_document(r.file_path)
            if raw:
                texts[r.id] = (r.file_name, clean_text(raw))

    updated, skipped = [], []
    for r in reports:
        if r.id not in texts:
            skipped.append(r.file_name)
            continue

        peer_corpus = [texts[other_id] for other_id in texts if other_id != r.id]
        own_corpus_name = os.path.basename(r.file_path) + ".txt"

        with _plagiarism_lock:
            report = detector.analyze(
                r.file_path, use_semantic=True,
                extra_corpus=peer_corpus, exclude_from_corpus=own_corpus_name,
            )
        if "error" in report:
            skipped.append(r.file_name)
            continue

        r.originality_score = report.get("originality", r.originality_score)
        r.risk_level         = RiskLevel(report.get("risk_level", "LOW"))
        r.summary            = report.get("summary", r.summary)
        r.tfidf_matches      = report.get("tfidf_matches",    [])
        r.semantic_matches   = report.get("semantic_matches", [])
        updated.append(r.file_name)

    db.session.commit()

    socketio.emit('plagiarism_recheck_complete', {
        "exam_id": exam_id, "updated": len(updated), "skipped": len(skipped),
    })

    return jsonify({"status": "done", "updated": len(updated), "skipped": skipped})


@app.route('/api/calibration', methods=['POST'])
def save_calibration():
    user, err = require_auth(roles=["student"])
    if err: return err

    data    = request.json or {}
    profile = CalibrationProfile.query.filter_by(student_id=user.id).first()

    if not profile:
        profile = CalibrationProfile(student_id=user.id)
        db.session.add(profile)

    profile.gaze_baseline      = data.get("gaze_baseline",      0.5)
    profile.head_baseline      = data.get("head_baseline",       0.5)
    profile.gaze_tolerance     = data.get("gaze_tolerance",      0.1)
    profile.head_tolerance     = data.get("head_tolerance",      0.08)
    profile.lip_baseline       = data.get("lip_baseline",        0.05)
    profile.has_eye_condition  = data.get("has_eye_condition",   False)
    profile.eye_condition_type = data.get("eye_condition_type",  None)
    profile.created_at         = utcnow()

    db.session.commit()
    return jsonify({"status": "saved", "profile": profile.to_dict()})


@app.route('/api/calibration', methods=['GET'])
def get_calibration():
    user, err = require_auth(roles=["student"])
    if err: return err
    profile = CalibrationProfile.query.filter_by(student_id=user.id).first()
    if not profile:
        return jsonify({"profile": None})
    return jsonify({"profile": profile.to_dict()})


@app.route('/api/report/<int:session_id>', methods=['GET'])
def get_report(session_id):
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    sess  = DBSession.query.get_or_404(session_id)
    fpath = os.path.join(
        "data/incidents", f"{sess.session_token}_session.json")

    if os.path.exists(fpath):
        return send_file(fpath, mimetype='application/json')

    student = db.session.get(User, sess.student_id)
    exam    = db.session.get(Exam, sess.exam_id)
    report  = {
        **sess.to_dict(),
                "student_name": student.name  if student else "Unknown",
        "exam_title":   exam.title    if exam    else "Unknown",
        "incidents":    [i.to_dict() for i in sess.incidents],
    }
    return jsonify(report)


@app.route('/api/screenshot/<filename>', methods=['GET'])
def get_screenshot(filename):
    fpath = os.path.join("static/screenshots", filename)
    if not os.path.exists(fpath):
        return jsonify({"error": "Not found"}), 404
    return send_file(fpath, mimetype='image/jpeg')


@app.route('/api/session/identity_check', methods=['POST'])
def log_identity_check():
    """Log an identity verification result from the desktop agent."""
    data  = request.json or {}
    token = data.get("session_token")
    ps    = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"error": "Session not found"}), 404

    check = IdentityCheck(
        session_id   = ps["db_session_id"],
        student_id   = ps["student_id"],
        is_match     = data.get("is_match", True),
        distance     = data.get("distance", 0.0),
        confidence   = data.get("confidence", 0.0),
        elapsed_secs = data.get("elapsed_secs", 0),
    )
    db.session.add(check)
    db.session.commit()

    if not check.is_match:
        socketio.emit('identity_alert', {
            "session_token": token,
            "student_id":    ps["student_id"],
            "confidence":    check.confidence,
        })

    return jsonify({"logged": True})


@app.route('/api/session/object_detection', methods=['POST'])
def log_object_detection():
    """Log an object detection event from the desktop agent."""
    data  = request.json or {}
    token = data.get("session_token")
    ps    = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"error": "Session not found"}), 404

    event = ObjectDetectionEvent(
        session_id        = ps["db_session_id"],
        object_class       = data.get("object_class",  "UNKNOWN"),
        raw_class          = data.get("raw_class",      ""),
        confidence         = data.get("confidence",     0.0),
        in_use             = data.get("in_use",         False),
        min_hand_distance  = data.get("min_hand_distance"),
        elapsed_secs       = data.get("elapsed_secs",   0),
        screenshot_path    = data.get("screenshot_path"),
    )
    db.session.add(event)
    db.session.commit()

    return jsonify({"logged": True})


@app.route('/api/session/fusion_score', methods=['POST'])
def log_fusion_score():
    """Log a fusion model score sample from the desktop agent."""
    data  = request.json or {}
    token = data.get("session_token")
    ps    = proctoring_sessions.get(token)

    if not ps:
        return jsonify({"error": "Session not found"}), 404

    entry = FusionScore(
        session_id     = ps["db_session_id"],
        score          = data.get("score", 0.0),
        is_high_risk   = data.get("score", 0.0) > 0.7,
        feature_vector = data.get("feature_vector"),
        elapsed_secs   = data.get("elapsed_secs", 0),
    )
    db.session.add(entry)
    db.session.commit()

    return jsonify({"logged": True})


@app.route('/api/lecturer/session/<int:session_id>/security', methods=['GET'])
def session_security_detail(session_id):
    """Full security-signal detail — identity, objects, fusion — for one session."""
    user, err = require_auth(roles=["lecturer", "admin"])
    if err: return err

    sess = DBSession.query.get_or_404(session_id)

    return jsonify({
        "identity_checks":   [c.to_dict() for c in sess.identity_checks],
        "object_detections": [o.to_dict() for o in sess.object_detections],
        "fusion_scores":     [f.to_dict() for f in sess.fusion_scores],
        "identity_mismatch_count": sum(1 for c in sess.identity_checks if not c.is_match),
        "object_in_use_count":     sum(1 for o in sess.object_detections if o.in_use),
        "max_fusion_score":        max([f.score for f in sess.fusion_scores], default=0.0),
    })


@app.route('/api/identity/register', methods=['POST'])
def register_identity():
    """
    Web-based facial registration. Accepts a base64 JPEG captured
    from the browser and saves it as the student's reference image,
    using the same file convention as the desktop app's
    IdentityVerifier, so either client can register or verify.
    """
    import base64, cv2, numpy as np
    from modules.vision.face_cropper import crop_face
    user, err = require_auth(roles=["student"])
    if err: return err

    data       = request.json or {}
    image_b64  = data.get("image", "")
    if not image_b64:
        return jsonify({"error": "No image provided"}), 400

    if "," in image_b64:
        image_b64 = image_b64.split(",")[1]

    img_bytes = base64.b64decode(image_b64)
    nparr     = np.frombuffer(img_bytes, np.uint8)
    frame     = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    try:
        face_crop = crop_face(frame)
    except FileNotFoundError as e:
        print(f"[identity/register] {e}")
        return jsonify({"error": "Face verification model unavailable — contact support"}), 500

    if face_crop is None:
        return jsonify({"error": "No clear face detected in that photo — try again with better lighting, facing the camera directly."}), 400

    ref_dir  = "data/identity_references"
    os.makedirs(ref_dir, exist_ok=True)
    ref_path = os.path.join(ref_dir, f"student_{user.id}_ref.jpg")

    cv2.imwrite(ref_path, face_crop)

    return jsonify({"status": "registered", "path": ref_path})


@app.route('/api/identity/status', methods=['GET'])
def identity_status():
    """Check whether this student already has a registered reference photo."""
    user, err = require_auth(roles=["student"])
    if err: return err

    ref_path = os.path.join("data/identity_references", f"student_{user.id}_ref.jpg")
    return jsonify({"registered": os.path.exists(ref_path)})


@app.route('/api/session/join', methods=['POST'])
def join_session():
    """Desktop app links to an already-started browser session via a short code."""
    user, err = require_auth(roles=["student"])
    if err: return err

    data = request.json or {}
    code = data.get("code", "").strip().upper()

    match = None
    for token, ps in proctoring_sessions.items():
        if token.upper().startswith(code) and ps["student_id"] == user.id:
            match = token
            break

    if not match:
        return jsonify({"error": "That code doesn't match an active exam session"}), 404

    return jsonify({
        "session_token": match,
        "exam_id": proctoring_sessions[match]["exam_id"],
    })


@app.route('/api/session/frame', methods=['POST'])
def post_frame():
    """Desktop app pushes the latest webcam snapshot for browser self-view."""
    data  = request.json or {}
    token = data.get("session_token")
    ps    = proctoring_sessions.get(token)
    if not ps:
        return jsonify({"error": "Session not found"}), 404
    ps["latest_frame"] = data.get("frame")  # base64 JPEG
    return jsonify({"ok": True})


@app.route('/api/session/frame', methods=['GET'])
def get_frame():
    """Browser polls this to show the student their own camera feed."""
    user, err = require_auth(roles=["student"])
    if err: return err
    token = request.args.get("token")
    ps    = proctoring_sessions.get(token)
    if not ps or "latest_frame" not in ps:
        return jsonify({"frame": None})
    return jsonify({"frame": ps["latest_frame"]})


@app.route('/api/identity/verify', methods=['POST'])
def verify_identity_snapshot():
    """
    Browser posts a base64 snapshot periodically during the exam.
    Compares it against the student's registered reference photo.
    """
    import base64, cv2, numpy as np
    from modules.vision.face_cropper import crop_face
    user, err = require_auth(roles=["student"])
    if err: return err

    data      = request.json or {}
    token     = data.get("session_token")
    image_b64 = data.get("image", "")
    if "," in image_b64:
        image_b64 = image_b64.split(",")[1]

    ref_path = os.path.join("data/identity_references", f"student_{user.id}_ref.jpg")
    if not os.path.exists(ref_path):
        return jsonify({"is_match": None, "confidence": 0.0, "note": "No reference registered"})

    img_bytes = base64.b64decode(image_b64)
    nparr     = np.frombuffer(img_bytes, np.uint8)
    frame     = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    try:
        face_crop = crop_face(frame)
    except FileNotFoundError as e:
        print(f"[identity/verify] {e}")
        return jsonify({"is_match": None, "confidence": 0.0, "note": "Face verification model unavailable"})

    if face_crop is None:
        return jsonify({"is_match": None, "confidence": 0.0, "note": "Face not clearly detected — check skipped"})

    try:
        from deepface import DeepFace
        with _arcface_lock:
            result = DeepFace.verify(
                img1_path=face_crop, img2_path=ref_path,
                model_name="ArcFace", detector_backend="opencv",
                distance_metric="cosine", enforce_detection=True,
            )
        is_match   = result["verified"]
        distance   = result["distance"]
        confidence = max(0.0, 1.0 - (distance / 0.68))
        note = None
    except ValueError as e:
        is_match, distance, confidence = None, None, 0.0
        note = "Face not clearly detected — check skipped"
        print(f"[identity/verify] face not detected: {e}")
    except Exception as e:
        is_match, distance, confidence = None, None, 0.0
        note = "Verification error — check skipped"
        print(f"[identity/verify] error: {e}")

    ps = proctoring_sessions.get(token)
    if ps and is_match is not None:
        check = IdentityCheck(
            session_id=ps["db_session_id"], student_id=user.id,
            is_match=is_match, distance=distance, confidence=confidence,
        )
        db.session.add(check)
        db.session.commit()

    return jsonify({"is_match": is_match, "distance": distance, "confidence": confidence, "note": note})


@app.route('/api/object/detect', methods=['POST'])
def detect_object_snapshot():
    """Browser posts a base64 snapshot periodically to check for phones/notes."""
    import base64, tempfile, cv2, numpy as np
    user, err = require_auth(roles=["student"])
    if err: return err

    data      = request.json or {}
    token     = data.get("session_token")
    image_b64 = data.get("image", "")
    if "," in image_b64:
        image_b64 = image_b64.split(",")[1]

    try:
        img_bytes = base64.b64decode(image_b64)
        nparr     = np.frombuffer(img_bytes, np.uint8)
        frame     = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Could not decode image")

        # _yolo_lock no longer guards against a native-library race —
        # YOLO now runs in its own isolated subprocess (see bootstrap()
        # and modules/vision/yolo_worker.py). It still matters here:
        # multiple Flask threads calling detect() concurrently on the
        # SAME queue pair could otherwise read back a different thread's
        # result, so the lock keeps each "send frame, wait for its
        # matching response" round trip atomic.
        if not hasattr(app, '_yolo_worker'):
            raise RuntimeError("YOLO worker is not available (failed to start at server startup)")

        with _yolo_lock:
            detections = app._yolo_worker.detect(frame, timeout=8.0)
    except Exception as e:
        print(f"[object/detect] ERROR: {e}")
        return jsonify({"error": str(e), "detections": []}), 500

    ps = proctoring_sessions.get(token)
    if ps:
        ps["last_frame"]    = f"data:image/jpeg;base64,{image_b64}"
        ps["last_frame_at"] = time.time()

    for det in detections:
        if ps:
            event = ObjectDetectionEvent(
                session_id=ps["db_session_id"], object_class=det["class"],
                raw_class=det["raw_class"], confidence=det["confidence"],
                in_use=False,
            )
            db.session.add(event)
    if ps and detections:
        db.session.commit()

    return jsonify({"detections": [
        {"class": d["class"], "confidence": d["confidence"]} for d in detections
    ]})


@app.route('/api/audio/classify', methods=['POST'])
def classify_audio_clip():
    """
    Browser posts a short WAV clip (~2s) periodically. Runs it through the
    trained CNN+LightGBM ensemble (paper/loud/silence/ambient only — whisper
    and speech remain the continuous rule-based classifier's job client-side,
    since ESC-50 has no true whisper class).
    """
    import base64, tempfile
    user, err = require_auth(roles=["student"])
    if err: return err

    data      = request.json or {}
    token     = data.get("session_token")
    audio_b64 = data.get("audio", "")
    if "," in audio_b64:
        audio_b64 = audio_b64.split(",")[1]

    try:
        audio_bytes = base64.b64decode(audio_b64)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        with _audio_lock:
            label, confidence = predict_from_file(tmp_path)
        os.unlink(tmp_path)
    except Exception as e:
        print(f"[audio/classify] ERROR: {e}")
        return jsonify({"error": str(e), "label": None}), 500

    ps = proctoring_sessions.get(token)
    if ps and label in ("paper", "loud") and confidence > 0.55:
        incident_type = "AUDIO_PAPER" if label == "paper" else "AUDIO_LOUD"
        incident = ps["logger"].log(incident_type, confidence,
                                      details=f"Trained audio ensemble: {label} ({confidence:.0%})")
        if incident:
            socketio.emit('incident', {**incident, "session_token": token, "student_id": ps["student_id"]})

    return jsonify({"label": label, "confidence": confidence})


@socketio.on('connect')
def on_connect():
    print("Client connected via WebSocket")
    emit('connected', {"status": "ok", "service": "TrueWatch"})

@socketio.on('disconnect')
def on_disconnect():
    print("Client disconnected")

@socketio.on('join_exam')
def on_join_exam(data):
    from flask_socketio import join_room
    exam_id = data.get("exam_id")
    join_room(f"exam_{exam_id}")
    emit('joined', {"exam_id": exam_id})

@socketio.on('ping')
def on_ping():
    emit('pong', {"time": time.time()})


def broadcast_status():
    while True:
        time.sleep(2)
        try:
            if proctoring_sessions:
                with app.app_context():
                    live = []
                    for token, ps in list(proctoring_sessions.items()):
                        logger  = ps["logger"]
                        student = db.session.get(User, ps["student_id"]) \
                            if ps.get("student_id") else None
                        live.append({
                            "session_token": token,
                            "student_id":    ps.get("student_id"),
                            "student_name":  student.name if student else "Unknown",
                            "risk_score":    logger.get_risk_score(),
                            "incidents":     len(logger.get_all()),
                            "summary":       logger.get_summary(),
                        })
                    socketio.emit('live_update', {"sessions": live})
        except Exception as e:
            print(f"[broadcast_status] error: {e}")


if __name__ == "__main__":
    bootstrap()

    status_thread = threading.Thread(target=broadcast_status, daemon=True)
    status_thread.start()

    print("TrueWatch API v2.1 starting...")
    print("Endpoints available at: http://localhost:5001")
    print("")
    print("  Auth:         POST /api/auth/login")
    print("  Auth:         POST /api/auth/register")
    print("  Exams:        GET  /api/exams")
    print("  Session:      POST /api/session/start")
    print("  Plagiarism:   POST /api/plagiarism/check")
    print("  Audio:        POST /api/audio/classify")
    print("  Lecturer:     GET  /api/lecturer/live")
    print("  Admin:        GET  /api/admin/users")
    print("")
    socketio.run(app, host='0.0.0.0', port=5001, debug=False)
    