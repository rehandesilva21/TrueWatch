from backend.database import db
from datetime import datetime
from enum import Enum as PyEnum
from werkzeug.security import generate_password_hash, check_password_hash
import json

class UserRole(PyEnum):
    ADMIN    = "admin"
    LECTURER = "lecturer"
    STUDENT  = "student"

class ExamType(PyEnum):
    MCQ      = "mcq"       # question-based online exam — full behavioral monitoring
    DOCUMENT = "document"  # paper/essay submitted as a file — plagiarism check only, no webcam/mic monitoring

class AssignmentType(PyEnum):
    INDIVIDUAL = "individual"  # lecturer enrolls specific students one by one
    BATCH      = "batch"       # exam is assigned to every student in a batch (class/cohort)

class ExamStatus(PyEnum):
    DRAFT     = "draft"
    ACTIVE    = "active"
    COMPLETED = "completed"
    ARCHIVED  = "archived"

class SessionResult(PyEnum):
    PENDING   = "pending"
    PASS      = "pass"
    FLAGGED   = "flagged"
    FAIL      = "fail"

class RiskLevel(PyEnum):
    LOW      = "LOW"
    MEDIUM   = "MEDIUM"
    HIGH     = "HIGH"
    CRITICAL = "CRITICAL"


# ─── Batches ───────────────────────────────────────────────────
class Batch(db.Model):
    __tablename__ = "batches"
    id          = db.Column(db.Integer,  primary_key=True)
    name        = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text,     nullable=True)
    created_by  = db.Column(db.Integer,  db.ForeignKey("users.id"), nullable=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    # backref="batch" lets a User (student) do `user.batch` to get their Batch
    students = db.relationship("User", backref="batch", lazy=True,
                                foreign_keys="User.batch_id")

    def to_dict(self):
        return {
            "id":            self.id,
            "name":          self.name,
            "description":   self.description,
            "created_by":    self.created_by,
            "created_at":    self.created_at.isoformat() if self.created_at else None,
            "student_count": len(self.students),
        }


# ─── Users ─────────────────────────────────────────────────────
class User(db.Model):
    __tablename__ = "users"
    id           = db.Column(db.Integer,     primary_key=True)
    name         = db.Column(db.String(100), nullable=False)
    email        = db.Column(db.String(150), unique=True, nullable=False)
    password     = db.Column(db.String(255), nullable=False)
    role         = db.Column(db.Enum(UserRole), default=UserRole.STUDENT)
    batch_id     = db.Column(db.Integer,     db.ForeignKey("batches.id"), nullable=True)
    is_active    = db.Column(db.Boolean,     default=True)
    created_at   = db.Column(db.DateTime,    default=datetime.utcnow)

    exams_created    = db.relationship("Exam",               backref="creator",  lazy=True)
    enrollments      = db.relationship("ExamEnrollment",     backref="student",  lazy=True)
    sessions         = db.relationship("Session",            backref="student",  lazy=True)
    calibration      = db.relationship("CalibrationProfile", backref="student",  uselist=False)

    def set_password(self, password):
        self.password = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password, password)

    def to_dict(self):
        return {
            "id":         self.id,
            "name":       self.name,
            "email":      self.email,
            "role":       self.role.value,
            "batch_id":   self.batch_id,
            "batch_name": self.batch.name if self.batch_id and self.batch else None,
            "is_active":  self.is_active,
            "created_at": self.created_at.isoformat(),
        }


