import { useRef, useState, useCallback } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

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
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (landmarkerRef.current) return
    try {
      console.log('[FaceMonitor] Resolving WASM fileset...')
      const filesetResolver = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      )
      console.log('[FaceMonitor] WASM fileset resolved, creating landmarker...')

      landmarkerRef.current = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numFaces: 2,
      })
      setReady(true)
      console.log('[FaceMonitor] Loaded successfully')
    } catch (err) {
      // Common causes if this throws:
      // - CORS/network block on cdn.jsdelivr.net or storage.googleapis.com
      //   (check browser Network tab for blocked/failed requests)
      // - Content-Security-Policy in your app blocking those origins
      // - Browser/WebAssembly not supported in this environment
      console.error('[FaceMonitor] Failed to load:', err.name, err.message)
      setReady(false)
      throw err
    }
  }, [])

  const detect = useCallback((videoEl, timestampMs) => {
    if (!landmarkerRef.current) {
      // Model not loaded yet — nothing to detect
      return null
    }
    if (!videoEl || videoEl.readyState < 2) {
      // Video not producing frames yet (readyState < HAVE_CURRENT_DATA)
      return null
    }

    const result = landmarkerRef.current.detectForVideo(videoEl, timestampMs)
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
  }, [])

  return { load, detect, ready }
}