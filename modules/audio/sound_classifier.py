import os
import numpy as np
import threading
import time

# ─── Sound categories ──────────────────────────────────────────
SOUND_CLASSES = ["silence", "whisper", "speech", "loud", "paper", "ambient"]
ALERT_CLASSES = ["whisper", "speech", "loud", "paper"]

# Trained ensemble covers only these 4 (see modules/audio/esc50_loader.py) —
# it has no whisper/speech classes, so it's used only to corroborate paper
# detection, not to replace the fast rule-based path.
ENSEMBLE_SAMPLE_RATE = 22050
ENSEMBLE_WINDOW_SEC  = 5.0
ENSEMBLE_WINDOW_LEN  = int(ENSEMBLE_SAMPLE_RATE * ENSEMBLE_WINDOW_SEC)
ENSEMBLE_CHECK_EVERY = 2.0   # seconds between ensemble passes
ENSEMBLE_PAPER_CONF  = 0.55  # minimum confidence to trust an ensemble "paper" call

try:
    from modules.audio.audio_inference import load_ensemble, predict_proba_from_array
    from modules.audio.esc50_loader import TARGET_CLASSES as ENSEMBLE_CLASSES
    _ENSEMBLE_IMPORTED = True
except Exception as e:
    print(f"Audio ensemble unavailable ({e}) — falling back to rule-based only.")
    _ENSEMBLE_IMPORTED = False


def get_audio_energy(audio_chunk):
    return float(np.sqrt(np.mean(audio_chunk ** 2)))


def extract_features_fast(audio_chunk, sample_rate=22050):
    """FFT-based frequency band analysis — fast and accurate."""
    if len(audio_chunk) == 0:
        return None

    # Apply Hanning window to reduce spectral leakage
    window   = np.hanning(len(audio_chunk))
    windowed = audio_chunk * window

    fft_mag  = np.abs(np.fft.rfft(windowed))
    freqs    = np.fft.rfftfreq(len(audio_chunk), d=1.0 / sample_rate)

    def band(lo, hi):
        mask = (freqs >= lo) & (freqs < hi)
        return float(np.mean(fft_mag[mask])) if mask.any() else 0.0

    # Frequency bands most relevant to human voice and paper sounds
    sub_bass  = band(20,   150)   # rumble, low noise
    bass      = band(150,  500)   # low voice, chest resonance
    low_mid   = band(500,  1200)  # core speech formants
    mid       = band(1200, 2500)  # speech clarity, consonants
    high_mid  = band(2500, 4000)  # sibilance (s,f,sh), whisper
    presence  = band(4000, 6000)  # paper rustle, high noise
    air       = band(6000, 11000) # paper, high frequency noise

    energy    = get_audio_energy(audio_chunk)
    peak      = float(np.max(np.abs(audio_chunk)))
    zcr       = float(np.mean(np.abs(np.diff(np.sign(audio_chunk)))) / 2)

    return {
        "sub_bass":  sub_bass,
        "bass":      bass,
        "low_mid":   low_mid,
        "mid":       mid,
        "high_mid":  high_mid,
        "presence":  presence,
        "air":       air,
        "energy":    energy,
        "peak":      peak,
        "zcr":       zcr,       # zero crossing rate — high = noisy/fricative
    }


