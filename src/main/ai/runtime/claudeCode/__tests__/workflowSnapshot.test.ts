import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AgentWorkflowSnapshot } from '@shared/ai/agentWorkflowProgress'

import {
  parseLocalWorkflowLaunch,
  parseLocalWorkflowPlan,
  resolveWorkflowSnapshotPath,
  resolveWorkflowTranscriptDir,
  updateLocalWorkflowSnapshot
} from '../workflowSnapshot'

describe('parseLocalWorkflowPlan', () => {
  it('parses escaped static fields while skipping nested template expressions', () => {
    const script = [
      "export const meta = { phases: [{ title: 'Rev\\u0069ew' }] }",
      'const ready = true',
      'await agent(`Inspect ${ready ? `nested ${value / 2}` : /}/.test(value)}`, {',
      "  label: 'review\\u{65}r',",
      "  phase: 'Rev\\u0069ew'",
      '})'
    ].join('\n')

    expect(parseLocalWorkflowPlan(script)).toEqual({
      phases: [{ title: 'Review' }],
      agents: [{ label: 'reviewer', phaseIndex: 1, phaseTitle: 'Review' }]
    })
  })

  it('ignores comments and regex literals while distinguishing division expressions', () => {
    const script = [
      'const ratio = total / count / 2',
      'const matcher = /agent\\([^)]*\\)\\/count/g',
      "// agent('comment', { label: 'ignored-line', phase: 'Ignored' })",
      "/* agent('comment', { label: 'ignored-block', phase: 'Ignored' }) */",
      "export const meta = { phases: [{ title: 'Verify' }] }",
      "await agent('Verify the result', { label: 'verifier', phase: 'Verify' })"
    ].join('\n')

    expect(parseLocalWorkflowPlan(script)).toEqual({
      phases: [{ title: 'Verify' }],
      agents: [{ label: 'verifier', phaseIndex: 1, phaseTitle: 'Verify' }]
    })
  })

  it.each([
    "export const meta = { phases: [{ title: 'Review' }]\nawait agent('x', { label: 'x', phase: 'Review' }",
    "export const meta = { phases: [{ title: 'unterminated }] }"
  ])('returns no plan for malformed input without throwing', (script) => {
    expect(() => parseLocalWorkflowPlan(script)).not.toThrow()
    expect(parseLocalWorkflowPlan(script)).toBeUndefined()
  })
})

