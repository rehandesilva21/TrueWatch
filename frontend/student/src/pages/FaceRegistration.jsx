import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import API from '../api'

export default function FaceRegistration() {
  const [status,   setStatus]   = useState('checking') // checking | ready | captured | saving | done
  const [error,    setError]    = useState('')
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const navigate  = useNavigate()
  const location  = useLocation()
  // Set when ExamRoom.jsx sent the student here because they had no
  // registered face yet — chains through calibration (if also needed)
  // straight back to the exam, instead of stopping at "done" here.
  const redirectTo = location.state?.redirectTo || null

  useEffect(() => {
    API.get('/identity/status')
      .then(res => {
        if (res.data.registered) { setStatus('done'); return }
        startCamera()
      })
      .catch(() => startCamera())
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // Some browsers need an explicit play() call, autoPlay attribute alone isn't reliable
        await videoRef.current.play().catch(() => {})
      }
      setStatus('ready')
    } catch (err) {
      console.error('Camera error:', err)
      if (err.name === 'NotAllowedError') {
        setError('Camera permission was denied. Click the camera icon in your browser\u2019s address bar, allow access, then reload this page.')
      } else if (err.name === 'NotFoundError') {
        setError('No camera was found. Check that a webcam is connected and not in use by another app.')
      } else if (err.name === 'NotReadableError') {
        setError('Your camera is being used by another program. Close other apps (Zoom, Teams, another TrueWatch window) and reload.')
      } else {
        setError(`Camera error: ${err.message}`)
      }
    }
  }

  const capture = () => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setStatus('captured')
  }

  const retake = () => setStatus('ready')

  const save = async () => {
    setStatus('saving')
    try {
      const imageData = canvasRef.current.toDataURL('image/jpeg', 0.92)
      await API.post('/identity/register', { image: imageData })
      streamRef.current?.getTracks().forEach(t => t.stop())
      setStatus('done')
    } catch {
      setError('Couldn\u2019t save your photo. Try again.')
      setStatus('captured')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative">
      <div className="liquid-bg" />

      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Verify it’s you</h1>
          <p className="text-sm mt-1.5" style={{ color: 'var(--ink-soft)' }}>
            This photo confirms your identity before every exam. It’s stored on our servers, never shared.
          </p>
        </div>

        <div className="glass-panel p-6">
          {error && (
            <div className="mb-4 px-4 py-3 rounded-2xl text-sm" style={{ background: 'rgba(255,59,48,0.1)', color: '#D70015' }}>
              {error}
            </div>
          )}

          {status === 'done' ? (
            <div className="text-center py-10">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
                   style={{ background: 'rgba(52,199,89,0.15)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path d="M20 6L9 17l-5-5" stroke="#34C759" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="font-medium">You’re all set</p>
              <p className="text-sm mt-1 mb-6" style={{ color: 'var(--ink-soft)' }}>Your identity is registered.</p>
              <button
                onClick={() => navigate('/calibration', redirectTo ? { state: { redirectTo } } : undefined)}
                className="glass-btn-primary"
              >
                Continue to calibration
              </button>
            </div>
          ) : (
            <>
              <div className="relative rounded-2xl overflow-hidden aspect-[4/3]" style={{ background: '#1D1D1F' }}>
                <video ref={videoRef} autoPlay muted playsInline
                       className={`w-full h-full object-cover ${status === 'captured' || status === 'saving' ? 'hidden' : ''}`} />
                <canvas ref={canvasRef}
                        className={`w-full h-full object-cover ${status === 'captured' || status === 'saving' ? '' : 'hidden'}`} />

                {status === 'ready' && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-48 h-60 rounded-[40%] border-2" style={{ borderColor: 'rgba(255,255,255,0.7)' }} />
                  </div>
                )}
              </div>

              <div className="mt-5">
                {status === 'ready' && (
                  <button onClick={capture} className="glass-btn-primary">Take photo</button>
                )}
                {status === 'captured' && (
                  <div className="flex gap-3">
                    <button onClick={retake} className="glass-btn-secondary flex-1">Retake</button>
                    <button onClick={save} className="glass-btn-primary flex-1">Use this photo</button>
                  </div>
                )}
                {status === 'saving' && (
                  <button disabled className="glass-btn-primary">Saving\u2026</button>
                )}
                {status === 'checking' && (
                  <p className="text-center text-sm" style={{ color: 'var(--ink-soft)' }}>Checking camera\u2026</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}