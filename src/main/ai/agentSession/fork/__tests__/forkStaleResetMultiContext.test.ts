import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { getAgentSessionHead } from '@data/services/agentSessionMessageTree'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { ClaudeForkCheckpointSchema } from '@main/ai/runtime/claudeCode/forkCheckpoint'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'

import { AgentSessionForkOperations } from '../AgentSessionForkOperations'

const configDir = '/test/claude'

function claudeCheckpoint(nativeId: string) {
  return {
    runtime: 'claude-code',
    runtimeSessionId: nativeId,
    messageUuid: randomUUID(),
    configDir
  }
}

describe('fork stale reset multi-context', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let sessionId: string
  let previous: ReturnType<typeof runtimeDriverRegistry.getAgentSessionDriver>

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'fork-stale-multi-'))
    const original = application.getPath.bind(application)
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      if (key === 'feature.agents.forks') return path.join(directory, 'forks', filename ?? '')
      return original(key, filename)
    })
    const agentId = randomUUID()
    const workspaceId = randomUUID()
    sessionId = randomUUID()
    dbh.db
      .insert(agentTable)
      .values({ id: agentId, type: 'claude-code', name: 'Claude', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, type: 'user', name: 'Work', path: directory, orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId, workspaceId, name: 'Source', orderKey: 'a0' })
      .run()
    previous = runtimeDriverRegistry.getAgentSessionDriver('claude-code')
    runtimeDriverRegistry.register({
      type: 'claude-code',
      isForkCheckpoint: (value) => ClaudeForkCheckpointSchema.safeParse(value).success,
      validateSession() {},
      async connect() {
        throw new Error('Fork test must not connect')
      },
      async fork(input) {
        const resumeToken = randomUUID()
        return {
          resumeToken,
          checkpoints: input.checkpoints.map((checkpoint) => ({ ...checkpoint, runtimeSessionId: resumeToken })),
          publish: []
        }
      }
    })
  })

  afterEach(async () => {
    runtimeDriverRegistry.clearForTest()
    if (previous) runtimeDriverRegistry.register(previous)
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  it('derives a per-binding reset marker so the recovered child reuses its native id (inv_d75af90853619a5a)', async () => {
    // Healthy root context + first answer (group A).
    const rootCtx = prepareClaudeBranch(sessionId, configDir)
    const nativeRoot = rootCtx.nativeThreadId!
    const parent = messages.saveMessage({
      sessionId,
      runtimeResumeToken: nativeRoot,
      runtimeAnchor: { checkpoint: claudeCheckpoint(nativeRoot) },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'old answer' }] } }
    })

    // `/clear` rotates to a newer native (group B, soon stale).
    const descendant = messages.saveMessage({
      sessionId,
      parentId: parent.id,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'q' }] } }
    })
    const clearedNative = randomUUID()
    prepareClaudeBranch(sessionId, configDir, clearedNative, descendant.id)
    const staleChild = messages.saveMessage({
      sessionId,
      parentId: descendant.id,
      runtimeResumeToken: clearedNative,
      runtimeAnchor: { checkpoint: claudeCheckpoint(clearedNative) },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'new answer' }] } }
    })

    // Only the newer archive goes missing: stale recovery reconnects fresh.
    messages.clearRuntimeResumeTokens(sessionId, clearedNative)
    messages.markStaleResumeResetBoundary(sessionId, staleChild.id)
    const reconnected = prepareClaudeBranch(sessionId, configDir, undefined, staleChild.id)
    contexts.bindContext(reconnected.id, reconnected.nativeThreadId!)
    const recoveredNative = contexts.context(reconnected.id).nativeThreadId!

    // Two replies complete on the recovered native.
    const user3 = messages.saveMessage({
      sessionId,
      parentId: staleChild.id,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'follow-up 1' }] } }
    })
    messages.saveMessage({
      sessionId,
      parentId: user3.id,
      runtimeResumeToken: recoveredNative,
      runtimeAnchor: { checkpoint: claudeCheckpoint(recoveredNative) },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'recovered 1' }] } }
    })
    const user4 = messages.saveMessage({
      sessionId,
      parentId: getAgentSessionHead(dbh.db, sessionId)!,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'follow-up 2' }] } }
    })
    const selected = messages.saveMessage({
      sessionId,
      parentId: user4.id,
      runtimeResumeToken: recoveredNative,
      runtimeAnchor: { checkpoint: claudeCheckpoint(recoveredNative) },
      message: { role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'recovered 2' }] } }
    })

    const childId = await new AgentSessionForkOperations().fork(sessionId, selected.id)

    const childContexts = dbh.db
      .select()
      .from(agentSessionContextTable)
      .where(eq(agentSessionContextTable.sessionId, childId))
      .all()
    expect(childContexts).toHaveLength(2)

    const childRows = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, childId))
      .all()
    const resetCopyId = childRows.find((row) => (row.data as { staleResumeReset?: unknown }).staleResumeReset)?.id
    expect(resetCopyId).toBeTruthy()

    const byAnchor = new Map(childContexts.map((ctx) => [ctx.anchorMessageId, ctx]))
    // First group stays on the healthy root without a reset marker.
    const rootId = childRows.find((row) => row.role === 'root')?.id ?? null
    const healthy = byAnchor.get(rootId)
    expect(healthy).toBeTruthy()
    expect(healthy!.checkpointMapping?.staleResetHandled).toBeUndefined()

    // Recovered group is anchored on the visible side and marked handled.
    const recovered = byAnchor.get(resetCopyId!)
    expect(recovered).toBeTruthy()
    expect(recovered!.checkpointMapping?.staleResetHandled).toBe(resetCopyId)

    // Child first send reuses the forked recovered native instead of throwing
    // `Native context already belongs to another branch`.
    const childHead = getAgentSessionHead(dbh.db, childId)!
    expect(() => prepareClaudeBranch(childId, configDir, recovered!.nativeThreadId!, childHead)).not.toThrow()
    expect(prepareClaudeBranch(childId, configDir, recovered!.nativeThreadId!, childHead).id).toBe(recovered!.id)
  })
})
