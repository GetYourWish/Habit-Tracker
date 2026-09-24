// UI hardening tests (v1.0.7) — three remote-reported failures, each pinned:
//
//  1. THEME COLORS: theme.flowState/flowStatePressed/danger were NEVER
//     defined on the theme objects, so the FAB rendered with NO background,
//     filled buttons (Complete / New category / Reload) were TRANSPARENT
//     with white labels — invisible — and text buttons fell back to the
//     system default color, unreadable in dark mode. That was "the text
//     doesnt look well enough".
//
//  2. ERROR BOUNDARY: a release build has no error boundary by default, so
//     any render error KILLS the process ("i cant create a new task without
//     having it crash"). The boundary converts that into an in-app recovery
//     card; the store and its data guarantees stay fully intact underneath.
//
//  3. QUIET RELOAD: the 15 s external-change poll used to repaint the
//     full-screen 'Loading…' spinner over a perfectly good board whenever
//     Syncthing landed a desktop edit.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Text, View } from 'react-native'

const { buildTheme, themeColorGuard, LIGHT, DARK } = require('../src/theme.js')
const ErrorBoundary = require('../src/components/ErrorBoundary.js').default

// ---------------------------------------------------------------------------
// 1. every control color the UI kit reads exists on every theme object
// ---------------------------------------------------------------------------

describe('theme color completeness (the invisible-buttons regression)', () => {
  test('light and dark themes both define every required control color', () => {
    expect(themeColorGuard(LIGHT).ok).toBe(true)
    expect(themeColorGuard(DARK).ok).toBe(true)
  })

  test('built themes carry the control colors through', () => {
    for (const pref of ['system', 'light', 'dark']) {
      const theme = buildTheme(pref, 'dark')
      const guard = themeColorGuard(theme)
      expect({ pref, missing: guard.missing }).toEqual({ pref, missing: [] })
      expect(guard.ok).toBe(true)
    }
  })

  test('flowState is a real hex color on both themes (FAB/text/filled buttons)', () => {
    expect(LIGHT.flowState).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DARK.flowState).toMatch(/^#[0-9a-f]{6}$/i)
    expect(LIGHT.flowStatePressed).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DARK.flowStatePressed).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('danger is a real hex color on both themes (delete confirm buttons)', () => {
    expect(LIGHT.danger).toMatch(/^#[0-9a-f]{6}$/i)
    expect(DARK.danger).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test('the guard actually catches a theme missing flowState (self-test)', () => {
    const broken = { ...LIGHT, flowState: undefined }
    const guard = themeColorGuard(broken)
    expect(guard.ok).toBe(false)
    expect(guard.missing).toContain('flowState')
  })

  test('the UI kit no longer references the removed ACCENT_DANGER constant', () => {
    const fs = require('fs')
    const path = require('path')
    const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ui.js'), 'utf8')
    expect(ui).not.toContain('ACCENT_DANGER')
    expect(ui).toContain('theme.danger')
  })
})

// ---------------------------------------------------------------------------
// 2. the error boundary turns render crashes into a recoverable in-app card
// ---------------------------------------------------------------------------

describe('ErrorBoundary', () => {
  function Bomb({ boom }) {
    if (boom) throw new Error('kaboom: render exploded')
    return <Text>healthy</Text>
  }

  // find the Pressable whose inner Text matches, and press it
  function pressButtonByText(tree, label) {
    const texts = tree.root.findAllByType(Text)
    const hit = texts.find(t => {
      const kids = t.props.children
      return Array.isArray(kids) ? kids.includes(label) : kids === label
    })
    if (!hit) throw new Error('no button labeled ' + label)
    let inst = hit
    while (inst && !(inst.props && typeof inst.props.onPress === 'function')) {
      inst = inst.parent
    }
    if (!inst) throw new Error('no pressable ancestor for ' + label)
    act(() => {
      inst.props.onPress()
    })
  }

  test('a render error inside the boundary shows the fallback, not a crash', () => {
    let tree
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <Bomb boom />
        </ErrorBoundary>
      )
    })
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('Something went wrong displaying the app')
    expect(json).toContain('kaboom: render exploded')
    // the data-safety reassurance must be on the card
    expect(json).toContain('NOT touched')
  })

  test('retry re-renders the children and recovers when the error is gone', () => {
    let boom = true
    function Switchable() {
      return <Bomb boom={boom} />
    }
    let tree
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <Switchable />
        </ErrorBoundary>
      )
    })
    expect(JSON.stringify(tree.toJSON())).toContain('Something went wrong')

    boom = false
    pressButtonByText(tree, 'Try again')
    expect(JSON.stringify(tree.toJSON())).toContain('healthy')
  })

  test('after one failed retry, the "Reload data" escape hatch appears', () => {
    let reloads = 0
    function AlwaysBomb() {
      throw new Error('still broken')
    }
    let tree
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary onReloadData={() => { reloads++ }}>
          <AlwaysBomb />
        </ErrorBoundary>
      )
    })
    pressButtonByText(tree, 'Try again') // first retry fails again (AlwaysBomb)
    expect(JSON.stringify(tree.toJSON())).toContain('Reload data from disk')
    pressButtonByText(tree, 'Reload data from disk')
    expect(reloads).toBe(1)
  })

  test('children render normally when nothing throws', () => {
    let tree
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <View>
            <Text>all good</Text>
          </View>
        </ErrorBoundary>
      )
    })
    expect(JSON.stringify(tree.toJSON())).toContain('all good')
  })
})

