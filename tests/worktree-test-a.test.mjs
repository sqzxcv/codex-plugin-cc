import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('Worktree A Test', () => {
  it('should pass a basic assertion', () => {
    assert.strictEqual(1 + 1, 2)
  })

  it('should handle string operations', () => {
    const greeting = `Hello, ${'World'}`
    assert.strictEqual(greeting, 'Hello, World')
  })

  it('should work with arrays', () => {
    const arr = [1, 2, 3]
    assert.deepStrictEqual([...arr, 4], [1, 2, 3, 4])
  })
})
