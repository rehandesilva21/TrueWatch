

def create_batch(client, admin_token, name="Batch A"):
    return client.post("/api/batches",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": name, "description": "Test batch"})


def test_admin_can_create_batch(client, admin_token):
    res = create_batch(client, admin_token)
    assert res.status_code == 201
    assert res.get_json()["batch"]["name"] == "Batch A"


def test_batch_name_is_required(client, admin_token):
    res = client.post("/api/batches",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"description": "No name given"})
    assert res.status_code == 400


def test_student_creation_requires_valid_batch_id(client, admin_token):
    res = client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Ghost Batch Student", "email": "ghost@test.com",
              "password": "password123", "role": "student", "batch_id": 9999})
    assert res.status_code == 400


def test_student_assigned_to_real_batch_succeeds(client, admin_token):
    batch = create_batch(client, admin_token, "Batch B").get_json()["batch"]
    res = client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Real Student", "email": "real@test.com",
              "password": "password123", "role": "student", "batch_id": batch["id"]})
    assert res.status_code == 201
    assert res.get_json()["user"]["batch_id"] == batch["id"]


def create_lecturer_token(client, admin_token):
    client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Dr Lecturer", "email": "lecturer@test.com",
              "password": "password123", "role": "lecturer"})
    login = client.post("/api/auth/login", json={
        "email": "lecturer@test.com", "password": "password123"
    })
    return login.get_json()["token"]


def test_lecturer_can_create_mcq_exam(client, admin_token):
    lecturer_token = create_lecturer_token(client, admin_token)
    res = client.post("/api/exams",
        headers={"Authorization": f"Bearer {lecturer_token}"},
        json={"title": "Midterm Exam", "exam_type": "mcq",
              "assignment_type": "individual", "duration_mins": 60})
    assert res.status_code == 201
    body = res.get_json()["exam"]
    assert body["exam_type"] == "mcq"
    assert body["status"] == "draft"


def test_exam_creation_rejects_invalid_exam_type(client, admin_token):
    lecturer_token = create_lecturer_token(client, admin_token)
    res = client.post("/api/exams",
        headers={"Authorization": f"Bearer {lecturer_token}"},
        json={"title": "Bad Exam", "exam_type": "quiz", "duration_mins": 60})
    assert res.status_code == 400


def test_batch_assignment_exam_requires_batch_id(client, admin_token):
    lecturer_token = create_lecturer_token(client, admin_token)
    res = client.post("/api/exams",
        headers={"Authorization": f"Bearer {lecturer_token}"},
        json={"title": "Batch Exam", "exam_type": "mcq",
              "assignment_type": "batch", "duration_mins": 60})
    assert res.status_code == 400


def test_batch_assignment_exam_auto_enrols_batch_students(client, admin_token):
    lecturer_token = create_lecturer_token(client, admin_token)
    batch = create_batch(client, admin_token, "Batch C").get_json()["batch"]
    client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Enrolled Student", "email": "enrolled@test.com",
              "password": "password123", "role": "student", "batch_id": batch["id"]})

    res = client.post("/api/exams",
        headers={"Authorization": f"Bearer {lecturer_token}"},
        json={"title": "Batch-Wide Exam", "exam_type": "mcq",
              "assignment_type": "batch", "batch_id": batch["id"], "duration_mins": 60})
    assert res.status_code == 201
    assert res.get_json()["batch_enrolled"] == 1


def test_student_cannot_start_exam_they_are_not_enrolled_in(client, admin_token):
    lecturer_token = create_lecturer_token(client, admin_token)
    exam = client.post("/api/exams",
        headers={"Authorization": f"Bearer {lecturer_token}"},
        json={"title": "Locked Exam", "exam_type": "mcq",
              "assignment_type": "individual", "duration_mins": 60}).get_json()["exam"]

    client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Outsider", "email": "outsider@test.com",
              "password": "password123", "role": "student"})
    student_token = client.post("/api/auth/login", json={
        "email": "outsider@test.com", "password": "password123"
    }).get_json()["token"]

    res = client.post("/api/session/start",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"exam_id": exam["id"]})
    assert res.status_code == 403
