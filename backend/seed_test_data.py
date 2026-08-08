import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.api import app
from backend.database import db
from backend.models import User, Exam, ExamEnrollment, UserRole, ExamStatus
from werkzeug.security import generate_password_hash
from datetime import datetime, timedelta

def seed():
    with app.app_context():
        # ── Test student ────────────────────────────────────
        student = User.query.filter_by(email="teststudent@truewatch.com").first()
        if not student:
            student = User(
                name  = "Test Student",
                email = "teststudent@truewatch.com",
                role  = UserRole.STUDENT,
            )
            student.set_password("test1234")
            db.session.add(student)
            db.session.commit()
            print(f"Created test student: teststudent@truewatch.com / test1234 (id={student.id})")
        else:
            print(f"Test student already exists (id={student.id})")

        # ── Test lecturer (reuse if exists) ─────────────────
        lecturer = User.query.filter_by(role=UserRole.LECTURER).first()
        if not lecturer:
            lecturer = User(
                name  = "Dr. Test Lecturer",
                email = "testlecturer@truewatch.com",
                role  = UserRole.LECTURER,
            )
            lecturer.set_password("test1234")
            db.session.add(lecturer)
            db.session.commit()
            print(f"Created test lecturer (id={lecturer.id})")

        # ── Test exam ────────────────────────────────────────
        exam = Exam.query.filter_by(title="TrueWatch Integration Test Exam").first()
        if not exam:
            exam = Exam(
                created_by    = lecturer.id,
                title         = "TrueWatch Integration Test Exam",
                description   = "Test exam for backend integration testing",
                duration_mins = 60,
                status        = ExamStatus.ACTIVE,   # must be active to start a session
                start_time    = datetime.utcnow(),
                end_time      = datetime.utcnow() + timedelta(hours=2),
            )
            db.session.add(exam)
            db.session.commit()
            print(f"Created test exam (id={exam.id})")
        else:
            print(f"Test exam already exists (id={exam.id})")

        # ── Enroll student in exam ──────────────────────────
        enrollment = ExamEnrollment.query.filter_by(
            exam_id=exam.id, student_id=student.id
        ).first()
        if not enrollment:
            enrollment = ExamEnrollment(exam_id=exam.id, student_id=student.id)
            db.session.add(enrollment)
            db.session.commit()
            print("Enrolled test student in test exam")
        else:
            print("Test student already enrolled")

        print("\n" + "=" * 50)
        print("SEED COMPLETE — use these for testing:")
        print(f"  Student ID : {student.id}")
        print(f"  Exam ID    : {exam.id}")
        print(f"  Login      : teststudent@truewatch.com / test1234")
        print("=" * 50)

if __name__ == "__main__":
    seed()