# ─── Exams ─────────────────────────────────────────────────────
class Exam(db.Model):
    __tablename__ = "exams"
    id             = db.Column(db.Integer,      primary_key=True)
    created_by     = db.Column(db.Integer,      db.ForeignKey("users.id"), nullable=False)
    title          = db.Column(db.String(200),  nullable=False)
    exam_type      = db.Column(db.Enum(ExamType), default=ExamType.MCQ, nullable=False)
    assignment_type= db.Column(db.Enum(AssignmentType), default=AssignmentType.INDIVIDUAL, nullable=False)
    batch_id       = db.Column(db.Integer,      db.ForeignKey("batches.id"), nullable=True)
    description    = db.Column(db.Text,         nullable=True)
    start_time     = db.Column(db.DateTime,     nullable=True)
    end_time       = db.Column(db.DateTime,     nullable=True)
    duration_mins  = db.Column(db.Integer,      default=60)
    status         = db.Column(db.Enum(ExamStatus), default=ExamStatus.DRAFT)
    created_at     = db.Column(db.DateTime,     default=datetime.utcnow)

    enrollments    = db.relationship("ExamEnrollment", backref="exam", lazy=True)
    batch          = db.relationship("Batch", foreign_keys=[batch_id], lazy=True)
    sessions       = db.relationship("Session",        backref="exam", lazy=True)

    def to_dict(self):
        return {
            "id":            self.id,
            "title":         self.title,
            "exam_type":     self.exam_type.value if self.exam_type else ExamType.MCQ.value,
            "assignment_type": self.assignment_type.value if self.assignment_type else AssignmentType.INDIVIDUAL.value,
            "batch_id":      self.batch_id,
            "batch_name":    self.batch.name if self.batch_id and self.batch else None,
            "description":   self.description,
            "start_time":    self.start_time.isoformat() if self.start_time else None,
            "end_time":      self.end_time.isoformat()   if self.end_time   else None,
            "duration_mins": self.duration_mins,
            "status":        self.status.value,
            "created_by":    self.created_by,
            "student_count": len(self.enrollments),
        }


# ─── Exam enrollments ──────────────────────────────────────────
class ExamEnrollment(db.Model):
    __tablename__ = "exam_enrollments"
    id          = db.Column(db.Integer, primary_key=True)
    exam_id     = db.Column(db.Integer, db.ForeignKey("exams.id"),  nullable=False)
    student_id  = db.Column(db.Integer, db.ForeignKey("users.id"),  nullable=False)
    status      = db.Column(db.String(20), default="enrolled")
    enrolled_at = db.Column(db.DateTime,   default=datetime.utcnow)


