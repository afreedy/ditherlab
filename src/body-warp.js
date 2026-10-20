const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

// Operations use source-relative coordinates so preview and export share one geometry.
export function warpImage(source, operations, mask, protect = false) {
  if (!operations.length) return new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
  const { width, height, data } = source
  const output = new ImageData(width, height)
  const result = output.data
  // A height edit moves pixels beyond the original person mask, so the scene must move with it.
  const maskData = operations.some(op => op.kind === 'band-stretch') ? null : mask?.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sampleX = x
      let sampleY = y
      for (let i = operations.length - 1; i >= 0; i--) {
        const op = operations[i]
        if (op.kind === 'band-stretch') {
          const top = op.top * height
          const bottom = op.bottom * height
          const stretchedBottom = clamp(top + (bottom - top) * (1 + clamp(op.amount, -0.5, 0.5)), top + 1, height - 1)
          if (sampleY >= top && sampleY < stretchedBottom) sampleY = top + (sampleY - top) * (bottom - top) / (stretchedBottom - top)
          else if (sampleY >= stretchedBottom) sampleY = bottom + (sampleY - stretchedBottom) * (height - bottom) / (height - stretchedBottom)
          continue
        }
        const cx = op.x * width
        const cy = op.y * height
        const rx = Math.max(1, op.rx * width)
        const ry = Math.max(1, op.ry * height)
        const dx = sampleX - cx
        const dy = sampleY - cy
        if (op.kind === 'shape-slim') {
          const angle = (op.angle || 0) * Math.PI / 180
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          const localX = dx * cos + dy * sin
          const localY = -dx * sin + dy * cos
          const localDistance = (localX / rx) ** 2 + (localY / ry) ** 2
          if (localDistance < 1) {
            const localFade = (1 - localDistance) ** 2
            const warpedX = localX / (1 - clamp(op.amount, -0.7, 0.7) * localFade)
            sampleX = cx + warpedX * cos - localY * sin
            sampleY = cy + warpedX * sin + localY * cos
          }
          continue
        }
        const distance = (dx / rx) ** 2 + (dy / ry) ** 2
        if (distance >= 1) continue
        const falloff = (1 - distance) ** 2
        const amount = clamp(op.amount ?? 0, -0.8, 0.8) * falloff
        if (op.kind === 'slim') sampleX = cx + dx / (1 - amount)
        if (op.kind === 'stretch') sampleY = cy + dy / (1 + amount)
        if (op.kind === 'resize') {
          sampleX = cx + dx / (1 + amount)
          sampleY = cy + dy / (1 + amount)
        }
        if (op.kind === 'move') {
          sampleX -= (op.moveX || 0) * width * falloff
          sampleY -= (op.moveY || 0) * height * falloff
        }
      }
      sampleX = clamp(sampleX, 0, width - 1)
      sampleY = clamp(sampleY, 0, height - 1)
      const x0 = Math.floor(sampleX)
      const y0 = Math.floor(sampleY)
      const x1 = Math.min(width - 1, x0 + 1)
      const y1 = Math.min(height - 1, y0 + 1)
      const fx = sampleX - x0
      const fy = sampleY - y0
      const p00 = (y0 * width + x0) * 4
      const p10 = (y0 * width + x1) * 4
      const p01 = (y1 * width + x0) * 4
      const p11 = (y1 * width + x1) * 4
      const target = (y * width + x) * 4
      let person = 1
      if (protect && maskData) {
        const mx = Math.min(mask.width - 1, Math.floor(x / width * mask.width))
        const my = Math.min(mask.height - 1, Math.floor(y / height * mask.height))
        person = clamp((maskData[my * mask.width + mx] - 0.15) / 0.7, 0, 1)
      }
      for (let channel = 0; channel < 4; channel++) {
        const top = data[p00 + channel] * (1 - fx) + data[p10 + channel] * fx
        const bottom = data[p01 + channel] * (1 - fx) + data[p11 + channel] * fx
        const warped = top * (1 - fy) + bottom * fy
        result[target + channel] = warped * person + data[target + channel] * (1 - person)
      }
    }
  }
  return output
}

export function autoOperations(name, landmarks, strength) {
  if (!landmarks) return []
  const midpoint = (a, b) => ({ x: (landmarks[a].x + landmarks[b].x) / 2, y: (landmarks[a].y + landmarks[b].y) / 2 })
  const shoulder = midpoint(11, 12)
  const hip = midpoint(23, 24)
  const knee = midpoint(25, 26)
  const ankle = midpoint(27, 28)
  const waist = { x: (shoulder.x + hip.x) / 2, y: shoulder.y * 0.38 + hip.y * 0.62 }
  const head = midpoint(7, 8)
  const shoulderWidth = Math.max(0.07, Math.abs(landmarks[11].x - landmarks[12].x))
  const hipWidth = Math.max(0.07, Math.abs(landmarks[23].x - landmarks[24].x))
  const torsoHeight = Math.max(0.1, Math.abs(hip.y - shoulder.y))
  const scalar = strength / 100
  const slim = (at, rx, ry, factor = 1) => ({ kind: 'slim', x: at.x, y: at.y, rx, ry, amount: 0.42 * scalar * factor })
  const resize = (at, rx, ry, factor = 1) => ({ kind: 'resize', x: at.x, y: at.y, rx, ry, amount: 0.38 * scalar * factor })
  const stretch = (at, rx, ry, factor = 1) => ({ kind: 'stretch', x: at.x, y: at.y, rx, ry, amount: 0.42 * scalar * factor })
  const waistOp = slim(waist, Math.max(0.13, shoulderWidth * 0.8), torsoHeight * 0.52)
  const hipOp = resize(hip, hipWidth * 0.8, torsoHeight * 0.48)
  const shoulderOp = resize(shoulder, shoulderWidth * 0.8, torsoHeight * 0.45)
  const legCenter = { x: (hip.x + ankle.x) / 2, y: (hip.y + ankle.y) / 2 }
  const legsOp = stretch(legCenter, Math.max(0.16, hipWidth), Math.max(0.12, Math.abs(ankle.y - hip.y) * 0.55))
  const chest = { x: shoulder.x * 0.55 + waist.x * 0.45, y: shoulder.y * 0.55 + waist.y * 0.45 }
  const chestOp = resize(chest, shoulderWidth * 0.53, torsoHeight * 0.28)
  const presets = {
    Classic: [waistOp], Natural: [slim(waist, waistOp.rx, waistOp.ry, 0.35)],
    Slender: [slim(waist, waistOp.rx, waistOp.ry, 1.35), slim(hip, hipWidth * 0.75, torsoHeight * 0.5, 0.55)],
    Hourglass: [waistOp, hipOp, shoulderOp], Posture: [stretch(shoulder, shoulderWidth, torsoHeight * 0.6, 0.4)],
    Muscular: [shoulderOp, resize(chest, chestOp.rx, chestOp.ry, 0.55)],
    'Golden ratio': [waistOp, shoulderOp], 'Head-to-shoulder': [shoulderOp],
    'Leg-to-body': [legsOp], 'Waist-to-hip': [waistOp, hipOp], Waist: [waistOp],
    Head: [resize(head, shoulderWidth * 0.35, torsoHeight * 0.32)],
    Slim: [waistOp], 'Chest size': [chestOp], Legs: [legsOp],
    Leg: [stretch(knee, hipWidth * 0.6, Math.max(0.1, Math.abs(ankle.y - knee.y) * 0.8))],
    Hips: [hipOp], Shoulders: [shoulderOp],
  }
  return presets[name] || []
}
