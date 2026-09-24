// board-features.test.js — v1.0.10/0.11 feature regressions (desktop parity):
//   1. dice / Randomizer (desktop Board.handleRandomizeTask): picks a random
//      board task not already working-on, writes it through addWorkingOn,
//      teleports to the row and flashes it; every-task-taken → no write but
//      still points at one; empty board → hint snackbar, no write.
//   2. category teleport (desktop Board.handleNavigateToCategory): tapping
//      a category in the sheet jumps to its FIRST marker on the board
//      (flash), a category with no marker gets a hint instead of silence.
//      v1.0.11 wiring: the FlatList carries onScrollToIndexFailed (RN 0.87
//      throws an invariant without it — the silent "teleport did not work"),
//      and row wrappers are collapsable={false} so measureInWindow works.
//   3. Working On popup (desktop WorkingOnMarker + WorkingOnPopup): the
//      today-card pill (only when count > 0) opens the sheet listing the
//      working-on tasks; completing from the list goes through the SAME
//      completeTask action as a board row (task completed + off the board +
//      off workingOn + log entry) and closes both sheet and dialog.
//   4. addWorkingOn action unit parity (append + meta stamp; input object
//      returned untouched when already present → store no-change-no-write).
//   5. consecutive marker spacing (desktop .marker-row.consecutive-marker):
//      a marker directly after another marker gets the settings-driven gap
//      (consecutiveMarkerMargin, default 150px); the FIRST of the pair and
//      markers after tasks get none.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { BoardScreen } from '../src/components/BoardScreen.js'
import { CategorySheet } from '../src/components/CategorySheet.js'
import { WorkingOnSheet } from '../src/components/WorkingOnSheet.js'
import { CompleteDialog } from '../src/components/dialogs.js'
import { TaskRow, MarkerRow } from '../src/components/rows.js'
import { FilledButton } from '../src/components/ui.js'
import { addWorkingOn } from '../src/actions.js'
import { getCurrentDate } from '@habit-tracker/core'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

const theme = buildTheme('dark', 'dark')
const NOW = '2026-09-22T12:00:00.000Z'