describe('updateLocalWorkflowSnapshot', () => {
  it('does not mutate a previous snapshot while advancing a retained Agent', () => {
    const previous: AgentWorkflowSnapshot = {
      runId: 'run-1',
      taskId: 'task-1',
      phases: [{ title: 'Review' }],
      workflowProgress: [
        { type: 'workflow_phase', index: 1, title: 'Review' },
        {
          type: 'workflow_agent',
          index: 1,
          label: 'reviewer',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'pending'
        }
      ]
    }

    const next = updateLocalWorkflowSnapshot(
      { phases: [{ title: 'Review' }], agents: [] },
      { runId: 'run-1', taskId: 'task-1' },
      { status: 'in_progress', description: 'Review: reviewer' },
      previous
    )

    expect(previous.workflowProgress[1]).toMatchObject({ state: 'pending' })
    expect(next.workflowProgress[1]).toMatchObject({ state: 'running' })
  })

  it('uses Agent tool-call totals while running and the SDK total at completion', () => {
    const plan = {
      phases: [{ title: 'Review' }],
      agents: [{ label: 'reviewer', phaseIndex: 1, phaseTitle: 'Review' }]
    }
    const launch = { runId: 'run-1', taskId: 'task-1' }
    const running = updateLocalWorkflowSnapshot(plan, launch, {
      status: 'in_progress',
      usage: { toolUses: 9 },
      workflowProgress: [
        {
          type: 'workflow_agent',
          index: 1,
          label: 'reviewer',
          phaseIndex: 1,
          phaseTitle: 'Review',
          state: 'progress',
          toolCalls: 2
        }
      ]
    })

    expect(running.totalToolCalls).toBe(2)

    const completed = updateLocalWorkflowSnapshot(
      plan,
      launch,
      { status: 'completed', usage: { toolUses: 9 } },
      running
    )

    expect(completed.totalToolCalls).toBe(9)
  })

  it('keeps the earliest match and releases old aliases when Agent indexes and labels change', () => {
    const plan = {
      phases: [{ title: 'Review' }],
      agents: ['shared', 'second', 'shared', 'later'].map((label) => ({
        label,
        phaseIndex: 1,
        phaseTitle: 'Review'
      }))
    }
    const progress = (index: number, label: string, tokens: number) => ({
      type: 'workflow_agent',
      index,
      label,
      phaseIndex: 1,
      phaseTitle: 'Review',
      state: 'progress',
      tokens
    })

    const snapshot = updateLocalWorkflowSnapshot(
      plan,
      { runId: 'run-1', taskId: 'task-1' },
      {
        status: 'in_progress',
        workflowProgress: [
          progress(2, 'shared', 10),
          progress(2, 'renamed', 20),
          progress(9, 'shared', 30),
          progress(2, 'second', 40),
          progress(10, 'renamed', 50),
          progress(1, 'new', 60)
        ]
      }
    )

    const agentRows = snapshot.workflowProgress.filter((item) => item.type === 'workflow_agent')
    expect(agentRows.map(({ index, label, tokens }) => ({ index, label, tokens }))).toEqual([
      { index: 1, label: 'new', tokens: 60 },
      { index: 2, label: 'second', tokens: 40 },
      { index: 3, label: 'second', tokens: undefined },
      { index: 4, label: 'later', tokens: undefined },
      { index: 9, label: 'shared', tokens: 30 },
      { index: 10, label: 'renamed', tokens: 50 }
    ])
    // Downstream statistics and row keys treat `index` as an identity, so it must stay unique even
    // when a label match moves a row onto an index another row still holds.
    expect(new Set(agentRows.map((agent) => agent.index)).size).toBe(agentRows.length)
    expect(snapshot.totalTokens).toBe(180)
  })

  it('keeps same-named Agents in separate phases and retains discovered phases at completion', () => {
    const plan = {
      phases: [{ title: 'Review' }, { title: 'Verify' }],
      agents: [
        { label: 'worker', phaseIndex: 1, phaseTitle: 'Review' },
        { label: 'worker', phaseIndex: 2, phaseTitle: 'Verify' }
      ]
    }
    const launch = { runId: 'run-1', taskId: 'task-1' }
    const previous = updateLocalWorkflowSnapshot(plan, launch, {
      status: 'in_progress',
      workflowProgress: [
        { type: 'workflow_phase', index: 3, title: 'Publish' },
        {
          type: 'workflow_agent',
          index: 3,
          label: 'publisher',
          phaseIndex: 3,
          phaseTitle: 'Publish',
          state: 'done',
          cumulativeTokens: 200
        }
      ]
    })
    const completed = updateLocalWorkflowSnapshot(
      plan,
      launch,
      {
        status: 'completed',
        usage: { contextTokens: 90, toolUses: 5 },
        workflowProgress: [
          { type: 'workflow_phase', index: 3, title: 'Publish' },
          {
            type: 'workflow_agent',
            index: 4,
            label: 'worker',
            phaseIndex: 2,
            phaseTitle: 'Verify',
            state: 'progress',
            cumulativeTokens: 100,
            toolCalls: 1
          }
        ]
      },
      previous
    )

    expect(completed.phases).toEqual([{ title: 'Review' }, { title: 'Verify' }, { title: 'Publish' }])
    expect(
      completed.workflowProgress
        .filter((item) => item.type === 'workflow_agent')
        .map(({ index, label, phaseTitle, state }) => ({ index, label, phaseTitle, state }))
    ).toEqual([
      { index: 1, label: 'worker', phaseTitle: 'Review', state: 'pending' },
      { index: 3, label: 'publisher', phaseTitle: 'Publish', state: 'done' },
      { index: 4, label: 'worker', phaseTitle: 'Verify', state: 'done' }
    ])
    expect(completed).toMatchObject({ totalTokens: 90, totalCumulativeTokens: 300, totalToolCalls: 5 })
    expect(previous.workflowProgress).toContainEqual(
      expect.objectContaining({ index: 2, label: 'worker', phaseTitle: 'Verify', state: 'pending' })
    )
  })
})

const RUN_ID = 'wf_safe-123'

