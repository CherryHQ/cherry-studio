import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { snapshotTo } from '@data/db/restore/snapshot'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { encodePortableAgentResumePoint } from '@main/ai/agents/portableProfilePolicy'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) => {
      if (key === 'feature.agents.claude.root') return path.join(root, 'Data', 'Agents', '.claude')
      if (key === 'feature.agents.transcripts') return path.join(root, 'Data', 'AgentTranscripts')
      throw new Error(`Unexpected path key: ${key}`)
    }
  }
}))

const { encodeClaudeProjectDir, projectRestoredAgentTranscript, stagePortableAgentTranscript } = await import(
  '../portableTranscript'
)
const { truncateTranscriptAtBoundary } = await import('../portableTranscript')

const SESSION_ID = 'host-session-1'
const SDK_SESSION_ID = '11111111-1111-4111-8111-111111111111'
const BOUNDARY = '22222222-2222-4222-8222-222222222222'

const dbh = setupTestDatabase()

function line(uuid: string, type = 'assistant'): string {
  return JSON.stringify({ type, uuid })
}

describe('encodeClaudeProjectDir', () => {
  // Canary pinned against @anthropic-ai/claude-agent-sdk 0.3.218. If an SDK
  // upgrade breaks these literals, restored-session projection must be re-verified.
  it('matches the SDK sanitizer for ordinary paths', () => {
    expect(encodeClaudeProjectDir('/Users/a/ws.1')).toBe('-Users-a-ws-1')
  })

  it('truncates past 200 chars and appends the SDK path hash', () => {
    expect(encodeClaudeProjectDir(`/ws/${'a'.repeat(300)}`)).toBe(`-ws-${'a'.repeat(196)}-ayp6h0`)
  })
})

describe('truncateTranscriptAtBoundary', () => {
  it('cuts through the anchor and drops later entries and a torn tail', () => {
    const raw = [line('u-1', 'user'), line(BOUNDARY), line('u-2', 'user'), '{"type":"assistant","uuid":"to'].join('\n')
    expect(truncateTranscriptAtBoundary(raw, BOUNDARY)).toBe(`${line('u-1', 'user')}\n${line(BOUNDARY)}\n`)
  })

  it('keeps all complete entries when no anchor is retained', () => {
    const raw = `${line('u-1', 'user')}\n${line('u-2')}\n{"torn`
    expect(truncateTranscriptAtBoundary(raw, undefined)).toBe(`${line('u-1', 'user')}\n${line('u-2')}\n`)
  })

  it('refuses a transcript that never reaches the anchor', () => {
    expect(() => truncateTranscriptAtBoundary(`${line('other')}\n`, BOUNDARY)).toThrow(
      'does not contain its retained Turn boundary'
    )
  })

  it('refuses a corrupt line before the anchor', () => {
    expect(() => truncateTranscriptAtBoundary(`{"broken\n${line(BOUNDARY)}\n`, BOUNDARY)).toThrow(
      'corrupt before its retained Turn boundary'
    )
  })
})

