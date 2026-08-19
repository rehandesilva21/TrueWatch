import { useRef, useState, useCallback } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

// Landmark indices — identical math to the Python pipeline
const LEFT_IRIS = 473, LEFT_EYE_L = 263, LEFT_EYE_R = 362
const NOSE_TIP = 1, LEFT_EAR = 234, RIGHT_EAR = 454
const UPPER_LIP = 13, LOWER_LIP = 14, LIP_L = 61, LIP_R = 291

function gazeRatio(landmarks) {
  const iris = landmarks[LEFT_IRIS], eyeL = landmarks[LEFT_EYE_L], eyeR = landmarks[LEFT_EYE_R]
  const width = Math.abs(eyeR.x - eyeL.x)
  if (width === 0) return 0.5
  return (iris.x - eyeL.x) / width
}

function headPose(landmarks) {
  const nose = landmarks[NOSE_TIP], left = landmarks[LEFT_EAR], right = landmarks[RIGHT_EAR]
  const leftDist = Math.abs(nose.x - left.x), rightDist = Math.abs(nose.x - right.x)
  const total = leftDist + rightDist
  return total === 0 ? 0.5 : leftDist / total
}

function lipDistance(landmarks) {
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
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      )
      landmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',   // GPU delegate fails on many Windows setups
        },
        runningMode: 'VIDEO',
        numFaces: 2,
      })
      setReady(true)
      console.log('[FaceMonitor] Loaded successfully')
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