# ─── Sessions ──────────────────────────────────────────────────
class Session(db.Model):
    __tablename__ = "sessions"
    id            = db.Column(db.Integer,  primary_key=True)
    exam_id       = db.Column(db.Integer,  db.ForeignKey("exams.id"),  nullable=False)
    student_id    = db.Column(db.Integer,  db.ForeignKey("users.id"),  nullable=False)
    session_token = db.Column(db.String(64), unique=True)
    started_at    = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at      = db.Column(db.DateTime, nullable=True)
    risk_score    = db.Column(db.Integer,  default=0)
    result        = db.Column(db.Enum(SessionResult), default=SessionResult.PENDING)
    ai_summary    = db.Column(db.Text,     nullable=True)
    auto_score    = db.Column(db.Float,    nullable=True)  # auto-graded MCQ score out of 100, null if no MCQ questions

    incidents          = db.relationship("Incident",          backref="session", lazy=True)
    plagiarism_reports = db.relationship("PlagiarismReport",  backref="session", lazy=True)
    answers             = db.relationship("StudentAnswer",     backref="session", lazy=True)

    def get_incident_summary(self):
        summary = {}
        for inc in self.incidents:
            summary[inc.type] = summary.get(inc.type, 0) + 1
        return summary

    def generate_ai_summary(self, incident_types=None):
        """
        incident_types: optional list of incident type strings (e.g. from
        the live IncidentLogger at the moment the session is stopped).
        When given, the summary is built from that list directly instead
        of re-querying self.incidents — this guarantees the text always
        matches the risk_score, which is computed from that same live
        list. Without this, a summary generated in the same request that
        just wrote those incidents to the DB could see a stale/empty
        `self.incidents` relationship and report "no suspicious activity"
        even though risk_score was already high — exactly backwards.
        If not given, falls back to self.incidents (e.g. for regenerating
        a summary later, outside the stop-session flow).
        """
        if incident_types is not None:
            summary = {}
            for t in incident_types:
                summary[t] = summary.get(t, 0) + 1
        else:
            summary = self.get_incident_summary()

        duration = ""
        if self.ended_at and self.started_at:
            # MySQL DATETIME columns don't store timezone info, so a
            # datetime just loaded from the DB comes back naive, while one
            # freshly assigned in this same request via utcnow() is still
            # timezone-aware — subtracting an aware datetime from a naive
            # one raises TypeError. Normalize both to naive (both are UTC
            # either way) before doing arithmetic.
            end   = self.ended_at.replace(tzinfo=None)   if self.ended_at.tzinfo   else self.ended_at
            start = self.started_at.replace(tzinfo=None) if self.started_at.tzinfo else self.started_at
            mins = int((end - start).total_seconds() / 60)
            duration = f"Duration: {mins} minutes. "

        if not summary:
            return f"{duration}No suspicious activity detected. Student appeared focused throughout."

        parts = []
        if summary.get("GAZE"):
            parts.append(f"gaze deviation ({summary['GAZE']} times)")
        if summary.get("HEAD"):
            parts.append(f"head turning ({summary['HEAD']} times)")
        if summary.get("LIP"):
            parts.append(f"sustained lip movement ({summary['LIP']} times)")
        if summary.get("AUDIO_WHISPER") or summary.get("AUDIO_SPEECH"):
            cnt = summary.get("AUDIO_WHISPER", 0) + summary.get("AUDIO_SPEECH", 0)
            parts.append(f"voice/whisper detected ({cnt} times)")
        if summary.get("AUDIO_LOUD"):
            parts.append(f"loud voice detected ({summary['AUDIO_LOUD']} times)")
        if summary.get("AUDIO_PAPER"):
            parts.append(f"paper sounds ({summary['AUDIO_PAPER']} times)")
        if summary.get("MULTI_FACE"):
            parts.append(f"multiple faces detected ({summary['MULTI_FACE']} times)")
        if summary.get("ABSENT"):
            parts.append(f"absent from frame ({summary['ABSENT']} times)")
        if summary.get("TAB_SWITCH") or summary.get("APP_SWITCH"):
            cnt = summary.get("TAB_SWITCH", 0) + summary.get("APP_SWITCH", 0)
            parts.append(f"switched away from the exam ({cnt} times)")
        if summary.get("IDENTITY_MISMATCH"):
            parts.append(f"identity mismatch ({summary['IDENTITY_MISMATCH']} times) — possible proxy test-taker")
        if summary.get("PROHIBITED_OBJECT"):
            parts.append(f"prohibited object in use ({summary['PROHIBITED_OBJECT']} times)")
        if summary.get("FUSION_HIGH_RISK"):
            parts.append(f"sustained high-risk behaviour pattern flagged by fusion model ({summary['FUSION_HIGH_RISK']} times)")

        # Any incident type we don't have specific wording for still gets
        # counted here instead of silently vanishing from the summary.
        known = {"GAZE","HEAD","LIP","AUDIO_WHISPER","AUDIO_SPEECH","AUDIO_LOUD",
                 "AUDIO_PAPER","MULTI_FACE","ABSENT","TAB_SWITCH","APP_SWITCH",
                 "IDENTITY_MISMATCH","PROHIBITED_OBJECT","FUSION_HIGH_RISK"}
        for t, cnt in summary.items():
            if t not in known:
                parts.append(f"{t.lower().replace('_', ' ')} ({cnt} times)")

        risk = self.risk_score
        risk_label = "Low" if risk < 20 else "Medium" if risk < 50 else "High"

        return (
            f"{duration}Risk score: {risk}/100 ({risk_label}). "
            f"Flagged behaviours: {', '.join(parts)}."
        )

    def to_dict(self):
        return {
            "id":           self.id,
            "exam_id":      self.exam_id,
            "student_id":   self.student_id,
            "session_token":self.session_token,
            "started_at":   self.started_at.isoformat() if self.started_at else None,
            "ended_at":     self.ended_at.isoformat()   if self.ended_at   else None,
            "risk_score":   self.risk_score,
            "result":       self.result.value,
            "ai_summary":   self.ai_summary,
            "auto_score":   self.auto_score,
            "incident_summary": self.get_incident_summary(),
            "total_incidents":  len(self.incidents),
        }


# ─── Incidents ─────────────────────────────────────────────────
class Incident(db.Model):
    __tablename__ = "incidents"
    id              = db.Column(db.Integer,  primary_key=True)
    session_id      = db.Column(db.Integer,  db.ForeignKey("sessions.id"), nullable=False)
    type            = db.Column(db.String(30))
    confidence      = db.Column(db.Float,    default=0.0)
    timestamp       = db.Column(db.DateTime, default=datetime.utcnow)
    elapsed_secs    = db.Column(db.Integer,  default=0)
    details         = db.Column(db.Text,     nullable=True)
    screenshot_path = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "id":              self.id,
            "session_id":      self.session_id,
            "type":            self.type,
            "confidence":      self.confidence,
            "timestamp":       self.timestamp.isoformat() if self.timestamp else None,
            "elapsed_secs":    self.elapsed_secs,
            "details":         self.details,
            "screenshot_path": self.screenshot_path,
        }

