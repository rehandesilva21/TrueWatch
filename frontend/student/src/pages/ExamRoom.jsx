import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFaceMonitor }  from '../hooks/useFaceMonitor'
import { useAudioMonitor } from '../hooks/useAudioMonitor'
import { useFusionModel }  from '../hooks/useFusionModel'
import API from '../api'

const ALERT_FRAMES = 20

const DEFAULT_CALIBRATION = {
  gaze_baseline: 0.5,
  gaze_tolerance: 0.15,
  head_baseline: 0.5,
  head_tolerance: 0.15,
  lip_baseline: 0.0,
}

const INCIDENT_COOLDOWN_MS = 4000

const SCORE_PENALTY = {
  IDENTITY_MISMATCH: 8,
  PROHIBITED_OBJECT: 6,
  MULTI_FACE:         5,
  FUSION_HIGH_RISK:   5,
  TAB_SWITCH:          4,
  ABSENT:              3,
  AUDIO_LOUD:          2,
  AUDIO_WHISPER:       2,
  AUDIO_SPEECH:        1.5,
  AUDIO_PAPER:         1.5,
  GAZE:                1,
  HEAD:                1,
  LIP:                 0.5,
}

const IDENTITY_CHECK_INTERVAL_MS = 10000
const OBJECT_CHECK_INTERVAL_MS   = 3000
const RULE_SCORE_PUSH_INTERVAL_MS = 15000
const AUDIO_CLIP_INTERVAL_MS = 8000
const PERIODIC_REQUEST_TIMEOUT_MS = 12000
const TAB_SWITCH_RECENT_WINDOW_MS = 5000

const scoreColor = (score) => score >= 90 ? '#027A48' : score >= 70 ? '#B54708' : '#B42318'
const scoreBadgeClass = (score) => score >= 90 ? 'exam-badge-success' : score >= 70 ? 'exam-badge-warning' : 'exam-badge-danger'

