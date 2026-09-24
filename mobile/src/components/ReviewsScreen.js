// ReviewsScreen — Android port of the desktop Reviews view, which was
// entirely missing from the mobile app (the 2026-09-22 "the reviews
// section is non existent" report). Desktop tabs, same order:
//   Dashboard | Daily | Flow State | Stacked Chart | Heatmap
//
// Data guarantees:
//  - every mutation goes through store.mutate → rebase → no-change-no-write
//    (editing a completion from the Reviews screen syncs to the desktop
//    exactly like a board edit)
//  - every number comes from @habit-tracker/core — the same module
//    the desktop renders from, over the same habit.json
//
// Editing parity with desktop Reviews TaskDetailPopup:
//   - completion date edit (the "worked past midnight" correction)
//   - completion time edit (HH:mm, device-local)
//   - note edit (≤500 chars)
//   - delete completed task

import React, { useMemo, useState, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  calculateDayScore,
  groupTasksByDate,
  formatDate,
  parseDate,
  getCurrentDate
} from '@habit-tracker/core'
import {
  addDays,
  subDays,
  getStartOfWeek,
  startOfDay,
  formatLongDate,
  formatMediumDate,
  formatShortDate,
  isoToLocalTimeString
} from '../dates.js'
import {
  TopAppBar,
  GlassCard,
  IconBtn,
  TextButton,
  FilledButton,
  Segmented,
  Dialog,
  Snackbar
} from './ui.js'
import { inputStyle } from './dialogs.js'
import { FlowStateArea, StackedCategoryBars, HeatmapGrid, buildDaySeries, buildHeatmapYear, buildScoreCache, resolveChartRange } from './reviews/charts.js'
import { ReviewsDashboard } from './reviews/dashboard.js'
import { updateTaskCompletion, deleteTask } from '../actions.js'
import { SPACING, TYPE, ACCENTS } from '../theme.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

// NOTE: Segmented reads opt.value — the option objects MUST carry `value`
// (a `key`-shaped list makes every tap onChange(undefined)).
const REVIEW_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'daily', label: 'Daily' },
  { value: 'flow', label: 'Flow' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'heatmap', label: 'Heatmap' }
]

const RANGE_TABS = [
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'All', value: 'all' }
]

// --- summary tile (desktop .summary-card) ------------------------------------

function SummaryTile({ theme, value, label }) {
  return (
    <View style={{ flex: 1, backgroundColor: theme.rowFill, borderRadius: 12, padding: SPACING.md, alignItems: 'center' }}>
      <Text style={{ color: theme.textPrimary, fontSize: 24, fontWeight: '800', letterSpacing: -0.4 }}>
        {value}
      </Text>
      <Text style={{ color: theme.textMuted, marginTop: 2, ...TYPE.caption, textAlign: 'center' }}>
        {label}
      </Text>
    </View>
  )
}

// --- Task detail dialog (desktop TaskDetailPopup) ------------------------------

