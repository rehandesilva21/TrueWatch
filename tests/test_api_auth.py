

def test_login_with_correct_credentials_succeeds(client):
    res = client.post("/api/auth/login", json={
        "email": "admin@truewatch.com", "password": "admin123"
    })
    assert res.status_code == 200
    body = res.get_json()
    assert "token" in body
    assert body["user"]["role"] == "admin"


def test_login_with_wrong_password_is_rejected(client):
    res = client.post("/api/auth/login", json={
        "email": "admin@truewatch.com", "password": "wrong-password"
    })
    assert res.status_code == 401
    assert "error" in res.get_json()


def test_login_with_unknown_email_is_rejected(client):
    res = client.post("/api/auth/login", json={
        "email": "nobody@truewatch.com", "password": "anything"
    })
    assert res.status_code == 401


def test_login_missing_fields_returns_400(client):
    res = client.post("/api/auth/login", json={"email": "admin@truewatch.com"})
    assert res.status_code == 400


def test_protected_endpoint_without_token_is_unauthorized(client):
    res = client.get("/api/admin/users")
    assert res.status_code == 401


def test_protected_endpoint_with_invalid_token_is_unauthorized(client):
    res = client.get("/api/admin/users", headers={"Authorization": "Bearer not-a-real-token"})
    assert res.status_code == 401


def test_self_registration_is_disabled(client):
    """Confirms the deliberate design decision (Chapter 4, Section 4.3.1)
    that students cannot self-register — every account must be created by
    an administrator."""
    res = client.post("/api/auth/register", json={
        "name": "Test Student", "email": "student@test.com", "password": "password123"
    })
    assert res.status_code == 403


def test_admin_can_create_user(client, admin_token):
    res = client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Jane Student", "email": "jane@test.com",
              "password": "password123", "role": "student"})
    assert res.status_code == 201
    assert res.get_json()["user"]["email"] == "jane@test.com"


def test_admin_cannot_create_duplicate_email(client, admin_token):
    payload = {"name": "Dup", "email": "dup@test.com", "password": "password123", "role": "student"}
    first = client.post("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"}, json=payload)
    second = client.post("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"}, json=payload)
    assert first.status_code == 201
    assert second.status_code == 409


def test_non_admin_cannot_create_users(client, admin_token):
    """Role-based access control: even a genuinely authenticated user
    (a student) must be rejected from an admin-only endpoint."""
    create = client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"name": "Regular Student", "email": "regular@test.com",
              "password": "password123", "role": "student"})
    assert create.status_code == 201

    login = client.post("/api/auth/login", json={
        "email": "regular@test.com", "password": "password123"
    })
    student_token = login.get_json()["token"]

    res = client.post("/api/admin/users",
        headers={"Authorization": f"Bearer {student_token}"},
        json={"name": "Should Fail", "email": "fail@test.com",
              "password": "password123", "role": "student"})
    assert res.status_code == 403


def test_change_password_requires_correct_current_password(client, admin_token):
    res = client.post("/api/auth/change-password",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "wrong-current", "new_password": "newpassword123"})
    assert res.status_code == 401


def test_change_password_rejects_short_new_password(client, admin_token):
    res = client.post("/api/auth/change-password",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_password": "short"})
    assert res.status_code == 400


def test_change_password_succeeds_and_new_password_works(client, admin_token):
    res = client.post("/api/auth/change-password",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"current_password": "admin123", "new_password": "newpassword123"})
    assert res.status_code == 200

    relogin = client.post("/api/auth/login", json={
        "email": "admin@truewatch.com", "password": "newpassword123"
    })
    assert relogin.status_code == 200
