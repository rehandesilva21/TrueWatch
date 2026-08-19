import multiprocessing as mp


def _worker_loop(input_queue, output_queue):
    """
    Runs in a completely separate OS process (spawned fresh, not forked),
    so it never inherits the parent process's already-initialized
    TensorFlow/LightGBM state. This sidesteps the native-library
    interaction hang confirmed via isolated testing: YOLO's first
    inference call hangs indefinitely whenever it runs in the same
    process as an already-loaded TensorFlow+LightGBM audio ensemble —
    reproduced even completely outside Flask, with KMP_DUPLICATE_LIB_OK,
    OMP_NUM_THREADS and PYTORCH_ENABLE_MPS_FALLBACK all already set.
    Running YOLO in its own process removes the shared-process
    precondition for that conflict entirely, rather than continuing to
    chase environment-variable fixes for a problem that was never
    actually about environment variables.
    """
    import os
    os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
    from modules.vision.object_detector import ObjectDetector

    detector = ObjectDetector()
    print("[yolo_worker] Loading YOLO in isolated subprocess...")
    detector.load()
    print("[yolo_worker] YOLO ready in isolated subprocess.")

    while True:
        frame = input_queue.get()
        if frame is None:  # sentinel value — clean shutdown
            break
        try:
            detections = detector.detect(frame)
            output_queue.put(("ok", detections))
        except Exception as e:
            output_queue.put(("error", str(e)))


class YoloWorkerHandle:
    """
    Lives in the main Flask process. Owns the child process and its two
    queues, and exposes a synchronous detect() call that looks just like
    the old in-process ObjectDetector.detect(), so api.py barely changes.
    """
    def __init__(self):
        ctx = mp.get_context("spawn")   # 'spawn', not 'fork' — this is
                                          # what gives the clean isolation;
                                          # the child re-imports everything
                                          # fresh instead of inheriting the
                                          # parent's already-loaded libraries
        self.input_queue  = ctx.Queue()
        self.output_queue = ctx.Queue()
        self.process = ctx.Process(
            target=_worker_loop,
            args=(self.input_queue, self.output_queue),
            daemon=True,
        )
        self.process.start()

    def detect(self, frame, timeout=8.0):
        self.input_queue.put(frame)
        status, payload = self.output_queue.get(timeout=timeout)
        if status == "error":
            raise RuntimeError(f"YOLO worker error: {payload}")
        return payload

    def shutdown(self):
        self.input_queue.put(None)
        self.process.join(timeout=5)