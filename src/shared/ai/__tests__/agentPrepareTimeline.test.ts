import { describe, expect, it } from 'vitest'

import {
  buildPrepareDiagnostics,
  type PrepareTimeline,
  type PrepareTimelineStage,
  stageToPhase
} from '../agentPrepareTimeline'

describe('stageToPhase', () => {
  it('maps mcp-warm to connecting-mcp', () => {
    expect(stageToPhase('mcp-warm')).toBe('connecting-mcp')
  })

  it('maps init-to-first-chunk to waiting-first-response', () => {
    expect(stageToPhase('init-to-first-chunk')).toBe('waiting-first-response')
  })

  it('maps every other stage to starting-runtime', () => {
    const startingRuntimeStages: PrepareTimelineStage[] = [
      'dispatch',
      'shell-env',
      'workspace',
      'tool-permissions',
      'system-prompt',
      'mcp-metadata',
      'skills',
      'warm-query',
      'spawn-to-init'
    ]
    for (const stage of startingRuntimeStages) {
      expect(stageToPhase(stage)).toBe('starting-runtime')
    }
  })
})

describe('buildPrepareDiagnostics', () => {
  const timeline: PrepareTimeline = {
    totalMs: 6200,
    stages: [
      { stage: 'dispatch', ms: 200 },
      { stage: 'mcp-warm', ms: 3000, detail: { serverCount: 1, mcpServerName: 'filesystem', completedInTime: true } },
      { stage: 'spawn-to-init', ms: 1500 },
      { stage: 'init-to-first-chunk', ms: 1500 }
    ],
    runtimeType: 'claude-code',
    mcpServerNames: ['filesystem']
  }

  it('forwards only the non-sensitive fields', () => {
    const diagnostics = buildPrepareDiagnostics({ timeline, appVersion: '2.0.0' })

    expect(diagnostics).toEqual({
      totalMs: 6200,
      stages: timeline.stages,
      mcpServerNames: ['filesystem'],
      appVersion: '2.0.0',
      agentType: 'claude-code'
    })
  })

  it('never leaks env vars, API keys, or base URLs', () => {
    const diagnostics = buildPrepareDiagnostics({ timeline, appVersion: '2.0.0', agentType: 'claude-code' })
    const serialized = JSON.stringify(diagnostics).toLowerCase()

    for (const forbidden of ['env', 'apikey', 'api_key', 'token', 'baseurl', 'base_url', 'secret', 'http']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('falls back to the runtime type, then unknown, for the agent type', () => {
    expect(buildPrepareDiagnostics({ timeline, appVersion: '2.0.0' }).agentType).toBe('claude-code')
    expect(buildPrepareDiagnostics({ timeline: { totalMs: 1, stages: [] }, appVersion: '2.0.0' }).agentType).toBe(
      'unknown'
    )
  })
})
