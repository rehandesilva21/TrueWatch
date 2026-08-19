// Runs on the dedicated audio rendering thread, NOT the main thread —
// this is the entire point. process() is called by the browser's audio
// engine at a fixed cadence and never blocks UI/detection code, unlike
// the deprecated ScriptProcessorNode's onaudioprocess, which runs
// synchronously on the main thread and was stalling the MediaPipe
// detection loop for the full 2-second recording window every 8 seconds.
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.recording = false
    this.buffers = []
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.recording = true
        this.buffers = []
      }
      if (e.data === 'stop') {
        this.recording = false
        const length = this.buffers.reduce((s, b) => s + b.length, 0)
        const merged = new Float32Array(length)
        let offset = 0
        for (const b of this.buffers) {
          merged.set(b, offset)
          offset += b.length
        }
        // Transfer ownership of the buffer instead of copying it —
        // zero-copy handoff back to the main thread.
        this.port.postMessage(merged, [merged.buffer])
        this.buffers = []
      }
    }
  }

  process(inputs) {
    if (this.recording && inputs[0] && inputs[0][0]) {
      // Must copy here — the Float32Array the engine hands us is reused
      // on the next call, so we can't just push a reference to it.
      this.buffers.push(new Float32Array(inputs[0][0]))
    }
    return true // keep the processor alive
  }
}

registerProcessor('recorder-worklet', RecorderProcessor)