const symlinksSupported = (() => {
  try {
    const probe = mkdtempSync(path.join(tmpdir(), 'cherry-symlink-probe-'))
    const target = path.join(probe, 'target')
    writeFileSync(target, '')
    symlinkSync(target, path.join(probe, 'link'))
    rmSync(probe, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
})()

function createWorkflowSession() {
  const sessionRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-root-')))
  const transcriptDir = path.join(sessionRoot, 'subagents', 'workflows', RUN_ID)
  mkdirSync(transcriptDir, { recursive: true })
  mkdirSync(path.join(sessionRoot, 'workflows', 'scripts'), { recursive: true })

  return {
    sessionRoot,
    transcriptDir,
    snapshotPath: path.join(sessionRoot, 'workflows', `${RUN_ID}.json`),
    scriptPath: path.join(sessionRoot, 'workflows', 'scripts', `run-${RUN_ID}.js`),
    receipt: (overrides: Record<string, unknown> = {}) => ({
      status: 'async_launched',
      taskType: 'local_workflow',
      taskId: 'workflow-task-1',
      runId: RUN_ID,
      transcriptDir,
      ...overrides
    }),
    cleanup: () => rmSync(sessionRoot, { recursive: true, force: true })
  }
}

describe('parseLocalWorkflowLaunch', () => {
  it('derives the snapshot from the session root instead of the receipt', () => {
    const session = createWorkflowSession()
    try {
      expect(parseLocalWorkflowLaunch(session.receipt(), 'created', session.sessionRoot)).toEqual({
        taskId: 'workflow-task-1',
        runId: RUN_ID,
        transcriptDir: session.transcriptDir,
        snapshotPath: session.snapshotPath,
        sessionRoot: session.sessionRoot,
        createdAt: 'created'
      })
    } finally {
      session.cleanup()
    }
  })

  it('rejects a workflow-shaped transcript directory outside the session root', () => {
    const session = createWorkflowSession()
    const foreignRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-foreign-')))
    try {
      const foreignTranscriptDir = path.join(foreignRoot, 'subagents', 'workflows', RUN_ID)
      mkdirSync(foreignTranscriptDir, { recursive: true })

      expect(
        parseLocalWorkflowLaunch(session.receipt({ transcriptDir: foreignTranscriptDir }), 'c', session.sessionRoot)
      ).toBeUndefined()
    } finally {
      session.cleanup()
      rmSync(foreignRoot, { recursive: true, force: true })
    }
  })

  it('rejects a script-path-only receipt that leaves the session root', () => {
    const session = createWorkflowSession()
    const foreignRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-foreign-')))
    try {
      const foreignScript = path.join(foreignRoot, 'workflows', 'scripts', `run-${RUN_ID}.js`)
      mkdirSync(path.dirname(foreignScript), { recursive: true })
      writeFileSync(foreignScript, '')

      expect(
        parseLocalWorkflowLaunch(
          session.receipt({ transcriptDir: undefined, scriptPath: foreignScript }),
          'c',
          session.sessionRoot
        )
      ).toBeUndefined()
    } finally {
      session.cleanup()
      rmSync(foreignRoot, { recursive: true, force: true })
    }
  })

  it('accepts a script path anchored inside the session root', () => {
    const session = createWorkflowSession()
    try {
      const launch = parseLocalWorkflowLaunch(
        session.receipt({ transcriptDir: undefined, scriptPath: session.scriptPath }),
        'c',
        session.sessionRoot
      )

      expect(launch?.snapshotPath).toBe(session.snapshotPath)
      expect(launch?.transcriptDir).toBeUndefined()
    } finally {
      session.cleanup()
    }
  })

  it('rejects a receipt that names no session-local path at all', () => {
    const session = createWorkflowSession()
    try {
      expect(
        parseLocalWorkflowLaunch(session.receipt({ transcriptDir: undefined }), 'c', session.sessionRoot)
      ).toBeUndefined()
    } finally {
      session.cleanup()
    }
  })

  it.skipIf(!symlinksSupported)('refuses a snapshot file that symlinks out of the session root', () => {
    const session = createWorkflowSession()
    const foreignRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-foreign-')))
    const foreignSnapshot = path.join(foreignRoot, `${RUN_ID}.json`)
    try {
      writeFileSync(foreignSnapshot, '{}')
      symlinkSync(foreignSnapshot, session.snapshotPath)
      const launch = parseLocalWorkflowLaunch(session.receipt(), 'c', session.sessionRoot)

      expect(launch).toBeDefined()
      expect(resolveWorkflowSnapshotPath(launch!)).toBeUndefined()
    } finally {
      session.cleanup()
      rmSync(foreignRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(!symlinksSupported)('rejects a session whose workflows directory symlinks outside it', () => {
    const session = createWorkflowSession()
    const foreignRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-foreign-')))
    try {
      rmSync(path.join(session.sessionRoot, 'workflows'), { recursive: true, force: true })
      symlinkSync(foreignRoot, path.join(session.sessionRoot, 'workflows'))

      expect(parseLocalWorkflowLaunch(session.receipt(), 'c', session.sessionRoot)).toBeUndefined()
    } finally {
      session.cleanup()
      rmSync(foreignRoot, { recursive: true, force: true })
    }
  })

  it('re-checks the transcript directory before it is read', () => {
    const session = createWorkflowSession()
    try {
      const launch = parseLocalWorkflowLaunch(session.receipt(), 'c', session.sessionRoot)
      expect(resolveWorkflowTranscriptDir(launch!)).toBe(session.transcriptDir)

      const scriptOnly = parseLocalWorkflowLaunch(
        session.receipt({ transcriptDir: undefined, scriptPath: session.scriptPath }),
        'c',
        session.sessionRoot
      )
      expect(resolveWorkflowTranscriptDir(scriptOnly!)).toBeUndefined()
    } finally {
      session.cleanup()
    }
  })

  it.skipIf(!symlinksSupported)('refuses a transcript directory swapped for an outside symlink', () => {
    const session = createWorkflowSession()
    const foreignRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'cherry-workflow-foreign-')))
    try {
      const launch = parseLocalWorkflowLaunch(session.receipt(), 'c', session.sessionRoot)
      expect(launch).toBeDefined()

      const transcriptDir = path.join(session.sessionRoot, 'subagents', 'workflows', RUN_ID)
      rmSync(transcriptDir, { recursive: true, force: true })
      symlinkSync(foreignRoot, transcriptDir)

      expect(resolveWorkflowTranscriptDir(launch!)).toBeUndefined()
    } finally {
      session.cleanup()
      rmSync(foreignRoot, { recursive: true, force: true })
    }
  })
})
