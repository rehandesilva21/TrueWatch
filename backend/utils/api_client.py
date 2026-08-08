import requests

API_BASE = "http://localhost:5001/api"


class TrueWatchAPIClient:
    """
    Handles authentication and session lifecycle against the
    Flask API, so the desktop app can log in as a real student
    and get a session_token for database-backed proctoring.
    """

    def __init__(self):
        self.token      = None
        self.user       = None

    def login(self, email, password):
        try:
            res = requests.post(f"{API_BASE}/auth/login", json={
                "email": email, "password": password
            }, timeout=5)
            res.raise_for_status()
            data = res.json()
            self.token = data["token"]
            self.user  = data["user"]
            print(f"Logged in as {self.user['name']} ({self.user['role']})")
            return True
        except Exception as e:
            print(f"Login failed: {e}")
            return False

    def start_session(self, exam_id):
        if not self.token:
            print("Not logged in — cannot start session.")
            return None
        try:
            res = requests.post(
                f"{API_BASE}/session/start",
                headers={"Authorization": f"Bearer {self.token}"},
                json={"exam_id": exam_id},
                timeout=5,
            )
            res.raise_for_status()
            data = res.json()
            print(f"Session started — token: {data['session_token'][:12]}...")
            return data["session_token"]
        except Exception as e:
            print(f"Failed to start session: {e}")
            print("Check: is the exam ACTIVE, and is the student enrolled?")
            return None

    def stop_session(self, session_token):
        if not self.token:
            return None
        try:
            res = requests.post(
                f"{API_BASE}/session/stop",
                headers={"Authorization": f"Bearer {self.token}"},
                json={"session_token": session_token},
                timeout=5,
            )
            res.raise_for_status()
            data = res.json()
            print(f"Session stopped — risk score: {data['risk_score']}/100, "
                  f"result: {data['result']}")
            return data
        except Exception as e:
            print(f"Failed to stop session: {e}")
            return None