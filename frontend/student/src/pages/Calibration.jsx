import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFaceMonitor } from '../hooks/useFaceMonitor'
import API from '../api'

const EYE_CONDITIONS = [
  { key: 'none',       label: 'No eye conditions',               multiplier: 1.0 },
  { key: 'strabismus', label: 'Strabismus (crossed eyes)',        multiplier: 2.5 },
  { key: 'nystagmus',  label: 'Nystagmus (involuntary movement)', multiplier: 3.0 },
  { key: 'squint',     label: 'Squint',                           multiplier: 2.0 },
  { key: 'other',      label: 'Other / unsure',                   multiplier: 2.0 },
]

export default function Calibration() {
  const [stage,     setStage]     = useState('condition') // condition | camera | calibrating | done
  const [condition, setCondition] = useState(null)
  const [progress,  setProgress]  = useState(0)
  const [error,     setError]     = useState('')

  const videoRef      = useRef(null)
  const streamRef     = useRef(null)
  const samplesRef    = useRef({ gaze: [], head: [], lip: [] })
  const rafRef        = useRef(null)
  const conditionRef  = useRef(null)
  const { load, detect } = useFaceMonitor()
  const navigate = useNavigate()

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    cancelAnimationFrame(rafRef.current)
  }, [])

  // Kicks off model load + camera + calibration loop, but ONLY once stage
  // has actually become 'camera' — which means React has already committed
  // the <video> element to the DOM. Doing this in an effect (rather than
  // directly in the button click handler) guarantees videoRef.current is
  // never null here, even if `load()` resolves near-instantly (e.g. the
  // face model was already cached from a previous calibration attempt).
  useEffect(() => {
    if (stage !== 'camera') return
    let cancelled = false

    const setup = async () => {
      try {
        console.log('[Calibration] Loading face model...')
        await load()
        if (cancelled) return
        console.log('[Calibration] Face model ready')

        if (!videoRef.current) {
          // Should be unreachable now, but fail loudly instead of silently
          // if it ever happens again.
          throw new Error('Video element not mounted')
        }

        console.log('[Calibration] Requesting camera...')
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        console.log('[Calibration] Camera streaming, readyState =', videoRef.current.readyState)

        setStage('calibrating')
        runCalibrationLoop()
      } catch (err) {
        if (cancelled) return
        console.error('[Calibration] Setup failed:', err.name, err.message)
        setError(err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow access in your browser and reload.'
          : `Camera error: ${err.message}`)
      }
    }

    setup()
    return () => { cancelled = true }
  }, [stage])

  const chooseCondition = (chosenCondition) => {
    setError('')
    setCondition(chosenCondition)
    conditionRef.current = chosenCondition
    setStage('camera')
  }

  const runCalibrationLoop = () => {
    const CALIBRATION_FRAMES = 60
    samplesRef.current = { gaze: [], head: [], lip: [] }

    const tick = () => {
      const result = detect(videoRef.current, performance.now())
      if (result && result.faceCount === 1) {
        samplesRef.current.gaze.push(result.gaze)
        samplesRef.current.head.push(result.head)
        samplesRef.current.lip.push(result.lip)
      }
      const collected = samplesRef.current.gaze.length
      setProgress(Math.min(100, (collected / CALIBRATION_FRAMES) * 100))

      if (collected >= CALIBRATION_FRAMES) {
        finishCalibration()
      } else {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length
  const stdev = arr => {
    const m = mean(arr)
    return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length)
  }

  const finishCalibration = async () => {
    const { gaze, head, lip } = samplesRef.current
    const activeCondition = conditionRef.current
    const multiplier = EYE_CONDITIONS.find(c => c.key === activeCondition)?.multiplier || 1.0

    const gazeBaseline = mean(gaze)
    const headBaseline = mean(head)
    const lipBaseline   = mean(lip)
    const gazeTolerance = Math.max(stdev(gaze) * 2.5, 0.10) * multiplier
    const headTolerance = Math.max(stdev(head) * 2.5, 0.08) * multiplier

    try {
      await API.post('/calibration', {
        gaze_baseline: gazeBaseline, head_baseline: headBaseline,
        gaze_tolerance: gazeTolerance, head_tolerance: headTolerance,
        lip_baseline: lipBaseline,
        has_eye_condition: activeCondition !== 'none',
        eye_condition_type: activeCondition === 'none' ? null : activeCondition,
      })
    } catch (err) {
      console.error('Failed to save calibration:', err)
    }

    streamRef.current?.getTracks().forEach(t => t.stop())
    setStage('done')
  }

  const retry = () => {
    setError('')
    setStage('condition')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <div className="liquid-bg" />

      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Quick calibration</h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--ink-soft)' }}>
            Helps TrueWatch learn your natural position, fairly.
          </p>
        </div>

        <div className="glass-panel p-6">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-2xl text-sm" style={{ background: 'rgba(255,59,48,0.1)', color: '#D70015' }}>
              <p>{error}</p>
              <button onClick={retry} className="mt-2 text-xs font-medium underline">Try again</button>
            </div>
          )}

          {stage === 'condition' && (
            <>
              <p className="text-sm font-medium mb-1">Do you have any eye conditions?</p>
              <p className="text-xs mb-4" style={{ color: 'var(--ink-soft)' }}>
                This ensures fair monitoring — nothing is shared beyond your calibration profile.
              </p>
              <div className="space-y-2">
                {EYE_CONDITIONS.map(c => (
                  <button key={c.key} onClick={() => chooseCondition(c.key)}
                          className="w-full text-left px-4 py-3 rounded-2xl text-sm font-medium transition-colors"
                          style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.9)' }}>
                    {c.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {(stage === 'camera' || stage === 'calibrating') && (
            <>
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3]" style={{ background: '#1D1D1F' }}>
                <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                {stage === 'calibrating' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-end pb-6 px-6"
                       style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55), transparent 50%)' }}>
                    <p className="text-white text-sm font-medium mb-3">Look straight ahead, relax your face</p>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.25)' }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
                    </div>
                  </div>
                )}
                {stage === 'camera' && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs text-white/70">Starting camera…</span>
                  </div>
                )}
              </div>
            </>
          )}

          {stage === 'done' && (
            <div className="text-center py-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(52,199,89,0.15)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="font-medium">Calibration complete</p>
              <p className="text-sm mt-1 mb-6" style={{ color: 'var(--ink-soft)' }}>You're ready for your exam.</p>
              <button onClick={() => navigate('/')} className="glass-btn-primary">Back to dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}