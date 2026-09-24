import { describe, it, expect } from 'vitest'
import { registerFixtureTests } from './fixture-contract.cjs'

// Node/desktop side of the dual-runtime drift guarantee.
// The SAME contract runs under jest-expo (Hermes/mobile) in mobile/.
registerFixtureTests({
  describe,
  test: it,
  expectEqual: (actual, expected) => expect(actual).toEqual(expected)
})
