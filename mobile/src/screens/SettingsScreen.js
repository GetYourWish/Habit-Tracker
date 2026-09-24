// SettingsScreen — Android equivalent of desktop Settings.jsx. v1.0.9
// brings the mobile settings to FULL desktop parity: the desktop's tabs
// (Data, Difficulties, Categories, Appearance, Calendar, Scoring, Logs,
// Dashboard) all exist here as sections. Every write goes through
// store.mutate → rebase → no-change-no-write, so settings edits sync to
// the desktop like any other mutation (both apps edit the same settings
// object in habit.json).
//
// Desktop-only controls are deliberately NOT mirrored: the multi-select
// keyboard modifier and the window app-icon picker have no meaning on a
// touch device. Everything else — theme, flow-state color, marker spacing,
// difficulties, categories (incl. priority multipliers), week start,
// fatigue scoring, heatmap mode, completion logs, dashboard card
// visibility — is here.

import React, { useEffect, useState, useCallback } from 'react'
import { View, Text, ScrollView, TextInput, Switch, Pressable, Alert } from 'react-native'
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  TopAppBar,
  GlassCard,
  FilledButton,
  TextButton,
  SettingsRow,
  Segmented,
  IconBtn,
  Dialog,
  Snackbar
} from '../components/ui.js'
import { inputStyle } from '../components/dialogs.js'
import { updateSettings, addDifficulty, updateDifficulty, moveDifficulty, addCategory, updateCategory, moveCategory, clearLogs } from '../actions.js'
import { SPACING, TYPE, ACCENTS } from '../theme.js'
// Bundled app.json — the version of the JS bundle actually running (the
// native versionName can be stale when the apk was rebuilt via gradlew on an
// old prebuild folder, as the 2026-09-17 crash report proved).
import appJson from '../../app.json'

const APP_VERSION = appJson.expo.version || ''

const HEX_RE = /^#[0-9a-fA-F]{6}$/

// The desktop's picker palette — the swatches a desktop color input offers,
// surfaced as tappable chips.
const COLOR_SWATCHES = [
  '#4ade80', '#22c55e', '#16a34a', '#fbbf24', '#f97316',
  '#ef4444', '#dc2626', '#f472b6', '#8b5cf6', '#7c3aed',
  '#60a5fa', '#3b82f6', '#2563eb', '#14b8a6', '#64748b',
  '#0f172a', '#ffffff', '#9ca3af'
]

const DASHBOARD_CARDS = [
  { id: 'avgDifficulty', label: 'Avg Difficulty' },
  { id: 'pointsPerTask', label: 'Points Per Task' },
  { id: 'intensityTrend', label: 'Intensity Trend' },
  { id: 'trueVsEffort', label: 'True vs Effort' },
  { id: 'bestPeriods', label: 'Best Periods' },
  { id: 'streaks', label: 'Streaks' },
  { id: 'importantStreak', label: 'Important Streak' },
  { id: 'heaviestLift', label: 'Heaviest Lift' },
  { id: 'balanceDays', label: 'Balance Days' },
  { id: 'activeDays', label: 'Active Days' },
  { id: 'focusDepth', label: 'Focus Depth' },
  { id: 'weekdayBars', label: 'Weekday Bars' },
  { id: 'shelfTime', label: 'Shelf Time' },
  { id: 'powerHours', label: 'Power Hours' },
  { id: 'difficultyMix', label: 'Difficulty Mix' },
  { id: 'categoryDonut', label: 'Category Donut' },
  { id: 'topDifficulty', label: 'Top Difficulty' },
  { id: 'alignment', label: 'Alignment' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'quietNudge', label: 'Quiet Nudge' }
]

