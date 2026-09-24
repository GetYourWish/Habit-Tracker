// CategorySheet — behavioral regression guards.
//
// v1.0.10 row semantics (desktop CategoryChip): tap the category row =
// NAVIGATE to its first marker on the board; the "+" icon = place a marker.
//
// REGRESSION THE CREATE-FORM TESTS GUARD:
//   The create-category form rendered <TextInput> while TextInput was not in
//   the react-native import list — the first "New category" tap crashed with
//   "Element type is invalid: … got: undefined". No previous test ever opened
//   this branch (the full-boot tests only render the board surface), so the
//   bug survived the whole 168-test suite. This test opens the form for real.

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { CategorySheet } from '../src/components/CategorySheet.js'
import { FilledButton } from '../src/components/ui.js'
import { buildTheme } from '../src/theme.js'

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 })
}))

const theme = buildTheme('dark', 'dark')
const baseProps = {
  theme,
  visible: true,
  categories: [
    { id: 'c1', name: 'Deep Work', color: '#8b5cf6', priorityMultiplier: 2 },
    { id: 'c2', name: 'Admin', color: '#60a5fa' }
  ],
  onAddMarker: () => {},
  onNavigate: () => {},
  onCreateCategory: () => {},
  onClose: () => {}
}

async function mountSheet(props) {
  let tree = null
  await act(async () => {
    tree = TestRenderer.create(<CategorySheet {...props} />)
    await Promise.resolve()
  })
  return tree
}

function filledButton(tree, label) {
  const matches = tree.root.findAllByType(FilledButton).filter(i => i.props.label === label)
  return matches[0] || null
}

function jsonTypes(tree) {
  const types = []
  const visit = node => {
    if (node && typeof node === 'object' && node.type) types.push(node.type)
    if (node && node.children) node.children.forEach(visit)
  }
  visit(tree.toJSON())
  return types
}

function jsonText(tree) {
  const texts = []
  const visit = node => {
    if (typeof node === 'string' || typeof node === 'number') texts.push(String(node))
    else if (Array.isArray(node)) node.forEach(visit)
    else if (node && node.children) node.children.forEach(visit)
  }
  visit(tree.toJSON())
  return texts.join(' ')
}

describe('CategorySheet category rows (v1.0.10 desktop chip semantics)', () => {
  test('tapping a category row navigates (full category object) and closes', async () => {
    const onNavigate = jest.fn()
    const onClose = jest.fn()
    const tree = await mountSheet({ ...baseProps, onNavigate, onClose })

    const row = tree.root.find(
      n => n.props?.accessibilityLabel === 'Jump to Deep Work on the board'
    )
    await act(async () => {
      row.props.onPress()
    })

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'Deep Work' })
    )
    expect(onClose).toHaveBeenCalled()

    act(() => {
      tree.unmount()
    })
  })

  test('tapping the + icon adds a marker (category id) without navigating', async () => {
    const onAddMarker = jest.fn()
    const onNavigate = jest.fn()
    const tree = await mountSheet({ ...baseProps, onAddMarker, onNavigate })

    const addBtn = tree.root.find(
      n => n.props?.accessibilityLabel === 'Add Deep Work marker to the board'
    )
    await act(async () => {
      addBtn.props.onPress()
    })

    expect(onAddMarker).toHaveBeenCalledTimes(1)
    expect(onAddMarker).toHaveBeenCalledWith('c1')
    expect(onNavigate).not.toHaveBeenCalled()

    act(() => {
      tree.unmount()
    })
  })

  test('the caption explains the two actions', async () => {
    const tree = await mountSheet(baseProps)
    const text = jsonText(tree)
    expect(text).toContain('jump to its marker on the board')
    expect(text).toContain('Tap + to place a new one')

    act(() => {
      tree.unmount()
    })
  })
})

describe('CategorySheet create-category form', () => {
  test('category list renders and offers the create form', async () => {
    const tree = await mountSheet(baseProps)

    const text = jsonText(tree)
    expect(text).toContain('Deep Work')
    expect(text).toContain('Admin')
    expect(filledButton(tree, 'New category')).toBeTruthy()
    // the create form is NOT open yet — no TextInput on screen
    expect(jsonTypes(tree)).not.toContain('TextInput')

    act(() => {
      tree.unmount()
    })
  })

  test('opening the create form renders a real TextInput (regression: was undefined)', async () => {
    const tree = await mountSheet(baseProps)
    const createBtn = filledButton(tree, 'New category')
    expect(createBtn).toBeTruthy()

    // BEFORE the fix this exact interaction threw:
    //   "Element type is invalid: expected a string (for built-in components)
    //    or a class/function (for composite components) but got: undefined"
    await act(async () => {
      createBtn.props.onPress()
    })

    expect(jsonTypes(tree)).toContain('TextInput')
    // the color swatches and the Add button are part of the form too
    expect(filledButton(tree, 'Add')).toBeTruthy()

    act(() => {
      tree.unmount()
    })
  })

  test('submitting the form calls onCreateCategory with name and chosen color', async () => {
    const onCreateCategory = jest.fn()
    const tree = await mountSheet({ ...baseProps, onCreateCategory })

    await act(async () => {
      filledButton(tree, 'New category').props.onPress()
    })

    const input = tree.root.find(node => node.props?.placeholder === 'Category name')
    await act(async () => {
      input.props.onChangeText('Reading')
    })
    await act(async () => {
      filledButton(tree, 'Add').props.onPress()
    })

    expect(onCreateCategory).toHaveBeenCalledTimes(1)
    expect(onCreateCategory).toHaveBeenCalledWith({ name: 'Reading', color: '#60a5fa' })

    act(() => {
      tree.unmount()
    })
  })
})
