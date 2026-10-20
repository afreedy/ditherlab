export const METHODS = [
  { id: 'halftone', name: 'Halftone dots' },
  { id: 'bayer', name: 'Bayer ordered' },
  { id: 'floyd', name: 'Floyd–Steinberg' },
  { id: 'atkinson', name: 'Atkinson' },
  { id: 'noise', name: 'Noise threshold' },
]

// Conventional 8×8 Bayer order, generated from its 2×2 seed.
const BAYER_8 = Array.from({ length: 64 }, (_, i) => {
  const x = i % 8
  const y = Math.floor(i / 8)
  const base = [0, 2, 3, 1]
  let value = 0
  for (let bit = 0; bit < 3; bit++) {
    value += base[((x >> bit) & 1) + 2 * ((y >> bit) & 1)] * (1 << (2 * (2 - bit)))
  }
  return value
})

export function orderedDecision(tone, x, y, phase = 0) {
  return tone > (BAYER_8[((y + phase) & 7) * 8 + ((x + phase) & 7)] + 0.5) / 64
}

export function diffuse(input, width, height, method, threshold = 0.5) {
  const values = Float32Array.from(input)
  const output = new Uint8Array(values.length)
  const kernel = method === 'atkinson'
    ? [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]]
    : [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const next = values[index] >= threshold ? 1 : 0
      output[index] = next
      const error = values[index] - next
      for (const [dx, dy, weight] of kernel) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny < height) values[ny * width + nx] += error * weight
      }
    }
  }
  return output
}

const clamp = value => Math.max(0, Math.min(1, value))
const noise = (x, y, seed) => {
  let n = Math.imul(x + 1747, 374761393) + Math.imul(y + seed * 13, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

export function renderDither(image, canvas, settings, seconds = 0, preview = false) {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const scale = preview ? Math.min(1, 1250 / Math.max(sourceWidth, sourceHeight)) : 1
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: false })
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.fillStyle = settings.paper
  ctx.fillRect(0, 0, width, height)

  const cell = preview ? Math.max(2, settings.cell * scale) : settings.cell
  const columns = Math.ceil(width / cell)
  const rows = Math.ceil(height / cell)
  const source = document.createElement('canvas')
  source.width = columns
  source.height = rows
  const sample = source.getContext('2d', { willReadFrequently: true })
  sample.fillStyle = '#fff'
  sample.fillRect(0, 0, columns, rows)
  sample.drawImage(image, 0, 0, columns, rows)
  const pixels = sample.getImageData(0, 0, columns, rows).data
  const tones = new Float32Array(columns * rows)
  const phase = seconds * settings.speed
  const motion = settings.motion !== 'none' ? settings.strength / 100 : 0

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x
      const p = i * 4
      let luminance = (pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722) / 255
      luminance = clamp((luminance - 0.5) * settings.contrast + 0.5 + settings.brightness / 100)
      let tone = settings.highlights ? luminance : 1 - luminance
      if (settings.motion === 'shimmer') tone += Math.sin(x * 0.37 + y * 0.19 + phase * 3.5) * motion * 0.23
      if (settings.motion === 'pulse') tone += Math.sin(phase * 3) * motion * 0.18
      tones[i] = clamp(tone)
    }
  }

  ctx.fillStyle = settings.ink
  const threshold = settings.threshold / 100
  if (settings.method === 'halftone') {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const density = clamp((tones[y * columns + x] - threshold) * 2.4 + 0.5)
        if (density <= 0.01) continue
        const radius = Math.sqrt(density) * cell * 0.49 * settings.dotScale
        const wave = settings.motion === 'wave' ? Math.sin(y * 0.16 + phase * 2) * motion * cell * 2.3 : 0
        const cx = x * cell + cell / 2 + wave
        const cy = y * cell + cell / 2
        ctx.beginPath()
        ctx.arc(cx, cy, Math.max(0.15, radius), 0, Math.PI * 2)
        ctx.fill()
      }
    }
    return
  }

  let binary
  if (settings.method === 'floyd' || settings.method === 'atkinson') {
    binary = diffuse(tones, columns, rows, settings.method, threshold)
  }
  const drift = settings.motion === 'drift' ? Math.floor(phase * motion * 6) : 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x
      const selected = binary
        ? binary[i]
        : settings.method === 'bayer'
          ? orderedDecision(clamp(tones[i] - threshold + 0.5), x, y, drift)
          : tones[i] > threshold + (noise(x, y, drift) - 0.5) * settings.grain
      if (!selected) continue
      const wave = settings.motion === 'wave' ? Math.sin(y * 0.16 + phase * 2) * motion * cell * 2.3 : 0
      ctx.fillRect(x * cell + wave, y * cell, Math.ceil(cell + 0.2), Math.ceil(cell + 0.2))
    }
  }
}
