import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import SidebarLayout from '../components/SidebarLayout'
import API from '../api'

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="w-11 h-6 rounded-full relative transition-colors shrink-0 disabled:opacity-50"
      style={{ background: checked ? 'var(--accent)' : 'rgba(0,0,0,0.15)' }}
    >
      <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
           style={{ transform: checked ? 'translateX(22px)' : 'translateX(2px)' }} />
    </button>
  )
}

function SectionCard({ title, children }) {
  return (
    <div className="glass-panel overflow-hidden mb-5">
      {title && (
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{title}</h2>
        </div>
      )}
      {children}
    </div>
  )
}

function StatusPill({ tone, children }) {
  const tones = {
    good:    { background: 'rgba(52,199,89,0.15)',  color: '#248A3D' },
    warn:    { background: 'rgba(255,159,10,0.15)', color: '#B25000' },
    neutral: { background: 'rgba(0,0,0,0.06)',       color: 'var(--ink-soft)' },
  }
  return (
    <span className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full" style={tones[tone]}>
      {children}
    </span>
  )
}

export default function Settings() {
  const navigate = useNavigate()

  // ── Identity ──────────────────────────────────────────────
  const [identityRegistered, setIdentityRegistered] = useState(null) // null = checking

  // ── Calibration ───────────────────────────────────────────
  const [calibration, setCalibration] = useState(undefined) // undefined = loading, null = none saved

  // ── Preferences (persisted server-side) ──────────────────
  const [prefsLoaded,   setPrefsLoaded]   = useState(false)
  const [notifications, setNotifications] = useState(true)
  const [soundAlerts,   setSoundAlerts]   = useState(true)
  const [savingPrefs,   setSavingPrefs]   = useState(false)

  // ── Camera & microphone devices ──────────────────────────
  const [cameras,          setCameras]          = useState([])
  const [microphones,      setMicrophones]      = useState([])
  const [selectedCamera,   setSelectedCamera]   = useState('')
  const [selectedMic,      setSelectedMic]      = useState('')
  const [devicesNeedPermission, setDevicesNeedPermission] = useState(false)
  const [loadingDevices,   setLoadingDevices]   = useState(true)

  // ── Change password ──────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwSaving, setPwSaving] = useState(false)

  useEffect(() => {
    API.get('/identity/status')
      .then(res => setIdentityRegistered(res.data.registered))
      .catch(() => setIdentityRegistered(null))

    API.get('/calibration')
      .then(res => setCalibration(res.data.profile))
      .catch(() => setCalibration(null))

    API.get('/preferences')
      .then(res => {
        const p = res.data.preferences || {}
        setNotifications(p.notifications ?? true)
        setSoundAlerts(p.soundAlerts ?? true)
        setSelectedCamera(p.cameraDeviceId || '')
        setSelectedMic(p.micDeviceId || '')
      })
      .catch(() => {})
      .finally(() => setPrefsLoaded(true))

    loadDevices()
  }, [])

  const loadDevices = async () => {
    setLoadingDevices(true)
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const cams = list.filter(d => d.kind === 'videoinput')
      const mics = list.filter(d => d.kind === 'audioinput')
      setCameras(cams)
      setMicrophones(mics)
      // Browsers withhold device labels until permission has been granted
      // at least once — an empty label on an otherwise-present device is
      // the signal to show the "grant access to see device names" prompt
      // rather than a confusing blank dropdown entry.
      setDevicesNeedPermission(cams.length > 0 && cams.every(c => !c.label))
    } catch (err) {
      console.error('[Settings] Failed to enumerate devices:', err)
    } finally {
      setLoadingDevices(false)
    }
  }

  const grantDeviceAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach(t => t.stop())
      await loadDevices()
    } catch (err) {
      console.error('[Settings] Device permission denied:', err)
    }
  }

  // Persists to the server on every change rather than requiring a
  // separate "Save" button — these are simple toggles/selects where
  // save-as-you-go matches how the rest of the app already behaves
  // (e.g. calibration auto-saves). Debounced isn't needed since these
  // fire on discrete clicks/selections, not continuous input.
  const savePreferences = async (partial) => {
    setSavingPrefs(true)
    try {
      await API.put('/preferences', partial)
    } catch (err) {
      console.error('[Settings] Failed to save preferences:', err)
    } finally {
      setSavingPrefs(false)
    }
  }

  const toggleNotifications = (val) => {
    setNotifications(val)
    savePreferences({ notifications: val })
  }
  const toggleSoundAlerts = (val) => {
    setSoundAlerts(val)
    savePreferences({ soundAlerts: val })
  }
  const changeCamera = (deviceId) => {
    setSelectedCamera(deviceId)
    savePreferences({ cameraDeviceId: deviceId })
  }
  const changeMic = (deviceId) => {
    setSelectedMic(deviceId)
    savePreferences({ micDeviceId: deviceId })
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    setPwSuccess(false)

    if (pwForm.next.length < 8) {
      setPwError('New password must be at least 8 characters.')
      return
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New passwords do not match.')
      return
    }

    setPwSaving(true)
    try {
      await API.post('/auth/change-password', {
        current_password: pwForm.current,
        new_password: pwForm.next,
      })
      setPwSuccess(true)
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      setPwError(err.response?.data?.error || 'Could not change password.')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <SidebarLayout>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-7">
          <h1 className="text-[28px] font-semibold tracking-tight">Settings</h1>
          {savingPrefs && (
            <span className="text-xs" style={{ color: 'var(--ink-soft)' }}>Saving…</span>
          )}
        </div>

        {/* Identity verification */}
        <SectionCard>
          <div className="px-5 py-4 flex flex-wrap gap-3 items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Identity verification</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {identityRegistered === null
                  ? 'Checking...'
                  : identityRegistered
                    ? 'Your reference photo is on file — used to confirm it\u2019s you during exams.'
                    : 'Not verified yet — required before you can start an exam.'}
              </p>
            </div>
            {identityRegistered !== null && (
              <button onClick={() => navigate('/register-face')} className="shrink-0">
                <StatusPill tone={identityRegistered ? 'good' : 'warn'}>
                  {identityRegistered ? 'Re-verify' : 'Verify now'}
                </StatusPill>
              </button>
            )}
          </div>
        </SectionCard>

        {/* Calibration */}
        <SectionCard>
          <div className="px-5 py-4 flex flex-wrap gap-3 items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Exam calibration</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>
                {calibration === undefined
                  ? 'Checking...'
                  : calibration
                    ? calibration.has_eye_condition
                      ? 'Calibrated, with a widened tolerance for your declared eye condition.'
                      : 'Your gaze and head-position baseline is saved.'
                    : 'Not calibrated yet — required before you can start an exam.'}
              </p>
            </div>
            {calibration !== undefined && (
              <button
                onClick={() => navigate('/calibration')}
                className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full"
                style={{ background: 'rgba(0,0,0,0.06)', color: 'var(--ink-soft)' }}
              >
                {calibration ? 'Recalibrate' : 'Calibrate now'}
              </button>
            )}
          </div>
        </SectionCard>

        {/* Camera & microphone */}
        <SectionCard title="Camera & microphone">
          <div className="px-5 py-4 space-y-4">
            {devicesNeedPermission ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(255,159,10,0.1)' }}>
                <p className="text-xs" style={{ color: '#B25000' }}>Grant access to see and choose your devices by name.</p>
                <button onClick={grantDeviceAccess} className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full" style={{ background: '#B25000', color: 'white' }}>
                  Allow
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>Camera</label>
                  <select
                    className="glass-input"
                    value={selectedCamera}
                    disabled={loadingDevices || cameras.length === 0}
                    onChange={e => changeCamera(e.target.value)}
                  >
                    <option value="">System default</option>
                    {cameras.map(c => (
                      <option key={c.deviceId} value={c.deviceId}>{c.label || 'Camera'}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>Microphone</label>
                  <select
                    className="glass-input"
                    value={selectedMic}
                    disabled={loadingDevices || microphones.length === 0}
                    onChange={e => changeMic(e.target.value)}
                  >
                    <option value="">System default</option>
                    {microphones.map(m => (
                      <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>
                    ))}
                  </select>
                </div>
                {!loadingDevices && cameras.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>No camera detected on this device.</p>
                )}
              </>
            )}
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              This is which camera and microphone TrueWatch uses during an exam — it does not affect any other app.
            </p>
          </div>
        </SectionCard>

        {/* Notifications */}
        <SectionCard title="Notifications">
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
            <div>
              <p className="text-sm font-medium">Exam notifications</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>Get notified before your exams start</p>
            </div>
            <Toggle checked={notifications} onChange={toggleNotifications} disabled={!prefsLoaded} />
          </div>
          <div className="px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Sound alerts</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-soft)' }}>Play a sound for proctoring warnings</p>
            </div>
            <Toggle checked={soundAlerts} onChange={toggleSoundAlerts} disabled={!prefsLoaded} />
          </div>
        </SectionCard>

        {/* Change password */}
        <SectionCard title="Password">
          <form onSubmit={handleChangePassword} className="px-5 py-4 space-y-3">
            {pwError && (
              <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(255,59,48,0.1)', color: '#D70015' }}>
                {pwError}
              </div>
            )}
            {pwSuccess && (
              <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(52,199,89,0.12)', color: '#248A3D' }}>
                Password changed successfully.
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>Current password</label>
              <input type="password" className="glass-input" value={pwForm.current}
                     onChange={e => setPwForm({ ...pwForm, current: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>New password</label>
              <input type="password" className="glass-input" value={pwForm.next} minLength={8}
                     onChange={e => setPwForm({ ...pwForm, next: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-soft)' }}>Confirm new password</label>
              <input type="password" className="glass-input" value={pwForm.confirm} minLength={8}
                     onChange={e => setPwForm({ ...pwForm, confirm: e.target.value })} required />
            </div>
            <button type="submit" disabled={pwSaving} className="glass-btn-primary mt-1" style={{ width: 'auto', padding: '10px 20px' }}>
              {pwSaving ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </SectionCard>
      </div>
    </SidebarLayout>
  )
}