export function TaskDetailDialog({ theme, task, difficulties, categories, onSave, onEditDate, onDelete, onClose }) {
  const completion = task && task.completion
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState('')
  const [editingTime, setEditingTime] = useState(false)
  const [timeValue, setTimeValue] = useState('')

  React.useEffect(() => {
    if (task) {
      setEditingNote(false)
      setEditingTime(false)
    }
  }, [task])

  if (!task || !completion) return null

  const difficulty = difficulties.find(d => d.id === completion.difficultyId)
  const category = categories.find(c => c.id === completion.categoryId)
  const completedDate = parseDate(completion.completedDate)

  const openNote = () => {
    setNoteValue(completion.note || '')
    setEditingNote(true)
  }
  const saveNote = () => {
    setEditingNote(false)
    if (noteValue !== (completion.note || '')) onSave({ note: noteValue })
  }
  const openTime = () => {
    setTimeValue(completion.completedAt ? isoToLocalTimeString(completion.completedAt).replace(/ (AM|PM)/, '') : '12:00')
    setEditingTime(true)
  }
  const saveTime = () => {
    setEditingTime(false)
    if (!TIME_RE.test(timeValue.trim())) return
    const [h, m] = timeValue.trim().split(':').map(Number)
    const d = new Date(completion.completedAt || completion.completedDate)
    d.setHours(h, m, 0, 0)
    onSave({ completedAt: d.toISOString() })
  }

  return (
    <Dialog
      theme={theme}
      visible={!!task}
      title="Task Details"
      onClose={onClose}
      wide
      actions={
        <>
          <TextButton theme={theme} label="Delete" destructive onPress={onDelete} />
          <TextButton theme={theme} label="Close" onPress={onClose} />
        </>
      }
    >
      <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.md }}>
        {task.text}
      </Text>

      <Text style={labelStyle(theme)}>COMPLETION DATE</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
        <View style={[inputStyle(theme), { flex: 1, justifyContent: 'center' }]}>
          <Text style={{ color: theme.textPrimary, fontSize: 15 }}>{formatLongDate(completedDate)}</Text>
        </View>
        <TextButton theme={theme} label="Edit Date" onPress={() => onEditDate(task)} />
      </View>

      <Text style={labelStyle(theme)}>COMPLETION TIME</Text>
      {editingTime ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <TextInput
            style={[inputStyle(theme), { flex: 1 }]}
            value={timeValue}
            onChangeText={setTimeValue}
            placeholder="HH:MM (24h)"
            placeholderTextColor={theme.textMuted}
            maxLength={5}
            inputMode="numeric"
            autoFocus
          />
          <TextButton theme={theme} label="Save" onPress={saveTime} disabled={!TIME_RE.test(timeValue.trim())} />
          <TextButton theme={theme} label="Cancel" onPress={() => setEditingTime(false)} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
          <View style={[inputStyle(theme), { flex: 1, justifyContent: 'center' }]}>
            <Text style={{ color: theme.textPrimary, fontSize: 15 }}>
              {isoToLocalTimeString(completion.completedAt) || '—'}
            </Text>
          </View>
          <TextButton theme={theme} label="Edit Time" onPress={openTime} />
        </View>
      )}

      {difficulty ? (
        <>
          <Text style={labelStyle(theme)}>DIFFICULTY</Text>
          <View
            style={{
              backgroundColor: difficulty.color,
              borderRadius: 12,
              paddingHorizontal: SPACING.lg,
              paddingVertical: 8,
              alignSelf: 'flex-start',
              marginBottom: SPACING.md
            }}
          >
            <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>
              {difficulty.label} ({difficulty.score})
            </Text>
          </View>
        </>
      ) : null}

      <Text style={labelStyle(theme)}>CATEGORY</Text>
      {category ? (
        <View
          style={{
            backgroundColor: category.color,
            borderRadius: 12,
            paddingHorizontal: SPACING.lg,
            paddingVertical: 8,
            alignSelf: 'flex-start',
            marginBottom: SPACING.md
          }}
        >
          <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 14 }}>{category.name}</Text>
        </View>
      ) : (
        <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.body }}>No category</Text>
      )}

      <Text style={labelStyle(theme)}>NOTE</Text>
      {editingNote ? (
        <View>
          <TextInput
            style={[inputStyle(theme), { minHeight: 80, textAlignVertical: 'top' }]}
            value={noteValue}
            onChangeText={setNoteValue}
            multiline
            maxLength={500}
            autoFocus
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.xs, marginTop: SPACING.sm }}>
            <TextButton theme={theme} label="Cancel" onPress={() => setEditingNote(false)} />
            <TextButton theme={theme} label="Save" onPress={saveNote} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm }}>
          <View style={[inputStyle(theme), { flex: 1, minHeight: 44 }]}>
            <Text style={{ color: completion.note ? theme.textPrimary : theme.textMuted, fontSize: 14.5, lineHeight: 20 }}>
              {completion.note || 'No note'}
            </Text>
          </View>
          <TextButton theme={theme} label="Edit" onPress={openNote} />
        </View>
      )}
    </Dialog>
  )
}

// --- Edit date dialog (desktop Edit Date popup) ---------------------------------

export function EditDateDialog({ theme, task, onSave, onClose }) {
  const [date, setDate] = useState('')
  React.useEffect(() => {
    if (task) setDate(task.completion ? task.completion.completedDate : '')
  }, [task])

  if (!task) return null
  const valid = DATE_RE.test(date.trim())

  return (
    <Dialog
      theme={theme}
      visible={!!task}
      title="Edit Completion Date"
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <TextButton theme={theme} label="Save" disabled={!valid} onPress={() => onSave(date.trim())} />
        </>
      }
    >
      <Text style={{ color: theme.textSecondary, ...TYPE.body, marginBottom: SPACING.md }}>
        Update the completion date for this task. Useful when you work past midnight or need to correct a mistake.
      </Text>
      <TextInput
        style={inputStyle(theme)}
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={theme.textMuted}
        maxLength={10}
        inputMode="numeric"
        autoFocus
      />
      {!valid ? (
        <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 4 }}>Use the YYYY-MM-DD format.</Text>
      ) : null}
    </Dialog>
  )
}

// --- Day detail dialog (desktop DayDetailPopup) ---------------------------------