function SectionCard({ theme, title, children }) {
  return (
    <GlassCard theme={theme} style={{ padding: SPACING.lg, marginBottom: SPACING.md }}>
      <Text style={{ color: theme.textSecondary, ...TYPE.sectionTitle, marginBottom: SPACING.sm }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </GlassCard>
  )
}

// --- color picker dialog (desktop <input type="color">) ------------------------

function ColorPickerDialog({ theme, visible, title, value, onSave, onClose }) {
  const [hex, setHex] = useState(value || '#8b5cf6')
  useEffect(() => {
    if (visible) setHex(value || '#8b5cf6')
  }, [visible, value])

  return (
    <Dialog
      theme={theme}
      visible={visible}
      title={title || 'Pick a color'}
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <TextButton theme={theme} label="Save" disabled={!HEX_RE.test(hex.trim())} onPress={() => onSave(hex.trim())} />
        </>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md }}>
        {COLOR_SWATCHES.map(c => (
          <Pressable
            key={c}
            onPress={() => setHex(c)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: c,
              borderWidth: hex.toLowerCase() === c ? 3 : 1,
              borderColor: hex.toLowerCase() === c ? theme.flowState : theme.border
            }}
            accessibilityLabel={`Color ${c}`}
            accessibilityRole="button"
          />
        ))}
      </View>
      <TextInput
        style={inputStyle(theme)}
        value={hex}
        onChangeText={setHex}
        placeholder="#8b5cf6"
        placeholderTextColor={theme.textMuted}
        maxLength={7}
        autoCapitalize="none"
      />
      {!HEX_RE.test(hex.trim()) ? (
        <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 4 }}>
          Use the #RRGGBB format.
        </Text>
      ) : null}
    </Dialog>
  )
}

// --- difficulty row (desktop difficulties-list item) ---------------------------