# ─── Adaptive calibrated classifier ───────────────────────────
class RuleBasedClassifier:
    def __init__(self):
        # These get overwritten during calibration
        self.bg_energy      = 0.003
        self.bg_low_mid     = 0.0
        self.bg_high_mid    = 0.0
        self.bg_air         = 0.0

        # Thresholds (set after calibration)
        self.silence_thresh  = 0.003
        self.whisper_thresh  = 0.006
        self.speech_thresh   = 0.018
        self.loud_thresh     = 0.055
        self.calibrated      = False

    def calibrate_background(self, energy_samples, feature_samples):
        if not energy_samples:
            return

        self.bg_energy   = float(np.percentile(energy_samples, 75))

        if feature_samples:
            self.bg_low_mid  = float(np.mean([f["low_mid"]  for f in feature_samples]))
            self.bg_high_mid = float(np.mean([f["high_mid"] for f in feature_samples]))
            self.bg_air      = float(np.mean([f["air"]      for f in feature_samples]))

        # Set adaptive thresholds above background
        self.silence_thresh = max(self.bg_energy * 1.2,  0.002)
        self.whisper_thresh = max(self.bg_energy * 2.5,  0.005)
        self.speech_thresh  = max(self.bg_energy * 6.0,  0.015)
        self.loud_thresh    = max(self.bg_energy * 20.0, 0.050)
        self.calibrated     = True

        print(f"Audio calibrated:")
        print(f"  Background energy : {self.bg_energy:.5f}")
        print(f"  Silence  threshold: {self.silence_thresh:.5f}")
        print(f"  Whisper  threshold: {self.whisper_thresh:.5f}")
        print(f"  Speech   threshold: {self.speech_thresh:.5f}")
        print(f"  Loud     threshold: {self.loud_thresh:.5f}")

    def classify(self, features):
        if features is None:
            return "silence", 0.9, False

        energy   = features["energy"]
        peak     = features["peak"]
        low_mid  = features["low_mid"]
        mid      = features["mid"]
        high_mid = features["high_mid"]
        presence = features["presence"]
        air      = features["air"]
        zcr      = features["zcr"]

        voice_energy = low_mid + mid + high_mid
        noise_energy = presence + air

        # ── Silence ────────────────────────────────────────
        if energy < self.silence_thresh:
            return "silence", 0.95, False

        # ── Loud voice ─────────────────────────────────────
        if energy > self.loud_thresh:
            return "loud", min(0.97, energy / self.loud_thresh * 0.5), True

        # ── Paper / rustling ───────────────────────────────
        # Paper: high ZCR + dominant high frequencies + spread across air band
        if (zcr > 0.15 and noise_energy > voice_energy * 0.8
                and energy > self.whisper_thresh):
            conf = min(0.90, zcr * 2.0)
            return "paper", round(conf, 2), True

        # ── Normal speech ──────────────────────────────────
        if energy > self.speech_thresh and voice_energy > noise_energy:
            conf = min(0.93, energy / self.speech_thresh * 0.45)
            return "speech", round(conf, 2), True

        # ── Whisper ────────────────────────────────────────
        # Whisper: energy just above bg, dominant high_mid + presence
        # (whispers lack bass/low_mid, concentrate in 2.5–6kHz)
        whisper_score = (high_mid + presence) / (low_mid + mid + 1e-6)
        if (energy > self.whisper_thresh
                and energy < self.speech_thresh
                and whisper_score > 1.2):
            conf = min(0.88, whisper_score * 0.3)
            return "whisper", round(conf, 2), True

        # ── Ambient ────────────────────────────────────────
        return "ambient", 0.6, False


