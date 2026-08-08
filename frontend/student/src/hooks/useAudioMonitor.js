import { useRef, useState, useCallback } from 'react'

export function useAudioMonitor() {
  const audioCtxRef  = useRef(null)
  const analyserRef  = useRef(null)
  const dataRef      = useRef(null)
  const streamRef    = useRef(null)
  const bgEnergyRef  = useRef(0.003)
  const [ready, setReady] = useState(false)

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    const ctx = new (window.AudioContext || window.webkitAudioContext)()

    // Browsers can create AudioContexts in a 'suspended' state due to
    // autoplay/gesture policies, especially when created inside an async
    // init chain rather than directly from a click handler. If it's
    // suspended, getByteFrequencyData returns near-zero data, which makes
    // background calibration bake in a near-zero baseline and every later
    // sound looks artificially "loud". Explicitly resume to guard against this.
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
    setReady(true)
    console.log('[AudioMonitor] Started, context state:', ctx.state)
    return stream
  }, [])

  // Reads frequency data ONCE and returns both the raw byte array and the
  // computed RMS energy, so every caller in a given tick works off the same
  // sample instead of re-sampling (and potentially getting a slightly
  // different frame) on every read.
  const readFrame = () => {
    if (!analyserRef.current || !dataRef.current) return { data: null, energy: 0 }
    analyserRef.current.getByteFrequencyData(dataRef.current)
    const data = dataRef.current
    const sum = data.reduce((a, b) => a + b * b, 0)
    const energy = Math.sqrt(sum / data.length) / 255
    return { data, energy }
  }

  // Kept for external callers that only want energy (e.g. simple VU meters).
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

    if (energy < bg * 1.2) return { class: 'silence', energy, alert: false }
    if (energy > bg * 20)  return { class: 'loud', energy, alert: true }

    // Guard: whisperScore divides by lowMid, which can be near-zero even
    // during ordinary faint noise (fan hum, chair creak). Require a minimum
    // absolute high-frequency energy before trusting the ratio, otherwise
    // tiny numerator noise over a near-zero denominator produces a huge,
    // meaningless ratio that used to false-trigger "whisper".
    const whisperScore = (highMid + air) / Math.max(lowMid, 0.02)
    if (energy > bg * 2.5 && energy < bg * 6 && (highMid + air) > 0.03 && whisperScore > 1.2) {
      return { class: 'whisper', energy, alert: true }
    }
    if (energy > bg * 6 && lowMid > highMid) {
      return { class: 'speech', energy, alert: true }
    }
    return { class: 'ambient', energy, alert: false }
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    setReady(false)
  }, [])

  return { start, stop, calibrateBackground, classify, getEnergy, ready }
}