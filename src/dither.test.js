import test from 'node:test'
import assert from 'node:assert/strict'
import { diffuse, orderedDecision } from './dither.js'

test('ordered matrix uses every threshold once and diffusion keeps output binary', () => {
  const levels = Array.from({ length: 64 }, (_, yx) => {
    for (let step = 0; step < 64; step++) {
      if (orderedDecision((step + 0.5) / 64, yx % 8, Math.floor(yx / 8))) return step
    }
    return 64
  })
  assert.equal(new Set(levels).size, 64)
  for (const method of ['floyd', 'atkinson']) {
    const result = diffuse([0, 0.3, 0.5, 0.7, 1, 0.2], 3, 2, method)
    assert.equal(result.length, 6)
    assert.ok([...result].every(value => value === 0 || value === 1))
    assert.equal(result[0], 0)
    assert.equal(result[4], 1)
  }
})