// Board layout (strict category rule — a task has a category ONLY between
// two markers of the SAME category):
//   [m1 DeepWork] t1 [m1b DeepWork] t2 [m2 Admin] t3
//   → t1 belongs to Deep Work; t2 (c1 above, c2 below) and t3 (no marker
//     below) have NO category.
function makeData(overrides = {}) {
  return {
    schemaVersion: 1,
    meta: { createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
    settings: { theme: 'system', fatigueIncrement: 0.1, fatigueCap: 3.0 },
    difficulties: [
      { id: 'd1', label: 'Easy', score: 1, color: '#4ade80', order: 0, active: true },
      { id: 'd2', label: 'Medium', score: 2, color: '#fbbf24', order: 1, active: true }
    ],
    categories: [
      { id: 'c1', name: 'Deep Work', color: '#8b5cf6', order: 0, active: true, priorityMultiplier: 1 },
      { id: 'c2', name: 'Admin', color: '#60a5fa', order: 1, active: true, priorityMultiplier: 1 },
      { id: 'c3', name: 'Reading', color: '#f472b6', order: 2, active: true, priorityMultiplier: 1 }
    ],
    markers: [
      { id: 'm1', categoryId: 'c1', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 'm1b', categoryId: 'c1', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
      { id: 'm2', categoryId: 'c2', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' }
    ],
    board: [
      { type: 'marker', markerId: 'm1' },
      { type: 'task', taskId: 't1' },
      { type: 'marker', markerId: 'm1b' },
      { type: 'task', taskId: 't2' },
      { type: 'marker', markerId: 'm2' },
      { type: 'task', taskId: 't3' }
    ],
    tasks: [
      { id: 't1', text: 'Write chapter', createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z', completion: null },
      { id: 't2', text: 'Review PR', createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z', completion: null },
      { id: 't3', text: 'Email inbox', createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-20T08:00:00.000Z', completion: null }
    ],
    workingOn: ['t1'],
    logs: [],
    ...overrides
  }
}

function makeStore() {
  const calls = []
  return {
    calls,
    mutate: async buildNext => {
      calls.push(buildNext)
    }
  }
}

async function mountBoard(data = makeData(), store = makeStore()) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(
      <BoardScreen
        theme={theme}
        state={{ status: 'ready', data, conflicts: [] }}
        store={store}
        refreshing={false}
        onRefresh={() => {}}
        onShowConflictInfo={() => {}}
      />
    )
    await Promise.resolve()
  })
  return { tree, store }
}

function textOf(tree) {
  // toJSON() output: host components carry STRING types ('Text') and their
  // text lives in the children array — props never contains children.
  const out = []
  const visit = n => {
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (n && typeof n === 'object') {
      if (n.type === 'Text' && Array.isArray(n.children)) {
        n.children.forEach(c => {
          if (typeof c === 'string') out.push(c)
        })
      }
      if (n.children) visit(n.children)
    }
  }
  visit(tree.toJSON())
  return out.join(' ')
}

// Press the first tappable element carrying this accessibilityLabel.
async function tap(tree, label) {
  const matches = tree.root.findAll(
    n => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function'
  )
  if (matches.length === 0) throw new Error('no tappable element with label: ' + label)
  await act(async () => {
    matches[0].props.onPress()
  })
}

// Real-timer wait (the teleport happens ~100–200 ms after the tap, like the
// desktop's scrollIntoView timeouts) — short enough to stay fast, real
// enough not to fight VirtualizedList's internal scheduling.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

describe('dice / Randomizer (desktop handleRandomizeTask)', () => {
  test('picks a task not already working-on, writes addWorkingOn, flashes the row', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0)
    const { tree, store } = await mountBoard(makeData()) // workingOn: ['t1']

    await tap(tree, 'Pick a random task to work on')

    // candidates = [t2, t3] (t1 already working-on) → random 0 → t2
    expect(store.calls.length).toBe(1)
    const next = store.calls[0](makeData(), NOW)
    expect(next.workingOn).toEqual(['t1', 't2'])
    expect(next.meta.updatedAt).toBe(NOW)

    // the user is told what was picked
    expect(textOf(tree)).toContain('Picked: Review PR')

    // …and the board teleports to it + flashes the row (desktop: 100 ms)
    await act(async () => {
      await sleep(160)
    })
    const t2Row = tree.root.findAllByType(TaskRow).find(r => r.props.task.id === 't2')
    expect(t2Row).toBeTruthy()
    expect(t2Row.props.flash).toBe(true)
    // only the picked row flashes
    const t1Row = tree.root.findAllByType(TaskRow).find(r => r.props.task.id === 't1')
    expect(t1Row.props.flash).toBeFalsy()

    randomSpy.mockRestore()
    act(() => {
      tree.unmount()
    })
  })

  test('every task already working-on → roll still points at one but writes NOTHING', async () => {
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0)
    const data = makeData({ workingOn: ['t1', 't2', 't3'] })
    const { tree, store } = await mountBoard(data)

    await tap(tree, 'Pick a random task to work on')

    // pool falls back to ALL tasks; the picked one (t1) is already
    // working-on → desktop skips the save entirely
    expect(store.calls.length).toBe(0)
    expect(textOf(tree)).not.toContain('Picked:')

    await act(async () => {
      await sleep(160)
    })
    const t1Row = tree.root.findAllByType(TaskRow).find(r => r.props.task.id === 't1')
    expect(t1Row.props.flash).toBe(true)

    randomSpy.mockRestore()
    act(() => {
      tree.unmount()
    })
  })

  test('no tasks on the board → hint snackbar, no write', async () => {
    const data = makeData({
      board: [{ type: 'marker', markerId: 'm1' }],
      workingOn: []
    })
    const { tree, store } = await mountBoard(data)

    await tap(tree, 'Pick a random task to work on')

    expect(store.calls.length).toBe(0)
    expect(textOf(tree)).toContain('No tasks on the board to pick from yet')

    act(() => {
      tree.unmount()
    })
  })
})

describe('category teleport (desktop handleNavigateToCategory)', () => {
  test('tapping a category jumps to its first board marker and flashes it', async () => {
    const { tree, store } = await mountBoard(makeData())

    await tap(tree, 'Categories')
    await tap(tree, 'Jump to Deep Work on the board')

    // navigation never writes
    expect(store.calls.length).toBe(0)

    // the sheet is closed so the board is visible…
    expect(tree.root.findByType(CategorySheet).props.visible).toBe(false)

    // …and the first Deep Work marker (m1) gets the teleport flash
    await act(async () => {
      await sleep(260)
    })
    const m1Row = tree.root.findAllByType(MarkerRow).find(r => r.props.marker.id === 'm1')
    expect(m1Row).toBeTruthy()
    expect(m1Row.props.flash).toBe(true)
    const m2Row = tree.root.findAllByType(MarkerRow).find(r => r.props.marker.id === 'm2')
    expect(m2Row.props.flash).toBeFalsy()

    act(() => {
      tree.unmount()
    })
  })

  test('category with no marker on the board gets a hint, not silence', async () => {
    const { tree, store } = await mountBoard(makeData())

    await tap(tree, 'Categories')
    await tap(tree, 'Jump to Reading on the board') // c3 has no marker

    expect(store.calls.length).toBe(0)
    expect(textOf(tree)).toContain('No "Reading" marker on the board yet')

    act(() => {
      tree.unmount()
    })
  })
})

