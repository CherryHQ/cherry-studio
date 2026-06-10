import { describe, expect, it } from 'vitest'

import {
  getTaskActiveText,
  getTaskId,
  getTaskString,
  getTaskTitle,
  isOrdinalTaskTitle,
  isTaskRecord,
  normalizeTaskLike,
  normalizeTaskStatus,
  normalizeTaskTitle
} from '../taskData'

describe('taskData', () => {
  it('recognizes record-like task values', () => {
    expect(isTaskRecord({ id: '1' })).toBe(true)
    expect(isTaskRecord(null)).toBe(false)
    expect(isTaskRecord(['1'])).toBe(false)
  })

  it('normalizes scalar values to task strings', () => {
    expect(getTaskString('  Build UI  ')).toBe('Build UI')
    expect(getTaskString(42)).toBe('42')
    expect(getTaskString(Number.NaN)).toBeUndefined()
    expect(getTaskString('   ')).toBeUndefined()
  })

  it('extracts task ids from supported id fields', () => {
    expect(getTaskId({ task_id: 'task-1' })).toBe('task-1')
    expect(getTaskId({ taskId: 7 })).toBe('7')
  })

  it('skips ordinal task titles and falls back to meaningful nested titles', () => {
    expect(isOrdinalTaskTitle('#12')).toBe(true)
    expect(normalizeTaskTitle('  Write   Tests ')).toBe('write tests')
    expect(getTaskTitle({ task: { subject: 'Implement parser' }, subject: '#1' })).toBe('Implement parser')
    expect(getTaskTitle({ subject: '#2' }, 'fallback title')).toBe('fallback title')
  })

  it('extracts active text from preferred fields', () => {
    expect(getTaskActiveText({ activeText: 'Running tests', description: 'Old text' })).toBe('Running tests')
    expect(getTaskActiveText({ activeForm: 'Editing file' })).toBe('Editing file')
  })

  it('normalizes task statuses into renderer groups', () => {
    expect(normalizeTaskStatus('pending')).toBe('pending')
    expect(normalizeTaskStatus('running')).toBe('in_progress')
    expect(normalizeTaskStatus('deleted')).toBe('completed')
    expect(normalizeTaskStatus('killed')).toBe('error')
    expect(normalizeTaskStatus('unknown')).toBeUndefined()
  })

  it('normalizes task-like records with fallback ids', () => {
    expect(
      normalizeTaskLike({ task: { description: '#3' }, activeForm: 'Reviewing', status: 'paused' }, 'task-3')
    ).toEqual({
      id: 'task-3',
      title: 'Reviewing',
      activeText: 'Reviewing',
      status: 'in_progress'
    })

    expect(normalizeTaskLike(undefined)).toBeUndefined()
    expect(normalizeTaskLike({ status: 'completed' })).toBeUndefined()
  })
})
