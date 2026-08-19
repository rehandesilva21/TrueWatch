import threading
import time
import subprocess
import platform
import logging

class TabMonitor:
    """
    Monitors for browser tab switching and application switching
    at OS level across Windows, macOS, and Linux environments.
    """

    def __init__(self, incident_logger=None):
        self.logger          = incident_logger
        self.running         = False
        self._thread         = None
        self.last_app        = None
        self.allowed_apps    = ["Google Chrome", "Safari",
                                "Firefox", "TrueWatch"]
        self.switch_count    = 0
        self.os_type         = platform.system()  # 'Windows', 'Darwin', 'Linux'

        self.latest = {
            "active_app":   "unknown",
            "alert":        False,
            "switch_count": 0,
        }
        self._lock = threading.Lock()

    def _get_active_app(self) -> str:
        """Query currently focused window title from the OS window manager."""
        try:
            # 1. WINDOWS IMPLEMENTATION (User32 Win32 API)
            if self.os_type == "Windows":
                import ctypes
                hwnd = ctypes.windll.user32.GetForegroundWindow()
                if not hwnd:
                    return "unknown"
                length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
                buf = ctypes.create_unicode_buffer(length + 1)
                ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
                return buf.value or "unknown"

            # 2. macOS IMPLEMENTATION (WindowServer via AppleScript)
            elif self.os_type == "Darwin":
                # Queries frontmost application name and active window title
                script = '''
                tell application "System Events"
                    set frontApp to name of first application process whose frontmost is true
                    try
                        tell process frontApp
                            set winTitle to name of window 1
                            return frontApp & " - " & winTitle
                        end tell
                    on error
                        return frontApp
                    end try
                end tell
                '''
                cmd = ["osascript", "-e", script]
                result = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8").strip()
                return result or "unknown"

            # 3. LINUX IMPLEMENTATION (X11 / Wayland Compositor)
            elif self.os_type == "Linux":
                # Primary attempt: xdotool (X11)
                try:
                    cmd = ["xdotool", "getactivewindow", "getwindowname"]
                    return subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8").strip() or "unknown"
                except (subprocess.CalledProcessError, FileNotFoundError):
                    # Fallback attempt: xprop (X11)
                    cmd = "xprop -id $(xprop -root _NET_ACTIVE_WINDOW | cut -d' ' -f5) WM_NAME"
                    out = subprocess.check_output(cmd, shell=True, stderr=subprocess.DEVNULL).decode("utf-8").strip()
                    if '="' in out:
                        return out.split('="')[1].rstrip('"')
                    return "unknown"

            return "unknown"

        except Exception:
            return "unknown"

    def _run(self):
        # Give time for initial exam session window initialization
        time.sleep(3)
        initial_app = self._get_active_app()

        with self._lock:
            self.last_app = initial_app
            self.latest["active_app"] = initial_app

        print(f"[TabMonitor] Started on {self.os_type}. Watching active app: {self.last_app}")

        while self.running:
            time.sleep(1.5)  # Polling interval
            current_app = self._get_active_app()

            if current_app and current_app != "unknown" and current_app != self.last_app:
                self.switch_count += 1

                # Substring case-insensitive match against allowed app whitelist
                current_lower = current_app.lower()
                alert = not any(
                    allowed.lower() in current_lower
                    for allowed in self.allowed_apps
                )

                print(f"[TAB MONITOR] App switched: "
                      f"{self.last_app} → {current_app} "
                      f"({'ALERT' if alert else 'OK'})")

                # Log incident to telemetry pipeline
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
        if not self.running:
            self.running = True
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
            print("[TabMonitor] Daemon thread initialized.")

    def stop(self):
        self.running = False

    def get_status(self):
        with self._lock:
            return self.latest.copy()