describe('Working On popup (desktop WorkingOnMarker + WorkingOnPopup)', () => {
  test('the today-card pill only appears when something is being worked on', async () => {
    const { tree } = await mountBoard(makeData({ workingOn: [] }))

    const pills = tree.root.findAll(
      n => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Working on ')
    )
    expect(pills.length).toBe(0)
    expect(textOf(tree)).toContain('0 working on')

    act(() => {
      tree.unmount()
    })
  })

  test('the pill opens the sheet listing the working-on tasks', async () => {
    const { tree } = await mountBoard(makeData()) // workingOn: ['t1']

    await tap(tree, 'Working on 1 task')

    expect(tree.root.findByType(WorkingOnSheet).props.visible).toBe(true)
    const text = textOf(tree)
    // JSX text nodes render as "Working On ( 1 )" — normalize whitespace
    expect(text.replace(/\s+/g, '')).toContain('WorkingOn(1)')
    expect(text).toContain('Write chapter')
    expect(text).toContain('Tap a task to complete it.')

    act(() => {
      tree.unmount()
    })
  })

  test('completing from the sheet runs the board complete flow and closes both layers', async () => {
    const { tree, store } = await mountBoard(makeData()) // workingOn: ['t1']

    await tap(tree, 'Working on 1 task')
    await tap(tree, 'Complete task: Write chapter') // opens CompleteDialog on top of the sheet

    // the dialog is open with the task preloaded
    expect(tree.root.findByType(CompleteDialog).props.task?.id).toBe('t1')

    // pick the first difficulty (Easy), then Complete
    const radios = tree.root.findAll(n => n.props?.accessibilityRole === 'radio')
    expect(radios.length).toBeGreaterThan(0)
    await act(async () => {
      radios[0].props.onPress()
    })
    const completeBtn = tree.root
      .findAllByType(FilledButton)
      .find(b => b.props.label === 'Complete')
    await act(async () => {
      completeBtn.props.onPress()
    })

    // ONE mutation, and it is the exact board complete flow
    expect(store.calls.length).toBe(1)
    const next = store.calls[0](makeData(), NOW)
    const t1 = next.tasks.find(t => t.id === 't1')
    expect(t1.completion.difficultyId).toBe('d1')
    expect(t1.completion.completedDate).toBe(getCurrentDate())
    // off the board and off workingOn, log entry appended
    expect(next.board.some(i => i.type === 'task' && i.taskId === 't1')).toBe(false)
    expect(next.workingOn).toEqual([])
    expect(next.logs.length).toBe(1)
    expect(next.logs[0].taskId).toBe('t1')

    // desktop closes the whole popup on complete — sheet AND dialog
    expect(tree.root.findByType(WorkingOnSheet).props.visible).toBe(false)
    expect(tree.root.findByType(CompleteDialog).props.task).toBe(null)

    act(() => {
      tree.unmount()
    })
  })
})

