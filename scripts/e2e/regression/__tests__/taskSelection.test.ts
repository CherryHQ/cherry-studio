import { describe, expect, it } from 'vitest'

import { caseGrep, parseTaskSelection, resolveWorkflowTasks, selectCases } from '../cases'

describe('combined regression tasks', () => {
  it('isolates provider setup, prompt polishing and browser recovery from their broader modules', () => {
    expect(
      selectCases(parseTaskSelection('custom-provider-chat,polish-prompts,browser-recovery')).map(({ id }) => id)
    ).toEqual(['M-02', 'MP-16', 'MP-125'])
  })

  it('executes overlapping selections once in manifest order', () => {
    const selection = parseTaskSelection(' notes-smoke, startup-smoke ,notes-smoke ')
    expect(selectCases(selection).map(({ id }) => id)).toEqual(['S-01', 'N-01'])
    expect(selectCases(selection, 'basicFeatures').map(({ id }) => id)).toEqual(['N-01'])
    const grep = new RegExp(caseGrep(selection)!)
    expect(grep.test('[S-01] Application startup smoke test')).toBe(true)
    expect(grep.test('[N-01] Create and save a note')).toBe(true)
    expect(grep.test('[N-010] Different scenario')).toBe(false)
    expect(grep.test('[MP-11] Notes and export')).toBe(false)
  })

  it.each(['', 'notes,', 'unknown', 'notes,unknown', 'all,notes'])(
    'rejects invalid selection %j before allocating desktop runners',
    (value) => expect(() => parseTaskSelection(value)).toThrow()
  )

  it('selects the two migrated settings search cases without adding standalone smoke', () => {
    const selection = parseTaskSelection('settings-search')
    const caseIds = ['SET-01', 'SET-02']
    expect(selectCases(selection, 'settings').map(({ id }) => id)).toEqual(caseIds)
    for (const task of ['settings', 'all'] as const) {
      expect(selectCases(task, 'settings').map(({ id }) => id)).toEqual(expect.arrayContaining(caseIds))
    }
    expect(resolveWorkflowTasks({ task: 'settings-search', suite: 'regression' })).toEqual({
      task: 'settings-search',
      regression: 'true',
      prepare_mcp: 'false',
      smoke: 'none'
    })
  })

  it('prepares Everything when it is part of a combined selection', () => {
    expect(resolveWorkflowTasks({ suite: 'regression', task: 'chat-core,mcp-skills' })).toEqual({
      task: 'chat-core,mcp-skills',
      regression: 'true',
      prepare_mcp: 'true',
      smoke: 'none'
    })
  })

  it.each([
    ['branch', {}, 'all', 'true', 'true', 'all'],
    ['branch', { task: 'notes-smoke' }, 'notes-smoke', 'true', 'false', 'all'],
    ['branch', { suite: 'regression' }, 'all', 'true', 'true', 'none'],
    ['branch', { suite: 'smoke', task: 'not-a-task' }, 'all', 'false', 'false', 'all'],
    ['tag', {}, 'all', 'true', 'true', 'none'],
    ['tag', { suite: 'regression', task: 'notes-smoke' }, 'notes-smoke', 'true', 'false', 'none']
  ] as const)('resolves %s inputs %j to the requested suites', (mode, inputs, task, regression, prepare_mcp, smoke) => {
    expect(resolveWorkflowTasks(inputs, mode)).toEqual({ task, regression, prepare_mcp, smoke })
  })

  it('rejects unknown suites and standalone smoke for installers before runner allocation', () => {
    expect(() => resolveWorkflowTasks({ suite: 'unknown' })).toThrow('Invalid E2E suite')
    expect(() => resolveWorkflowTasks({ suite: 'smoke' }, 'tag')).toThrow('Standalone smoke requires a branch checkout')
  })
})