# ─── Plagiarism reports ────────────────────────────────────────
class PlagiarismReport(db.Model):
    __tablename__ = "plagiarism_reports"
    id               = db.Column(db.Integer, primary_key=True)
    session_id       = db.Column(db.Integer, db.ForeignKey("sessions.id"), nullable=False)
    student_id       = db.Column(db.Integer, db.ForeignKey("users.id"),    nullable=False)
    file_name        = db.Column(db.String(255))
    file_path        = db.Column(db.String(500))
    originality_score= db.Column(db.Float,   default=100.0)
    risk_level       = db.Column(db.Enum(RiskLevel), default=RiskLevel.LOW)
    summary          = db.Column(db.Text,    nullable=True)
    tfidf_matches    = db.Column(db.JSON,    nullable=True)
    semantic_matches = db.Column(db.JSON,    nullable=True)
    checked_at       = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":                self.id,
            "session_id":        self.session_id,
            "student_id":        self.student_id,
            "file_name":         self.file_name,
            "originality_score": self.originality_score,
            "risk_level":        self.risk_level.value,
            "summary":           self.summary,
            "tfidf_matches":     self.tfidf_matches,
            "semantic_matches":  self.semantic_matches,
            "checked_at":        self.checked_at.isoformat(),
        }


# ─── Calibration profiles ──────────────────────────────────────
class CalibrationProfile(db.Model):
    __tablename__ = "calibration_profiles"
    id                = db.Column(db.Integer, primary_key=True)
    student_id        = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True)
    gaze_baseline     = db.Column(db.Float,   default=0.5)
    head_baseline     = db.Column(db.Float,   default=0.5)
    gaze_tolerance    = db.Column(db.Float,   default=0.1)
    head_tolerance    = db.Column(db.Float,   default=0.08)
    lip_baseline      = db.Column(db.Float,   default=0.05)
    has_eye_condition = db.Column(db.Boolean, default=False)
    eye_condition_type= db.Column(db.String(50), nullable=True)
    created_at        = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "student_id":         self.student_id,
            "gaze_baseline":      self.gaze_baseline,
            "head_baseline":      self.head_baseline,
            "gaze_tolerance":     self.gaze_tolerance,
            "head_tolerance":     self.head_tolerance,
            "lip_baseline":       self.lip_baseline,
            "has_eye_condition":  self.has_eye_condition,
            "eye_condition_type": self.eye_condition_type,
        }
class StudentGrade(db.Model):
    __tablename__ = "student_grades"
    id          = db.Column(db.Integer,  primary_key=True)
    session_id  = db.Column(db.Integer,  db.ForeignKey("sessions.id"), unique=True)
    student_id  = db.Column(db.Integer,  db.ForeignKey("users.id"))
    exam_id     = db.Column(db.Integer,  db.ForeignKey("exams.id"))
    grade       = db.Column(db.Integer,  nullable=False)
    feedback    = db.Column(db.Text,     nullable=True)
    sent_at     = db.Column(db.DateTime, default=datetime.utcnow)
    sent_by     = db.Column(db.Integer,  db.ForeignKey("users.id"))

    def to_dict(self):
        return {
            "session_id": self.session_id,
            "student_id": self.student_id,
            "exam_id":    self.exam_id,
            "grade":      self.grade,
            "feedback":   self.feedback,
            "sent_at":    self.sent_at.isoformat(),
        }
class ExamQuestion(db.Model):
    __tablename__ = "exam_questions"
    id            = db.Column(db.Integer,  primary_key=True)
    exam_id       = db.Column(db.Integer,  db.ForeignKey("exams.id"), nullable=False)
    question_text = db.Column(db.Text,     nullable=False)
    question_type = db.Column(db.String(20), default="mcq")  # mcq, essay, upload
    options       = db.Column(db.JSON,     nullable=True)     # for MCQ
    correct_answer= db.Column(db.Integer,  nullable=True)     # for MCQ
    marks         = db.Column(db.Integer,  default=5)
    order_num     = db.Column(db.Integer,  default=0)

    def to_dict(self):
        return {
            "id":            self.id,
            "exam_id":       self.exam_id,
            "question_text": self.question_text,
            "question_type": self.question_type,
            "options":       self.options,
            "marks":         self.marks,
            "order_num":     self.order_num,
        }


