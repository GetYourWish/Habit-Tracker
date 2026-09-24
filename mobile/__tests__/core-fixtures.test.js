// Dual-runtime drift guard, mobile side (jest-expo / Hermes).
// Runs the EXACT SAME golden-fixture contract as packages/core's Vitest
// suite (Node). If these two ever disagree, @habit-tracker/core is
// not portable — that is a release blocker by the zero-drift principle.
const { registerFixtureTests } = require('../../packages/core/tests/fixture-contract.cjs')

registerFixtureTests({
  describe,
  test: it,
  expectEqual: (actual, expected) => expect(actual).toEqual(expected)
})
