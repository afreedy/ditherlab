import assert from 'node:assert/strict'
import test from 'node:test'
import { autoOperations, warpImage } from './body-warp.js'

globalThis.ImageData = class ImageData {
  constructor(data, width, height) {
    if (typeof data === 'number') Object.assign(this, { width: data, height: width, data: new Uint8ClampedArray(data * width * 4) })
    else Object.assign(this, { data, width, height })
  }
}

test('manual warp changes pixels and protection preserves background', () => {
  const width = 9
  const height = 9
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4
    data[at] = x * 20
    data[at + 3] = 255
  }
  const source = { width, height, data }
  const op = [{ kind: 'slim', x: 0.5, y: 0.5, rx: 0.5, ry: 0.5, amount: 0.6 }]
  const warped = warpImage(source, op)
  assert.notEqual(warped.data[(4 * width + 5) * 4], data[(4 * width + 5) * 4])
  const protectedImage = warpImage(source, op, { width: 1, height: 1, data: new Float32Array([0]) }, true)
  assert.deepEqual(protectedImage.data, data)
})

test('manual guides affect their region in both directions', () => {
  const width = 11, height = 11
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4
    data[at] = x * 20
    data[at + 1] = y * 20
    data[at + 3] = 255
  }
  const source = { width, height, data }
  const value = (image, x, y, channel = 0) => image.data[(y * width + x) * 4 + channel]
  const band = { kind: 'band-stretch', top: 0.2, bottom: 0.8 }
  const stretch = warpImage(source, [{ ...band, amount: 0.6 }])
  const compress = warpImage(source, [{ ...band, amount: -0.6 }])
  assert.equal(value(stretch, 5, 0, 1), value(source, 5, 0, 1))
  assert.ok(value(stretch, 5, 3, 1) < value(source, 5, 3, 1))
  assert.ok(value(compress, 5, 3, 1) > value(source, 5, 3, 1))
  assert.ok(value(stretch, 5, 9, 1) < value(source, 5, 9, 1))
  assert.ok(value(compress, 5, 9, 1) > value(source, 5, 9, 1))
  assert.deepEqual(warpImage(source, [{ ...band, amount: 0.6 }], { width: 1, height: 1, data: new Float32Array([0]) }, true).data, stretch.data)
  const slim = { kind: 'shape-slim', x: 0.5, y: 0.5, rx: 0.45, ry: 0.45, angle: 0 }
  assert.ok(value(warpImage(source, [{ ...slim, amount: 0.6 }]), 6, 5) > value(source, 6, 5))
  assert.ok(value(warpImage(source, [{ ...slim, amount: -0.6 }]), 6, 5) < value(source, 6, 5))
  const rotated = warpImage(source, [{ ...slim, angle: 45, amount: 0.6 }])
  assert.notEqual(value(rotated, 6, 6, 1), value(source, 6, 6, 1))
  const circle = { kind: 'resize', x: 0.5, y: 0.5, rx: 0.45, ry: 0.45 }
  assert.ok(value(warpImage(source, [{ ...circle, amount: 0.6 }]), 6, 5) < value(source, 6, 5))
  assert.ok(value(warpImage(source, [{ ...circle, amount: -0.6 }]), 6, 5) > value(source, 6, 5))
})

test('automatic selections use detected landmarks', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }))
  landmarks[11] = { x: 0.3, y: 0.25 }
  landmarks[12] = { x: 0.7, y: 0.25 }
  landmarks[23] = { x: 0.35, y: 0.6 }
  landmarks[24] = { x: 0.65, y: 0.6 }
  landmarks[25] = { x: 0.4, y: 0.8 }
  landmarks[26] = { x: 0.6, y: 0.8 }
  landmarks[27] = { x: 0.4, y: 0.95 }
  landmarks[28] = { x: 0.6, y: 0.95 }
  assert.equal(autoOperations('Hourglass', landmarks, 50).length, 3)
  assert.equal(autoOperations('Waist', null, 50).length, 0)
})