const IDENTITY_META = {
  pending:   { label: 'Not verified yet',  cls: 'exam-badge-neutral' },
  verifying: { label: 'Verifying…',        cls: 'exam-badge-warning' },
  verified:  { label: 'Identity verified', cls: 'exam-badge-success' },
  mismatch:  { label: 'Identity mismatch', cls: 'exam-badge-danger'  },
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function ExamRoom() {
  const { examId } = useParams()
  const { user }   = useAuth()
  const navigate   = useNavigate()

  const [exam,           setExam]           = useState(null)
  const [questions,      setQuestions]      = useState([])
  const [currentQ,       setCurrentQ]       = useState(0)
  const [answers,        setAnswers]        = useState({})
  const [sessionToken,   setSessionToken]   = useState(null)
  const [timeLeft,       setTimeLeft]       = useState(0)
  const [uploading,      setUploading]      = useState(false)
  const [uploadedFile,   setUploadedFile]   = useState(null)
  const [plagResult,     setPlagResult]     = useState(null)
  const [warnings,       setWarnings]       = useState([])
  const [audioClass,     setAudioClass]     = useState('silence')
  const [loading,        setLoading]        = useState(true)
  const [loadError,      setLoadError]      = useState('')
  const [submitting,     setSubmitting]     = useState(false)
  const [showConfirm,    setShowConfirm]    = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [leaving,        setLeaving]        = useState(false)
  const [calibration,    setCalibration]    = useState(null)
  const [monitorError,   setMonitorError]   = useState('')
  const [faceReady,      setFaceReady]      = useState(false)
  const [score,          setScore]          = useState(100)
  const [identityStatus, setIdentityStatus] = useState('pending')
  const [isDocumentExam, setIsDocumentExam] = useState(null)
  const [incidentCount,  setIncidentCount]  = useState(0)

  const videoRef   = useRef(null)
  const streamRef  = useRef(null)
  const rafRef     = useRef(null)
  const timerRef   = useRef(null)
  const fileInputRef  = useRef(null)
  const initRan       = useRef(false)
  const sessionTokenRef = useRef(null)
  const calibrationRef  = useRef(null)
  const faceReadyRef    = useRef(false)
  const scoreRef        = useRef(100)
  const lastLoggedAt    = useRef({})
  const counters   = useRef({ gaze: 0, head: 0, lip: 0, absent: 0, tabSwitches: 0 })
  const lastSnapshotAt = useRef({ identity: 0, object: 0, fusion: 0, audioClip: 0 })
  const answersRef = useRef({})
  const isDocumentExamRef = useRef(false)
  const warningIdRef = useRef(0)
  const inFlightRef = useRef({ object: false, identity: false, audioClip: false })
  const lastObjectDetectedRef = useRef(false)
  const lastTabSwitchAtRef    = useRef(0)
  const fusionReadyRef = useRef(false)

  const { load: loadFace, detect: detectFace } = useFaceMonitor()
  const {
    start: startAudio, stop: stopAudio, calibrateBackground,
    classify: classifyAudio, recordClip,
  } = useAudioMonitor()
  const {
    load: loadFusion, ready: fusionReady,
    buildFeatureVector, pushFrame, predict: predictFusion,
  } = useFusionModel()

  useEffect(() => { answersRef.current = answers }, [answers])
  useEffect(() => { fusionReadyRef.current = fusionReady }, [fusionReady])

  const pushWarning = (type, details) => {
    warningIdRef.current += 1
    const id = `${Date.now()}-${warningIdRef.current}`
    setWarnings(prev => [{ id, type, details, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 8))
  }

  const applyScorePenalty = (type) => {
    const penalty = SCORE_PENALTY[type] ?? 1
    scoreRef.current = Math.max(0, +(scoreRef.current - penalty).toFixed(2))
    setScore(scoreRef.current)
  }

  const logIncident = async (type, confidence, details) => {
    if (!sessionTokenRef.current) return

    const now = performance.now()
    const last = lastLoggedAt.current[type] || 0
    if (now - last < INCIDENT_COOLDOWN_MS) return
    lastLoggedAt.current[type] = now

    applyScorePenalty(type)

    try {
      const res = await API.post('/session/incident', { session_token: sessionTokenRef.current, type, confidence, details })
      if (res.data?.logged) {
        setIncidentCount(c => c + 1)
      }
    } catch (err) {
      console.error('[ExamRoom] Failed to log incident:', type, err?.response?.data || err?.message || err)
    }
    pushWarning(type, details)
  }

  useEffect(() => {
    if (initRan.current) return
    initRan.current = true

    const init = async () => {
      try {
        const examRes = await API.get(`/exams/${examId}`)
        setExam(examRes.data)
        setTimeLeft(examRes.data.duration_mins * 60)

        const docOnly = examRes.data.exam_type === 'document'
        setIsDocumentExam(docOnly)
        isDocumentExamRef.current = docOnly

        if (!docOnly) {
          const idRes = await API.get('/identity/status').catch(() => ({ data: { registered: false } }))
          if (!idRes.data.registered) {
            navigate('/register-face', { state: { redirectTo: `/exam/${examId}` } })
            return
          }
        }

        const calibRes = await API.get('/calibration').catch(() => ({ data: { profile: null } }))

        if (!docOnly && !calibRes.data.profile) {
          navigate('/calibration', { state: { redirectTo: `/exam/${examId}` } })
          return
        }

        const profile = calibRes.data.profile || DEFAULT_CALIBRATION
        setCalibration(profile)
        calibrationRef.current = profile

        let sessionRes
        try {
          sessionRes = await API.post('/session/start', { exam_id: parseInt(examId) })
        } catch (err) {
          if (err.response?.status === 409) {
            navigate('/', { state: { examBlockedMessage: err.response.data?.error || 'You have already submitted this exam.' } })
            return
          }
          throw err
        }
        setSessionToken(sessionRes.data.session_token)
        sessionTokenRef.current = sessionRes.data.session_token
        console.log(`[ExamRoom] Session ${sessionRes.data.status}: ${sessionRes.data.session_token.slice(0, 12)}...`)

        const qRes = await API.get(`/exams/${examId}/questions`).catch(() => ({ data: { questions: [] } }))
        setQuestions(qRes.data.questions || [])

        if (docOnly) {
          console.log('[ExamRoom] Document-only exam — behavioral monitoring disabled, plagiarism check only.')
        } else {
          await startMonitoring()
        }
      } catch (err) {
        console.error('[ExamRoom] Init failed:', err)
        setLoadError(err.response?.data?.error || 'Could not load this exam. Please go back and try again.')
      } finally {
        setLoading(false)
      }
    }
    init()

    // IMPORTANT: only call getFocusedApp if it actually exists as a
    // function. Electron's main process and preload script are loaded
    // ONCE at app startup and are never hot-reloaded by Vite. If
    // preload.js is edited while `electron:dev` is still running from
    // before that edit, window.electronAPI here is stale and won't have
    // this method yet, requiring a full restart of `npm run
    // electron:dev` (not just a page refresh) to pick it up. The
    // typeof check + inner try/catch mean stale/missing state can never
    // break tab-switch detection itself — at worst it falls back to the
    // generic browser message, exactly like running in a plain browser
    // tab, and the LSTM's tabSwitchRecent feature (via
    // lastTabSwitchAtRef, unchanged below) keeps working either way.
    const hasElectronFocusApi = typeof window.electronAPI?.getFocusedApp === 'function'
    console.log('[ExamRoom] Electron focus API available:', hasElectronFocusApi, 'window.electronAPI =', window.electronAPI)

    const handleTabAway = async (reason) => {
      if (isDocumentExamRef.current) return
      counters.current.tabSwitches += 1
      lastTabSwitchAtRef.current = performance.now()

      let details = `Switched away from exam (${reason})`
      try {
        // In Electron, ask the OS what's actually focused right now —
        // this is the supervisor-flagged "golden point" feature, only
        // possible because Electron has real OS-level access a browser
        // tab is deliberately never granted.
        if (hasElectronFocusApi) {
          const info = await window.electronAPI.getFocusedApp()
          if (info?.appName) details = `Switched to ${info.appName} (${reason})`
        }
      } catch (err) {
        // Never let an Electron-side failure prevent the base incident
        // from being logged — fall through to the generic message above.
        console.error('[ExamRoom] getFocusedApp failed, using generic message:', err?.message || err)
      }

      logIncident('TAB_SWITCH', 0.99, details)
    }
    const handleVisibility = () => { if (document.hidden) handleTabAway('tab hidden') }
    const handleBlur       = () => handleTabAway('window lost focus')

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('blur', handleBlur)
      clearInterval(timerRef.current)
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      stopAudio()
    }
  }, [examId])

  const startMonitoring = async () => {
    let errors = []

    try {
      await loadFace()
      faceReadyRef.current = true
      setFaceReady(true)
    } catch (err) {
      console.error('[ExamRoom] Face load error:', err.name, err.message)
      errors.push('Face detection unavailable — gaze/head tracking disabled.')
    }

    try {
      if (!videoRef.current) {
        throw new Error('Video element not found in DOM — this should not happen')
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    } catch (err) {
      console.error('[ExamRoom] Camera error:', err.name, err.message)
      setMonitorError(`Camera failed (${err.name}): ${err.message}. Close other apps using the camera and reload.`)
      return
    }

    try {
      await startAudio()
      await calibrateBackground(2000)
    } catch (err) {
      console.error('[ExamRoom] Audio error:', err.name, err.message)
      errors.push('Microphone unavailable — audio detection disabled.')
    }

    try {
      await loadFusion()
    } catch (err) {
      console.error('[ExamRoom] Fusion model load error:', err.message)
    }

    if (errors.length) setMonitorError(errors.join(' '))
    detectionLoop()
  }

  const runFusionInference = (gazeDev, headDev, lipDev, faceCount, audio) => {
    if (!fusionReadyRef.current) return

    const tabSwitchRecent = (performance.now() - lastTabSwitchAtRef.current) < TAB_SWITCH_RECENT_WINDOW_MS

    const features = buildFeatureVector({
      gazeDev, headDev, lipDev, faceCount,
      audioClass: audio.class, audioAlert: audio.alert,
      identityMismatch: identityStatus === 'mismatch',
      objectInUse: lastObjectDetectedRef.current,
      tabSwitchRecent,
    })

    const windowFull = pushFrame(features)
    if (!windowFull) return

    const fusionScore = predictFusion()
    if (fusionScore === null) return

    const now = performance.now()
    if (now - lastSnapshotAt.current.fusion > RULE_SCORE_PUSH_INTERVAL_MS) {
      lastSnapshotAt.current.fusion = now

      API.post('/session/fusion_score', {
        session_token: sessionTokenRef.current,
        score: fusionScore,
        feature_vector: features,
      }, { timeout: PERIODIC_REQUEST_TIMEOUT_MS }).catch(err =>
        console.error('[ExamRoom] Failed to push fusion score:', err?.message || err)
      )

      if (fusionScore > 0.7) {
        logIncident('FUSION_HIGH_RISK', fusionScore, 'Sustained multi-signal anomaly pattern (trained LSTM)')
      }
    }
  }

  const detectionLoop = () => {
    const tick = () => {
      try {
        let gazeDevFlag = false, headDevFlag = false, lipDevFlag = false
        let faceCountThisTick = 1

        if (faceReadyRef.current) {
          const result = detectFace(videoRef.current, performance.now())

          if (result) {
            faceCountThisTick = result.faceCount

            if (result.faceCount === 0) {
              counters.current.absent += 1
              if (counters.current.absent === ALERT_FRAMES) logIncident('ABSENT', 0.99, 'No face detected')
            } else {
              counters.current.absent = 0
            }

            if (result.faceCount > 1) {
              logIncident('MULTI_FACE', 0.99, `${result.faceCount} faces detected`)
            }

            const calib = calibrationRef.current
            if (result.faceCount === 1 && calib) {
              gazeDevFlag = Math.abs(result.gaze - calib.gaze_baseline) > calib.gaze_tolerance
              headDevFlag = Math.abs(result.head - calib.head_baseline) > calib.head_tolerance
              lipDevFlag  = Math.abs(result.lip  - calib.lip_baseline)  > 0.04

              counters.current.gaze = gazeDevFlag ? counters.current.gaze + 1 : 0
              counters.current.head = headDevFlag ? counters.current.head + 1 : 0
              counters.current.lip  = lipDevFlag  ? counters.current.lip  + 1 : 0

              if (counters.current.gaze === ALERT_FRAMES) logIncident('GAZE', 0.85, 'Looking away from screen')
              if (counters.current.head === ALERT_FRAMES) logIncident('HEAD', 0.85, 'Head turned away')
              if (counters.current.lip  === ALERT_FRAMES) logIncident('LIP', 0.7, 'Sustained lip movement')
            }
          }
        }

        const audio = classifyAudio()
        setAudioClass(audio.class)
        if (audio.alert && audio.class === 'loud')    logIncident('AUDIO_LOUD', 0.8, 'Loud voice detected')
        if (audio.alert && audio.class === 'whisper') logIncident('AUDIO_WHISPER', 0.75, 'Whisper detected')
        if (audio.alert && audio.class === 'speech')  logIncident('AUDIO_SPEECH', 0.7, 'Voice detected')

        runFusionInference(gazeDevFlag, headDevFlag, lipDevFlag, faceCountThisTick, audio)

        const now = performance.now()
        if (now - lastSnapshotAt.current.object > OBJECT_CHECK_INTERVAL_MS) {
          lastSnapshotAt.current.object = now
          postSnapshot('/object/detect', 'object')
        }
        if (now - lastSnapshotAt.current.identity > IDENTITY_CHECK_INTERVAL_MS) {
          lastSnapshotAt.current.identity = now
          setIdentityStatus(prev => prev === 'verified' ? prev : 'verifying')
          postSnapshot('/identity/verify', 'identity')
        }
        if (now - lastSnapshotAt.current.audioClip > AUDIO_CLIP_INTERVAL_MS) {
          lastSnapshotAt.current.audioClip = now
          postAudioClip()
        }
      } catch (err) {
        console.error('[ExamRoom] Detection tick failed, continuing loop:', err)
      } finally {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const postAudioClip = async () => {
    if (!sessionTokenRef.current) return
    if (inFlightRef.current.audioClip) return
    inFlightRef.current.audioClip = true
    try {
      const wavBlob = await recordClip(2000)
      const audioDataUrl = await blobToDataURL(wavBlob)
      await API.post('/audio/classify', {
        session_token: sessionTokenRef.current,
        audio: audioDataUrl,
      }, { timeout: PERIODIC_REQUEST_TIMEOUT_MS })
    } catch (err) {
      console.error('[ExamRoom] audio clip cycle failed:', err?.response?.data || err?.message)
    } finally {
      inFlightRef.current.audioClip = false
    }
  }

  const postSnapshot = async (endpoint, kind) => {
    if (!videoRef.current || videoRef.current.readyState < 2) return
    if (!sessionTokenRef.current) return
    if (inFlightRef.current[kind]) return
    inFlightRef.current[kind] = true

    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
    const image = canvas.toDataURL('image/jpeg', 0.7)

    try {
      const res = await API.post(endpoint, { session_token: sessionTokenRef.current, image }, { timeout: PERIODIC_REQUEST_TIMEOUT_MS })
      if (endpoint === '/identity/verify') {
        if (res.data.is_match === false) {
          setIdentityStatus('mismatch')
          logIncident('IDENTITY_MISMATCH', 1 - res.data.confidence, 'Face did not match registered identity')
        } else if (res.data.is_match === true) {
          setIdentityStatus('verified')
        } else {
          setIdentityStatus(prev => prev === 'verifying' ? 'pending' : prev)
        }
      }
      if (endpoint === '/object/detect') {
        lastObjectDetectedRef.current = (res.data.detections?.length ?? 0) > 0
        if (res.data.detections?.length) {
          res.data.detections.forEach(d => {
            // in_use comes from the backend's hand-proximity check
            // (Chapter 6, Section 6.3.5) — distinguishes an object merely
            // visible in frame from one the student is actively holding,
            // which is meaningfully more suspicious and worth the lecturer
            // seeing as a distinct, specific detail rather than an
            // identical "object detected" message either way.
            const details = d.in_use
              ? `${d.class} actively held`
              : `${d.class} visible (not in use)`
            logIncident('PROHIBITED_OBJECT', d.confidence, details)
          })
        }
      }
    } catch (err) {
      console.error(`[ExamRoom] ${endpoint} failed:`, err?.response?.data || err?.message || err)
      if (endpoint === '/identity/verify') setIdentityStatus('pending')
    } finally {
      inFlightRef.current[kind] = false
    }
  }

  useEffect(() => {
    if (timeLeft <= 0 || !sessionToken) return
    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0 } return t - 1 })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [sessionToken])

  const formatTime = s => {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  }
  const timeColor = timeLeft < 300 ? '#B42318' : timeLeft < 600 ? '#B54708' : '#111827'
  const selectAnswer = (qId, val) => setAnswers(prev => ({ ...prev, [qId]: val }))

  const handleFileUpload = async e => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setUploadedFile(file.name)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('session_token', sessionTokenRef.current)
      const res = await API.post('/plagiarism/check', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      setPlagResult(res.data)
    } catch (err) { console.error(err) } finally { setUploading(false) }
  }

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    stopAudio()
    try {
      const payload = { session_token: sessionTokenRef.current, answers: answersRef.current }
      await API.post('/session/stop', payload, { timeout: 20000 })
    } catch (err) {
      console.error('[ExamRoom] Submit failed:', err)
    }
    navigate('/', { state: { examSubmitted: true } })
  }

  // Leaving WITHOUT submitting — reachable from the back button at any
  // point, including mid-exam. This deliberately does NOT call
  // /session/stop, so the session is left in its current "started, not
  // ended" state server-side rather than being marked as a proper
  // submission. This is not a new integrity gap: a student could already
  // reach the exact same outcome today by simply quitting the whole
  // Electron app (Cmd+Q) or closing the window, which this code has no
  // way to prevent either. All this adds is a clean, honest in-app path
  // to the same place, with the camera/mic/fusion model properly
  // released either way.
  const handleLeave = () => {
    if (leaving) return
    setLeaving(true)
    cancelAnimationFrame(rafRef.current)
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    stopAudio()
    navigate('/')
  }

  const q = questions[currentQ]
  const sColor = scoreColor(score)
  const idMeta = IDENTITY_META[identityStatus]

  if (loadError) {
    return (
      <div className="exam-shell flex items-center justify-center min-h-screen p-6">
        <div className="exam-card p-8 max-w-sm w-full text-center">
          <p className="font-semibold text-gray-900 mb-2">Can't open this exam</p>
          <p className="text-sm text-gray-500 mb-5">{loadError}</p>
          <button onClick={() => navigate('/')} className="exam-btn-primary w-full justify-center">Back to dashboard</button>
        </div>
      </div>
    )
  }

  return (
    <div className="exam-shell min-h-screen flex flex-col">

      {loading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/70 gap-4">
          <div className="w-6 h-6 border-2 border-gray-900 rounded-full animate-spin" style={{ borderTopColor: 'transparent' }} />
          <button onClick={() => navigate('/')} className="text-xs font-medium text-gray-500 hover:text-gray-700 underline">
            Cancel and go back
          </button>
        </div>
      )}

      <div className="exam-topbar px-3 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => (loading || loadError) ? navigate('/') : setShowLeaveConfirm(true)}
            aria-label="Back to dashboard"
            className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="w-7 h-7 rounded-md bg-gray-900 flex items-center justify-center shrink-0">
            <span className="text-white text-[11px] font-bold">TW</span>
          </div>
          <span className="font-medium text-sm text-gray-800 truncate max-w-[140px] sm:max-w-none">{exam?.title}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap justify-end">
          {!isDocumentExam && (
            <span className={`exam-badge ${idMeta.cls} hidden xs:inline-flex`}>{idMeta.label}</span>
          )}
          {!isDocumentExam && (
            <span className={`exam-badge ${scoreBadgeClass(score)} tabular-nums`}>
              {score.toFixed(0)} / 100
            </span>
          )}
          <span className="text-sm sm:text-base font-semibold tabular-nums" style={{ color: timeColor }}>{formatTime(timeLeft)}</span>
          <button onClick={() => setShowConfirm(true)} className="exam-btn-danger">
            Submit exam
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row gap-4 p-3 sm:p-4 max-w-7xl mx-auto w-full">
        <div className="w-full md:w-80 shrink-0 space-y-4 order-2 md:order-1">

          {monitorError && !isDocumentExam && (
            <div className="exam-card p-3 border-amber-200 bg-amber-50">
              <p className="text-[12px] leading-relaxed text-amber-800">{monitorError}</p>
            </div>
          )}

          {!isDocumentExam && (
            <div className="exam-card">
              <div className="exam-card-header flex items-center justify-between">
                <span>Proctoring</span>
                <span className="normal-case font-normal text-gray-400">
                  {incidentCount} logged{fusionReady ? ' · LSTM active' : ''}
                </span>
              </div>
              <div className="p-3">
                <div className="w-full h-1.5 rounded-full bg-gray-100 mb-3 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: sColor }} />
                </div>
                <div className="rounded-lg overflow-hidden aspect-video relative bg-gray-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ transform: 'scaleX(-1)' }}
                  />
                  <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded bg-black/55">
                    <div className={`w-1.5 h-1.5 rounded-full ${faceReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="text-[10px] text-white font-medium">{faceReady ? 'Monitoring' : 'Starting…'}</span>
                  </div>
                  <div className="absolute bottom-2 right-2 px-2 py-1 rounded bg-black/55 text-[10px] font-medium text-white capitalize">
                    {audioClass}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed mt-3 text-gray-500">
                  This report goes to your lecturer for review only. It does not change your exam score.
                </p>
              </div>
            </div>
          )}

          {isDocumentExam && (
            <div className="exam-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-gray-500">Document exam</p>
              <p className="text-[12px] leading-relaxed text-gray-500">
                No webcam or behavioral monitoring runs for this exam. Your uploaded file is checked for
                originality (plagiarism) only.
              </p>
            </div>
          )}

          {!isDocumentExam && warnings.length > 0 && (
            <div className="exam-card">
              <div className="exam-card-header">Recent notices</div>
              <div className="p-3 space-y-1.5 max-h-48 overflow-y-auto">
                {warnings.map(w => (
                  <div key={w.id} className="px-3 py-2 rounded-md text-xs bg-amber-50 text-amber-800">
                    <p className="font-medium">{w.type.replace(/_/g, ' ')}</p>
                    {w.details && <p className="mt-0.5">{w.details}</p>}
                    <p className="opacity-70 mt-0.5">{w.time}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isDocumentExam && questions.length > 0 && (
            <div className="exam-card">
              <div className="exam-card-header">Questions</div>
              <div className="p-3 flex flex-wrap gap-1.5">
                {questions.map((question, i) => (
                  <button key={i} onClick={() => setCurrentQ(i)}
                          className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
                            i === currentQ
                              ? 'bg-gray-900 text-white'
                              : answers[question.id] !== undefined
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-gray-100 text-gray-500'
                          }`}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isDocumentExam && (
            <div className="exam-card">
              <div className="exam-card-header">Written answer</div>
              <div className="p-3">
                <input ref={fileInputRef} type="file" accept=".pdf,.docx,.doc" onChange={handleFileUpload} className="hidden" />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="w-full py-3 rounded-lg text-center border border-dashed border-gray-300 bg-gray-50 hover:bg-gray-100 transition-colors disabled:opacity-60">
                  {uploading ? <span className="text-xs text-gray-500">Checking…</span>
                    : uploadedFile ? <span className="text-xs font-medium text-emerald-700">✓ {uploadedFile.slice(0, 18)}</span>
                    : <span className="text-xs font-medium text-gray-700">Upload PDF or DOCX</span>}
                </button>
                {plagResult && (
                  <div className={`mt-3 p-3 rounded-lg text-xs ${plagResult.risk_level === 'LOW' ? 'exam-badge-success' : 'exam-badge-warning'}`}>
                    <p className="font-medium">Originality: {plagResult.originality}%</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 order-1 md:order-2">
          {!isDocumentExam && q && (
            <div className="exam-card p-4 sm:p-7 max-w-2xl">
              <div className="flex items-center justify-between mb-5">
                <span className="text-xs font-medium text-gray-500">Question {currentQ + 1} of {questions.length}</span>
                <span className="exam-badge exam-badge-neutral">{q.marks || 5} marks</span>
              </div>
              <p className="text-[16px] font-medium leading-relaxed mb-6 text-gray-900">{q.question_text}</p>

              {q.question_type === 'mcq' && q.options?.map((opt, idx) => (
                <div key={idx} onClick={() => selectAnswer(q.id, idx)}
                     className={`flex items-center gap-3 px-4 py-3.5 rounded-lg mb-2.5 cursor-pointer transition-colors border ${
                       answers[q.id] === idx ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'
                     }`}>
                  <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center shrink-0 border-2 ${
                    answers[q.id] === idx ? 'border-gray-900' : 'border-gray-300'
                  }`} style={{ width: 18, height: 18 }}>
                    {answers[q.id] === idx && <div className="w-2.5 h-2.5 rounded-full bg-gray-900" />}
                  </div>
                  <span className="text-sm text-gray-800">{opt}</span>
                </div>
              ))}

              {q.question_type === 'essay' && (
                <textarea className="exam-input h-40 resize-none" placeholder="Type your answer here…"
                          value={answers[q.id] || ''} onChange={e => selectAnswer(q.id, e.target.value)} />
              )}

              <div className="flex flex-wrap gap-3 justify-between items-center mt-7">
                <button onClick={() => setCurrentQ(Math.max(0, currentQ - 1))} disabled={currentQ === 0}
                        className="exam-btn-secondary disabled:opacity-40 order-1">Previous</button>
                <span className="text-xs text-gray-500 order-3 sm:order-2 w-full sm:w-auto text-center">{Object.keys(answers).length} / {questions.length} answered</span>
                <button onClick={() => setCurrentQ(Math.min(questions.length - 1, currentQ + 1))} disabled={currentQ === questions.length - 1}
                        className="exam-btn-primary disabled:opacity-40 order-2 sm:order-3">Next</button>
              </div>
            </div>
          )}

          {isDocumentExam && (
            <div className="exam-card p-10 text-center max-w-2xl">
              <p className="font-medium mb-2 text-gray-900">This is a document-only exam</p>
              <p className="text-sm text-gray-500">Upload your written answer using the panel on the left, then submit when ready.</p>
            </div>
          )}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/40">
          <div className="exam-card p-7 max-w-sm w-full">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Submit your exam?</h2>
            <p className="text-sm mb-1 text-gray-500">You've answered {Object.keys(answers).length} of {questions.length} questions.</p>
            {!isDocumentExam && (
              <p className="text-sm mb-4 font-medium" style={{ color: sColor }}>Integrity score: {score.toFixed(1)} / 100</p>
            )}
            <p className="text-xs text-gray-400 mb-4">You can only submit this exam once. You won't be able to re-enter after submitting.</p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setShowConfirm(false)} className="exam-btn-secondary flex-1 justify-center">Go back</button>
              <button onClick={handleSubmit} disabled={submitting} className="exam-btn-danger flex-1 justify-center">
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLeaveConfirm && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-6 bg-black/40">
          <div className="exam-card p-7 max-w-sm w-full">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Leave without submitting?</h2>
            <p className="text-sm mb-1 text-gray-500">
              {Object.keys(answers).length > 0
                ? `You've answered ${Object.keys(answers).length} of ${questions.length} questions — this progress will not be saved.`
                : "You haven't submitted anything for this exam yet."}
            </p>
            <p className="text-xs text-gray-400 mb-4">
              This exam will remain open, but you'll need to return and submit it properly before the time limit ends.
            </p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setShowLeaveConfirm(false)} className="exam-btn-secondary flex-1 justify-center">Stay</button>
              <button onClick={handleLeave} disabled={leaving} className="exam-btn-danger flex-1 justify-center">
                {leaving ? 'Leaving…' : 'Leave exam'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}