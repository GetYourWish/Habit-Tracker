// dialogs.js — Material dialogs for the board flows. Every confirmation
// writes through the same desktop-identical data paths (actions.js).

import React, { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable } from 'react-native'
import { Dialog, TextButton, FilledButton } from './ui.js'
import { getCurrentDate } from '@habit-tracker/core'
import { SPACING, TYPE } from '../theme.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function inputStyle(theme) {
  return {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    color: theme.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    backgroundColor: theme.bgSecondary
  }
}

// Add / edit task text (desktop: header input + inline row editing)
export function TaskTextDialog({ theme, visible, title, initialText = '', onSubmit, onClose }) {
  const [text, setText] = useState(initialText)
  useEffect(() => {
    if (visible) setText(initialText)
  }, [visible, initialText])

  function submit() {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <Dialog
      theme={theme}
      visible={visible}
      title={title}
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <TextButton theme={theme} label="Save" onPress={submit} disabled={!text.trim()} />
        </>
      }
    >
      <TextInput
        style={inputStyle(theme)}
        value={text}
        onChangeText={setText}
        placeholder="What needs to be done?"
        placeholderTextColor={theme.textMuted}
        autoFocus
        multiline
        onSubmitEditing={submit}
        returnKeyType="done"
        blurOnSubmit
      />
    </Dialog>
  )
}

// Complete flow — desktop CompletionPopup parity: difficulty chips, local
// calendar date (editable), optional note (max 500).
export function CompleteDialog({ theme, task, difficulties, onConfirm, onClose }) {
  const [difficultyId, setDifficultyId] = useState(null)
  const [date, setDate] = useState(getCurrentDate())
  const [note, setNote] = useState('')

  useEffect(() => {
    if (task) {
      setDifficultyId(null)
      setDate(getCurrentDate())
      setNote('')
    }
  }, [task])

  const activeDifficulties = (difficulties || []).filter(d => d.active !== false)
  const dateValid = DATE_RE.test(date.trim())

  return (
    <Dialog
      theme={theme}
      visible={!!task}
      title="Complete task"
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <FilledButton
            theme={theme}
            label="Complete"
            onPress={() => onConfirm({ difficultyId, date: date.trim(), note })}
            disabled={!difficultyId || !dateValid}
            style={{ minWidth: 110 }}
          />
        </>
      }
    >
      <Text style={{ color: theme.textPrimary, ...TYPE.bodyStrong, marginBottom: SPACING.md }} numberOfLines={3}>
        {String(task?.text ?? '')}
      </Text>

      <Text style={styles.label(theme)}>Difficulty</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.lg }}>
        {activeDifficulties.map(d => {
          const selected = difficultyId === d.id
          return (
            <Pressable
              key={d.id}
              onPress={() => setDifficultyId(d.id)}
              android_ripple={{ color: theme.ripple }}
              style={({ pressed }) => ({
                borderWidth: 1.5,
                borderColor: d.color,
                backgroundColor: selected ? d.color : 'transparent',
                opacity: pressed && !selected ? 0.75 : 1,
                borderRadius: 999,
                paddingHorizontal: SPACING.md,
                paddingVertical: 7
              })}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <Text style={{ color: selected ? '#ffffff' : d.color, fontWeight: '700', fontSize: 13.5, letterSpacing: 0.2 }}>
                {d.label} ({d.score})
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.label(theme)}>Date completed</Text>
      <View style={{ flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' }}>
        <TextInput
          style={[inputStyle(theme), { flex: 1 }]}
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={theme.textMuted}
          maxLength={10}
          inputMode="numeric"
        />
        <TextButton theme={theme} label="Today" onPress={() => setDate(getCurrentDate())} />
      </View>
      {!dateValid ? (
        <Text style={{ color: theme.danger, fontSize: 12.5, marginTop: 4 }}>
          Use the YYYY-MM-DD format.
        </Text>
      ) : null}

      <Text style={[styles.label(theme), { marginTop: SPACING.md }]}>Note (optional)</Text>
      <TextInput
        style={[inputStyle(theme), { minHeight: 72, textAlignVertical: 'top' }]}
        value={note}
        onChangeText={setNote}
        placeholder="Add a short note…"
        placeholderTextColor={theme.textMuted}
        multiline
        maxLength={500}
      />
    </Dialog>
  )
}

// Delete confirmation — desktop delete popup parity
export function ConfirmDialog({ theme, visible, title, body, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Dialog
      theme={theme}
      visible={visible}
      title={title}
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <TextButton theme={theme} label={confirmLabel} destructive onPress={onConfirm} />
        </>
      }
    >
      <Text style={{ color: theme.textSecondary, ...TYPE.body }}>{body}</Text>
    </Dialog>
  )
}

// Category note — desktop has a view/edit popup on the "i" indicator
export function MarkerNoteDialog({ theme, visible, categoryName, initialNote = '', onSave, onClose }) {
  const [note, setNote] = useState(initialNote)
  useEffect(() => {
    if (visible) setNote(initialNote)
  }, [visible, initialNote])

  return (
    <Dialog
      theme={theme}
      visible={visible}
      title={categoryName ? `Note — ${categoryName}` : 'Category note'}
      onClose={onClose}
      actions={
        <>
          <TextButton theme={theme} label="Cancel" onPress={onClose} />
          <TextButton theme={theme} label="Save" onPress={() => onSave(note)} />
        </>
      }
    >
      <TextInput
        style={[inputStyle(theme), { minHeight: 90, textAlignVertical: 'top' }]}
        value={note}
        onChangeText={setNote}
        placeholder="Enter category note…"
        placeholderTextColor={theme.textMuted}
        multiline
        maxLength={500}
      />
    </Dialog>
  )
}

const styles = {
  label: theme => ({
    color: theme.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8
  })
}
