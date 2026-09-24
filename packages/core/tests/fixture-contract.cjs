// Golden fixture contract — THE drift contract.
//
// For every fixture in ../fixtures this runner computes, using ONLY the
// public core API:
//   - day scores per completion date
//   - per-task score breakdowns (every completed task)
//   - category derivations for every board task position
//   - the full healed output of validateAndHealData
// and asserts them EXACTLY (deep equality, no epsilon) against
// ../__fixtures__/expected.json.
//
// Framework-agnostic on purpose: registerFixtureTests() is called by a
// Vitest wrapper (Node/desktop CI) AND a Jest wrapper (jest-expo/Hermes
// /mobile CI). Both runtimes must produce identical numbers — that is the
// anti-drift guarantee of the monorepo. A failing fixture test is treated
// as a BREAKING change and requires a core version bump + explicit review.
'use strict'

const fs = require('fs')
const path = require('path')
const core = require('../index.js')

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// Compute everything the contract locks, from a fixture file object.
function computeActual(fixture) {
  const healed = core.validateAndHealData(fixture)
  const settings = healed.settings || {}
  const inc = settings.fatigueIncrement != null ? settings.fatigueIncrement : 0.10
  const cap = settings.fatigueCap != null ? settings.fatigueCap : 3.0

  const grouped = core.groupTasksByDate(healed.tasks)
  const dayScores = {}
  for (const [date, tasks] of grouped) {
    dayScores[date] = core.calculateDayScore(tasks, healed.difficulties, inc, cap, healed.categories)
  }

  const breakdowns = {}
  for (const task of healed.tasks) {
    if (task && task.completion) {
      breakdowns[task.id] = core.calculateTaskScoreBreakdown(
        task, healed.tasks, healed.difficulties, inc, cap, healed.categories
      )
    }
  }

  const categoryDerivations = {}
  healed.board.forEach((item, idx) => {
    if (item.type === 'task') {
      const category = core.getTaskCategory(idx, healed.board, healed.markers, healed.categories)
      categoryDerivations['board:' + idx] = category ? category.id : null
    }
  })

  return { dayScores, breakdowns, categoryDerivations, healedOutput: healed }
}

// Register the contract on a test framework. `t` provides:
//   describe(name, fn), test(name, fn), expectEqual(actual, expected, message?)
function registerFixtureTests(t) {
  const fixturesDir = path.join(__dirname, '..', 'fixtures')
  const expectedPath = path.join(__dirname, '..', '__fixtures__', 'expected.json')
  const expected = loadJSON(expectedPath)
  const fixtureNames = fs.readdirSync(fixturesDir).filter(n => n.endsWith('.json')).sort()

  for (const name of fixtureNames) {
    t.describe('golden fixture: ' + name, () => {
      const fixture = loadJSON(path.join(fixturesDir, name))
      const exp = expected[name]
      if (!exp) {
        t.test('has expected values in __fixtures__/expected.json', () => {
          throw new Error('Missing expected entry for ' + name + ' — run scripts/generate-expected.cjs')
        })
        return
      }

      t.test('day scores match exactly', () => {
        t.expectEqual(computeActual(fixture).dayScores, exp.dayScores)
      })

      t.test('per-task breakdowns match exactly', () => {
        t.expectEqual(computeActual(fixture).breakdowns, exp.breakdowns)
      })

      t.test('category derivations match exactly', () => {
        t.expectEqual(computeActual(fixture).categoryDerivations, exp.categoryDerivations)
      })

      t.test('healed output matches exactly (incl. preserved meta.updatedAt)', () => {
        t.expectEqual(computeActual(fixture).healedOutput, exp.healedOutput)
      })

      t.test('healing is idempotent (heal twice == heal once)', () => {
        const once = core.validateAndHealData(fixture)
        const twice = core.validateAndHealData(once)
        t.expectEqual(twice, once)
      })
    })
  }
}

module.exports = { computeActual, registerFixtureTests }