// ---------------------------------------------------------------------------
// 3. quiet reload — external change detected by the poll must not flash the
//    loading screen (asserted at the store level here; the App-level paint
//    is covered by device-flow.test.js)
// ---------------------------------------------------------------------------

describe('store quiet reload on external change', () => {
  const { createTrackerStore } = require('../src/storage/store.js')

  function memAdapter() {
    const files = new Map()
    let modTime = 1
    return {
      listChildren: async () => (files.has('habit.json') ? ['mem://dir/habit.json'] : []),
      createDocument: async (dir, name) => {
        files.set(name, '')
        return 'mem://dir/' + name
      },
      removeDocument: async uri => {
        files.delete(uri.split('/').pop())
      },
      readDocument: async uri => {
        const c = files.get(uri.split('/').pop())
        if (c === undefined) throw new Error('not found')
        return c
      },
      writeDocument: async (uri, content) => {
        files.set(uri.split('/').pop(), content)
        modTime++
      },
      statDocument: async uri => {
        const c = files.get(uri.split('/').pop())
        return c === undefined ? null : { exists: true, size: c.length, modificationTime: modTime }
      },
      fileNameOf: uri => uri.split('/').pop(),
      appDocumentsDir: () => 'mem://app/',
      ensureAppDir: async () => {},
      appWriteFile: async () => {},
      appListDir: async () => [],
      appDelete: async () => {},
      __files: files
    }
  }

  test('checkExternal repaints ready→ready without passing through loading', async () => {
    const adapter = memAdapter()
    const good = JSON.stringify({
      schemaVersion: 1,
      settings: {},
      tasks: [],
      board: []
    })
    adapter.__files.set('habit.json', good)
    const store = createTrackerStore({ adapter, dirUri: 'mem://dir' })
    const seen = []
    store.subscribe(() => seen.push(store.getSnapshot().status))
    await store.load()
    expect(store.getSnapshot().status).toBe('ready')

    // an external edit lands (size changes)
    const edited = JSON.stringify({
      schemaVersion: 1,
      settings: { theme: 'dark' },
      tasks: [],
      board: []
    })
    adapter.__files.set('habit.json', edited)

    seen.length = 0
    const changed = await store.checkExternal()
    expect(changed).toBe(true)
    expect(store.getSnapshot().status).toBe('ready')
    expect(store.getSnapshot().data.settings.theme).toBe('dark')
    // THE assertion: no 'loading' repaint in the sequence — the board never
    // flashes the full-screen spinner
    expect(seen).toEqual(['ready'])
  })

  test('a manual load still shows loading (the boot path keeps its spinner)', async () => {
    const adapter = memAdapter()
    adapter.__files.set('habit.json', JSON.stringify({ schemaVersion: 1, settings: {}, tasks: [], board: [] }))
    const store = createTrackerStore({ adapter, dirUri: 'mem://dir' })
    const seen = []
    store.subscribe(() => seen.push(store.getSnapshot().status))
    await store.load()
    expect(seen).toContain('loading')
    expect(store.getSnapshot().status).toBe('ready')
  })
})
