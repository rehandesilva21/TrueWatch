import { useState, useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import Layout from '../components/Layout'
import API from '../api'

// A small live-updating <img> for one session's camera feed. Not real
// video — the student's browser only posts a still snapshot every few
// seconds (see ExamRoom's OBJECT_CHECK_INTERVAL_MS) — but it polls the
// backend's cached last frame for this session and refreshes on its own,
// so each card shows an actual, current image from that student's camera
// instead of a hardcoded "CAM FEED" placeholder that never showed anything.
//
// Polling is client-side only: it can't produce frames faster than the
// student's browser actually posts them (that interval lives in
// ExamRoom). Polling faster than that just means each new frame appears
// sooner after it's captured — it won't manufacture in-between frames.
function LiveFrame({ token }) {
  const [frame,    setFrame]    = useState(null)
  const [prevFrame, setPrevFrame] = useState(null)
  const [stale,    setStale]    = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await API.get(`/lecturer/live-frame/${token}`)
        if (cancelled) return
        setFrame(current => {
          // Only swap when the frame actually changed — keeps the crossfade
          // from re-triggering (and flickering) on every identical poll.
          if (res.data.image && res.data.image !== current) {
            setPrevFrame(current)
            return res.data.image
          }
          return current
        })
        setStale(res.data.age_secs > 8)
      } catch (err) {
        if (!cancelled) { setFrame(null) }
      }
    }
    poll()
    const interval = setInterval(poll, 1200)
    return () => { cancelled = true; clearInterval(interval) }
  }, [token])

  if (!frame) {
    return (
      <div className="bg-slate-900 h-52 flex items-center justify-center">
        <span className="text-slate-600 text-xs">Waiting for camera…</span>
      </div>
    )
  }

  return (
    <div className="bg-slate-900 h-52 relative overflow-hidden">
      {/* Previous frame stays underneath so the crossfade has something to
          dissolve from instead of popping straight to black. */}
      {prevFrame && (
        <img src={prevFrame} alt="" aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }} />
      )}
      <img
        key={frame}
        src={frame}
        alt="Live camera feed"
        className="absolute inset-0 w-full h-full object-cover animate-[fadein_0.35s_ease-out]"
        style={{ transform: 'scaleX(-1)' }}
      />
      {stale && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <span className="text-white text-xs">Feed delayed</span>
        </div>
      )}
      <style>{`@keyframes fadein { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  )
}

export default function LiveMonitor() {
  const [sessions,  setSessions]  = useState([])
  const [alerts,    setAlerts]    = useState([])
  const [selected,  setSelected]  = useState(null)
  const [connected, setConnected] = useState(false)
  const socketRef = useRef(null)

  useEffect(() => {
    // Initial fetch
    fetchLive()
    const interval = setInterval(fetchLive, 3000)

    // WebSocket
    const socket = io('http://localhost:5001', {
      extraHeaders: { Authorization: `Bearer ${localStorage.getItem('tw_token')}` }
    })
    socketRef.current = socket

    socket.on('connect',    () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('live_update', data => {
      setSessions(data.sessions || [])
    })

    socket.on('incident', data => {
      setAlerts(prev => [{
        id:      Date.now(),
        student: data.student_id,
        type:    data.type,
        time:    new Date().toLocaleTimeString(),
        conf:    data.confidence,
      }, ...prev].slice(0, 20))
    })

    socket.on('plagiarism_result', data => {
      setAlerts(prev => [{
        id:       Date.now(),
        student:  data.student_id,
        type:     'PLAGIARISM',
        time:     new Date().toLocaleTimeString(),
        detail:   `Originality: ${data.originality}% — ${data.risk_level}`,
      }, ...prev].slice(0, 20))
    })

    return () => {
      clearInterval(interval)
      socket.disconnect()
    }
  }, [])

  const fetchLive = async () => {
    try {
      const res = await API.get('/lecturer/live')
      setSessions(res.data.live_sessions || [])
    } catch (err) {
      console.error(err)
    }
  }

  const riskColor = r =>
    r >= 60 ? 'text-red-600'   :
    r >= 30 ? 'text-amber-600' : 'text-green-600'

  const riskBg = r =>
    r >= 60 ? 'bg-red-500'   :
    r >= 30 ? 'bg-amber-500' : 'bg-green-500'

  const riskBorder = r =>
    r >= 60 ? 'border-red-200'   :
    r >= 30 ? 'border-amber-200' : 'border-slate-200'

  const incidentColor = type => {
    const map = {
      GAZE: 'bg-amber-400', HEAD: 'bg-amber-400', LIP: 'bg-orange-400', ABSENT: 'bg-red-400',
      MULTI_FACE: 'bg-red-500', AUDIO_SPEECH: 'bg-blue-400', AUDIO_WHISPER: 'bg-orange-400',
      AUDIO_PAPER: 'bg-blue-300', TAB_SWITCH: 'bg-red-500', PLAGIARISM: 'bg-purple-400',
    }
    return map[type] || 'bg-slate-400'
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[22px] font-semibold text-slate-900 tracking-tight">Live monitor</h1>
            <p className="text-slate-500 text-sm mt-1">{sessions.length} student{sessions.length !== 1 ? 's' : ''} currently active</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`flex items-center gap-1.5 text-sm font-medium ${connected ? 'text-green-600' : 'text-slate-400'}`}>
              <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}/>
              {connected ? 'Live' : 'Connecting...'}
            </span>
          </div>
        </div>

        {/* Alert banner */}
        {alerts.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>
              <p className="text-sm font-semibold text-red-700">Live alerts</p>
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {alerts.slice(0, 5).map(a => (
                <div key={a.id} className="text-xs text-red-600 flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${incidentColor(a.type)}`} />
                  <span className="font-medium">Student {a.student}</span>
                  <span>—</span>
                  <span>{a.type.replace('_', ' ')}</span>
                  {a.detail && <span className="text-red-400">· {a.detail}</span>}
                  <span className="text-red-300 ml-auto">{a.time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="card p-16 text-center">
            <h2 className="text-base font-semibold text-slate-700 mb-1.5">No active sessions</h2>
            <p className="text-slate-400 text-sm">Students will appear here when they start an exam.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {sessions.map(s => (
              <div
                key={s.session_token}
                onClick={() => setSelected(selected?.session_token === s.session_token ? null : s)}
                className={`card cursor-pointer transition-all hover:shadow-md border-2 ${riskBorder(s.risk_score)}`}
              >
                {/* Live camera feed — polls the student's latest snapshot */}
                <div className="relative">
                  <LiveFrame token={s.session_token} />
                  <div className="absolute top-2 left-2">
                    <span className="bg-primary/90 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"/>
                      Live
                    </span>
                  </div>
                  {s.risk_score >= 60 && (
                    <div className="absolute top-2 right-2">
                      <span className="badge-red text-xs">FLAGGED</span>
                    </div>
                  )}
                  {s.risk_score >= 30 && s.risk_score < 60 && (
                    <div className="absolute top-2 right-2">
                      <span className="badge-amber text-xs">WATCH</span>
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-slate-800 text-sm">{s.student_name}</p>
                    <span className={`text-sm font-bold ${riskColor(s.risk_score)}`}>
                      {s.risk_score}/100
                    </span>
                  </div>

                  {/* Risk bar */}
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
                    <div
                      className={`h-1.5 rounded-full transition-all ${riskBg(s.risk_score)}`}
                      style={{ width: `${s.risk_score}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{s.incidents} incident{s.incidents !== 1 ? 's' : ''}</span>
                    <div className="flex gap-1">
                      {Object.entries(s.summary || {}).slice(0, 3).map(([type, count]) => (
                        <span key={type} title={type} className="flex items-center gap-1 bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">
                          <span className={`w-1.5 h-1.5 rounded-full ${incidentColor(type)}`} />{count}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {selected?.session_token === s.session_token && (
                  <div className="border-t border-slate-100 p-3 bg-slate-50">
                    <p className="text-xs font-medium text-slate-500 mb-2">Incident breakdown</p>
                    {Object.keys(s.summary || {}).length === 0 ? (
                      <p className="text-xs text-slate-400">No incidents yet</p>
                    ) : (
                      Object.entries(s.summary).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-xs mb-1">
                          <span className="text-slate-600 flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${incidentColor(type)}`} />
                            {type.replace('_', ' ')}
                          </span>
                          <span className="font-medium text-slate-800">{count}×</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}