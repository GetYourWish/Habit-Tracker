// scoring.js — THE canonical scoring implementation.
//
// Documented formula (README / SCHEMA.md):
//   score(task_i) = basePoints_i × min(1.0 + i × fatigueIncrement, fatigueCap) × priorityMultiplier_i
// where i is the 0-based position of the task in its completion day, ordered
// by completedAt ascending (ties broken by iteration order — Array.sort is
// stable per ES2019 in every supported runtime).
//
// HISTORY: calculateDayScore used to accumulate the multiplier by repeated
// addition (1.0, +inc, +inc, ...) while calculateTaskScoreBreakdown computed
// 1.0 + i*inc directly. Floating point makes those two diverge in the last
// bits, so desktop and any second client could disagree on day totals. The
// multiplicative form is canonical (matches the documented formula) and both
// callers now go through fatigueMultiplier() below. DO NOT reintroduce an
// additive accumulator anywhere — golden fixtures will fail.

// The ONE fatigue multiplier implementation. i is 0-based: the first task of
// a day gets 1.0 regardless of the cap.
function fatigueMultiplier(taskIndex, fatigueIncrement, fatigueCap) {
  return Math.min(1.0 + taskIndex * fatigueIncrement, fatigueCap)
}

// Resolve a category's priority multiplier with the legacy semantics:
// only a numeric priorityMultiplier applies; anything else means 1.0.
function categoryPriorityMultiplier(categoryMap, categoryId) {
  if (!categoryId) return 1.0
  const category = categoryMap.get(categoryId)
  if (category && typeof category.priorityMultiplier === 'number') {
    return category.priorityMultiplier
  }
  return 1.0
}

// Calculate the score breakdown for a SINGLE task at the moment of completion.
// Returns an object with all formula components for logging.
// Accepts pre-built Maps for performance when called in bulk.
function calculateTaskScoreBreakdown(task, completedTasks, difficulties, fatigueIncrement, fatigueCap, categories, _difficultyMap, _categoryMap, _tasksByDate) {
  const difficultyMap = _difficultyMap || new Map(difficulties.map(d => [d.id, d]))
  const categoryMap = _categoryMap || new Map(categories.map(c => [c.id, c]))

  const difficulty = difficultyMap.get(task.completion.difficultyId)
  const basePoints = difficulty ? difficulty.score : 0
  const difficultyLabel = difficulty ? difficulty.label : 'Unknown'
  const difficultyColor = difficulty ? difficulty.color : '#888'

  // Determine category info
  let categoryName = null
  let categoryColor = null
  const priorityMultiplier = categoryPriorityMultiplier(categoryMap, task.completion.categoryId)
  if (task.completion.categoryId) {
    const category = categoryMap.get(task.completion.categoryId)
    if (category) {
      categoryName = category.name
      categoryColor = category.color
    }
  }

  // Calculate fatigue multiplier: count tasks completed earlier on the same date
  const completionDate = task.completion.completedDate
  let taskIndex = 0
  if (_tasksByDate && _tasksByDate.has(completionDate)) {
    // O(k) for k tasks on that day instead of O(n) for all tasks
    const dayTasks = _tasksByDate.get(completionDate)
    const taskTime = new Date(task.completion.completedAt).getTime()
    for (let i = 0; i < dayTasks.length; i++) {
      if (dayTasks[i].id !== task.id && new Date(dayTasks[i].completion.completedAt).getTime() < taskTime) {
        taskIndex++
      }
    }
  } else if (!_tasksByDate) {
    // Fallback: original O(n) filter (only when no pre-grouped map provided)
    const earlierTasks = completedTasks.filter(t =>
      t.id !== task.id &&
      t.completion &&
      t.completion.completedDate === completionDate &&
      new Date(t.completion.completedAt) < new Date(task.completion.completedAt)
    )
    taskIndex = earlierTasks.length
  }
  const multiplier = fatigueMultiplier(taskIndex, fatigueIncrement, fatigueCap)

  const finalScore = basePoints * multiplier * priorityMultiplier

  return {
    basePoints,
    difficultyLabel,
    difficultyColor,
    categoryName,
    categoryColor,
    priorityMultiplier,
    fatigueMultiplier: multiplier,
    finalScore: Math.round(finalScore * 100) / 100 // 2 decimal places
  }
}

// Calculate the score for one day's completed tasks.
// Canonical multiplicative fatigue: task i gets min(1.0 + i*increment, cap).
function calculateDayScore(completedTasks, difficulties, fatigueIncrement = 0.10, fatigueCap = 3.0, categories = []) {
  if (!completedTasks || completedTasks.length === 0) {
    return 0
  }

  // Sort by completion timestamp (stable: ties keep iteration order)
  const sorted = [...completedTasks].sort((a, b) => {
    return new Date(a.completion.completedAt) - new Date(b.completion.completedAt)
  })

  // Create lookups for O(1) access
  const difficultyMap = new Map(difficulties.map(d => [d.id, d]))
  const categoryMap = new Map(categories.map(c => [c.id, c]))

  let totalScore = 0
  for (let i = 0; i < sorted.length; i++) {
    const task = sorted[i]
    const difficulty = difficultyMap.get(task.completion.difficultyId)
    const baseScore = difficulty ? difficulty.score : 0
    const priorityMultiplier = categoryPriorityMultiplier(categoryMap, task.completion.categoryId)
    totalScore += baseScore * fatigueMultiplier(i, fatigueIncrement, fatigueCap) * priorityMultiplier
  }

  return totalScore
}

// Pre-group tasks by date for efficient heatmap calculation - O(n) instead of O(n*m)
// Each group is sorted by completedAt for O(k) fatigue lookups
function groupTasksByDate(completedTasks) {
  const grouped = new Map()

  for (const task of completedTasks) {
    if (!task.completion || !task.completion.completedDate) continue

    const dateStr = task.completion.completedDate
    if (!grouped.has(dateStr)) {
      grouped.set(dateStr, [])
    }
    grouped.get(dateStr).push(task)
  }

  // Sort each day's tasks by completion time for efficient fatigue index calculation
  for (const [, tasks] of grouped) {
    tasks.sort((a, b) => new Date(a.completion.completedAt).getTime() - new Date(b.completion.completedAt).getTime())
  }

  return grouped
}

module.exports = {
  fatigueMultiplier,
  calculateTaskScoreBreakdown,
  calculateDayScore,
  groupTasksByDate
}
