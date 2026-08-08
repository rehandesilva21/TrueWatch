import threading
import time
import subprocess
import platform

class TabMonitor:
    """
    Monitors for browser tab switching and
    application switching at OS level on macOS.
    """

    def __init__(self, incident_logger=None):
        self.logger          = incident_logger
        self.running         = False
        self._thread         = None
        self.last_app        = None
        self.allowed_apps    = ["Google Chrome", "Safari",
                                 "Firefox", "TrueWatch"]
        self.switch_count    = 0

        self.latest = {
            "active_app":   "unknown",
            "alert":        False,
            "switch_count": 0,
        }
        self._lock = threading.Lock()

    def _get_active_app(self):
        """Get currently focused application on Windows."""
        try:
            import ctypes
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            return buf.value or "unknown"
        except Exception:
            return "unknown"

    def _run(self):
        # Give a moment for exam to start
        time.sleep(3)
        self.last_app = self._get_active_app()
        print(f"Tab monitor started. Watching app: {self.last_app}")

        while self.running:
            time.sleep(1.5)  # check every 1.5 seconds
            current_app = self._get_active_app()

            if current_app and current_app != self.last_app:
                self.switch_count += 1
                # current_app is the FULL window title bar text (e.g.
                # "student (localhost:5173) - TrueWatch - Visual Studio Code"),
                # not a bare app name — so it will never exactly equal an
                # entry in allowed_apps. Match by substring instead, or
                # every legitimate window (including the exam tab itself)
                # gets flagged as a cheating incident.
                current_lower = current_app.lower()
                alert = not any(
                    allowed.lower() in current_lower
                    for allowed in self.allowed_apps
                )

                print(f"[TAB MONITOR] App switched: "
                      f"{self.last_app} → {current_app} "
                      f"({'ALERT' if alert else 'OK'})")

                # Log incident
                if self.logger and alert:
                    self.logger.log(
                        incident_type="TAB_SWITCH",
                        confidence=0.99,
                        details=f"Switched to: {current_app}"
                    )

                with self._lock:
                    self.latest = {
                        "active_app":   current_app,
                        "alert":        alert,
                        "switch_count": self.switch_count,
                    }

                self.last_app = current_app

    def start(self):
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("Tab monitor started.")

    def stop(self):
        self.running = False

    def get_status(self):
        with self._lock:
            return self.latest.copy()