# ─── Student answers ───────────────────────────────────────────
class StudentAnswer(db.Model):
    """What a student actually submitted for one question of an exam —
    this is the piece that was missing entirely before: the frontend
    tracked answers in React state but never sent them anywhere, so
    lecturers had no way to see what a student actually answered."""
    __tablename__ = "student_answers"
    id              = db.Column(db.Integer, primary_key=True)
    session_id      = db.Column(db.Integer, db.ForeignKey("sessions.id"),       nullable=False)
    question_id     = db.Column(db.Integer, db.ForeignKey("exam_questions.id"), nullable=False)
    selected_option = db.Column(db.Integer, nullable=True)   # mcq
    answer_text     = db.Column(db.Text,    nullable=True)   # essay
    is_correct      = db.Column(db.Boolean, nullable=True)   # null = ungraded (essay)
    marks_awarded   = db.Column(db.Float,   default=0.0)

    def to_dict(self, question=None):
        d = {
            "id":              self.id,
            "session_id":      self.session_id,
            "question_id":     self.question_id,
            "selected_option": self.selected_option,
            "answer_text":     self.answer_text,
            "is_correct":      self.is_correct,
            "marks_awarded":   self.marks_awarded,
        }
        if question:
            d["question_text"] = question.question_text
            d["question_type"] = question.question_type
            d["options"]       = question.options
            d["correct_answer"]= question.correct_answer
            d["marks"]         = question.marks
        return d
# ─── Identity Verification ──────────────────────────────────────
class IdentityCheck(db.Model):
    __tablename__ = "identity_checks"
    id           = db.Column(db.Integer,  primary_key=True)
    session_id   = db.Column(db.Integer,  db.ForeignKey("sessions.id"), nullable=False)
    student_id   = db.Column(db.Integer,  db.ForeignKey("users.id"),    nullable=False)
    is_match     = db.Column(db.Boolean,  default=True)
    distance     = db.Column(db.Float,    default=0.0)
    confidence   = db.Column(db.Float,    default=0.0)
    checked_at   = db.Column(db.DateTime, default=datetime.utcnow)
    elapsed_secs = db.Column(db.Integer,  default=0)

    def to_dict(self):
        return {
            "id":           self.id,
            "session_id":   self.session_id,
            "student_id":   self.student_id,
            "is_match":     self.is_match,
            "distance":     self.distance,
            "confidence":   self.confidence,
            "checked_at":   self.checked_at.isoformat(),
            "elapsed_secs": self.elapsed_secs,
        }


# ─── Object Detection Events ────────────────────────────────────
class ObjectDetectionEvent(db.Model):
    __tablename__ = "object_detections"
    id                = db.Column(db.Integer,  primary_key=True)
    session_id        = db.Column(db.Integer,  db.ForeignKey("sessions.id"), nullable=False)
    object_class       = db.Column(db.String(30))
    raw_class          = db.Column(db.String(30))
    confidence         = db.Column(db.Float,    default=0.0)
    in_use             = db.Column(db.Boolean,  default=False)
    min_hand_distance  = db.Column(db.Float,    nullable=True)
    detected_at        = db.Column(db.DateTime, default=datetime.utcnow)
    elapsed_secs       = db.Column(db.Integer,  default=0)
    screenshot_path    = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "id":                self.id,
            "session_id":        self.session_id,
            "object_class":      self.object_class,
            "raw_class":         self.raw_class,
            "confidence":        self.confidence,
            "in_use":            self.in_use,
            "min_hand_distance": self.min_hand_distance,
            "detected_at":       self.detected_at.isoformat(),
            "elapsed_secs":      self.elapsed_secs,
            "screenshot_path":   self.screenshot_path,
        }


# ─── Temporal Fusion Scores ──────────────────────────────────────
class FusionScore(db.Model):
    __tablename__ = "fusion_scores"
    id            = db.Column(db.Integer,  primary_key=True)
    session_id    = db.Column(db.Integer,  db.ForeignKey("sessions.id"), nullable=False)
    score         = db.Column(db.Float,    default=0.0)
    is_high_risk  = db.Column(db.Boolean,  default=False)
    feature_vector= db.Column(db.JSON,     nullable=True)   # last frame's 10 features
    recorded_at   = db.Column(db.DateTime, default=datetime.utcnow)
    elapsed_secs  = db.Column(db.Integer,  default=0)

    def to_dict(self):
        return {
            "id":             self.id,
            "session_id":     self.session_id,
            "score":          self.score,
            "is_high_risk":   self.is_high_risk,
            "feature_vector": self.feature_vector,
            "recorded_at":    self.recorded_at.isoformat(),
            "elapsed_secs":   self.elapsed_secs,
        }