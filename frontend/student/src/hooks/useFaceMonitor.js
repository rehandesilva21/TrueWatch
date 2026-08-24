import { useRef, useState, useCallback } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// Landmark indices — identical math to the Python pipeline
const LEFT_IRIS = 473, LEFT_EYE_L = 263, LEFT_EYE_R = 362
const NOSE_TIP = 1, LEFT_EAR = 234, RIGHT_EAR = 454
const UPPER_LIP = 13, LOWER_LIP = 14, LIP_L = 61, LIP_R = 291

// Exported specifically so these pure, dependency-free calculations can
// be unit-tested in isolation (Chapter 7, Code-Level Testing) without
// needing to mock MediaPipe or a live video element — this changes
// nothing about how useFaceMonitor() itself uses them internally below.
export function gazeRatio(landmarks) {
  const iris = landmarks[LEFT_IRIS], eyeL = landmarks[LEFT_EYE_L], eyeR = landmarks[LEFT_EYE_R]
  const width = Math.abs(eyeR.x - eyeL.x)
  if (width === 0) return 0.5
  return (iris.x - eyeL.x) / width
}

export function headPose(landmarks) {
  const nose = landmarks[NOSE_TIP], left = landmarks[LEFT_EAR], right = landmarks[RIGHT_EAR]
  const leftDist = Math.abs(nose.x - left.x), rightDist = Math.abs(nose.x - right.x)
  const total = leftDist + rightDist
  return total === 0 ? 0.5 : leftDist / total
}

export function lipDistance(landmarks) {
  const upper = landmarks[UPPER_LIP], lower = landmarks[LOWER_LIP]
  const left = landmarks[LIP_L], right = landmarks[LIP_R]
  const mouthWidth = Math.abs(right.x - left.x)
  if (mouthWidth === 0) return 0
  return Math.abs(lower.y - upper.y) / mouthWidth
}

export function useFaceMonitor() {
  const landmarkerRef = useRef(null)
  // Tracks the last timestamp actually passed to detectForVideo(). MediaPipe's
  // VIDEO running mode requires every call's timestamp to be strictly greater
  // than the previous one — performance.now() can occasionally violate this
  // across animation-frame ticks (tab backgrounding/foregrounding, React
  // StrictMode double-invoke, etc.), which throws inside MediaPipe's WASM
  // internals. That throw previously propagated all the way up through
  // ExamRoom's tick() and silently killed the ENTIRE detection loop —
  // gaze, head, absence, identity and object checks all stopped at once,
  // since they all live inside that same loop.
  const lastTimestampRef = useRef(-1)
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (landmarkerRef.current) return
    try {
      // Both the WASM runtime and the model weights are now served from
      // this app's own public/ folder rather than external CDNs
      // (jsdelivr for the WASM runtime, Google Cloud Storage for the
      // model file). Previously, every single exam session depended on
      // the student's browser successfully reaching two different
      // third-party CDNs at the exact moment the exam started — a
      // genuine single point of failure with no relationship to
      // TrueWatch's own reliability. The WASM files ship inside the
      // already-installed @mediapipe/tasks-vision npm package itself
      // (copied into public/mediapipe-wasm/ once, not downloaded at
      // runtime); the model file is downloaded once manually and
      // committed into public/models/ — see README for the exact
      // download step, since MediaPipe doesn't publish model weights
      // through npm.
      const filesetResolver = await FilesetResolver.forVisionTasks('/mediapipe-wasm')
      landmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'CPU',   // GPU delegate fails on many Windows setups
        },
        runningMode: 'VIDEO',
        numFaces: 2,
      })
      setReady(true)
      console.log('[FaceMonitor] Loaded successfully (self-hosted, no CDN dependency)')
    } catch (err) {
      console.error('[FaceMonitor] Failed to load:', err.name, err.message)
      throw err
    }
  }, [])

  // Call once per animation frame with a <video> element
  const detect = useCallback((videoEl, timestampMs) => {
    if (!landmarkerRef.current || !videoEl || videoEl.readyState < 2) return null

    // Enforce a strictly-increasing integer timestamp. If the incoming
    // value hasn't advanced (or went backwards), bump it by 1ms rather
    // than passing it through unchanged — this is what MediaPipe actually
    // requires, and doing it here means every caller gets this protection
    // automatically instead of needing to reimplement it.
    let ts = Math.floor(timestampMs)
    if (ts <= lastTimestampRef.current) {
      ts = lastTimestampRef.current + 1
    }
    lastTimestampRef.current = ts

    try {
      const result = landmarkerRef.current.detectForVideo(videoEl, ts)
      const faceCount = result.faceLandmarks?.length || 0
      if (faceCount === 0) {
        return { faceCount: 0, gaze: null, head: null, lip: null, landmarks: null }
      }
      const lm = result.faceLandmarks[0]
      return {
        faceCount,
        gaze: gazeRatio(lm),
        head: headPose(lm),
        lip: lipDistance(lm),
        landmarks: lm,
      }
    } catch (err) {
      // A single bad frame must never propagate and kill the caller's
      // detection loop — log it once, loudly, and return null so the
      // caller treats this exactly like "no face detected this frame"
      // and simply tries again next tick.
      console.error('[FaceMonitor] detectForVideo failed on this frame:', err.message)
      return null
    }
  }, [])

  return { load, detect, ready }
}