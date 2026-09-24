// categories.js — the STRICT category derivation rule.

// Get category for a task based on board position - STRICT DERIVATION RULE
// A task belongs to a category ONLY if:
// 1. There is a marker directly above it AND a marker directly below it
// 2. Both markers reference the SAME category ID
// Otherwise, the task has NO category.
//
// Board marker items reference the marker ENTITY via markerId; the
// categoryId lives on the marker entity (markers[].categoryId). History:
// this used to read `.categoryId` straight off the board item — always
// undefined — so the rule silently returned null for every task and
// category chips never rendered on board rows. Fixed during core
// extraction (2026-08): resolve both board items through the markers list
// first, mirroring the completion-popup derivation in App.jsx.
function getTaskCategory(taskIndex, boardItems, markers, categories) {
  let aboveItem = null
  let belowItem = null

  // Find nearest marker item above (before) the task
  for (let i = taskIndex - 1; i >= 0; i--) {
    const item = boardItems[i]
    if (item && item.type === 'marker') {
      aboveItem = item
      break
    }
  }

  // Find nearest marker item below (after) the task
  for (let i = taskIndex + 1; i < boardItems.length; i++) {
    const item = boardItems[i]
    if (item && item.type === 'marker') {
      belowItem = item
      break
    }
  }

  // Task has a category ONLY if both marker items exist AND their marker
  // entities reference the same category
  if (aboveItem && belowItem) {
    const above = markers.find(m => m.id === aboveItem.markerId)
    const below = markers.find(m => m.id === belowItem.markerId)
    if (above && below && above.categoryId === below.categoryId) {
      const category = categories.find(c => c.id === above.categoryId)
      return category || null
    }
  }

  return null
}

module.exports = { getTaskCategory }