describe('stagePortableAgentTranscript', () => {
  let transcriptRoot: string
  let claudeRoot: string
  let workspacePath: string
  let detachedDbPath: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'portable-transcript-'))
    transcriptRoot = path.join(root, 'Data', 'AgentTranscripts')
    claudeRoot = path.join(root, 'Data', 'Agents', '.claude')
    workspacePath = path.join(root, 'Data', 'Agents', 'system', 'ws-1')
    detachedDbPath = path.join(root, 'detached.sqlite')
    mkdirSync(transcriptRoot, { recursive: true })

    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'w-1', name: 'ws', path: workspacePath, type: 'system', orderKey: 'a' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: SESSION_ID, workspaceId: 'w-1', name: 's', orderKey: 'a' } as never)
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'm-1',
        sessionId: SESSION_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [] },
        runtimeResumeToken: encodePortableAgentResumePoint({ sessionId: SDK_SESSION_ID, resumeSessionAt: BOUNDARY })
      } as never)
      .run()
    snapshotTo(dbh.sqlite, detachedDbPath)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function writeSdkTranscript(projectDir: string): void {
    const dir = path.join(claudeRoot, 'projects', projectDir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, `${SDK_SESSION_ID}.jsonl`),
      `${line('u-1', 'user')}\n${line(BOUNDARY)}\n${line('u-2')}\n`
    )
  }

  it('stages the SDK transcript cut at the retained boundary', async () => {
    writeSdkTranscript(encodeClaudeProjectDir(workspacePath))
    const stagedPath = path.join(root, 'staged.jsonl')

    await stagePortableAgentTranscript({
      detachedDbPath,
      transcriptRoot,
      agentRuntimeConfigRoot: claudeRoot,
      sourcePath: path.join(transcriptRoot, `${SESSION_ID}.jsonl`),
      stagedPath
    })

    expect(readFileSync(stagedPath, 'utf8')).toBe(`${line('u-1', 'user')}\n${line(BOUNDARY)}\n`)
  })

  it('falls back to a projects scan when the encoded directory does not match', async () => {
    writeSdkTranscript('some-other-encoding')
    const stagedPath = path.join(root, 'staged.jsonl')

    await stagePortableAgentTranscript({
      detachedDbPath,
      transcriptRoot,
      agentRuntimeConfigRoot: claudeRoot,
      sourcePath: path.join(transcriptRoot, `${SESSION_ID}.jsonl`),
      stagedPath
    })

    expect(readFileSync(stagedPath, 'utf8')).toBe(`${line('u-1', 'user')}\n${line(BOUNDARY)}\n`)
  })

  it('fails when no transcript exists for the retained session', async () => {
    await expect(
      stagePortableAgentTranscript({
        detachedDbPath,
        transcriptRoot,
        agentRuntimeConfigRoot: claudeRoot,
        sourcePath: path.join(transcriptRoot, `${SESSION_ID}.jsonl`),
        stagedPath: path.join(root, 'staged.jsonl')
      })
    ).rejects.toThrow('was not found under the SDK projects root')
  })
})

describe('projectRestoredAgentTranscript', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'portable-transcript-project-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('projects the canonical transcript to the SDK location once', async () => {
    const cwd = path.join(root, 'ws')
    const canonical = path.join(root, 'Data', 'AgentTranscripts', `${SESSION_ID}.jsonl`)
    mkdirSync(path.dirname(canonical), { recursive: true })
    writeFileSync(canonical, `${line(BOUNDARY)}\n`)

    await projectRestoredAgentTranscript({
      hostSessionId: SESSION_ID,
      cwd,
      resumePoint: { sessionId: SDK_SESSION_ID, resumeSessionAt: BOUNDARY }
    })

    const sdkFile = path.join(
      root,
      'Data',
      'Agents',
      '.claude',
      'projects',
      encodeClaudeProjectDir(cwd),
      `${SDK_SESSION_ID}.jsonl`
    )
    expect(readFileSync(sdkFile, 'utf8')).toBe(`${line(BOUNDARY)}\n`)

    // Second call is a no-op: the SDK file now exists and is not overwritten.
    writeFileSync(sdkFile, 'SDK-OWNED')
    await projectRestoredAgentTranscript({
      hostSessionId: SESSION_ID,
      cwd,
      resumePoint: { sessionId: SDK_SESSION_ID, resumeSessionAt: BOUNDARY }
    })
    expect(readFileSync(sdkFile, 'utf8')).toBe('SDK-OWNED')
  })

  it('does nothing when no canonical transcript was restored', async () => {
    const cwd = path.join(root, 'ws')
    await projectRestoredAgentTranscript({
      hostSessionId: SESSION_ID,
      cwd,
      resumePoint: { sessionId: SDK_SESSION_ID }
    })
    expect(() =>
      readFileSync(path.join(root, 'Data', 'Agents', '.claude', 'projects', encodeClaudeProjectDir(cwd)), 'utf8')
    ).toThrow()
  })
})
