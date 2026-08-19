import { useRef, useState, useCallback } from 'react'
import * as tf from '@tensorflow/tfjs'

const WINDOW_SIZE   = 15
const N_FEATURES    = 10
const LSTM_UNITS     = 32
const MODEL_JSON_URL = '/models/fusion_lstm/model.json'

// Must match modules/fusion/feature_extractor.py's FEATURE_NAMES order
// exactly — the model was trained on this specific column order, so any
// mismatch here silently produces meaningless predictions rather than an
// error.
// [gaze_deviation, head_deviation, lip_movement, absent_flag,
//  multi_face_flag, audio_severity, audio_alert_flag, identity_mismatch,
//  object_in_use, tab_switch_flag]

const AUDIO_SEVERITY = {
  silence: 0.0, ambient: 0.1, whisper: 0.5,
  speech:  0.6, paper:   0.4, loud:    1.0,
}

export function useFusionModel() {
  // Raw named tensors ({ 'sequential/lstm/kernel': Tensor, ... }), not a
  // tf.LayersModel — we deliberately never call tf.loadLayersModel() or
  // touch modelTopology at all. That code path kept failing on this
  // specific file's Keras-3-vs-tfjs serialization mismatches (InputLayer
  // key naming, LSTM cell nesting, and a further shape/byte-alignment
  // issue after that). tf.io.loadWeights() only needs the
  // weightsManifest + the raw .bin shard bytes — which we've already
  // confirmed load correctly — so this sidesteps every one of those
  // compatibility issues by construction. The cost: the LSTM + Dense
  // forward pass has to be implemented by hand below, since there's no
  // LayersModel to run it for us.
  const weightsRef = useRef(null)
  const windowRef  = useRef([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(MODEL_JSON_URL)
      const modelJson = await res.json()
      const basePath = MODEL_JSON_URL.substring(0, MODEL_JSON_URL.lastIndexOf('/') + 1)

      const weights = await tf.io.loadWeights(modelJson.weightsManifest, basePath)
      weightsRef.current = weights

      // Fail loudly here, with the exact missing/renamed variable, rather
      // than silently producing garbage predictions later if something's
      // still off with the manifest.
      const required = [
        'sequential/lstm/kernel', 'sequential/lstm/recurrent_kernel', 'sequential/lstm/bias',
        'sequential/dense/kernel', 'sequential/dense/bias',
        'sequential/dense_1/kernel', 'sequential/dense_1/bias',
      ]
      for (const name of required) {
        if (!weights[name]) throw new Error(`Missing expected weight: ${name}`)
      }

      console.log('[FusionModel] Raw weights loaded successfully. Shapes:')
      required.forEach(name => console.log(' ', name, weights[name].shape))

      windowRef.current = []
      setReady(true)
      console.log('[FusionModel] Ready (manual forward pass, bypassing LayersModel entirely)')
    } catch (err) {
      console.error('[FusionModel] Failed to load:', err.message)
      setLoadError(err.message)
      throw err
    }
  }, [])

  const buildFeatureVector = useCallback(({
    gazeDev, headDev, lipDev, faceCount,
    audioClass, audioAlert,
    identityMismatch, objectInUse, tabSwitchRecent,
  }) => {
    return [
      gazeDev ? 1 : 0,
      headDev ? 1 : 0,
      lipDev ? 1 : 0,
      faceCount === 0 ? 1 : 0,
      faceCount > 1 ? 1 : 0,
      AUDIO_SEVERITY[audioClass] ?? 0.0,
      audioAlert ? 1 : 0,
      identityMismatch ? 1 : 0,
      objectInUse ? 1 : 0,
      tabSwitchRecent ? 1 : 0,
    ]
  }, [])

  const pushFrame = useCallback((features) => {
    windowRef.current.push(features)
    if (windowRef.current.length > WINDOW_SIZE) windowRef.current.shift()
    return windowRef.current.length === WINDOW_SIZE
  }, [])

  // Hand-written forward pass: LSTM(32) -> Dense(16, relu) -> Dense(1, sigmoid).
  // Dropout layers are omitted entirely — they're identity operations at
  // inference time (only active during training), so skipping them is
  // exactly correct, not an approximation.
  //
  // Implements the standard Keras LSTM cell equations directly, run
  // manually for each of the 15 timesteps in the window:
  //   z = x_t @ kernel + h_{t-1} @ recurrent_kernel + bias      [1, 4*units]
  //   [z_i, z_f, z_c, z_o] = split(z, 4)   (Keras's fixed gate order: i, f, c, o)
  //   i = sigmoid(z_i); f = sigmoid(z_f); c~ = tanh(z_c); o = sigmoid(z_o)
  //   c_t = f * c_{t-1} + i * c~
  //   h_t = o * tanh(c_t)
  // This gate order and kernel/recurrent_kernel shape convention
  // ((input_dim, 4*units) and (units, 4*units) respectively) is a stable
  // Keras public contract that hasn't changed across versions, so this
  // part of the reconstruction should be reliable regardless of which
  // Keras version originally trained/saved the model.
  const predict = useCallback(() => {
    const weights = weightsRef.current
    if (!weights || windowRef.current.length < WINDOW_SIZE) return null

    return tf.tidy(() => {
      const kernel    = weights['sequential/lstm/kernel']
      const recKernel = weights['sequential/lstm/recurrent_kernel']
      const bias      = weights['sequential/lstm/bias']
      const denseK    = weights['sequential/dense/kernel']
      const denseB    = weights['sequential/dense/bias']
      const dense1K   = weights['sequential/dense_1/kernel']
      const dense1B   = weights['sequential/dense_1/bias']

      let h = tf.zeros([1, LSTM_UNITS])
      let c = tf.zeros([1, LSTM_UNITS])

      for (let t = 0; t < WINDOW_SIZE; t++) {
        const xT = tf.tensor2d([windowRef.current[t]], [1, N_FEATURES])

        const z = tf.add(
          tf.add(tf.matMul(xT, kernel), tf.matMul(h, recKernel)),
          bias
        )

        const zi = z.slice([0, 0], [1, LSTM_UNITS])
        const zf = z.slice([0, LSTM_UNITS], [1, LSTM_UNITS])
        const zc = z.slice([0, LSTM_UNITS * 2], [1, LSTM_UNITS])
        const zo = z.slice([0, LSTM_UNITS * 3], [1, LSTM_UNITS])

        const i = tf.sigmoid(zi)
        const f = tf.sigmoid(zf)
        const cTilde = tf.tanh(zc)
        const o = tf.sigmoid(zo)

        c = tf.add(tf.mul(f, c), tf.mul(i, cTilde))
        h = tf.mul(o, tf.tanh(c))
      }

      const d1  = tf.relu(tf.add(tf.matMul(h, denseK), denseB))
      const out = tf.sigmoid(tf.add(tf.matMul(d1, dense1K), dense1B))

      return out.dataSync()[0]
    })
  }, [])

  return { load, ready, loadError, buildFeatureVector, pushFrame, predict }
}