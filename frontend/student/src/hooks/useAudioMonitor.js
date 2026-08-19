import { useRef, useState, useCallback } from 'react'

export function useAudioMonitor() {
  const audioCtxRef     = useRef(null)
  const analyserRef     = useRef(null)
  const dataRef         = useRef(null)
  const streamRef       = useRef(null)
  const bgEnergyRef     = useRef(0.003)
  const workletNodeRef  = useRef(null)
  const workletReadyRef = useRef(false)
  const historyRef  = useRef([])
  const HISTORY_SIZE = 8   // ~8 frames of smoothing ≈ 130ms window at 60fps

  const [ready, setReady] = useState(false)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    const ctx = new (window.AudioContext || window.webkitAudioContext)()

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch (err) {
        console.warn('[AudioMonitor] Failed to resume AudioContext:', err.message)
      }
    }

    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    audioCtxRef.current = ctx
    analyserRef.current = analyser
    dataRef.current = new Uint8Array(analyser.frequencyBinCount)
    historyRef.current = []

    try {
      await ctx.audioWorklet.addModule('/recorder-worklet.js')
      workletReadyRef.current = true
    } catch (err) {
      console.error('[AudioMonitor] Failed to load recorder worklet:', err.message)
      workletReadyRef.current = false
    }

    setReady(true)
    console.log('[AudioMonitor] Started, context state:', ctx.state)
    return stream
  }, [])

  const readFrame = () => {
    if (!analyserRef.current || !dataRef.current) return { data: null, energy: 0 }
    analyserRef.current.getByteFrequencyData(dataRef.current)
    const data = dataRef.current
    const sum = data.reduce((a, b) => a + b * b, 0)
    const energy = Math.sqrt(sum / data.length) / 255
    return { data, energy }
  }

  const getEnergy = () => readFrame().energy

  const calibrateBackground = useCallback((durationMs = 3000) => {
    return new Promise(resolve => {
      const samples = []
      const interval = setInterval(() => samples.push(readFrame().energy), 100)
      setTimeout(() => {
        clearInterval(interval)
        const avg = samples.reduce((a, b) => a + b, 0) / (samples.length || 1)
        bgEnergyRef.current = Math.max(avg * 1.5, 0.003)
        console.log('[AudioMonitor] Background calibrated:', bgEnergyRef.current)
        resolve(bgEnergyRef.current)
      }, durationMs)
    })
  }, [])

  const classify = useCallback(() => {
    const { data, energy } = readFrame()
    if (!data || !audioCtxRef.current) return { class: 'silence', energy: 0, alert: false }

    const bin = (loHz, hiHz) => {
      const nyquist = audioCtxRef.current.sampleRate / 2
      const loBin = Math.floor((loHz / nyquist) * data.length)
      const hiBin = Math.floor((hiHz / nyquist) * data.length)
      let sum = 0
      for (let i = loBin; i < hiBin; i++) sum += data[i]
      return sum / Math.max(hiBin - loBin, 1) / 255
    }

    const lowMid  = bin(500, 2000)
    const highMid = bin(2500, 4000)
    const air     = bin(6000, 11000)
    const bg      = bgEnergyRef.current

    historyRef.current.push({ energy, lowMid, highMid, air })
    if (historyRef.current.length > HISTORY_SIZE) historyRef.current.shift()

    const avg = (key) => historyRef.current.reduce((s, r) => s + r[key], 0) / historyRef.current.length
    const avgEnergy  = avg('energy')
    const avgLowMid  = avg('lowMid')
    const avgHighMid = avg('highMid')
    const avgAir     = avg('air')

    if (avgEnergy < bg * 1.2) return { class: 'silence', energy: avgEnergy, alert: false }

    // FIX: bg*20 required near-shouting volume — realistic loud talking
    // almost never reached it, so it silently fell through to the
    // 'speech' branch below instead of ever being classified as 'loud'.
    // bg*9 still sits clearly above normal conversational speech
    // (bg*3.5–bg*9 covers loud-but-normal talking) while being
    // reachable without shouting directly into the mic.
    if (avgEnergy > bg * 9) return { class: 'loud', energy: avgEnergy, alert: true }

    if (avgEnergy > bg * 3.5 && avgLowMid > avgHighMid * 1.15) {
      return { class: 'speech', energy: avgEnergy, alert: true }
    }

    const whisperScore = (avgHighMid + avgAir) / Math.max(avgLowMid, 0.02)
    if (avgEnergy > bg * 1.8 && avgEnergy <= bg * 3.5 && (avgHighMid + avgAir) > 0.03 && whisperScore > 1.3) {
      return { class: 'whisper', energy: avgEnergy, alert: true }
    }

    return { class: 'ambient', energy: avgEnergy, alert: false }
  }, [])

  const recordClip = useCallback((durationMs = 2000) => {
    return new Promise((resolve, reject) => {
      const ctx = audioCtxRef.current
      const stream = streamRef.current
      if (!ctx || !stream) return reject(new Error('Audio not started — call start() first'))
      if (!workletReadyRef.current) return reject(new Error('Recorder worklet not loaded'))

      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'recorder-worklet')
      workletNodeRef.current = node

      node.port.onmessage = (e) => {
        const merged = e.data
        source.disconnect()
        node.disconnect()
        resolve(encodeWAV(merged, ctx.sampleRate))
      }

      source.connect(node)

      node.port.postMessage('start')
      setTimeout(() => {
        node.port.postMessage('stop')
      }, durationMs)
    })
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    workletNodeRef.current?.disconnect()
    workletNodeRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    historyRef.current = []
    setReady(false)
  }, [])

  return { start, stop, calibrateBackground, classify, recordClip, getEnergy, ready }
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)) }

  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}