function DifficultyRow({ theme, difficulty, index, count, onPatch, onMove, onPickColor }) {
  const [label, setLabel] = useState(difficulty.label)
  const [score, setScore] = useState(String(difficulty.score))
  useEffect(() => {
    setLabel(difficulty.label)
    setScore(String(difficulty.score))
  }, [difficulty.label, difficulty.score])

  const commitLabel = () => {
    const t = label.trim()
    if (t && t !== difficulty.label) onPatch({ label: t })
  }
  const commitScore = () => {
    const v = parseFloat(score)
    if (Number.isFinite(v) && v >= 0 && v !== difficulty.score) onPatch({ score: v })
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 }}>
      <Pressable
        onPress={() => onPickColor(difficulty)}
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: difficulty.color,
          borderWidth: 1,
          borderColor: theme.border
        }}
        accessibilityLabel={`Pick color for ${difficulty.label}`}
        accessibilityRole="button"
      />
      <TextInput
        style={[inputStyle(theme), { flex: 1, paddingVertical: 6 }]}
        value={label}
        onChangeText={setLabel}
        onEndEditing={commitLabel}
        placeholder="Label"
        placeholderTextColor={theme.textMuted}
        returnKeyType="done"
      />
      <TextInput
        style={[inputStyle(theme), { width: 64, paddingVertical: 6 }]}
        value={score}
        onChangeText={setScore}
        onEndEditing={commitScore}
        keyboardType="decimal-pad"
        placeholder="1"
        placeholderTextColor={theme.textMuted}
      />
      <View style={{ flexDirection: 'row' }}>
        <IconBtn
          name="chevron-up"
          size={19}
          color={theme.textSecondary}
          disabled={index === 0}
          onPress={() => onMove('up')}
          accessibilityLabel={`Move ${difficulty.label} up`}
        />
        <IconBtn
          name="chevron-down"
          size={19}
          color={theme.textSecondary}
          disabled={index === count - 1}
          onPress={() => onMove('down')}
          accessibilityLabel={`Move ${difficulty.label} down`}
        />
      </View>
      <Switch
        value={difficulty.active !== false}
        onValueChange={v => onPatch({ active: v })}
        trackColor={{ true: theme.flowState, false: theme.bgTertiary }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

// --- category row (desktop categories-list item) -------------------------------

function CategoryRow({ theme, category, index, count, onPatch, onMove, onPickColor }) {
  const [name, setName] = useState(category.name)
  const [mult, setMult] = useState(String(category.priorityMultiplier ?? 1))
  useEffect(() => {
    setName(category.name)
    setMult(String(category.priorityMultiplier ?? 1))
  }, [category.name, category.priorityMultiplier])

  const commitName = () => {
    const t = name.trim()
    if (t && t !== category.name) onPatch({ name: t })
  }
  const commitMult = () => {
    const v = parseFloat(mult)
    if (Number.isFinite(v) && v >= 0 && v !== (category.priorityMultiplier ?? 1)) {
      onPatch({ priorityMultiplier: v })
    }
  }

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 6 }}>
      <Pressable
        onPress={() => onPickColor(category)}
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          backgroundColor: category.color,
          borderWidth: 1,
          borderColor: theme.border
        }}
        accessibilityLabel={`Pick color for ${category.name}`}
        accessibilityRole="button"
      />
      <TextInput
        style={[inputStyle(theme), { flex: 1, paddingVertical: 6 }]}
        value={name}
        onChangeText={setName}
        onEndEditing={commitName}
        placeholder="Name"
        placeholderTextColor={theme.textMuted}
        returnKeyType="done"
      />
      <TextInput
        style={[inputStyle(theme), { width: 64, paddingVertical: 6 }]}
        value={mult}
        onChangeText={setMult}
        onEndEditing={commitMult}
        keyboardType="decimal-pad"
        placeholder="1.0"
        placeholderTextColor={theme.textMuted}
      />
      <View style={{ flexDirection: 'row' }}>
        <IconBtn
          name="chevron-up"
          size={19}
          color={theme.textSecondary}
          disabled={index === 0}
          onPress={() => onMove('up')}
          accessibilityLabel={`Move ${category.name} up`}
        />
        <IconBtn
          name="chevron-down"
          size={19}
          color={theme.textSecondary}
          disabled={index === count - 1}
          onPress={() => onMove('down')}
          accessibilityLabel={`Move ${category.name} down`}
        />
      </View>
      <Switch
        value={category.active !== false}
        onValueChange={v => onPatch({ active: v })}
        trackColor={{ true: theme.flowState, false: theme.bgTertiary }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

// --- the screen -------------------------------------------------------------------

export function SettingsScreen({
  theme,
  state,
  store,
  folderUri,
  autoSync,
  onSetAutoSync,
  onPickFolder,
  onShowSnack,
  themeValue,
  onThemeChange
}) {
  const insets = useSafeAreaInsets()
  const data = state.data
  const settings = data?.settings || {}
  const difficulties = data?.difficulties || []
  const categories = data?.categories || []
  const logs = data?.logs || []
  const [snack, setSnack] = useState(null)
  const [logFilter, setLogFilter] = useState('all')
  const [pickingColor, setPickingColor] = useState(null) // { kind:'difficulty'|'category'|'flowState', item }
  const [confirmingClearLogs, setConfirmingClearLogs] = useState(false)

  const [fatigueIncrement, setFatigueIncrement] = useState('')
  const [fatigueCap, setFatigueCap] = useState('')
  const [markerSpacing, setMarkerSpacing] = useState('')
  useEffect(() => {
    setFatigueIncrement(String(settings.fatigueIncrement ?? 0.10))
    setFatigueCap(String(settings.fatigueCap ?? 3.0))
    const px = parseInt(String(settings.consecutiveMarkerMargin || '150px'), 10)
    setMarkerSpacing(String(Number.isFinite(px) ? px : 150))
  }, [settings.fatigueIncrement, settings.fatigueCap, settings.consecutiveMarkerMargin])

  const run = useCallback(
    async buildNext => {
      try {
        await store.mutate(buildNext)
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

  // Optimistic theme change: App applies the override instantly; we only
  // surface failures here (the override is rolled back by the App).
  const handleThemeTap = useCallback(
    value => {
      if (!onThemeChange) {
        run((d, now) => updateSettings(d, { theme: value }, now))
        return
      }
      Promise.resolve(onThemeChange(value)).catch(e =>
        setSnack('Save failed: ' + ((e && e.message) || e))
      )
    },
    [onThemeChange, run]
  )

  const commitNumber = (key, raw, fallback, parse) => {
    if (raw.trim() === '') return
    const value = parse(raw.trim())
    if (!Number.isFinite(value) || value === settings[key]) return
    run((d, now) => updateSettings(d, { [key]: value }, now))
  }

  const commitMarkerSpacing = () => {
    const v = parseInt(markerSpacing, 10)
    if (!Number.isFinite(v) || v < 0) return
    const next = `${Math.min(v, 500)}px`
    if (next === settings.consecutiveMarkerMargin) return
    run((d, now) => updateSettings(d, { consecutiveMarkerMargin: next }, now))
  }

  const handleBackupNow = async () => {
    try {
      await store.backupNow()
      setSnack('Backup saved to the app’s private .backups folder')
    } catch (e) {
      setSnack('Backup failed: ' + (e.message || e))
    }
  }

  const handleChangeFolder = () => {
    Alert.alert(
      'Change data folder',
      'Pick the Syncthing folder that contains habit.json. The app will reload from it — nothing is moved or deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Choose folder', onPress: () => onPickFolder().catch(e => setSnack('Folder pick failed: ' + (e.message || e))) }
      ]
    )
  }

  const filteredLogs = React.useMemo(() => {
    const sorted = [...logs].reverse() // newest first
    if (logFilter === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10)
      return sorted.filter(l => (l.timestamp || '').slice(0, 10) === todayStr)
    }
    if (logFilter === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return sorted.filter(l => new Date(l.timestamp) >= weekAgo)
    }
    return sorted
  }, [logs, logFilter])

  const themeSelection = themeValue || settings.theme || 'system'
  const flowStateColor = settings.flowStateColor || ACCENTS.flowState

  const savePickedColor = hex => {
    const target = pickingColor
    setPickingColor(null)
    if (!target) return
    if (target.kind === 'flowState') {
      if (hex !== settings.flowStateColor) {
        run((d, now) => updateSettings(d, { flowStateColor: hex }, now))
      }
      return
    }
    if (target.kind === 'difficulty') {
      run((d, now) => updateDifficulty(d, target.item.id, { color: hex }, now))
    } else if (target.kind === 'category') {
      run((d, now) => updateCategory(d, target.item.id, { color: hex }, now))
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <TopAppBar theme={theme} title="Settings" subtitle={state.status === 'ready' ? 'habit.json loaded' : state.status} />
      <ScrollView
        contentContainerStyle={{
          padding: SPACING.lg,
          paddingBottom: insets.bottom + 120
        }}
      >
        {/* Sync (desktop Data tab) */}
        <SectionCard theme={theme} title="Sync">
          <SettingsRow
            theme={theme}
            icon="folder-sync-outline"
            label="Data folder"
            hint={folderUri || 'Not selected'}
            control={<TextButton theme={theme} label="Change" onPress={handleChangeFolder} />}
          />
          <SettingsRow
            theme={theme}
            icon="autorenew"
            label="Auto-sync (poll every 15 s)"
            hint="Also refreshes when the app returns to the foreground"
            control={
              <Switch
                value={autoSync}
                onValueChange={onSetAutoSync}
                trackColor={{ true: theme.flowState, false: theme.bgTertiary }}
                thumbColor="#ffffff"
              />
            }
          />
          <SettingsRow
            theme={theme}
            icon="content-save-cog-outline"
            label="Backup now"
            hint="Copies the current file into the app’s private .backups (last 20 kept)"
            control={<TextButton theme={theme} label="Backup" onPress={handleBackupNow} />}
          />
          <SettingsRow
            theme={theme}
            icon="alert-octagon-outline"
            label="Sync conflicts"
            hint={
              state.conflicts.length > 0
                ? `${state.conflicts.length} conflict copy(ies) in the folder — resolve them in Syncthing; the app never loads or deletes them automatically`
                : 'None detected'
            }
          />
        </SectionCard>

        {/* Difficulties (desktop Difficulties tab) */}
        <SectionCard theme={theme} title="Difficulties">
          <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.caption }}>
            Changing scores will recalculate all historical data.
          </Text>
          {difficulties.map((d, i) => (
            <DifficultyRow
              key={d.id}
              theme={theme}
              difficulty={d}
              index={i}
              count={difficulties.length}
              onPatch={patch => run((data2, now) => updateDifficulty(data2, d.id, patch, now))}
              onMove={dir => run((data2, now) => moveDifficulty(data2, d.id, dir, now))}
              onPickColor={item => setPickingColor({ kind: 'difficulty', item })}
            />
          ))}
          <TextButton
            theme={theme}
            label="+ Add Difficulty"
            onPress={() => run((d, now) => addDifficulty(d, now))}
          />
        </SectionCard>

        {/* Categories (desktop Categories tab) */}
        <SectionCard theme={theme} title="Categories">
          <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.caption }}>
            Priority multiplier: tasks in a category with a 2x multiplier earn double points. Default 1.0.
          </Text>
          {categories.map((c, i) => (
            <CategoryRow
              key={c.id}
              theme={theme}
              category={c}
              index={i}
              count={categories.length}
              onPatch={patch => run((data2, now) => updateCategory(data2, c.id, patch, now))}
              onMove={dir => run((data2, now) => moveCategory(data2, c.id, dir, now))}
              onPickColor={item => setPickingColor({ kind: 'category', item })}
            />
          ))}
          <TextButton
            theme={theme}
            label="+ Add Category"
            onPress={() => run((d, now) => addCategory(d, now))}
          />
        </SectionCard>

        {/* Appearance (desktop Appearance tab — mobile-relevant controls) */}
        <SectionCard theme={theme} title="Appearance">
          <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.sm }}>Theme</Text>
          <Segmented
            theme={theme}
            value={themeSelection}
            onChange={handleThemeTap}
            options={[
              { label: 'System', value: 'system' },
              { label: 'Light', value: 'light' },
              { label: 'Dark', value: 'dark' }
            ]}
          />
          <Text style={{ color: theme.textMuted, marginTop: SPACING.sm, ...TYPE.caption }}>
            Applies instantly; saved to habit.json like every other change.
          </Text>

          <SettingsRow
            theme={theme}
            icon="tune-vertical"
            label="Flow State color"
            hint="Working-on highlight, Flow State chart and today's working-on count"
            control={
              <Pressable
                onPress={() => setPickingColor({ kind: 'flowState' })}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: flowStateColor,
                  borderWidth: 1,
                  borderColor: theme.border
                }}
                accessibilityLabel="Pick the Flow State color"
                accessibilityRole="button"
              />
            }
          />

          <View style={{ marginTop: SPACING.md }}>
            <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.sm }}>
              Consecutive marker spacing
            </Text>
            <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
              <TextInput
                style={[inputStyle(theme), { flex: 1 }]}
                value={markerSpacing}
                onChangeText={setMarkerSpacing}
                onEndEditing={commitMarkerSpacing}
                keyboardType="number-pad"
                placeholder="150"
                placeholderTextColor={theme.textMuted}
              />
              <Text style={{ color: theme.textSecondary, ...TYPE.secondary }}>px</Text>
            </View>
            <Text style={{ color: theme.textMuted, marginTop: SPACING.sm, ...TYPE.caption }}>
              Extra space inserted above a category marker that directly follows another marker on the board (default: 150px).
            </Text>
          </View>
        </SectionCard>

        {/* Calendar (desktop Calendar tab) */}
        <SectionCard theme={theme} title="Calendar">
          <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.sm }}>Week starts on</Text>
          <Segmented
            theme={theme}
            value={settings.weekStartsOn ?? 1}
            onChange={value => run((d, now) => updateSettings(d, { weekStartsOn: value }, now))}
            options={[
              { label: 'Monday', value: 1 },
              { label: 'Sunday', value: 0 }
            ]}
          />
        </SectionCard>

        {/* Scoring (desktop Scoring tab) */}
        <SectionCard theme={theme} title="Scoring">
          <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.caption }}>
            score(task i) = base × min(1.0 + i × increment, cap) × category multiplier — shared with the desktop via @habit-tracker/core.
          </Text>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textSecondary, ...TYPE.secondary, marginBottom: 6 }}>
                Fatigue increment
              </Text>
              <TextInput
                style={inputStyle(theme)}
                value={fatigueIncrement}
                onChangeText={setFatigueIncrement}
                onEndEditing={() => commitNumber('fatigueIncrement', fatigueIncrement, 0.10, parseFloat)}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.textSecondary, ...TYPE.secondary, marginBottom: 6 }}>Fatigue cap</Text>
              <TextInput
                style={inputStyle(theme)}
                value={fatigueCap}
                onChangeText={setFatigueCap}
                onEndEditing={() => commitNumber('fatigueCap', fatigueCap, 3.0, parseFloat)}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={{ marginTop: SPACING.lg }}>
            <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.sm }}>
              Heatmap mode
            </Text>
            <Segmented
              theme={theme}
              value={settings.heatmapMode || 'score'}
              onChange={value => run((d, now) => updateSettings(d, { heatmapMode: value }, now))}
              options={[
                { label: 'Score', value: 'score' },
                { label: 'Task Count', value: 'count' }
              ]}
            />
            <Text style={{ color: theme.textMuted, marginTop: SPACING.sm, ...TYPE.caption }}>
              What the Reviews heatmap grid measures per day.
            </Text>
          </View>
        </SectionCard>

        {/* Logs (desktop Logs tab) */}
        <SectionCard theme={theme} title="Logs">
          <View style={{ marginBottom: SPACING.md }}>
            <Segmented
              theme={theme}
              value={logFilter}
              onChange={setLogFilter}
              options={[
                { label: 'All', value: 'all' },
                { label: 'Today', value: 'today' },
                { label: 'This Week', value: 'week' }
              ]}
              accessibilityLabel="Log filter"
            />
          </View>
          <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.caption }}>
            Each task completion is logged with its full score calculation. Logs are capped at 500 entries.
          </Text>
          {filteredLogs.length === 0 ? (
            <Text style={{ color: theme.textMuted, ...TYPE.secondary }}>No completions logged yet.</Text>
          ) : (
            <View style={{ gap: SPACING.sm }}>
              {filteredLogs.map(log => (
                <View key={log.id} style={{ backgroundColor: theme.rowFill, borderRadius: 10, padding: SPACING.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.sm }}>
                    <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, flex: 1 }} numberOfLines={2}>
                      {log.taskText}
                    </Text>
                    <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong }}>
                      {log.finalScore} pts
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <Text style={{ color: theme.textMuted, ...TYPE.caption }}>
                      {new Date(log.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                      {new Date(log.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    <View style={{ backgroundColor: (log.difficultyColor || '#999') + '22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, borderWidth: 1, borderColor: log.difficultyColor || '#999' }}>
                      <Text style={{ color: log.difficultyColor || theme.textSecondary, fontSize: 11 }}>
                        {log.difficultyLabel}
                      </Text>
                    </View>
                    {log.categoryName ? (
                      <View style={{ backgroundColor: (log.categoryColor || '#999') + '22', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, borderWidth: 1, borderColor: log.categoryColor || '#999' }}>
                        <Text style={{ color: log.categoryColor || theme.textSecondary, fontSize: 11 }}>
                          {log.categoryName}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: theme.textMuted, marginTop: 6, fontSize: 11.5 }}>
                    {log.basePoints} (base)
                    {log.fatigueMultiplier !== 1 ? ` × ${log.fatigueMultiplier.toFixed(2)} (fatigue)` : ''}
                    {log.priorityMultiplier !== 1 ? ` × ${log.priorityMultiplier.toFixed(1)} (priority)` : ''}
                    {' = '}
                    <Text style={{ color: theme.textSecondary, fontWeight: '700' }}>{log.finalScore}</Text>
                  </Text>
                </View>
              ))}
            </View>
          )}
          <FilledButton
            theme={theme}
            label="Clear Logs"
            icon="delete-sweep-outline"
            destructive
            disabled={logs.length === 0}
            onPress={() => setConfirmingClearLogs(true)}
            style={{ marginTop: SPACING.md }}
          />
        </SectionCard>

        {/* Dashboard cards (desktop Dashboard tab) */}
        <SectionCard theme={theme} title="Dashboard Cards">
          <Text style={{ color: theme.textMuted, marginBottom: SPACING.md, ...TYPE.caption }}>
            Toggle visibility of cards on the Reviews → Dashboard cockpit (shared with the desktop).
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md }}>
            {DASHBOARD_CARDS.map(c => {
              const dash = settings.dashboard || {}
              const checked = dash[c.id] !== false
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    run((d, now) =>
                      updateSettings(d, { dashboard: { ...(d.settings && d.settings.dashboard ? d.settings.dashboard : {}), [c.id]: !checked } }, now)
                    )
                  }
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    backgroundColor: theme.rowFill,
                    borderRadius: 999,
                    paddingHorizontal: SPACING.md,
                    paddingVertical: 8
                  }}
                  accessibilityLabel={`${c.label} card ${checked ? 'visible' : 'hidden'}`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked }}
                >
                  <Icon
                    name={checked ? 'checkbox-outline' : 'checkbox-blank-outline'}
                    size={18}
                    color={checked ? theme.flowState : theme.textMuted}
                  />
                  <Text style={{ color: theme.textSecondary, ...TYPE.caption }}>{c.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </SectionCard>

        {/* About */}
        <SectionCard theme={theme} title="About">
          <SettingsRow
            theme={theme}
            icon="information-outline"
            label="Version"
            hint={`v${APP_VERSION} (js bundle) — schemaVersion 1 supported`}
          />
          <SettingsRow
            theme={theme}
            icon="file-document-outline"
            label="Data file"
            hint="habit.json — written atomically (tmp + verify), heals only when needed, never rewrites unchanged content"
          />
          <SettingsRow
            theme={theme}
            icon="cellphone-link"
            label="Desktop companion"
            hint="Same file, same scores — every rule lives in @habit-tracker/core"
          />
        </SectionCard>

        <FilledButton
          theme={theme}
          label="Reload from disk"
          icon="refresh"
          onPress={() => store.load().catch(() => {})}
          style={{ marginTop: SPACING.sm }}
        />
      </ScrollView>

      <ColorPickerDialog
        theme={theme}
        visible={!!pickingColor}
        title={
          pickingColor && pickingColor.kind === 'flowState'
            ? 'Flow State color'
            : pickingColor && pickingColor.item
              ? `Color — ${pickingColor.item.label || pickingColor.item.name || ''}`
              : 'Pick a color'
        }
        value={
          pickingColor && pickingColor.kind === 'flowState'
            ? flowStateColor
            : pickingColor && pickingColor.item
              ? pickingColor.item.color
              : '#8b5cf6'
        }
        onSave={savePickedColor}
        onClose={() => setPickingColor(null)}
      />

      <Dialog
        theme={theme}
        visible={confirmingClearLogs}
        title="Clear all completion logs?"
        onClose={() => setConfirmingClearLogs(false)}
        actions={
          <>
            <TextButton theme={theme} label="Cancel" onPress={() => setConfirmingClearLogs(false)} />
            <TextButton
              theme={theme}
              label="Clear Logs"
              destructive
              onPress={() => {
                setConfirmingClearLogs(false)
                run((d, now) => clearLogs(d, now))
              }}
            />
          </>
        }
      >
        <Text style={{ color: theme.textSecondary, ...TYPE.body }}>
          This removes the completion history shown here and on the desktop's Logs tab. Task completions themselves are kept — only the log entries go away. This cannot be undone.
        </Text>
      </Dialog>

      <Snackbar theme={theme} message={snack} onDone={() => setSnack(null)} />
    </View>
  )
}