# ─── Audio monitor ─────────────────────────────────────────────
class AudioMonitor:
    def __init__(self):
        self.classifier = RuleBasedClassifier()
        self.running    = False
        self._thread    = None
        self.latest_result = {
            "class":      "silence",
            "confidence": 0.0,
            "alert":      False,
            "energy":     0.0,
            "features":   None,
            "ensemble_class":      None,
            "ensemble_confidence": 0.0,
        }
        self._lock          = threading.Lock()
        self._result_buffer = []
        self.BUFFER_SIZE    = 3

        # Rolling 5-second buffer for the trained ensemble, filled continuously
        # by the same InputStream callback used for the fast rule-based path.
        self._ring          = np.zeros(ENSEMBLE_WINDOW_LEN, dtype='float32')
        self._ring_filled   = 0
        self._ensemble_ok   = False
        self._last_ensemble_check = 0.0
        self._ensemble_result     = {"class": None, "confidence": 0.0}

    def calibrate(self, duration_seconds=4):
        import sounddevice as sd
        SAMPLE_RATE   = 22050
        CHUNK_SAMPLES = 4410   # 0.2 sec chunks for calibration

        print("Stay quiet — calibrating background audio...")
        energy_samples  = []
        feature_samples = []

        def cb(indata, frames, time_info, status):
            chunk    = indata.copy().flatten()
            energy_samples.append(get_audio_energy(chunk))
            feat = extract_features_fast(chunk, SAMPLE_RATE)
            if feat:
                feature_samples.append(feat)

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1,
                            blocksize=CHUNK_SAMPLES,
                            dtype='float32', callback=cb):
            time.sleep(duration_seconds)

        self.classifier.calibrate_background(energy_samples, feature_samples)

    def _load_ensemble_safe(self):
        if not _ENSEMBLE_IMPORTED:
            return
        try:
            load_ensemble()
            self._ensemble_ok = True
        except Exception as e:
            print(f"Could not load audio ensemble ({e}) — continuing with rule-based only.")
            self._ensemble_ok = False

    def _check_ensemble(self, now):
        """Runs the trained CNN+LightGBM ensemble on the last 5s of audio.
        Only called every ENSEMBLE_CHECK_EVERY seconds — it's a corroboration
        signal for quiet paper-handling the fast heuristic misses, not a
        replacement for the real-time whisper/speech/loud path."""
        if not self._ensemble_ok:
            return
        if self._ring_filled < ENSEMBLE_WINDOW_LEN:
            return  # still warming up (first 5s of the session)
        if now - self._last_ensemble_check < ENSEMBLE_CHECK_EVERY:
            return

        self._last_ensemble_check = now
        try:
            proba = predict_proba_from_array(self._ring.copy())
            idx   = int(np.argmax(proba))
            self._ensemble_result = {
                "class":      ENSEMBLE_CLASSES[idx],
                "confidence": float(proba[idx]),
            }
        except Exception as e:
            print(f"Ensemble prediction failed ({e}) — skipping this cycle.")

    def _run(self):
        import sounddevice as sd
        SAMPLE_RATE   = 22050
        CHUNK_SAMPLES = 4410   # 0.2 sec — fast response
        audio_buffer  = np.zeros(CHUNK_SAMPLES, dtype='float32')

        def cb(indata, frames, time_info, status):
            nonlocal audio_buffer
            chunk = indata.copy().flatten()
            audio_buffer = chunk

            # Feed the rolling 5s buffer for the ensemble
            self._ring = np.roll(self._ring, -len(chunk))
            self._ring[-len(chunk):] = chunk
            self._ring_filled = min(self._ring_filled + len(chunk), ENSEMBLE_WINDOW_LEN)

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1,
                            blocksize=CHUNK_SAMPLES,
                            dtype='float32', callback=cb):
            while self.running:
                time.sleep(0.08)   # classify every 80ms — fast enough for real-time
                now      = time.time()
                chunk    = audio_buffer.copy()
                features = extract_features_fast(chunk, SAMPLE_RATE)
                cls, conf, alert = self.classifier.classify(features)
                energy   = features["energy"] if features else 0.0

                # Smooth: majority vote over last 3 results
                self._result_buffer.append((cls, alert))
                if len(self._result_buffer) > self.BUFFER_SIZE:
                    self._result_buffer.pop(0)

                # Most common class in buffer
                classes        = [r[0] for r in self._result_buffer]
                alerts         = [r[1] for r in self._result_buffer]
                dominant_class = max(set(classes), key=classes.count)
                confirmed      = sum(alerts) >= 2

                # ── Ensemble corroboration (paper only) ─────────────────
                self._check_ensemble(now)
                ens = self._ensemble_result
                if (ens["class"] == "paper"
                        and ens["confidence"] >= ENSEMBLE_PAPER_CONF
                        and dominant_class in ("ambient", "silence")):
                    # Rule-based heuristic sees nothing alarming, but the
                    # trained model is confident it's hearing paper over the
                    # last 5s — this is exactly the case it was added for.
                    dominant_class = "paper"
                    conf           = ens["confidence"]
                    confirmed      = True

                with self._lock:
                    self.latest_result = {
                        "class":      dominant_class,
                        "confidence": conf,
                        "alert":      confirmed,
                        "energy":     energy,
                        "features":   features,
                        "ensemble_class":      ens["class"],
                        "ensemble_confidence": ens["confidence"],
                    }

    def start(self):
        self._load_ensemble_safe()
        self.running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        print("Audio monitor started.")

    def stop(self):
        self.running = False

    def get_result(self):
        with self._lock:
            return self.latest_result.copy()