export function DayDetailDialog({ theme, date, tasks, difficulties, categories, onOpenTask, onClose }) {
  if (!date) return null
  const dateStr = formatDate(parseDate(date))
  const dayTasks = tasks.filter(t => t.completion && t.completion.completedDate === dateStr)

  return (
    <Dialog
      theme={theme}
      visible={!!date}
      title={formatLongDate(parseDate(date))}
      onClose={onClose}
      wide
      actions={<TextButton theme={theme} label="Close" onPress={onClose} />}
    >
      <Text style={{ color: theme.textSecondary, marginBottom: SPACING.md, ...TYPE.secondary }}>
        {dayTasks.length} task{dayTasks.length !== 1 ? 's' : ''} completed
      </Text>
      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: SPACING.md }}>
        {dayTasks.length === 0 ? (
          <Text style={{ color: theme.textMuted, ...TYPE.body }}>No tasks completed on this date</Text>
        ) : (
          dayTasks.map(task => {
            const difficulty = difficulties.find(d => d.id === task.completion.difficultyId)
            const category = categories.find(c => c.id === task.completion.categoryId)
            return (
              <Pressable
                key={task.id}
                onPress={() => onOpenTask(task)}
                style={{
                  backgroundColor: theme.bgSecondary,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.border,
                  padding: SPACING.md
                }}
                accessibilityRole="button"
                accessibilityLabel={`Task details: ${task.text}`}
              >
                <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: 6 }}>{task.text}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: task.completion.note ? 6 : 0 }}>
                  {difficulty ? (
                    <View style={{ backgroundColor: difficulty.color, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                      <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '600' }}>
                        {difficulty.label} ({difficulty.score})
                      </Text>
                    </View>
                  ) : null}
                  {category ? (
                    <View style={{ backgroundColor: category.color, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                      <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '600' }}>{category.name}</Text>
                    </View>
                  ) : null}
                  <View style={{ backgroundColor: theme.bgTertiary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                    <Text style={{ color: theme.textSecondary, fontSize: 11.5 }}>
                      {isoToLocalTimeString(task.completion.completedAt)}
                    </Text>
                  </View>
                </View>
                {task.completion.note ? (
                  <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{task.completion.note}</Text>
                ) : null}
              </Pressable>
            )
          })
        )}
      </ScrollView>
    </Dialog>
  )
}

// --- date stepper (‹ date ›) ------------------------------------------------------

function DateStepper({ theme, date, onChange, label }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md }}>
      <IconBtn name="chevron-left" color={theme.textSecondary} onPress={() => onChange(subDays(date, 1))} accessibilityLabel="Previous day" />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong }}>{label}</Text>
      </View>
      <IconBtn name="chevron-right" color={theme.textSecondary} onPress={() => onChange(addDays(date, 1))} accessibilityLabel="Next day" />
      <IconBtn name="calendar-today" color={theme.textSecondary} onPress={() => onChange(new Date())} accessibilityLabel="Jump to today" />
    </View>
  )
}

// --- the screen --------------------------------------------------------------------

