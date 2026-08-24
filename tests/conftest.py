"""
tests/conftest.py

Shared pytest fixtures for the automated test suite (Chapter 7).
"""
import os
import sys
from unittest.mock import MagicMock

# ── Mock heavy ML dependencies before anything imports them ───────────
for _module_name in [
    "tensorflow", "tensorflow.keras", "tensorflow.keras.models",
    "deepface",
    "ultralytics",
    "sentence_transformers",
    "mediapipe",
    "librosa",
    "lightgbm",
    "pandas",
    "torch",
]:
    sys.modules[_module_name] = MagicMock()

# ── Isolated in-memory database for the whole test session ────────────
os.environ["TRUEWATCH_DB_URI"] = "sqlite:///:memory:"

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(scope="session")
def app():
   
    from backend.api import app as flask_app
    flask_app.config["TESTING"] = True

    from backend.database import init_db
    init_db(flask_app)

    yield flask_app


@pytest.fixture(autouse=True)
def clean_database(app):
    
    from backend.database import db, _seed_admin
    with app.app_context():
        db.drop_all()
        db.create_all()
        _seed_admin(app)
    yield


@pytest.fixture
def client(app):
    
    return app.test_client()


@pytest.fixture
def db_session(app):
    
    from backend.database import db
    with app.app_context():
        yield db.session


@pytest.fixture
def admin_token(client):
   
    res = client.post("/api/auth/login", json={
        "email": "admin@truewatch.com", "password": "admin123"
    })
    assert res.status_code == 200
    return res.get_json()["token"]