describe('addWorkingOn action (desktop handleRandomizeTask write)', () => {
  test('appends the picked task and stamps meta.updatedAt', () => {
    const next = addWorkingOn(makeData(), 't2', NOW)
    expect(next.workingOn).toEqual(['t1', 't2'])
    expect(next.meta.updatedAt).toBe(NOW)
  })

  test('returns the input object unchanged when the task is already working-on', () => {
    const data = makeData()
    const next = addWorkingOn(data, 't1', NOW)
    expect(next).toBe(data) // same reference → store no-change-no-write skips disk
  })

  test('never mutates the input', () => {
    const data = makeData()
    const before = JSON.stringify(data)
    addWorkingOn(data, 't3', NOW)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('teleport wiring (the v1.0.11 "category teleport did not work" fix)', () => {
  test('the FlatList declares onScrollToIndexFailed — RN 0.87 throws without it', async () => {
    const { tree } = await mountBoard(makeData())
    const lists = tree.root.findAll(n => typeof n.props?.onScrollToIndexFailed === 'function')
    expect(lists.length).toBeGreaterThan(0)
    act(() => {
      tree.unmount()
    })
  })

  test('a far-index failure lands near the target and never throws or loops', async () => {
    const { tree } = await mountBoard(makeData())
    const list = tree.root.findAll(n => typeof n.props?.onScrollToIndexFailed === 'function')[0]
    // simulate RN's far-index miss for the LAST marker (m2, index 5)
    let threw = null
    await act(async () => {
      try {
        for (let round = 0; round < 5; round++) {
          list.props.onScrollToIndexFailed({
            index: 5,
            averageItemLength: 60,
            highestMeasuredFrameIndex: 1
          })
        }
        await sleep(520) // retry timer fires at 420 ms
      } catch (e) {
        threw = e
      }
    })
    expect(threw).toBe(null)
    // the board still renders every row after the failure rounds
    expect(tree.root.findAllByType(TaskRow).length).toBe(3)
    expect(tree.root.findAllByType(MarkerRow).length).toBe(3)
    act(() => {
      tree.unmount()
    })
  })

  test('every row wrapper is collapsable={false} so measureInWindow works on device', async () => {
    const { tree } = await mountBoard(makeData())
    const rows = tree.root.findAllByType(TaskRow)
    for (const row of rows) {
      // walk up past VirtualizedList's own cell wrapper to OUR measurement
      // wrapper — the only ancestor carrying a ref callback
      let wrapper = row.parent
      while (wrapper && typeof wrapper.props?.ref !== 'function') wrapper = wrapper.parent
      expect(wrapper).toBeTruthy()
      expect(wrapper.props.collapsable).toBe(false)
      expect(typeof wrapper.props.ref).toBe('function')
    }
    act(() => {
      tree.unmount()
    })
  })
})

describe('consecutive marker spacing (desktop .marker-row.consecutive-marker)', () => {
  // board order: [m1 DeepWork] [m1b DeepWork] [t1] [m2 Admin] [t3]
  // → m1b is the only marker directly after another marker
  const consecutiveBoard = {
    board: [
      { type: 'marker', markerId: 'm1' },
      { type: 'marker', markerId: 'm1b' },
      { type: 'task', taskId: 't1' },
      { type: 'marker', markerId: 'm2' },
      { type: 'task', taskId: 't3' }
    ]
  }

  function markerRow(tree, id) {
    return tree.root.findAllByType(MarkerRow).find(r => r.props.marker.id === id)
  }

  test('only the marker directly after another marker gets the gap', async () => {
    const { tree } = await mountBoard(makeData(consecutiveBoard))
    expect(markerRow(tree, 'm1').props.consecutive).toBe(false) // first of the pair
    expect(markerRow(tree, 'm1b').props.consecutive).toBe(true) // follows m1
    expect(markerRow(tree, 'm2').props.consecutive).toBe(false) // follows task t1
    act(() => {
      tree.unmount()
    })
  })

  test('default spacing is 150 (desktop --consecutive-marker-margin default)', async () => {
    const { tree } = await mountBoard(makeData(consecutiveBoard))
    for (const id of ['m1', 'm1b', 'm2']) {
      expect(markerRow(tree, id).props.spacing).toBe(150)
    }
    act(() => {
      tree.unmount()
    })
  })

  test('settings.consecutiveMarkerMargin drives the gap (Settings → Board section)', async () => {
    const { tree } = await mountBoard(
      makeData({
        ...consecutiveBoard,
        settings: { theme: 'system', fatigueIncrement: 0.1, fatigueCap: 3.0, consecutiveMarkerMargin: '220px' }
      })
    )
    expect(markerRow(tree, 'm1b').props.spacing).toBe(220)
    expect(markerRow(tree, 'm1').props.spacing).toBe(220) // spacing applies only when consecutive
    act(() => {
      tree.unmount()
    })
  })

  test('a garbage margin value falls back to 150', async () => {
    const { tree } = await mountBoard(
      makeData({
        ...consecutiveBoard,
        settings: { theme: 'system', consecutiveMarkerMargin: 'big' }
      })
    )
    expect(markerRow(tree, 'm1b').props.spacing).toBe(150)
    act(() => {
      tree.unmount()
    })
  })
})
