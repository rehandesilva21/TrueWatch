import os
import json
import time
import threading
import cv2
from datetime import datetime
import threading
import requests

LOG_PATH        = "data/incidents"
SCREENSHOT_PATH = "static/screenshots"
AUDIO_CLIP_PATH = "static/audio_clips"

os.makedirs(LOG_PATH,        exist_ok=True)
os.makedirs(SCREENSHOT_PATH, exist_ok=True)
os.makedirs(AUDIO_CLIP_PATH, exist_ok=True)


class IncidentLogger:
    """
    Logs all proctoring incidents with:
    - Timestamp
    - Incident type
    - Confidence score
    - Evidence screenshot
    - Session metadata
    """

    def __init__(self, session_id=None, session_token=None, api_base="http://localhost:5001/api"):
        self.session_id     = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self.session_token  = session_token   # NEW — enables live push
        self.api_base       = api_base
        self.incidents      = []
        self.session_start  = time.time()
        self._lock          = threading.Lock()
        self._last_logged   = {}
        self.COOLDOWN       = 5.0
        print(f"Incident logger started — Session: {self.session_id}")

    def _push_live(self, incident):
        """Fire-and-forget POST so the browser gets a real-time toast."""
        if not self.session_token:
            return
        def _send():
            try:
                requests.post(f"{self.api_base}/session/incident", json={
                    "session_token": self.session_token,
                    "type":          incident["type"],
                    "confidence":    incident["confidence"],
                    "details":       incident["details"],
                }, timeout=1.5)
            except Exception:
                pass
        threading.Thread(target=_send, daemon=True).start()

    def log(self, incident_type, confidence=0.0, frame=None, details=""):
        now = time.time()
        with self._lock:
            last = self._last_logged.get(incident_type, 0)
            if now - last < self.COOLDOWN:
                return
            self._last_logged[incident_type] = now

        timestamp = datetime.now()
        elapsed   = round(now - self.session_start, 1)
        screenshot_path = None

        if frame is not None:
            fname = f"{self.session_id}_{incident_type}_{timestamp.strftime('%H%M%S')}.jpg"
            screenshot_path = os.path.join(SCREENSHOT_PATH, fname)
            cv2.imwrite(screenshot_path, frame)

        incident = {
            "id": len(self.incidents) + 1, "session_id": self.session_id,
            "type": incident_type, "confidence": round(confidence, 3),
            "timestamp": timestamp.isoformat(), "elapsed_secs": elapsed,
            "details": details, "screenshot": screenshot_path,
        }

        with self._lock:
            self.incidents.append(incident)

        print(f"[INCIDENT] {elapsed}s | {incident_type} | conf:{confidence:.0%} | {details}")
        self._push_live(incident)   # NEW
        return incident

    def get_all(self):
        with self._lock:
            return self.incidents.copy()

    def get_summary(self):
        """Return incident counts grouped by type."""
        with self._lock:
            summary = {}
            for inc in self.incidents:
                t = inc["type"]
                summary[t] = summary.get(t, 0) + 1
        return summary

    def get_risk_score(self):
        weights = {
            "GAZE":               2,
            "HEAD":                2,
            "LIP":                 3,
            "ABSENT":              5,
            "MULTI_FACE":          10,
            "AUDIO_SPEECH":        4,
            "AUDIO_WHISPER":       6,
            "AUDIO_LOUD":          3,
            "AUDIO_PAPER":         3,
            "TAB_SWITCH":          8,
            "APP_SWITCH":          8,
            "IDENTITY_MISMATCH":   15,   # highest single-signal weight — proxy risk
            "PROHIBITED_OBJECT":   12,
            "FUSION_HIGH_RISK":    10,
        }
        with self._lock:
            score = sum(
                weights.get(inc["type"], 1)
                for inc in self.incidents
            )
        return min(score, 100)
    
    def save_session(self):
        """Save full session log as JSON."""
        session_data = {
            "session_id":    self.session_id,
            "start_time":    datetime.fromtimestamp(
                                 self.session_start).isoformat(),
            "end_time":      datetime.now().isoformat(),
            "duration_secs": round(time.time() - self.session_start, 1),
            "total_incidents": len(self.incidents),
            "risk_score":    self.get_risk_score(),
            "summary":       self.get_summary(),
            "incidents":     self.get_all(),
        }

        fname  = f"{self.session_id}_session.json"
        fpath  = os.path.join(LOG_PATH, fname)
        with open(fpath, 'w') as f:
            json.dump(session_data, f, indent=2)

        print(f"Session saved: {fpath}")
        print(f"Total incidents: {len(self.incidents)}")
        print(f"Risk score: {self.get_risk_score()}/100")
        return fpath