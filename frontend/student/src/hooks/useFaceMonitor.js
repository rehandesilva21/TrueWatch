import { useRef, useState, useCallback } from 'react'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const LEFT_IRIS = 473, LEFT_EYE_L = 263, LEFT_EYE_R = 362
const NOSE_TIP = 1, LEFT_EAR = 234, RIGHT_EAR = 454
const UPPER_LIP = 13, LOWER_LIP = 14, LIP_L = 61, LIP_R = 291

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
 
  const lastTimestampRef = useRef(-1)
  const [ready, setReady] = useState(false)

  const load = useCallback(async () => {
    if (landmarkerRef.current) return
    try {
     
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
      
      console.error('[FaceMonitor] detectForVideo failed on this frame:', err.message)
      return null
    }
  }, [])

  return { load, detect, ready }
}