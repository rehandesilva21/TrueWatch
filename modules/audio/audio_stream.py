import os
import numpy as np
import sounddevice as sd
import queue
import threading

# ─── Audio config ──────────────────────────────────────────────
SAMPLE_RATE    = 22050   # Hz — standard for audio ML
CHUNK_DURATION = 1.0     # seconds per chunk
CHUNK_SAMPLES  = int(SAMPLE_RATE * CHUNK_DURATION)
CHANNELS       = 1

class AudioStream:
    """
    Continuously captures microphone audio in a background thread
    and puts chunks into a queue for the classifier to process.
    """
    def __init__(self):
        self.queue     = queue.Queue()
        self.running   = False
        self._stream   = None
        self._thread   = None

    def _callback(self, indata, frames, time, status):
        if status:
            print(f"Audio stream status: {status}")
        # Put a copy of the audio chunk into the queue
        self.queue.put(indata.copy().flatten())

    def start(self):
        self.running = True
        self._stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            blocksize=CHUNK_SAMPLES,
            dtype='float32',
            callback=self._callback
        )
        self._stream.start()
        print("Audio stream started.")

    def stop(self):
        self.running = False
        if self._stream:
            self._stream.stop()
            self._stream.close()
        print("Audio stream stopped.")

    def get_chunk(self, timeout=1.0):
        """Get next audio chunk. Returns None if no chunk available."""
        try:
            return self.queue.get(timeout=timeout)
        except queue.Empty:
            return None