export function ReviewsScreen({ theme, state, store }) {
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState('dashboard')
  const [selectedDate, setSelectedDate] = useState(startOfDay(new Date()))
  const [range, setRange] = useState('week')
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear())
  const [snack, setSnack] = useState(null)

  const [dayDetail, setDayDetail] = useState(null) // 'YYYY-MM-DD'
  const [taskDetail, setTaskDetail] = useState(null) // task object
  const [taskToEditDate, setTaskToEditDate] = useState(null) // task object

  const data = state.data
  const tasks = data?.tasks || []
  const difficulties = data?.difficulties || []
  const categories = data?.categories || []
  const settings = data?.settings || {}

  const run = useCallback(
    async (buildNext, successMessage) => {
      try {
        await store.mutate(buildNext)
        if (successMessage) setSnack(successMessage)
      } catch (e) {
        if (e && e.code === 'SCHEMA_VERSION_TOO_NEW') {
          setSnack(`File is now schema ${e.schemaVersion} — update this app first`)
        } else {
          setSnack('Save failed: ' + (e.message || e))
        }
      }
    },
    [store]
  )

  const completedTasks = useMemo(() => tasks.filter(t => t.completion), [tasks])
  const tasksByDate = useMemo(() => groupTasksByDate(completedTasks), [completedTasks])
  const scoreCache = useMemo(
    () =>
      buildScoreCache(
        completedTasks,
        difficulties,
        categories,
        settings.fatigueIncrement || 0.10,
        settings.fatigueCap || 3.0
      ),
    [completedTasks, difficulties, categories, settings.fatigueIncrement, settings.fatigueCap]
  )
  const flowStateColor = settings.flowStateColor || ACCENTS.flowState

  // Daily tab data (desktop dailyData)
  const dailyData = useMemo(() => {
    const dateStr = formatDate(selectedDate)
    const daysTasks = tasksByDate.get(dateStr) || []
    const score = calculateDayScore(
      daysTasks,
      difficulties,
      settings.fatigueIncrement || 0.10,
      settings.fatigueCap || 3.0,
      categories
    )
    return { date: dateStr, score, count: daysTasks.length, tasks: daysTasks }
  }, [selectedDate, tasksByDate, difficulties, categories, settings])

  // Flow State / Stacked shared range + series
  const chartRange = useMemo(
    () => resolveChartRange(range, completedTasks, settings.weekStartsOn),
    [range, completedTasks, settings.weekStartsOn]
  )
  const series = useMemo(
    () =>
      buildDaySeries({
        start: chartRange.start,
        end: chartRange.end,
        tasksByDate,
        difficulties,
        categories,
        settings
      }),
    [chartRange, tasksByDate, difficulties, categories, settings]
  )

  const weeklySummary = useMemo(() => {
    const real = series.filter(d => !d.isFuture)
    const totalScore = real.reduce((s, d) => s + (d.score || 0), 0)
    const totalCount = real.reduce((s, d) => s + d.count, 0)
    const bestDay = real.reduce((best, d) => ((d.score || 0) > (best ? best.score || 0 : -Infinity) ? d : best), real[0])
    return { totalScore, totalCount, bestDay }
  }, [series])

  const heatmapCells = useMemo(
    () => buildHeatmapYear({ year: heatmapYear, tasksByDate, difficulties, categories, settings }),
    [heatmapYear, tasksByDate, difficulties, categories, settings]
  )

  const openDay = useCallback(dateStr => setDayDetail(dateStr), [])

  const handleSaveCompletion = patch => {
    const task = taskDetail
    if (!task) return
    run(d => updateTaskCompletion(d, task.id, patch, new Date().toISOString()), 'Completion updated')
  }

  const handleSaveDate = newDate => {
    const task = taskToEditDate
    setTaskToEditDate(null)
    if (!task) return
    if (newDate === task.completion.completedDate) return
    run(d => updateTaskCompletion(d, task.id, { completedDate: newDate }, new Date().toISOString()), 'Completion date updated')
  }

  const handleDeleteCompleted = () => {
    const task = taskDetail
    setTaskDetail(null)
    if (!task) return
    run(d => deleteTask(d, task.id, new Date().toISOString()), 'Task deleted')
  }

  const renderTab = () => {
    if (tab === 'dashboard') {
      return <ReviewsDashboard theme={theme} data={data} onDayPress={openDay} />
    }

    if (tab === 'daily') {
      return (
        <View>
          <DateStepper
            theme={theme}
            date={selectedDate}
            onChange={d => setSelectedDate(startOfDay(d))}
            label={formatLongDate(selectedDate)}
          />
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <SummaryTile
              theme={theme}
              value={String(Math.round(dailyData.score * 10) / 10)}
              label="Productivity Score"
            />
            <SummaryTile theme={theme} value={String(dailyData.count)} label="Tasks Completed" />
          </View>
          {dailyData.tasks.length === 0 ? (
            <Text style={{ color: theme.textMuted, ...TYPE.secondary, textAlign: 'center', paddingVertical: SPACING.xl }}>
              No tasks completed on this date
            </Text>
          ) : (
            <View style={{ gap: SPACING.sm }}>
              {dailyData.tasks.map(task => {
                const difficulty = difficulties.find(d => d.id === task.completion.difficultyId)
                const category = categories.find(c => c.id === task.completion.categoryId)
                return (
                  <Pressable
                    key={task.id}
                    onPress={() => setTaskDetail(task)}
                    style={{
                      backgroundColor: theme.rowFill,
                      borderRadius: 12,
                      padding: SPACING.md
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Task details: ${task.text}`}
                  >
                    <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong }}>{task.text}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      {difficulty ? (
                        <View style={{ backgroundColor: difficulty.color, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                          <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '600' }}>{difficulty.label}</Text>
                        </View>
                      ) : null}
                      {category ? (
                        <View style={{ backgroundColor: category.color, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                          <Text style={{ color: '#ffffff', fontSize: 11.5, fontWeight: '600' }}>{category.name}</Text>
                        </View>
                      ) : null}
                      <View style={{ backgroundColor: theme.bgTertiary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 3 }}>
                        <Text style={{ color: theme.textSecondary, fontSize: 11.5 }}>
                          {isoToLocalTimeString(task.completion.completedAt)}
                        </Text>
                      </View>
                    </View>
                    {task.completion.note ? (
                      <Text style={{ color: theme.textSecondary, marginTop: 6, ...TYPE.caption }} numberOfLines={2}>
                        {task.completion.note}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>
          )}
        </View>
      )
    }

    if (tab === 'flow') {
      return (
        <View>
          <DateStepper
            theme={theme}
            date={selectedDate}
            onChange={d => setSelectedDate(startOfDay(d))}
            label={formatShortDate(chartRange.start) + ' – ' + formatShortDate(chartRange.end)}
          />
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
            <SummaryTile theme={theme} value={String(Math.round(weeklySummary.totalScore * 10) / 10)} label="Total Score" />
            <SummaryTile theme={theme} value={String(weeklySummary.totalCount)} label="Tasks Completed" />
            <SummaryTile
              theme={theme}
              value={weeklySummary.bestDay ? String(Math.round((weeklySummary.bestDay.score || 0) * 10) / 10) : '0'}
              label={`Best Day (${weeklySummary.bestDay ? weeklySummary.bestDay.dayName : '-'})`}
            />
          </View>
          <Segmented theme={theme} value={range} onChange={setRange} options={RANGE_TABS} accessibilityLabel="Chart range" />
          <GlassCard theme={theme} style={{ padding: SPACING.md, marginTop: SPACING.md }}>
            <FlowStateArea theme={theme} series={series} flowStateColor={flowStateColor} onDayPress={openDay} />
          </GlassCard>
        </View>
      )
    }

    if (tab === 'stacked') {
      return (
        <View>
          <Segmented theme={theme} value={range} onChange={setRange} options={RANGE_TABS} accessibilityLabel="Stacked chart range" />
          <GlassCard theme={theme} style={{ padding: SPACING.md, marginTop: SPACING.md }}>
            <StackedCategoryBars
              theme={theme}
              series={series}
              tasksByDate={tasksByDate}
              categories={categories}
              scoreCache={scoreCache}
              onDayPress={openDay}
            />
          </GlassCard>
        </View>
      )
    }

    // heatmap
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, marginBottom: SPACING.md }}>
          <IconBtn name="chevron-left" color={theme.textSecondary} onPress={() => setHeatmapYear(y => y - 1)} accessibilityLabel="Previous year" />
          <Text style={{ color: theme.textPrimary, fontSize: 18, fontWeight: '800' }}>{heatmapYear}</Text>
          <IconBtn name="chevron-right" color={theme.textSecondary} onPress={() => setHeatmapYear(y => y + 1)} accessibilityLabel="Next year" />
        </View>
        <GlassCard theme={theme} style={{ padding: SPACING.md }}>
          <HeatmapGrid theme={theme} cells={heatmapCells} onDayPress={openDay} />
        </GlassCard>
        <Text style={{ color: theme.textMuted, marginTop: SPACING.sm, ...TYPE.caption, textAlign: 'center' }}>
          Mode: {settings.heatmapMode === 'count' ? 'task count' : 'score'} — change it in Settings → Scoring
        </Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <TopAppBar
        theme={theme}
        title="Reviews"
        subtitle={state.status === 'ready' ? 'same data, same scores as the desktop' : state.status}
      />
      <ScrollView
        contentContainerStyle={{
          padding: SPACING.lg,
          paddingBottom: insets.bottom + 120
        }}
      >
        <Segmented theme={theme} value={tab} onChange={setTab} options={REVIEW_TABS} accessibilityLabel="Review section" />
        <View style={{ marginTop: SPACING.md }}>{renderTab()}</View>
      </ScrollView>

      <DayDetailDialog
        theme={theme}
        date={dayDetail}
        tasks={tasks}
        difficulties={difficulties}
        categories={categories}
        onOpenTask={task => {
          setDayDetail(null)
          setTaskDetail(task)
        }}
        onClose={() => setDayDetail(null)}
      />

      <TaskDetailDialog
        theme={theme}
        task={taskDetail}
        difficulties={difficulties}
        categories={categories}
        onSave={handleSaveCompletion}
        onEditDate={task => {
          setTaskDetail(null)
          setTaskToEditDate(task)
        }}
        onDelete={handleDeleteCompleted}
        onClose={() => setTaskDetail(null)}
      />

      <EditDateDialog theme={theme} task={taskToEditDate} onSave={handleSaveDate} onClose={() => setTaskToEditDate(null)} />

      <Snackbar theme={theme} message={snack} onDone={() => setSnack(null)} />
    </View>
  )
}

function labelStyle(theme) {
  return {
    color: theme.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8
  }
}
