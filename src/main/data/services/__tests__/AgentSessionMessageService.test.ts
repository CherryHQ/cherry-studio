import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionForkContextTable } from '@data/db/schemas/agentSessionForkContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionEditService } from '@data/services/AgentSessionEditService'
import type { ForkContextCompatibility } from '@data/services/agentSessionForkContext'
import { agentSessionForkContextService } from '@data/services/AgentSessionForkContextService'
import type { AgentSessionForkJournal } from '@data/services/agentSessionForkJournal'
import { agentSessionForkService } from '@data/services/AgentSessionForkService'
import type { AgentSessionDeliveryRoutingError } from '@data/services/AgentSessionMessageService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { forkContextHash } from '@data/services/utils/forkContext'
import { AgentSessionEditOperations } from '@main/ai/agentSession/AgentSessionEditOperations'
import { AgentSessionForkOperations } from '@main/ai/agentSession/AgentSessionForkOperations'
import * as forkContextEnvironment from '@main/ai/agentSession/forkContextEnvironment'
import { forkFileIdentity } from '@main/ai/agentSession/forkFiles'
import { buildForkHistory } from '@main/ai/agentSession/forkHistory'
import {
  ForkContextPreparer,
  prepareForkContext,
  prepareForkContextDocument
} from '@main/ai/agentSession/prepareForkContext'
import { prepareRuntimeHistory } from '@main/ai/agentSession/prepareRuntimeHistory'
import { AgentSessionForkError, type RuntimeForkInput } from '@main/ai/runtime/forkCheckpoint'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnectInput, AgentRuntimeConnection } from '@main/ai/runtime/types'
import {
  AgentChatContextProvider,
  type ValidatedAgentDispatch
} from '@main/ai/streamManager/context/AgentChatContextProvider'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({
  notifyDataApiDataChangeMock: vi.fn()
}))

vi.mock('@data/dataApiDataChange', () => ({
  notifyDataApiDataChange: notifyDataApiDataChangeMock
}))

const SESSION_ID = 'session-1'
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'
const FILE_ENTRY_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d003'
type AgentSessionInsert = typeof agentSessionTable.$inferInsert

describe('AgentSessionMessageService', () => {
  const dbh = setupTestDatabase()

  async function seedSession(values: Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }) {
    const workspaceId = values.workspaceId ?? `workspace-${values.id}`
    await dbh.db.insert(agentWorkspaceTable).values({
      id: workspaceId,
      name: workspaceId,
      path: `/tmp/${workspaceId}`,
      type: 'user',
      orderKey: `workspace-${values.orderKey}`
    })
    await dbh.db
      .insert(agentSessionTable)
      .values({ createdAt: 0, lastActivityAt: 0, updatedAt: 0, ...values, workspaceId })
  }

  async function seedSessions(rows: Array<Omit<AgentSessionInsert, 'workspaceId'> & { workspaceId?: string }>) {
    for (const row of rows) {
      await seedSession(row)
    }
  }

  async function seedAgent(id: string, name: string, deletedAt?: number) {
    await dbh.db.insert(agentTable).values({
      id,
      type: 'claude-code',
      name,
      instructions: 'test',
      orderKey: id,
      deletedAt
    })
  }

  beforeEach(async () => {
    notifyDataApiDataChangeMock.mockClear()
    await seedSession({ id: SESSION_ID, name: 'Session', orderKey: 'a0' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports message existence per session', async () => {
    await seedSession({ id: 'session-2', name: 'Other', orderKey: 'a1' })
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(false)

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'hi' }] } }
    })

    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID)).toBe(true)
    expect(agentSessionMessageService.hasSessionMessages(SESSION_ID, USER_MESSAGE_ID)).toBe(false)
    expect(agentSessionMessageService.hasSessionMessages('session-2')).toBe(false)
  })

  describe('edit-resend transactions', () => {
    const editedId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
    const replyId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'

    it.each(
      ['pi', 'claude-code', 'dsh'].flatMap((runtime) =>
        ['native', 'rebuilt', 'first'].map((mode) => ({ runtime, mode }))
      )
    )(
      'replaces a $runtime $mode tail without creating a session, and never replays an uncertain send',
      async ({ runtime, mode }) => {
        const root = await mkdtemp(path.join(tmpdir(), 'cherry-edit-'))
        const originalGetPath = application.getPath.bind(application)
        vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
          key === 'feature.agents.forks' ? root : originalGetPath(key, ...args)
        )
        vi.spyOn(forkContextEnvironment, 'resolveForkContextInput').mockImplementation(async (input) => ({
          sessionId: input.sessionId,
          signal: input.signal,
          budget: 8000,
          countTokens: (text) => text.length,
          compatibility: {
            runtime,
            schemaVersion: 1,
            sdkVersion: 'test',
            systemPromptHash: 'a'.repeat(64),
            toolsetHash: 'b'.repeat(64),
            compressorHash: 'c'.repeat(64),
            modelHash: 'd'.repeat(64)
          },
          resolveCompressor: async () => {
            throw new Error('Unexpected compression')
          }
        }))
        const host = {
          assertIdleForEdit: () => {},
          closeForEdit: async () => {},
          adoptEditConnection: vi.fn(),
          connectForEdit: (input: AgentRuntimeConnectInput, runtime: string) =>
            runtimeDriverRegistry.getAgentSessionDriver(runtime)!.connect(input)
        }
        const connection = {
          close: vi.fn(async () => {}),
          events: { async *[Symbol.asyncIterator]() {} },
          send: vi.fn(),
          reconcile: vi.fn(async () => 'current' as const)
        }
        const connect = vi.fn<(input: AgentRuntimeConnectInput) => Promise<typeof connection>>(async () => connection)
        const fork = vi.fn(async (input: RuntimeForkInput) => {
          expect(input.checkpoint.runtimeSessionId).toBe('old-native-session')
          expect(JSON.stringify(input)).not.toContain(replyId)
          return {
            resumeToken: input.targetSessionId,
            publish: [],
            checkpoints: input.checkpoints.map((checkpoint) => ({
              ...checkpoint,
              runtimeSessionId: input.targetSessionId
            }))
          }
        })
        runtimeDriverRegistry.clearForTest()
        runtimeDriverRegistry.register({
          type: runtime,
          capabilities: ['agent-session'],
          connect,
          fork: mode === 'native' ? fork : undefined,
          validateSession: () => {},
          listAvailableTools: async () => []
        })
        try {
          dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey: 'p0' }).run()
          dbh.db
            .insert(userModelTable)
            .values({
              id: 'test::model',
              providerId: 'test',
              modelId: 'model',
              name: 'Model',
              orderKey: 'm0',
              capabilities: [],
              supportsStreaming: true
            })
            .run()
          seedEditHistory(mode === 'first')
          if (mode === 'native') {
            dbh.db.update(agentSessionMessageTable).set({ runtimeForkState: null }).run()
            const checkpoint =
              runtime === 'pi'
                ? { runtime, runtimeSessionId: 'old-native-session', leafId: 'leaf-before-edit' }
                : runtime === 'dsh'
                  ? { runtime, runtimeSessionId: 'old-native-session', boundary: 7 }
                  : {
                      runtime,
                      runtimeSessionId: 'old-native-session',
                      messageUuid: randomUUID(),
                      configDir: root,
                      sourceCwd: root,
                      prefixBytes: 500,
                      prefixHash: 'a'.repeat(64)
                    }
            dbh.db
              .update(agentSessionMessageTable)
              .set({ runtimeForkState: { version: 1, status: 'available', checkpoint } })
              .where(eq(agentSessionMessageTable.id, ASSISTANT_MESSAGE_ID))
              .run()
          }
          const snapshot = agentSessionMessageService.readEditSnapshotTx(dbh.db, SESSION_ID, editedId)
          const target = { messageId: editedId, version: snapshot.version, operationId: randomUUID() }
          const validated: ValidatedAgentDispatch = {
            sessionId: SESSION_ID,
            topicId: `agent-session:${SESSION_ID}`,
            agentId: 'agent',
            agentUpdatedAt: '',
            agentType: runtime,
            agentName: 'Agent',
            uniqueModelId: 'test::model',
            reasoningEffort: 'default',
            serviceTier: 'standard',
            headless: false,
            messageSnapshot: { id: 'agent', name: 'Agent', model: { id: 'model', name: 'Model', provider: 'test' } },
            userMessageId: randomUUID(),
            userMessageParts: [{ type: 'text', text: 'edited request' }],
            shouldAutoNameInitialTurn: false
          }
          const provider = new AgentChatContextProvider()
          const operations = new AgentSessionEditOperations(host)
          const activate = vi.fn((persisted) => ({
            topicId: validated.topicId,
            models: [],
            listeners: [],
            reservedMessages: persisted.savedMessages.map((row) => ({
              id: row.id,
              role: row.role,
              parts: row.data.parts
            }))
          }))
          const run = () =>
            operations.run(target, validated, (tx) => provider.persistDispatchTx(tx, validated), activate)
          const sessionsBefore = dbh.db.select().from(agentSessionTable).all()
          await run()
          const rows = dbh.db.select().from(agentSessionMessageTable).all()
          if (mode !== 'first') {
            expect(rows.map((row) => row.id)).toContain(USER_MESSAGE_ID)
            expect(rows.map((row) => row.id)).toContain(ASSISTANT_MESSAGE_ID)
          }
          expect(rows.map((row) => row.id)).not.toContain(editedId)
          expect(rows.map((row) => row.id)).not.toContain(replyId)
          expect(rows.filter((row) => row.role === 'user').at(-1)?.data.parts).toEqual(validated.userMessageParts)
          expect(
            dbh.db
              .select()
              .from(agentSessionTable)
              .all()
              .map((row) => [row.id, row.name, row.workspaceId])
          ).toEqual(sessionsBefore.map((row) => [row.id, row.name, row.workspaceId]))
          const operation = agentSessionEditService.get(target.operationId)!
          expect(operation.nativeSessionId).not.toBe(SESSION_ID)
          expect(connect.mock.calls[0][0]).toMatchObject({
            sessionId: SESSION_ID,
            nativeSessionId: operation.nativeSessionId
          })
          expect(host.adoptEditConnection).toHaveBeenCalledWith(SESSION_ID, connection)
          expect(connection.close).not.toHaveBeenCalled()
          const context = agentSessionForkContextService.get(SESSION_ID)?.document
          if (mode === 'rebuilt') {
            expect(context?.state).toBe('contextReady')
            const history = buildForkHistory(context!.prepared!)
            expect(history).toContain('retained request')
            expect(history).toContain('retained answer')
            expect(history).not.toContain('old request')
            expect(history).not.toContain('old answer')
            expect(history).not.toContain('edited request')
          } else {
            expect(context).toBeUndefined()
            if (mode === 'native')
              expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBe(operation.nativeSessionId)
            else expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBeNull()
          }
          await run()
          const retriedRows = dbh.db.select().from(agentSessionMessageTable).all()
          expect(retriedRows.map((row) => ({ ...row, updatedAt: 0 }))).toEqual(
            rows.map((row) => ({ ...row, updatedAt: 0 }))
          )
          agentSessionEditService.beginSend(SESSION_ID, operation.assistantMessageId!)
          await expect(run()).rejects.toMatchObject({ reason: 'send_uncertain' })
          expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(retriedRows)
          agentSessionMessageService.saveMessage({
            sessionId: SESSION_ID,
            runtimeResumeToken: 'new-native',
            message: { id: operation.assistantMessageId, role: 'assistant', status: 'success', data: { parts: [] } }
          })
          const result = await run()
          expect(result.models).toEqual([])
          expect(agentSessionEditService.get(target.operationId)?.status).toBe('sent')
        } finally {
          runtimeDriverRegistry.clearForTest()
          await rm(root, { recursive: true, force: true })
        }
      }
    )

    it.each(['prepare', 'commit'] as const)(
      'keeps the original history on %s failure and blocks writes during preparation',
      async (failure) => {
        const root = await mkdtemp(path.join(tmpdir(), 'cherry-edit-failure-'))
        const originalGetPath = application.getPath.bind(application)
        vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
          key === 'feature.agents.forks' ? root : originalGetPath(key, ...args)
        )
        const snapshot = seedEditHistory(true)
        const before = dbh.db.select().from(agentSessionMessageTable).all()
        const connection: AgentRuntimeConnection = {
          close: vi.fn(async () => {}),
          send: vi.fn(),
          events: { async *[Symbol.asyncIterator]() {} },
          reconcile: vi.fn(async () => 'current' as const)
        }
        runtimeDriverRegistry.clearForTest()
        runtimeDriverRegistry.register({
          type: 'pi',
          capabilities: ['agent-session'],
          validateSession: () => {},
          listAvailableTools: async () => [],
          connect: async () => {
            expect(() => agentSessionService.deleteTx(dbh.db, SESSION_ID)).toThrow('busy')
            expect(() => agentSessionMessageService.deleteSessionMessage(SESSION_ID, editedId)).toThrow('busy')
            expect(() =>
              agentSessionMessageService.saveMessage({
                sessionId: SESSION_ID,
                message: {
                  id: randomUUID(),
                  role: 'user',
                  data: { parts: [{ type: 'text', text: 'concurrent input' }] }
                }
              })
            ).toThrow('busy')
            if (failure === 'prepare') throw new Error('prepare failed')
            return connection
          }
        })
        const validated: ValidatedAgentDispatch = {
          sessionId: SESSION_ID,
          topicId: `agent-session:${SESSION_ID}`,
          agentId: 'agent',
          agentUpdatedAt: '',
          agentType: 'pi',
          agentName: 'Agent',
          uniqueModelId: 'test::model',
          reasoningEffort: 'default',
          serviceTier: 'standard',
          headless: false,
          messageSnapshot: { id: 'agent', name: 'Agent', model: { id: 'model', name: 'Model', provider: 'test' } },
          userMessageId: randomUUID(),
          userMessageParts: [{ type: 'text', text: 'edited request' }],
          shouldAutoNameInitialTurn: false
        }
        const operations = new AgentSessionEditOperations({
          assertIdleForEdit: () => {},
          closeForEdit: async () => {},
          adoptEditConnection: () => {},
          connectForEdit: (input: AgentRuntimeConnectInput, runtime: string) =>
            runtimeDriverRegistry.getAgentSessionDriver(runtime)!.connect(input)
        })
        const target = { messageId: editedId, version: snapshot.version, operationId: randomUUID() }
        try {
          await expect(
            operations.run(
              target,
              validated,
              () => {
                throw new Error('commit failed')
              },
              () => {
                throw new Error('must not activate')
              }
            )
          ).rejects.toThrow(`${failure} failed`)
          expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
          expect(agentSessionEditService.current(SESSION_ID)).toBeUndefined()
          expect(agentSessionEditService.get(target.operationId)).toMatchObject({
            status: 'failed',
            cleanupComplete: true
          })
        } finally {
          runtimeDriverRegistry.clearForTest()
          await rm(root, { recursive: true, force: true })
        }
      }
    )

    function seedEditHistory(first = false) {
      const entries = (
        [
          { id: USER_MESSAGE_ID, role: 'user', text: 'retained request' },
          { id: ASSISTANT_MESSAGE_ID, role: 'assistant', text: 'retained answer' },
          { id: editedId, role: 'user', text: 'old request' },
          { id: replyId, role: 'assistant', text: 'old answer' }
        ] as const
      ).slice(first ? 2 : 0)
      for (const [i, entry] of entries.entries()) {
        agentSessionMessageService.saveMessage({
          sessionId: SESSION_ID,
          runtimeResumeToken: 'old-native-session',
          runtimeForkState: {
            version: 1,
            status: 'available',
            checkpoint: { runtime: 'pi', runtimeSessionId: 'old-native-session', leafId: entry.id }
          },
          message: {
            id: entry.id,
            role: entry.role,
            status: 'success',
            data: { parts: [{ type: 'text', text: entry.text }] }
          }
        })
        dbh.db
          .update(agentSessionMessageTable)
          .set({ createdAt: i })
          .where(eq(agentSessionMessageTable.id, entry.id))
          .run()
      }
      return agentSessionMessageService.readEditSnapshotTx(dbh.db, SESSION_ID, editedId)
    }

    it.each([false, true])(
      'replaces only the selected tail and clears old native tokens (first message: %s)',
      (first) => {
        seedEditHistory(first)
        aiUsageRecordService.recordInvocation({
          requestId: 'edit-existing-bill',
          context: createAiUsageCaptureContext({
            providerId: 'fixture',
            providerName: 'Fixture',
            modelId: 'fixture',
            modelName: 'Fixture',
            credentialReceipt: { attribution: 'unknown' },
            source: { type: 'agent', id: 'fixture', name: 'Fixture', icon: null },
            messageRef: { kind: 'agent-session', id: replyId }
          }),
          modality: 'language',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          completedAt: 1000
        })
        const snapshot = agentSessionMessageService.readEditSnapshotTx(dbh.db, SESSION_ID, editedId)
        const sessionBefore = agentSessionService.getById(SESSION_ID)
        const bills = dbh.db.select().from(aiUsageRecordTable).all()
        const newId = randomUUID()
        application.get('DbService').withWriteTx((tx) => {
          agentSessionMessageService.replaceEditTailTx(
            tx,
            snapshot,
            snapshot.prefix.map((row) => ({ id: row.id, runtimeResumeToken: null, runtimeForkState: null }))
          )
          agentSessionMessageService.saveMessagesTx(tx, {
            sessionId: SESSION_ID,
            messages: [
              {
                id: newId,
                role: 'user',
                status: 'success',
                data: { parts: [{ type: 'text', text: 'edited request' }] }
              }
            ]
          })
        })
        const rows = agentSessionMessageService.readForkPrefixTx(dbh.db, SESSION_ID, newId)
        expect(rows.map((row) => row.id)).toEqual([...snapshot.prefix.map((row) => row.id), newId])
        expect(rows.slice(0, -1).map((row) => row.data)).toEqual(snapshot.prefix.map((row) => row.data))
        expect(rows.at(-1)?.data.parts).toEqual([{ type: 'text', text: 'edited request' }])
        expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBeNull()
        expect(dbh.db.select().from(aiUsageRecordTable).all()).toEqual(bills)
        expect(agentSessionService.getById(SESSION_ID)).toMatchObject({
          id: sessionBefore.id,
          name: sessionBefore.name,
          agentId: sessionBefore.agentId,
          workspaceId: sessionBefore.workspaceId
        })
        expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(1)
      }
    )

    it('rolls back native mapping and old answers if inserting the replacement fails', () => {
      const snapshot = seedEditHistory()
      const messages = dbh.db.select().from(agentSessionMessageTable).all()
      const sessions = dbh.db.select().from(agentSessionTable).all()
      expect(() =>
        application.get('DbService').withWriteTx((tx) => {
          agentSessionMessageService.replaceEditTailTx(
            tx,
            snapshot,
            snapshot.prefix.map((row) => ({
              id: row.id,
              runtimeResumeToken: 'replacement-native',
              runtimeForkState: null
            }))
          )
          tx.insert(agentSessionMessageTable)
            .values({
              id: USER_MESSAGE_ID,
              sessionId: SESSION_ID,
              role: 'user',
              status: 'success',
              data: { parts: [] }
            })
            .run()
        })
      ).toThrow()
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messages)
      expect(dbh.db.select().from(agentSessionTable).all()).toEqual(sessions)
      expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBe('old-native-session')
    })

    it.each(['edit', 'delete', 'append', 'workspace'] as const)(
      'rejects a stale editor after %s without deleting further history',
      (change) => {
        const snapshot = seedEditHistory()
        if (change === 'edit')
          agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, {
            data: { parts: [{ type: 'text', text: 'changed' }] }
          })
        if (change === 'delete') agentSessionMessageService.deleteSessionMessage(SESSION_ID, replyId)
        if (change === 'append')
          agentSessionMessageService.saveMessage({
            sessionId: SESSION_ID,
            message: { id: randomUUID(), role: 'user', status: 'success', data: { parts: [] } }
          })
        if (change === 'workspace')
          dbh.db
            .update(agentWorkspaceTable)
            .set({ path: '/changed-workspace' })
            .where(eq(agentWorkspaceTable.id, `workspace-${SESSION_ID}`))
            .run()
        const before = dbh.db.select().from(agentSessionMessageTable).all()
        expect(() =>
          application
            .get('DbService')
            .withWriteTx((tx) => agentSessionMessageService.replaceEditTailTx(tx, snapshot, snapshot.prefix))
        ).toThrow()
        expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
      }
    )

    it('rejects earlier messages, assistant targets, pending work and incomplete native mapping', () => {
      const snapshot = seedEditHistory()
      for (const id of [USER_MESSAGE_ID, ASSISTANT_MESSAGE_ID]) {
        expect(() => agentSessionMessageService.readEditSnapshotTx(dbh.db, SESSION_ID, id)).toThrow(
          'not_last_user_message'
        )
      }
      expect(() =>
        application.get('DbService').withWriteTx((tx) => agentSessionMessageService.replaceEditTailTx(tx, snapshot, []))
      ).toThrow('invalid_mapping')
      expect(agentSessionMessageService.getSessionMessage(SESSION_ID, replyId).data.parts).toEqual([
        { type: 'text', text: 'old answer' }
      ])
      dbh.db
        .update(agentSessionMessageTable)
        .set({ status: 'pending' })
        .where(eq(agentSessionMessageTable.id, replyId))
        .run()
      expect(() => agentSessionMessageService.readEditSnapshotTx(dbh.db, SESSION_ID, editedId)).toThrow('busy')
    })
  })

  describe('native fork persistence', () => {
    const compatibility = (runtime: string): ForkContextCompatibility => ({
      runtime,
      schemaVersion: 1,
      sdkVersion: 'fixture-v1',
      systemPromptHash: forkContextHash('system'),
      toolsetHash: forkContextHash('tools'),
      compressorHash: forkContextHash('compressor'),
      modelHash: forkContextHash('model')
    })

    function recordNative(
      ...args: Parameters<typeof agentSessionForkContextService.recordNative> extends [...infer P, unknown] ? P : never
    ) {
      const state = agentSessionMessageService
        .readForkPrefixTx(dbh.db, args[0], args[1], args[2])
        .at(-1)!.runtimeForkState
      const capture = agentSessionForkContextService.captureNativePrefix(args[0], args[1], args[2], state)!
      agentSessionForkContextService.recordNative(...args, capture)
    }

    async function contextSource() {
      await seedAgent('context-agent', 'Context Agent')
      await seedSession({ id: 'context-source', agentId: 'context-agent', name: 'History', orderKey: 'context-a' })
      agentSessionMessageService.saveMessage({
        sessionId: 'context-source',
        runtimeForkState: {
          version: 1,
          status: 'available',
          checkpoint: { runtime: 'pi', runtimeSessionId: 'fixture', leafId: 'leaf' }
        },
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              { type: 'text', text: 'OLD_VERBOSE_PAST '.repeat(3000) },
              { type: 'data-compaction-anchor', data: { status: 'done', phase: 'agent-session' } }
            ]
          }
        }
      })
    }

    async function contextChild(sourceId: string, childId: string, boundary: string) {
      const source = agentSessionMessageService.readForkPrefixTx(dbh.db, sourceId, boundary)
      await seedSession({ id: childId, agentId: 'context-agent', name: childId, orderKey: childId })
      const rows = source.map((row) => ({ ...row, id: randomUUID(), runtimeResumeToken: null, runtimeForkState: null }))
      agentSessionMessageService.insertForkMessagesTx(dbh.db, childId, rows)
      agentSessionService.setForkSourceTx(dbh.db, childId, {
        sessionId: sourceId,
        messageId: boundary,
        operationId: randomUUID(),
        historyMessageId: rows.at(-1)!.id
      })
      agentSessionForkContextService.createTx(dbh.db, childId, rows, sourceId, source)
      return rows
    }

    it.each(['edit', 'delete', 'append'] as const)('validates the frozen native capture after %s', async (change) => {
      await contextSource()
      const state = agentSessionMessageService
        .readForkPrefixTx(dbh.db, 'context-source', ASSISTANT_MESSAGE_ID)
        .at(-1)!.runtimeForkState
      const capture = agentSessionForkContextService.captureNativePrefix(
        'context-source',
        ASSISTANT_MESSAGE_ID,
        [],
        state
      )!
      if (change === 'edit')
        agentSessionMessageService.updateSessionMessage('context-source', ASSISTANT_MESSAGE_ID, {
          data: { parts: [{ type: 'text', text: 'changed' }] }
        })
      if (change === 'delete') agentSessionMessageService.deleteSessionMessage('context-source', ASSISTANT_MESSAGE_ID)
      if (change === 'append')
        agentSessionMessageService.saveMessage({
          sessionId: 'context-source',
          message: {
            id: randomUUID(),
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'FUTURE_SECRET' }] }
          }
        })
      const save = () =>
        agentSessionForkContextService.recordNative(
          'context-source',
          ASSISTANT_MESSAGE_ID,
          [],
          compatibility('pi'),
          { identity: 'capture', messages: [{ role: 'user', content: 'BOUNDARY_ONLY' }] },
          capture
        )
      if (change === 'delete') expect(save).toThrow('source_missing')
      else save()
      const document = agentSessionForkContextService.get('context-source')?.document
      if (change === 'append') {
        expect(document?.summaries).toHaveLength(1)
        expect(JSON.stringify(document)).not.toContain('FUTURE_SECRET')
        expect(document?.summaries[0].captureProof).toBeDefined()
      } else expect(document).toBeUndefined()
    })

    it('rolls back checkpoint invalidation and deletion together on a real SQLite failure', async () => {
      await contextSource()
      const remove = agentSessionMessageService.deleteSessionMessageTx.bind(agentSessionMessageService)
      vi.spyOn(agentSessionMessageService, 'deleteSessionMessageTx').mockImplementation((...args) => {
        remove(...args)
        throw new Error('transaction failed after delete')
      })
      expect(() => agentSessionMessageService.deleteSessionMessage('context-source', ASSISTANT_MESSAGE_ID)).toThrow(
        'transaction failed'
      )
      expect(
        agentSessionMessageService.getSessionMessage('context-source', ASSISTANT_MESSAGE_ID).forkAvailability
      ).toEqual({ status: 'available' })
    })

    it('uses durable receipts rather than initialization tokens and preserves sent state during v1 upgrade', async () => {
      await contextSource()
      recordNative('context-source', ASSISTANT_MESSAGE_ID, [], compatibility('pi'), {
        identity: 'native',
        messages: [{ role: 'user', content: 'PAST_ONLY' }]
      })
      await contextChild('context-source', 'receipt-child', ASSISTANT_MESSAGE_ID)
      const compress = compressor()
      const input = {
        sessionId: 'receipt-child',
        compatibility: compatibility('pi'),
        budget: 2000,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }
      const prepared = (await prepareForkContext(input))!
      expect(agentSessionForkContextService.needsPreparation('receipt-child')).toBe(true)
      agentSessionForkContextService.fail('receipt-child', { code: 'network', category: 'retryable' })
      expect((await prepareForkContext(input))!.preparedContextId).toBe(prepared.preparedContextId)
      const receiptId = randomUUID()
      agentSessionForkContextService.beginSend('receipt-child', prepared.preparedContextId, randomUUID(), receiptId)
      expect(() => agentSessionForkContextService.needsPreparation('receipt-child')).toThrow('native_uncertain')
      agentSessionMessageService.saveMessage({
        sessionId: 'receipt-child',
        runtimeResumeToken: 'native-child',
        message: {
          id: receiptId,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'received' }] }
        }
      })
      expect(agentSessionForkContextService.needsPreparation('receipt-child')).toBe(false)
      const sent = agentSessionForkContextService.get('receipt-child')!.document
      dbh.db
        .update(agentSessionForkContextTable)
        .set({ document: { ...sent, version: 1 } })
        .where(eq(agentSessionForkContextTable.sessionId, 'receipt-child'))
        .run()
      const upgraded = agentSessionForkContextService.get('receipt-child')!.document
      expect(upgraded.version).toBe(2)
      expect(upgraded.state).toBe('sent')
      expect(upgraded.summaries).toHaveLength(0)
      expect(upgraded.audits[0]).toMatchObject({ outcome: 'sent', resumeToken: 'native-child' })
      expect(agentSessionForkContextService.needsPreparation('receipt-child')).toBe(false)
      expect(compress.resolveCompressor).not.toHaveBeenCalled()
      dbh.db
        .delete(agentSessionForkContextTable)
        .where(eq(agentSessionForkContextTable.sessionId, 'receipt-child'))
        .run()
      expect(() => agentSessionForkContextService.needsPreparation('receipt-child')).toThrow('native_uncertain')
    })

    it.each(['owned', 'adopted', 'legacy'] as const)(
      'safely recovers %s workspace cleanup and registration claims',
      async (kind) => {
        dbh.db.update(agentWorkspaceTable).set({ orderKey: 'a0' }).run()
        const root = await mkdtemp(path.join(tmpdir(), 'cherry-fork-cleanup-'))
        const originalGetPath = application.getPath.bind(application)
        vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
          key === 'feature.agents.forks'
            ? path.join(root, 'forks')
            : key === 'feature.agents.system_workspaces'
              ? path.join(root, 'system')
              : originalGetPath(key, ...args)
        )
        const container = application.getContainer()
        const originalGet = container.get.bind(container)
        vi.spyOn(container, 'get').mockImplementation((name) =>
          name === 'AgentFileWriteService' ? { hasWritesInside: () => false } : originalGet(name)
        )
        const operationId = randomUUID()
        const targetSessionId = randomUUID()
        const createdAt = Date.now()
        const workspace = agentWorkspaceService.buildSystemWorkspacePath(
          path.join(root, 'system'),
          targetSessionId,
          createdAt
        )
        const artifactDirectory = path.join(root, 'forks', operationId)
        try {
          await mkdir(path.join(workspace, 'adopted'), { recursive: true })
          await mkdir(artifactDirectory, { recursive: true })
          await writeFile(path.join(workspace, 'adopted', 'keep.txt'), 'keep')
          const journal: AgentSessionForkJournal = {
            version: kind === 'legacy' ? 1 : 2,
            operationId,
            sourceSessionId: randomUUID(),
            messageId: randomUUID(),
            targetSessionId,
            createdAt,
            artifactDirectory,
            artifactIdentity: await forkFileIdentity(artifactDirectory),
            workspace,
            workspaceIdentity: await forkFileIdentity(workspace),
            published: [],
            committed: true
          }
          const adopted =
            kind === 'adopted' ? agentWorkspaceService.findOrCreateByPath(path.join(workspace, 'adopted')) : undefined
          agentSessionForkService.writeJournal(journal)
          agentSessionForkService.beginCleanup(journal)
          expect(() => agentWorkspaceService.findOrCreateByPath(path.join(root, 'new'))).toThrow('fork cleanup')
          // Simulate a crash with the claim persisted: startup recovery must first release it.
          await new AgentSessionForkOperations().recover(true)
          const registered = agentWorkspaceService.findOrCreateByPath(path.join(root, 'new'))
          expect(registered.path).toBe(path.join(root, 'new'))
          if (kind === 'owned') await expect(readFile(path.join(workspace, 'adopted', 'keep.txt'))).rejects.toThrow()
          else {
            expect(await readFile(path.join(workspace, 'adopted', 'keep.txt'), 'utf8')).toBe('keep')
            expect(agentSessionForkService.journals()).toContainEqual(
              expect.objectContaining({ operationId, workspaceDisposition: 'retained', cleanupComplete: true })
            )
            if (adopted) agentWorkspaceService.deleteByIdTx(dbh.db, adopted.id)
            await new AgentSessionForkOperations().recover(true)
            expect(await readFile(path.join(workspace, 'adopted', 'keep.txt'), 'utf8')).toBe('keep')
          }
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    )

    function compressor() {
      const prompts: unknown[] = []
      const model: LanguageModelV3 = {
        specificationVersion: 'v3',
        provider: 'fixture',
        modelId: 'compressor',
        supportedUrls: {},
        async doGenerate(input) {
          prompts.push(input.prompt)
          return {
            content: [{ type: 'text', text: '<summary>Past work was completed.</summary>' }],
            finishReason: { unified: 'stop', raw: undefined },
            warnings: [],
            usage: {
              inputTokens: { total: 50, noCache: 50, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 10, text: 10, reasoning: 0 }
            }
          }
        },
        async doStream() {
          throw new Error('No model stream permitted')
        }
      }
      const resolveCompressor = vi.fn(async () => ({ languageModel: model, contextWindow: 8192 }))
      return { prompts, resolveCompressor }
    }

    it.each(['pi', 'claude-code', 'dsh'])(
      'prepares detached %s edit history without exposing later input or modifying the live conversation',
      async (runtime) => {
        await contextSource()
        const config = compatibility(runtime)
        recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
          identity: 'past-compaction',
          messages: [{ role: 'user', content: 'COMPACTED_PAST' }]
        })
        const rows = agentSessionMessageService.readForkPrefixTx(dbh.db, 'context-source', ASSISTANT_MESSAGE_ID)
        const futureId = randomUUID()
        agentSessionMessageService.saveMessage({
          sessionId: 'context-source',
          message: {
            id: futureId,
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'OLD_REQUEST_CANARY' }] }
          }
        })
        const futureReply = randomUUID()
        agentSessionMessageService.saveMessage({
          sessionId: 'context-source',
          runtimeForkState: rows[0].runtimeForkState,
          message: {
            id: futureReply,
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'OLD_ANSWER_CANARY' }] }
          }
        })
        dbh.db
          .update(agentSessionMessageTable)
          .set({ createdAt: rows[0].createdAt + 1 })
          .where(eq(agentSessionMessageTable.id, futureId))
          .run()
        dbh.db
          .update(agentSessionMessageTable)
          .set({ createdAt: rows[0].createdAt + 2 })
          .where(eq(agentSessionMessageTable.id, futureReply))
          .run()
        recordNative('context-source', futureReply, [], config, {
          identity: 'future-compaction',
          messages: [{ role: 'user', content: 'FUTURE_SUMMARY_CANARY' }]
        })
        const messagesBefore = dbh.db.select().from(agentSessionMessageTable).all()
        const contextsBefore = dbh.db.select().from(agentSessionForkContextTable).all()
        const detached = agentSessionForkContextService.createDocumentTx(dbh.db, rows, 'context-source', rows)
        const original = structuredClone(detached)
        const compress = compressor()
        const input = {
          compatibility: config,
          budget: 2000,
          resolveCompressor: compress.resolveCompressor,
          signal: new AbortController().signal
        }
        const result = await prepareForkContextDocument(input, detached)
        expect(result.state).toBe('contextReady')
        expect(result.snapshot.entries.map((entry) => entry.messageId)).toEqual([ASSISTANT_MESSAGE_ID])
        const history = buildForkHistory(result.prepared!)
        expect(history).not.toContain('CANARY')
        expect(JSON.stringify(compress.prompts)).not.toContain('CANARY')
        if (runtime !== 'claude-code') {
          expect(history).toContain('COMPACTED_PAST')
          expect(compress.prompts).toHaveLength(0)
        } else {
          expect(history).toContain('Past work was completed.')
          expect(compress.prompts.length).toBeGreaterThan(0)
        }
        const calls = compress.prompts.length
        const retry = await prepareForkContextDocument(input, result)
        expect(retry.prepared?.preparedContextId).toBe(result.prepared?.preparedContextId)
        expect(compress.prompts).toHaveLength(calls)
        expect(detached).toEqual(original)
        expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(messagesBefore)
        expect(dbh.db.select().from(agentSessionForkContextTable).all()).toEqual(contextsBefore)
        expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(2)
      }
    )

    it.each(['network', 'cancelled'] as const)(
      'keeps live history untouched after detached preparation is %s',
      async (failure) => {
        await contextSource()
        const rows = agentSessionMessageService.readForkPrefixTx(dbh.db, 'context-source', ASSISTANT_MESSAGE_ID)
        const detached = agentSessionForkContextService.createDocumentTx(dbh.db, rows, 'context-source', rows)
        const original = structuredClone(detached)
        const controller = new AbortController()
        if (failure === 'cancelled') controller.abort()
        await expect(
          prepareForkContextDocument(
            {
              compatibility: compatibility('pi'),
              budget: 1500,
              resolveCompressor: async () => {
                throw new Error('compressor unavailable')
              },
              signal: controller.signal
            },
            detached
          )
        ).rejects.toMatchObject({ detail: { code: failure } })
        expect(detached).toEqual(original)
        expect(agentSessionMessageService.readForkPrefixTx(dbh.db, 'context-source', ASSISTANT_MESSAGE_ID)).toEqual(
          rows
        )
        expect(dbh.db.select().from(agentSessionForkContextTable).all()).toEqual([])
      }
    )

    it.each(['pi', 'dsh'])(
      'serves %s compacted context without a model call after source and child deletion',
      async (runtime) => {
        await contextSource()
        const config = compatibility(runtime)
        recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
          identity: 'native-compaction',
          messages: [{ role: 'user', content: 'COMPACTED_PAST' }]
        })
        const rows = await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
        const compress = compressor()
        const input = {
          sessionId: 'context-child',
          compatibility: config,
          budget: 2000,
          resolveCompressor: compress.resolveCompressor,
          signal: new AbortController().signal
        }
        const prepared = (await prepareForkContext(input))!
        expect(buildForkHistory(prepared)).toContain('COMPACTED_PAST')
        expect(buildForkHistory(prepared)).not.toContain('OLD_VERBOSE_PAST')
        expect(compress.prompts).toHaveLength(0)
        expect(compress.resolveCompressor).not.toHaveBeenCalled()
        expect(agentSessionMessageService.getSessionMessage('context-child', rows[0].id).data.parts?.[0]).toMatchObject(
          {
            text: 'OLD_VERBOSE_PAST '.repeat(3000)
          }
        )
        expect((await prepareForkContext(input))?.preparedContextId).toBe(prepared.preparedContextId)
        await contextChild('context-child', 'context-grandchild', rows[0].id)
        agentSessionService.deleteTx(dbh.db, 'context-source')
        agentSessionService.deleteTx(dbh.db, 'context-child')
        const grandchild = (await prepareForkContext({ ...input, sessionId: 'context-grandchild' }))!
        expect(buildForkHistory(grandchild)).toContain('COMPACTED_PAST')
        expect(compress.prompts).toHaveLength(0)
        expect(
          dbh.db
            .select()
            .from(agentSessionForkContextTable)
            .where(eq(agentSessionForkContextTable.sessionId, 'context-child'))
            .get()
        ).toBeUndefined()
      }
    )

    it.each(['damaged', 'missing'])('recompresses a %s summary without including future input', async (damage) => {
      await contextSource()
      const config = compatibility('pi')
      recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
        identity: 'native-compaction',
        messages: [{ role: 'user', content: 'COMPACTED_PAST' }]
      })
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const record = agentSessionForkContextService.get('context-child')!
      if (damage === 'missing') record.document.summaries = []
      else record.document.summaries[0].segments[0].text = 'CORRUPT_FUTURE_CANARY'
      agentSessionForkContextService.save('context-child', record.revision, record.document)
      agentSessionMessageService.saveMessage({
        sessionId: 'context-child',
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'FUTURE_MESSAGE_CANARY' }] }
        }
      })
      const compress = compressor()
      const prepared = (await prepareForkContext({
        sessionId: 'context-child',
        compatibility: config,
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }))!
      expect(compress.prompts.length).toBeGreaterThan(0)
      expect(JSON.stringify(compress.prompts)).not.toContain('FUTURE_MESSAGE_CANARY')
      expect(JSON.stringify(compress.prompts)).not.toContain('CORRUPT_FUTURE_CANARY')
      expect(buildForkHistory(prepared)).not.toContain('OLD_VERBOSE_PAST')
      expect(buildForkHistory(prepared)).not.toContain('FUTURE_MESSAGE_CANARY')
    })

    it('shares preparation across callers and reuses the durable result after host restart', async () => {
      await contextSource()
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const compress = compressor()
      const input = {
        sessionId: 'context-child',
        compatibility: compatibility('pi'),
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }
      const host = new ForkContextPreparer()
      const first = host.prepare(input)
      expect(host.prepare(input)).toBe(first)
      await expect(host.prepare({ ...input, budget: 1600 })).rejects.toMatchObject({
        detail: { code: 'configuration' }
      })
      const prepared = (await first)!
      const count = compress.prompts.length
      expect((await new ForkContextPreparer().prepare(input))?.preparedContextId).toBe(prepared.preparedContextId)
      expect(compress.prompts).toHaveLength(count)
    })

    it('cancels before compression and retries without an injection receipt', async () => {
      await contextSource()
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const compress = compressor()
      const controller = new AbortController()
      controller.abort()
      const input = {
        sessionId: 'context-child',
        compatibility: compatibility('pi'),
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: controller.signal
      }
      await expect(prepareForkContext(input)).rejects.toBeDefined()
      expect(compress.prompts).toHaveLength(0)
      expect(agentSessionForkContextService.get('context-child')!.document).toMatchObject({
        state: 'cancelled',
        audits: []
      })
      expect(await prepareForkContext({ ...input, signal: new AbortController().signal })).toBeDefined()
    })

    it.each([
      [503, 'network', 'retryable'],
      [401, 'configuration', 'not_retryable']
    ])('preserves compressor failure classification for HTTP %s', async (statusCode, code, category) => {
      await contextSource()
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      await expect(
        prepareForkContext({
          sessionId: 'context-child',
          compatibility: compatibility('pi'),
          budget: 1500,
          resolveCompressor: async () => {
            throw Object.assign(new Error('fixture failure'), { statusCode })
          },
          signal: new AbortController().signal
        })
      ).rejects.toMatchObject({ detail: { code, category } })
      expect(agentSessionForkContextService.get('context-child')!.document.error).toEqual({ code, category })
    })

    it('rebuilds malformed summary records without discarding the verified input snapshot', async () => {
      await contextSource()
      const config = compatibility('pi')
      recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
        identity: 'native',
        messages: [{ role: 'user', content: 'COMPACTED_PAST' }]
      })
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const record = agentSessionForkContextService.get('context-child')!
      record.document.summaries[0].segments[0].contentHash = 'malformed-hash'
      dbh.db
        .update(agentSessionForkContextTable)
        .set({ document: record.document })
        .where(eq(agentSessionForkContextTable.sessionId, 'context-child'))
        .run()
      const compress = compressor()
      const prepared = await prepareForkContext({
        sessionId: 'context-child',
        compatibility: config,
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      })
      expect(prepared).toBeDefined()
      expect(compress.prompts.length).toBeGreaterThan(0)
      expect(JSON.stringify(compress.prompts)).not.toContain('COMPACTED_PAST')
      expect(agentSessionForkContextService.get('context-child')!.document.snapshot.hash).toBe(
        record.document.snapshot.hash
      )
    })

    it('requires the exact successful assistant receipt to reconcile a crash', async () => {
      await contextSource()
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const compress = compressor()
      const input = {
        sessionId: 'context-child',
        compatibility: compatibility('pi'),
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }
      const prepared = (await prepareForkContext(input))!
      agentSessionForkContextService.beginSend('context-child', prepared.preparedContextId, 'new-user', USER_MESSAGE_ID)
      agentSessionForkContextService.fail('context-child', { code: 'cancelled', category: 'cancelled' })
      agentSessionForkContextService.fail('context-child', { code: 'network', category: 'retryable' })
      agentSessionForkContextService.confirmSend('context-child', 'wrong-token', 'different-assistant')
      await expect(prepareForkContext(input)).rejects.toMatchObject({ detail: { category: 'needs_reconciliation' } })
      agentSessionMessageService.saveMessage({
        sessionId: 'context-child',
        runtimeResumeToken: 'confirmed-native-token',
        message: {
          id: USER_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] }
        }
      })
      expect(await prepareForkContext(input)).toBeUndefined()
      expect(agentSessionForkContextService.get('context-child')!.document).toMatchObject({
        state: 'sent',
        audits: [{ outcome: 'sent', resumeToken: 'confirmed-native-token' }]
      })
    })

    it('rejects corrupt ancestry even when the most recent summary is valid', async () => {
      await contextSource()
      const config = compatibility('pi')
      recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
        identity: 'first',
        messages: [{ role: 'user', content: 'ANCESTOR' }]
      })
      recordNative('context-source', ASSISTANT_MESSAGE_ID, [], config, {
        identity: 'second',
        messages: [{ role: 'user', content: 'LATEST_VALID_SUMMARY' }]
      })
      const rows = await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const record = agentSessionForkContextService.get('context-child')!
      expect(record.document.summaries).toHaveLength(2)
      record.document.summaries[0].segments[0].text = 'CORRUPT_ANCESTOR'
      agentSessionForkContextService.save('context-child', record.revision, record.document)
      await contextChild('context-child', 'context-grandchild', rows[0].id)
      const compress = compressor()
      const prepared = (await prepareForkContext({
        sessionId: 'context-grandchild',
        compatibility: config,
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }))!
      expect(compress.prompts.length).toBeGreaterThan(0)
      expect(buildForkHistory(prepared)).not.toContain('LATEST_VALID_SUMMARY')
      expect(JSON.stringify(compress.prompts)).not.toContain('CORRUPT_ANCESTOR')
    })

    it('persists a send intent and refuses ambiguous retries without reinjecting', async () => {
      await contextSource()
      await contextChild('context-source', 'context-child', ASSISTANT_MESSAGE_ID)
      const compress = compressor()
      const input = {
        sessionId: 'context-child',
        compatibility: compatibility('claude-code'),
        budget: 1500,
        resolveCompressor: compress.resolveCompressor,
        signal: new AbortController().signal
      }
      const prepared = (await prepareForkContext(input))!
      agentSessionForkContextService.beginSend('context-child', prepared.preparedContextId, 'new-user', 'new-assistant')
      await expect(prepareForkContext(input)).rejects.toMatchObject({
        detail: { code: 'native_uncertain', category: 'needs_reconciliation' }
      })
      agentSessionForkContextService.confirmSend('context-child', 'durable-native-token')
      expect(await prepareForkContext(input)).toBeUndefined()
      const audit = agentSessionForkContextService.get('context-child')!.document.audits[0]
      expect(audit.historyHash).toBe(forkContextHash(buildForkHistory(prepared)))
      expect(audit.messageId).toBe('new-user')
      expect(audit.outcome).toBe('sent')
    })

    it.each(['pi', 'claude-code', 'dsh'] as const)(
      'rebuilds a %s child and grandchild without parent history or execution state',
      async (type) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'cherry-fork-history-'))
        const originalGetPath = application.getPath.bind(application)
        vi.spyOn(application, 'getPath').mockImplementation((key, ...args) =>
          key === 'feature.agents.forks' ? directory : originalGetPath(key, ...args)
        )
        const fork = vi.fn().mockRejectedValue(new AgentSessionForkError('history_missing'))
        runtimeDriverRegistry.register({
          type,
          capabilities: ['agent-session'],
          fork,
          connect: vi.fn(),
          validateSession: vi.fn(),
          listAvailableTools: vi.fn()
        })
        try {
          await seedAgent('history-agent', 'History Agent')
          dbh.db.update(agentTable).set({ type }).where(eq(agentTable.id, 'history-agent')).run()
          const sourceId = randomUUID()
          await seedSession({ id: sourceId, agentId: 'history-agent', name: 'Source', orderKey: 'history-order' })
          const selected = agentSessionMessageService.saveMessage({
            sessionId: sourceId,
            runtimeForkState: null,
            message: {
              id: randomUUID(),
              role: 'assistant',
              status: 'success',
              data: {
                parts: [
                  { type: 'text', text: 'included amber' },
                  {
                    type: 'tool-Bash',
                    toolCallId: 'approval-call',
                    state: 'approval-requested',
                    input: { command: 'echo amber' },
                    approval: { id: 'must-not-inherit' }
                  }
                ]
              }
            }
          })
          agentSessionMessageService.saveMessage({
            sessionId: sourceId,
            message: {
              id: randomUUID(),
              role: 'user',
              status: 'success',
              data: { parts: [{ type: 'text', text: 'excluded violet' }] }
            }
          })
          // Shipped history has SQL NULL, unlike newly created messages' explicit boundary state.
          dbh.db
            .update(agentSessionMessageTable)
            .set({ runtimeForkState: null })
            .where(eq(agentSessionMessageTable.id, selected.id))
            .run()
          const operations = new AgentSessionForkOperations()
          const sessionsBefore = dbh.db.select().from(agentSessionTable).all().length
          await expect(operations.fork(sourceId, selected.id, false)).rejects.toMatchObject({
            reason: 'legacy_history'
          })
          expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(sessionsBefore)
          const first = operations.fork(sourceId, selected.id, true)
          expect(operations.fork(sourceId, selected.id, true)).toBe(first)
          const childId = await first
          expect(agentSessionService.getById(childId).name).toBe('Source (1)')
          const siblingId = await operations.fork(sourceId, selected.id, true)
          expect(agentSessionService.getById(siblingId).name).toBe('Source (2)')
          expect(agentSessionService.getById(sourceId).name).toBe('Source')
          expect(fork).not.toHaveBeenCalled()
          const history = agentSessionMessageService.getForkHistory(childId)!
          expect(history).toHaveLength(1)
          expect(history[0].id).not.toBe(selected.id)
          expect(JSON.stringify(history)).toContain('included amber')
          expect(JSON.stringify(history)).not.toContain('excluded violet')
          expect(JSON.stringify(history)).not.toContain('must-not-inherit')
          expect(history[0]).toMatchObject({ runtimeResumeToken: null, delivery: null, stats: null })
          expect(history[0].data.parts?.[1]).toMatchObject({ state: 'output-error' })
          const grandchildId = await operations.fork(childId, history[0].id, true)
          expect(agentSessionService.getById(grandchildId).name).toBe('Source (3)')
          agentSessionService.deleteTx(dbh.db, sourceId)
          agentSessionService.deleteTx(dbh.db, childId)
          expect(agentSessionMessageService.getForkHistory(grandchildId)?.[0].data.parts?.[0]).toEqual({
            type: 'text',
            text: 'included amber'
          })

          if (type === 'pi') {
            const grandchildMessage = agentSessionMessageService.getForkHistory(grandchildId)![0]
            const checkpoint = { runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' }
            dbh.db
              .update(agentSessionMessageTable)
              .set({
                runtimeForkState: { version: 1, status: 'available', checkpoint }
              })
              .where(eq(agentSessionMessageTable.id, grandchildMessage.id))
              .run()
            await expect(operations.fork(grandchildId, grandchildMessage.id, false)).rejects.toMatchObject({
              reason: 'history_missing'
            })
            const fallbackId = await operations.fork(grandchildId, grandchildMessage.id, true)
            expect(fork).toHaveBeenCalledOnce()
            expect(agentSessionMessageService.getForkHistory(fallbackId)?.[0].data.parts?.[0]).toEqual({
              type: 'text',
              text: 'included amber'
            })
            fork.mockResolvedValue({
              resumeToken: 'native-child',
              checkpoints: [{ ...checkpoint, runtimeSessionId: 'native-child' }],
              publish: []
            })
            dbh.db
              .update(agentSessionMessageTable)
              .set({
                runtimeForkState: { version: 1, status: 'available', checkpoint }
              })
              .where(eq(agentSessionMessageTable.id, grandchildMessage.id))
              .run()
            const nativeId = await operations.fork(grandchildId, grandchildMessage.id, false)
            expect(agentSessionMessageService.getForkHistory(nativeId)).toBeUndefined()
            expect(agentSessionMessageService.getLastRuntimeResumeToken(nativeId)).toBe('native-child')
            fork.mockRejectedValue(new Error('disk full'))
            await expect(operations.fork(grandchildId, grandchildMessage.id)).rejects.toThrow('disk full')
          }
        } finally {
          runtimeDriverRegistry.clearForTest()
          await rm(directory, { recursive: true, force: true })
        }
      }
    )

    it('keeps native checkpoints private and invalidates a selected history after edits', () => {
      const saved = agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeForkState: {
          version: 1,
          status: 'available',
          checkpoint: { runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' }
        },
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'answer' }] }
        }
      })
      expect(saved.forkAvailability).toEqual({ status: 'available' })
      expect(saved).not.toHaveProperty('runtimeForkState')
      agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, {
        data: { parts: [{ type: 'text', text: 'edited' }] }
      })
      expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).forkAvailability).toEqual({
        status: 'unavailable',
        reason: 'history_changed'
      })
    })

    it.each(['pi', 'claude-code', 'dsh'] as const)(
      'prepares an independent %s prefix without creating or modifying an application session',
      async (runtime) => {
        const checkpoint =
          runtime === 'pi'
            ? { runtime, runtimeSessionId: 'native', leafId: 'leaf-before-edit' }
            : runtime === 'dsh'
              ? { runtime, runtimeSessionId: 'native', boundary: 10 }
              : {
                  runtime,
                  runtimeSessionId: 'native',
                  messageUuid: ASSISTANT_MESSAGE_ID,
                  configDir: '/config',
                  sourceCwd: '/workspace',
                  prefixBytes: 100,
                  prefixHash: 'a'.repeat(64)
                }
        agentSessionMessageService.saveMessage({
          sessionId: SESSION_ID,
          runtimeResumeToken: 'native',
          runtimeForkState: { version: 1, status: 'available', checkpoint },
          message: {
            id: ASSISTANT_MESSAGE_ID,
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'retained history' }] }
          }
        })
        const rows = agentSessionMessageService.readForkPrefixTx(dbh.db, SESSION_ID, ASSISTANT_MESSAGE_ID, [])
        const original = structuredClone(rows)
        const fork = vi.fn(async (input: RuntimeForkInput) => ({
          resumeToken: input.targetSessionId,
          checkpoints: input.checkpoints.map((value) => ({
            ...value,
            runtimeSessionId: input.targetSessionId
          })),
          publish: []
        }))
        vi.spyOn(runtimeDriverRegistry, 'getAgentSessionDriver').mockReturnValue({
          type: runtime,
          capabilities: ['agent-session'],
          validateSession: vi.fn(),
          listAvailableTools: vi.fn(async () => []),
          connect: vi.fn(),
          fork
        })
        const input = {
          sourceSessionId: SESSION_ID,
          runtime,
          messages: rows,
          targetSessionId: 'new-native-generation',
          targetCwd: '/workspace',
          artifactDirectory: '/owned-staging',
          allowHistoryRebuild: true,
          signal: new AbortController().signal
        }
        await expect(prepareRuntimeHistory(input)).resolves.toMatchObject({
          resumeToken: 'new-native-generation',
          checkpoints: [{ ...checkpoint, runtimeSessionId: 'new-native-generation' }]
        })
        expect(
          dbh.db
            .select()
            .from(agentSessionTable)
            .all()
            .map((row) => row.id)
        ).toEqual([SESSION_ID])
        expect(agentSessionMessageService.readForkPrefixTx(dbh.db, SESSION_ID, ASSISTANT_MESSAGE_ID, [])).toEqual(
          original
        )
        expect(rows).toEqual(original)

        // A later user row is not permission to reuse an earlier assistant checkpoint.
        const callsBeforeRebuild = fork.mock.calls.length
        await expect(
          prepareRuntimeHistory({ ...input, messages: [...rows, { ...rows[0], role: 'user' }] })
        ).resolves.toBeUndefined()
        await expect(prepareRuntimeHistory({ ...input, messages: [] })).resolves.toBeUndefined()
        expect(fork.mock.calls.length).toBe(callsBeforeRebuild)
        fork.mockRejectedValueOnce(new AgentSessionForkError('history_missing'))
        await expect(prepareRuntimeHistory(input)).resolves.toBeUndefined()
        fork.mockRejectedValueOnce(new Error('disk full'))
        await expect(prepareRuntimeHistory(input)).rejects.toThrow('disk full')
        const controller = new AbortController()
        controller.abort(new Error('cancelled'))
        await expect(prepareRuntimeHistory({ ...input, signal: controller.signal })).rejects.toThrow('cancelled')
      }
    )

    it.each([
      ['Source', 'Source (1)', 'Source (2)'],
      ['test(1)', 'unrelated', 'test(2)'],
      ['test (1)', 'test (2)', 'test (3)'],
      ['test(1)', 'test (4)', 'test(5)'],
      ['test(9)', 'test(2)', 'test(10)'],
      ['test(draft)', 'unrelated', 'test(draft) (1)'],
      ['test(1) notes', 'unrelated', 'test(1) notes (1)'],
      ['test(9007199254740992)', 'unrelated', 'test(9007199254740993)']
    ])('forks %s alongside %s as %s with increasing numbering', async (sourceName, existingName, expectedName) => {
      await seedAgent('fork-agent', 'Fork Agent')
      await seedSession({ id: 'fork-source', agentId: 'fork-agent', name: sourceName, orderKey: 'fork-order' })
      await seedSession({ id: 'existing-name', agentId: 'fork-agent', name: existingName, orderKey: 'existing-order' })
      agentSessionMessageService.saveMessage({
        sessionId: 'fork-source',
        runtimeResumeToken: 'original-token',
        runtimeForkState: {
          version: 1,
          status: 'available',
          checkpoint: { runtime: 'pi', runtimeSessionId: 'native', leafId: 'leaf' }
        },
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'answer' }] }
        }
      })
      const source = agentSessionForkService.read('fork-source', ASSISTANT_MESSAGE_ID)
      const journal = {
        version: 1 as const,
        operationId: 'test-operation',
        sourceSessionId: 'fork-source',
        messageId: ASSISTANT_MESSAGE_ID,
        targetSessionId: 'fork-child',
        createdAt: Date.now(),
        artifactDirectory: '/test-owned-operation',
        published: [],
        committed: false
      }
      agentSessionMessageService.saveMessage({
        sessionId: 'fork-source',
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'later' }] }
        }
      })
      agentSessionForkService.commit({
        source,
        journal,
        excludedIds: [],
        messages: source.messages.map((row) => ({ ...row, id: FILE_ENTRY_ID, runtimeResumeToken: 'child-token' }))
      })
      expect(agentSessionService.getById('fork-child').workspaceId).toBe(source.workspace.id)
      expect(agentSessionService.getById('fork-child').name).toBe(expectedName)
      expect(agentSessionService.getById('existing-name').name).toBe(existingName)
      expect(agentSessionService.getById('fork-source').name).toBe(sourceName)
      const child = agentSessionMessageService.getSessionMessage('fork-child', FILE_ENTRY_ID)
      expect(child.runtimeResumeToken).toBe('child-token')
      expect(child.stats).toBeNull()
      expect(child.delivery).toBeNull()
      if (sourceName === 'test(1)' && existingName === 'unrelated') {
        const childSource = agentSessionForkService.read('fork-child', FILE_ENTRY_ID)
        agentSessionForkService.commit({
          source: childSource,
          journal: {
            ...journal,
            operationId: 'grandchild-operation',
            sourceSessionId: 'fork-child',
            messageId: FILE_ENTRY_ID,
            targetSessionId: 'fork-grandchild'
          },
          excludedIds: [],
          messages: childSource.messages.map((row) => ({ ...row, id: 'grandchild-message' }))
        })
        expect(agentSessionService.getById('fork-grandchild').name).toBe('test(3)')
        agentSessionForkService.commit({
          source,
          journal: { ...journal, operationId: 'sibling-operation', targetSessionId: 'fork-sibling' },
          excludedIds: [],
          messages: source.messages.map((row) => ({ ...row, id: 'sibling-message' }))
        })
        expect(agentSessionService.getById('fork-sibling').name).toBe('test(4)')
        expect(agentSessionService.getById('fork-child').name).toBe('test(2)')
      }
      agentSessionService.deleteTx(dbh.db, 'fork-source')
      expect(agentSessionService.getById('fork-child').id).toBe('fork-child')
      expect(agentSessionForkService.hasCommittedChild(journal)).toBe(true)
    })

    it('publishes no child when the source prefix changed or its parent disappeared', async () => {
      await seedAgent('fork-agent', 'Fork Agent')
      await seedSession({ id: 'fork-source', agentId: 'fork-agent', name: 'Source', orderKey: 'fork-order' })
      agentSessionMessageService.saveMessage({
        sessionId: 'fork-source',
        message: {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'answer' }] }
        }
      })
      const source = agentSessionForkService.read('fork-source', ASSISTANT_MESSAGE_ID)
      const input = {
        source,
        excludedIds: [],
        messages: source.messages.map((row) => ({ ...row, id: FILE_ENTRY_ID })),
        journal: {
          version: 1 as const,
          operationId: 'test-operation',
          sourceSessionId: 'fork-source',
          messageId: ASSISTANT_MESSAGE_ID,
          targetSessionId: 'fork-child',
          createdAt: Date.now(),
          artifactDirectory: '/test-owned-operation',
          published: [],
          committed: false
        }
      }
      agentSessionMessageService.updateSessionMessage('fork-source', ASSISTANT_MESSAGE_ID, { data: { parts: [] } })
      expect(() => agentSessionForkService.commit(input)).toThrow('source_changed')
      agentSessionService.deleteTx(dbh.db, 'fork-source')
      expect(() => agentSessionForkService.commit(input)).toThrow('source_missing')
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'fork-child')).get()
      ).toBeUndefined()
    })
  })

  describe('cross-session delivery', () => {
    it('persists same-Agent and cross-Agent envelopes before scheduling', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'same-target', agentId: 'agent-a', name: 'Same target', orderKey: 'b1' })
      await seedSession({ id: 'cross-target', agentId: 'agent-b', name: 'Cross target', orderKey: 'b2' })

      const sameAgent = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'same-target',
        content: 'same agent work'
      })
      const crossAgent = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'cross-target',
        content: 'cross agent work'
      })

      expect(sameAgent.delivery).toMatchObject({
        sender: { agentId: 'agent-a', sessionId: 'sender' },
        receiver: { agentId: 'agent-a', sessionId: 'same-target' },
        replyPolicy: 'none',
        status: 'accepted'
      })
      expect(crossAgent.delivery).toMatchObject({
        receiver: { agentId: 'agent-b', sessionId: 'cross-target' },
        status: 'accepted'
      })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries().map((message) => message.id)).toEqual([
        sameAgent.id,
        crossAgent.id
      ])
      expect(
        agentSessionMessageService.listRecoverableSessionDeliveries('same-target').map((message) => message.id)
      ).toEqual([sameAgent.id])
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'projection', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: ['same-target'] },
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: 'same-target' },
          entityIds: [sameAgent.id]
        }
      ])
    })

    it('atomically creates a same-Agent Session with its first delivery', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'shared-workspace',
        name: 'Shared',
        path: '/tmp/shared-workspace',
        type: 'user',
        orderKey: 'workspace-shared'
      })

      const created = agentSessionMessageService.createSessionWithDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        sessionName: 'Fresh work',
        workspace: { type: 'user', workspaceId: 'shared-workspace' },
        content: 'Start here'
      })

      expect(created.session).toMatchObject({
        agentId: 'agent-a',
        name: 'Fresh work',
        workspaceId: 'shared-workspace'
      })
      expect(created.message).toMatchObject({
        sessionId: created.session.id,
        data: { parts: [{ type: 'text', text: 'Start here' }] },
        delivery: {
          sender: { agentId: 'agent-a', sessionId: 'sender' },
          receiver: { agentId: 'agent-a', sessionId: created.session.id },
          replyPolicy: 'completion',
          status: 'accepted'
        }
      })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'membership', entityIds: [created.session.id] },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          entityIds: [created.message.id]
        }
      ])
    })

    it('rolls back the new Session when the sender identity is stale', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'rollback-workspace',
        name: 'Rollback',
        path: '/tmp/rollback-workspace',
        type: 'user',
        orderKey: 'workspace-rollback'
      })
      const sessionsBefore = await dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable)

      expect(() =>
        agentSessionMessageService.createSessionWithDelivery({
          senderAgentId: 'agent-b',
          senderSessionId: 'sender',
          sessionName: 'Must roll back',
          workspace: { type: 'user', workspaceId: 'rollback-workspace' },
          content: 'Do not persist'
        })
      ).toThrow()

      const sessionsAfter = await dbh.db.select({ id: agentSessionTable.id }).from(agentSessionTable)
      expect(sessionsAfter).toEqual(sessionsBefore)
      expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
    })

    it('rejects a forged sender identity without writing a message', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })

      expect(() =>
        agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-b',
          senderSessionId: 'sender',
          receiverSessionId: 'target',
          content: 'forged'
        })
      ).toThrowError(expect.objectContaining<Partial<AgentSessionDeliveryRoutingError>>({ code: 'SENDER_FORBIDDEN' }))
      expect(agentSessionMessageService.listSessionDeliveries('target')).toEqual([])
    })

    it('returns stable errors for missing, orphaned, and deleted targets', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-deleted', 'Deleted', Date.now())
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'orphan', name: 'Orphan', orderKey: 'b1' })
      await seedSession({ id: 'deleted-target', agentId: 'agent-deleted', name: 'Deleted target', orderKey: 'b2' })

      const send = (receiverSessionId: string) =>
        agentSessionMessageService.acceptSessionDelivery({
          senderAgentId: 'agent-a',
          senderSessionId: 'sender',
          receiverSessionId,
          content: 'work'
        })

      expect(() => send('missing')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_NOT_FOUND' }))
      expect(() => send('orphan')).toThrowError(expect.objectContaining({ code: 'TARGET_SESSION_ORPHANED' }))
      expect(() => send('deleted-target')).toThrowError(expect.objectContaining({ code: 'TARGET_AGENT_DELETED' }))
    })

    it('keeps accepted and delivering rows recoverable until terminal consumption', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-a', name: 'Target', orderKey: 'b1' })
      const accepted = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'durable work'
      })

      agentSessionMessageService.transitionSessionDelivery('target', accepted.id, 'delivering', {
        expected: ['accepted'],
        turnRef: 'assistant-turn'
      })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toHaveLength(1)

      const consumed = agentSessionMessageService.updateSessionDeliveryStatus('target', accepted.id, 'consumed')
      expect(consumed?.delivery).toMatchObject({ status: 'consumed', statusAt: expect.any(String) })
      expect(agentSessionMessageService.listRecoverableSessionDeliveries()).toEqual([])
    })

    it('rejects deleting a non-terminal delivery message', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-a', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'durable work'
      })

      expect(() => agentSessionMessageService.deleteSessionMessage('target', request.id)).toThrowError(
        expect.objectContaining({ code: 'RESOURCE_LOCKED' })
      )
      expect(agentSessionMessageService.getSessionMessage('target', request.id).id).toBe(request.id)
    })

    it('finalizes one frozen completion result after terminal persistence', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })
      const assistantId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d090'
      agentSessionMessageService.saveMessage({
        sessionId: 'target',
        message: {
          id: assistantId,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'Frozen result' }] }
        }
      })
      agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
        expected: ['accepted'],
        turnRef: assistantId
      })

      const first = agentSessionMessageService.finalizeSessionDelivery({
        requestSessionId: 'target',
        requestMessageId: request.id,
        assistantMessageId: assistantId,
        outcome: 'success'
      })
      const second = agentSessionMessageService.finalizeSessionDelivery({
        requestSessionId: 'target',
        requestMessageId: request.id,
        assistantMessageId: assistantId,
        outcome: 'success'
      })

      expect(first).toMatchObject({
        sessionId: 'sender',
        data: { parts: [{ type: 'text', text: 'Frozen result' }] },
        delivery: {
          inReplyTo: request.id,
          sourceMessageId: assistantId,
          outcome: 'success',
          status: 'accepted'
        }
      })
      expect(second).toBeNull()
      agentSessionMessageService.updateSessionMessage('target', assistantId, {
        data: { parts: [{ type: 'text', text: 'Edited later' }] }
      })
      expect(agentSessionMessageService.getSessionMessage('sender', first!.id).data).toEqual({
        parts: [{ type: 'text', text: 'Frozen result' }]
      })
      expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
        status: 'consumed',
        outcome: 'success'
      })
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
        { endpoint: '/agent-sessions', kind: 'projection', entityIds: ['sender'] },
        { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: ['sender'] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: ['sender'] },
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId: 'target' },
          entityIds: [request.id]
        },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: 'sender' },
          entityIds: [first!.id]
        }
      ])
      expect(
        agentSessionMessageService
          .listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
          .map((message) => message.id)
          .sort()
      ).toEqual([first!.id, request.id].sort())
    })

    it('creates a failure result before deleting a target with an unfinished completion request', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })

      agentSessionService.delete('target')

      const [result] = agentSessionMessageService.listSessionDeliveries({
        sessionId: 'sender',
        requestId: request.id
      })
      expect(result).toMatchObject({
        sessionId: 'sender',
        delivery: {
          inReplyTo: request.id,
          outcome: 'failed',
          error: { code: 'TARGET_SESSION_DELETED' }
        }
      })
    })

    it('interrupts an active completion before deleting its Agent while retaining the target Session', async () => {
      await seedAgent('agent-a', 'Agent A')
      await seedAgent('agent-b', 'Agent B')
      await seedSession({ id: 'sender', agentId: 'agent-a', name: 'Sender', orderKey: 'b0' })
      await seedSession({ id: 'target', agentId: 'agent-b', name: 'Target', orderKey: 'b1' })
      const request = agentSessionMessageService.acceptSessionDelivery({
        senderAgentId: 'agent-a',
        senderSessionId: 'sender',
        receiverSessionId: 'target',
        content: 'Do the work',
        replyPolicy: 'completion'
      })
      agentSessionMessageService.transitionSessionDelivery('target', request.id, 'delivering', {
        expected: ['accepted'],
        turnRef: 'assistant-turn'
      })

      agentService.deleteAgent('agent-b', { deleteSessions: false })

      expect(agentSessionMessageService.getSessionMessage('target', request.id).delivery).toMatchObject({
        status: 'failed',
        outcome: 'interrupted',
        error: { code: 'TARGET_AGENT_DELETED' }
      })
      expect(agentSessionService.getById('target').agentId).toBeNull()
      const [result] = agentSessionMessageService.listSessionDeliveries({ sessionId: 'sender', requestId: request.id })
      expect(result.delivery).toMatchObject({
        inReplyTo: request.id,
        outcome: 'interrupted',
        error: { code: 'TARGET_AGENT_DELETED' }
      })
    })
  })

  describe('findCrashOrphanedAssistantMessages + resolveCrashOrphanedMessages (boot reconcile)', () => {
    it('finds only pending assistant rows and resolves them to error with the given data', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d010'
      const DONE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d011'
      const PENDING_USER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d012'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: DONE, role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'done' }] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: { id: PENDING_USER, role: 'user', status: 'pending', data: { parts: [{ type: 'text', text: 'q' }] } }
      })

      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([
        { id: PENDING, sessionId: SESSION_ID, data: { parts: [] } }
      ])

      now.mockReturnValue(5_000)
      const finalizedData = { parts: [{ type: 'text' as const, text: 'terminalized' }] }
      agentSessionMessageService.resolveCrashOrphanedMessages([{ id: PENDING, data: finalizedData }], [SESSION_ID])
      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([])
      const [row] = await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, PENDING))
      const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
      expect(row.status).toBe('error')
      expect(row.data).toEqual(finalizedData)
      expect(session.lastActivityAt).toBe(1_000)
    })

    it('finds settled assistant rows whose approval registry was lost on restart', () => {
      const ORPHANED = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d013'
      const COMPLETE = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d014'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: ORPHANED,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'tool-call-1',
                toolName: 'screenshot',
                state: 'approval-requested',
                input: {},
                approval: { id: 'approval-1' }
              }
            ]
          }
        }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: COMPLETE,
          role: 'assistant',
          status: 'success',
          data: {
            parts: [
              {
                type: 'dynamic-tool',
                toolCallId: 'tool-call-2',
                toolName: 'list_tabs',
                state: 'output-available',
                input: {},
                output: {}
              }
            ]
          }
        }
      })

      expect(agentSessionMessageService.findCrashOrphanedAssistantMessages()).toEqual([
        expect.objectContaining({ id: ORPHANED, sessionId: SESSION_ID })
      ])
    })

    it('discards resume tokens only for the affected sessions', async () => {
      const OTHER_SESSION_ID = 'session-2'
      await seedSession({ id: OTHER_SESSION_ID, name: 'Other', orderKey: 'a1' })
      const PENDING = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d020'
      const EARLIER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d021'
      const OTHER = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d022'
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeResumeToken: 'token-earlier',
        message: { id: EARLIER, role: 'assistant', status: 'success', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeResumeToken: 'token-crashed',
        message: { id: PENDING, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.saveMessage({
        sessionId: OTHER_SESSION_ID,
        runtimeResumeToken: 'token-other',
        message: { id: OTHER, role: 'assistant', status: 'success', data: { parts: [] } }
      })

      agentSessionMessageService.resolveCrashOrphanedMessages([{ id: PENDING, data: { parts: [] } }], [SESSION_ID])

      // The whole crashed session loses its tokens — the earlier turn's token would still resume
      // the untrusted external CLI state, so the next connection must start without one.
      expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBeNull()
      expect(agentSessionMessageService.getLastRuntimeResumeToken(OTHER_SESSION_ID)).toBe('token-other')
    })
  })

  it('atomically settles a persisted background tool approval with the user-updated input', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: {
          parts: [
            {
              type: 'tool-AskUserQuestion',
              toolCallId: 'tool-call-1',
              state: 'approval-requested',
              input: { questions: [] },
              approval: { id: 'approval-1' }
            }
          ]
        }
      }
    })
    const updatedInput = { questions: [], answers: { Choice: 'SQLite' } }

    now.mockReturnValue(2_000)
    expect(
      agentSessionMessageService.applyToolApprovalDecision(SESSION_ID, ASSISTANT_MESSAGE_ID, {
        approvalId: 'approval-1',
        approved: true,
        updatedInput
      })
    ).toBe(true)

    const saved = agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    expect(saved.data.parts?.[0]).toMatchObject({
      state: 'approval-responded',
      input: updatedInput,
      approval: { id: 'approval-1', approved: true }
    })
    const [session] = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID)).all()
    expect(session.lastActivityAt).toBe(2_000)
    now.mockRestore()
  })

  it('keeps attachment refs in sync with agent-session message history', async () => {
    await dbh.db.insert(fileEntryTable).values({
      id: FILE_ENTRY_ID,
      origin: 'internal',
      name: 'report',
      ext: 'pdf',
      size: 42,
      cleanupPolicy: 'delete_when_unreferenced'
    })
    const filePart = {
      type: 'file' as const,
      url: 'file:///stale/location/report.pdf',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
      providerMetadata: { cherry: { fileEntryId: FILE_ENTRY_ID } }
    }

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'inspect' }, filePart, filePart] }
      }
    })

    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([
      expect.objectContaining({ fileEntryId: FILE_ENTRY_ID, sourceId: USER_MESSAGE_ID, role: 'attachment' })
    ])

    agentSessionMessageService.updateSessionMessage(SESSION_ID, USER_MESSAGE_ID, {
      data: { parts: [{ type: 'text', text: 'attachment removed' }] }
    })
    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([])

    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', data: { parts: [filePart] } }
    })
    agentSessionMessageService.deleteSessionMessage(SESSION_ID, USER_MESSAGE_ID)
    expect(await dbh.db.select().from(agentSessionMessageFileRefTable)).toEqual([])
  })

  it('creates messages with service-owned audit timestamps', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const saved = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_000)
    expect(session.updatedAt).toBe(1_700_000_000_000)
    expect(session.lastActivityAt).toBe(1_700_000_000_000)
    expect(saved.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(saved.updatedAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('writes neither user nor pending assistant when the session agent changed before the transaction', async () => {
    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        'agent-that-no-longer-owns-session'
      )
    ).toThrow(`Session with id '${SESSION_ID}' not found`)

    expect(
      await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
    ).toEqual([])
  })

  it('writes neither message when the owning Agent changed after validation', async () => {
    await seedAgent('agent-a', 'Agent A')
    await dbh.db.update(agentSessionTable).set({ agentId: 'agent-a' }).where(eq(agentSessionTable.id, SESSION_ID))
    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'agent-a'))
    await dbh.db
      .update(agentTable)
      .set({ name: 'Agent A updated', updatedAt: agent.updatedAt + 1 })
      .where(eq(agentTable.id, 'agent-a'))

    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        {
          id: 'agent-a',
          updatedAt: new Date(agent.updatedAt).toISOString(),
          model: 'provider::validated-model',
          type: 'claude-code'
        }
      )
    ).toThrow("Agent 'agent-a' was modified by another user")

    expect(
      await dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.sessionId, SESSION_ID))
    ).toEqual([])
  })

  it('compares legacy cherry-claw rows by their normalized runtime type', async () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'legacy', name: 'Legacy', orderKey: 'p0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'legacy::model',
        providerId: 'legacy',
        modelId: 'model',
        presetModelId: 'model',
        name: 'Legacy model',
        isEnabled: true,
        isHidden: false,
        orderKey: 'm0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'legacy-agent',
        type: 'cherry-claw',
        name: 'Legacy Agent',
        instructions: '',
        model: 'legacy::model',
        orderKey: 'a0'
      })
      .run()
    dbh.db.update(agentSessionTable).set({ agentId: 'legacy-agent' }).where(eq(agentSessionTable.id, SESSION_ID)).run()
    const [agent] = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy-agent')).all()

    expect(() =>
      agentSessionMessageService.saveMessages(
        {
          sessionId: SESSION_ID,
          messages: [
            { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'run' }] } },
            { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
          ]
        },
        {
          id: 'legacy-agent',
          updatedAt: new Date(agent.updatedAt).toISOString(),
          model: 'legacy::model',
          type: 'claude-code'
        }
      )
    ).not.toThrow()
  })

  it('terminalizes a pending assistant after live persistence fails', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      runtimeResumeToken: 'resume-token',
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [] } }
    })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    notifyDataApiDataChangeMock.mockClear()

    agentSessionMessageService.markAssistantMessageTerminalError(SESSION_ID, ASSISTANT_MESSAGE_ID)

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).toBe('error')
    expect(agentSessionMessageService.getLastRuntimeResumeToken(SESSION_ID)).toBe('resume-token')
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [ASSISTANT_MESSAGE_ID]
      }
    ])
  })

  it('keeps createdAt stable when updating an existing message', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const created = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] }
      }
    })
    now.mockReturnValue(1_700_000_000_500)
    const updated = agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'edited' }] }
      }
    })

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(row.createdAt).toBe(1_700_000_000_000)
    expect(row.updatedAt).toBe(1_700_000_000_500)
    expect(session.updatedAt).toBe(1_700_000_000_500)
    expect(session.lastActivityAt).toBe(1_700_000_000_000)
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.updatedAt).toBe('2023-11-14T22:13:20.500Z')
  })

  it('advances each pending assistant response segment but not a terminal rewrite', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })

    now.mockReturnValue(1_700_000_000_500)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'done' }] }
      }
    })

    now.mockReturnValue(1_700_000_001_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'projection rewrite' }] }
      }
    })

    const [message] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, ASSISTANT_MESSAGE_ID))
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(session.lastActivityAt).toBe(1_700_000_000_500)
    expect(session.updatedAt).toBe(1_700_000_001_000)

    now.mockReturnValue(1_700_000_001_500)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: message.data }
    })
    now.mockReturnValue(1_700_000_002_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'success', data: message.data }
    })

    const [continuedSession] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(continuedSession.lastActivityAt).toBe(1_700_000_002_000)
  })

  it('keeps session activity after messages are deleted', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: USER_MESSAGE_ID, role: 'user', status: 'success', data: { parts: [] } }
    })
    now.mockReturnValue(2_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    now.mockReturnValue(3_000)
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: { id: ASSISTANT_MESSAGE_ID, role: 'assistant', status: 'success', data: { parts: [] } }
    })

    agentSessionMessageService.deleteSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(session.lastActivityAt).toBe(3_000)

    agentSessionMessageService.deleteSessionMessage(SESSION_ID, USER_MESSAGE_ID)
    const [emptySession] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))
    expect(emptySession.lastActivityAt).toBe(3_000)
  })

  it('publishes the data change derived from an inserted or updated message', () => {
    agentSessionMessageService.saveMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        }
      },
      { publishDataChange: true }
    )

    expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        { endpoint: '/agent-sessions/latest' },
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'membership',
          routeParams: { sessionId: SESSION_ID },
          entityIds: [USER_MESSAGE_ID]
        }
      ])
    )

    agentSessionMessageService.saveMessage(
      {
        sessionId: SESSION_ID,
        message: {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'updated' }] }
        }
      },
      { publishDataChange: true }
    )

    expect(notifyDataApiDataChangeMock).toHaveBeenLastCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [USER_MESSAGE_ID]
      }
    ])
  })

  it('reads and updates message data within the owning Agent session', async () => {
    const otherSessionId = 'session-other-update'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'b0' })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'error',
        data: { parts: [{ type: 'data-error', data: { message: 'failed' } }] }
      }
    })

    expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).toBe('error')
    expect(() => agentSessionMessageService.getSessionMessage(otherSessionId, ASSISTANT_MESSAGE_ID)).toThrow(
      "Message with id '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002' not found"
    )

    const data = {
      parts: [
        {
          type: 'data-error' as const,
          data: { message: 'failed' },
          providerMetadata: { cherry: { diagnosis: { summary: 'Check the provider' } } }
        }
      ]
    }
    const updated = agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, { data })

    expect(updated.data).toEqual(data)
    expect(updated.status).toBe('error')
    expect(() =>
      agentSessionMessageService.updateSessionMessage(otherSessionId, ASSISTANT_MESSAGE_ID, { data })
    ).toThrow("Message with id '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002' not found")
  })

  it('preserves turnOptions when a data patch sends only parts', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'answer' }], turnOptions: { reasoningEffort: 'high', fastMode: true } }
      }
    })

    const updated = agentSessionMessageService.updateSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID, {
      data: { parts: [{ type: 'text', text: 'edited' }] }
    })

    expect(updated.data.parts).toEqual([{ type: 'text', text: 'edited' }])
    expect(updated.data.turnOptions).toEqual({ reasoningEffort: 'high', fastMode: true })
  })

  it('replaces parts on the original assistant row', () => {
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'success',
        data: {
          parts: [
            {
              type: 'tool-Agent',
              toolCallId: 'task-root',
              state: 'input-available',
              input: { prompt: 'Audit' }
            }
          ]
        }
      }
    })

    agentSessionMessageService.replaceMessageParts(SESSION_ID, ASSISTANT_MESSAGE_ID, [
      {
        type: 'tool-Agent',
        toolCallId: 'task-root',
        state: 'input-available',
        input: { prompt: 'Audit' }
      },
      {
        type: 'text',
        text: 'Subagent finished',
        providerMetadata: { cherry: { parentToolCallId: 'task-root' } }
      }
    ])

    const saved = agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    expect(saved.status).toBe('success')
    expect(saved.data.parts).toEqual([
      expect.objectContaining({ toolCallId: 'task-root' }),
      expect.objectContaining({ type: 'text', text: 'Subagent finished' })
    ])
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId: SESSION_ID },
        entityIds: [ASSISTANT_MESSAGE_ID]
      }
    ])
  })

  it('keeps the session timestamp aligned with a newly saved message batch', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_700_000_001_000).mockReturnValue(1_700_000_002_000)

    agentSessionMessageService.saveMessages({
      sessionId: SESSION_ID,
      messages: [
        {
          id: USER_MESSAGE_ID,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        },
        {
          id: ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] }
        }
      ]
    })

    const rows = await dbh.db.select().from(agentSessionMessageTable)
    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, SESSION_ID))

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.createdAt)).toEqual([1_700_000_001_000, 1_700_000_001_000])
    expect(session.updatedAt).toBe(1_700_000_001_000)
  })

  it('pages body-free canonical metadata in a closed range without skipping timestamp ties', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: 'range-start',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'start' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: 'range-tie-a',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'tie a' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: 'range-tie-z',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'tie z' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: 'range-end',
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: '结束🙂\n"quoted"\\slash' }] },
        status: 'success',
        runtimeResumeToken: 'resume-token',
        delivery: {
          version: 1,
          sender: { agentId: 'sender-agent', sessionId: 'sender-session' },
          receiver: { agentId: 'receiver-agent', sessionId: SESSION_ID },
          replyPolicy: 'completion',
          sourceMessageId: null,
          outcome: null,
          error: null,
          statusAt: '1970-01-01T00:00:00.300Z'
        },
        deliveryStatus: 'accepted',
        deliveryInReplyTo: null,
        deliveryTurnRef: null,
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: 'range-before',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'before' }] },
        status: 'success',
        createdAt: 99,
        updatedAt: 99
      },
      {
        id: 'range-after',
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'after' }] },
        status: 'success',
        createdAt: 301,
        updatedAt: 301
      }
    ])

    const firstPage = agentSessionMessageService.listCreatedInRangeMetadataPage({ fromMs: 100, toMs: 300, limit: 2 })
    const secondPage = agentSessionMessageService.listCreatedInRangeMetadataPage({
      fromMs: 100,
      toMs: 300,
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((message) => message.id)).toEqual(['range-end', 'range-tie-a'])
    expect(secondPage.items.map((message) => message.id)).toEqual(['range-tie-z', 'range-start'])
    expect(secondPage.nextCursor).toBeUndefined()
    for (const metadata of [...firstPage.items, ...secondPage.items]) {
      const entity = agentSessionMessageService.getSessionMessage(metadata.sessionId, metadata.id)
      expect(metadata).not.toHaveProperty('data')
      expect(metadata.createdAt).toBe(entity.createdAt)
      expect(metadata.entityJsonBytes).toBe(Buffer.byteLength(JSON.stringify(entity), 'utf8'))
    }
  })

  it('plans the global keyset range walk without a temporary order-by sort', () => {
    const plan = dbh.sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id
         FROM agent_session_message
         WHERE created_at >= ?
           AND created_at <= ?
           AND (created_at < ? OR (created_at = ? AND id > ?))
         ORDER BY created_at DESC, id ASC
         LIMIT ?`
      )
      .all(100, 300, 200, 200, 'cursor-id', 101) as Array<{ detail: string }>

    expect(
      plan.some(({ detail }) => detail.includes('USING COVERING INDEX agent_session_message_created_at_id_idx'))
    ).toBe(true)
    expect(plan.some(({ detail }) => detail.includes('USE TEMP B-TREE FOR ORDER BY'))).toBe(false)
  })

  it('falls back to the newest page when list pagination receives a malformed cursor', async () => {
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: USER_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: ASSISTANT_MESSAGE_ID,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      cursor: 'not-a-cursor',
      limit: 1
    })

    expect(result.items.map((item) => item.id)).toEqual([ASSISTANT_MESSAGE_ID])
    expect(result.nextCursor).toBe(`200:${ASSISTANT_MESSAGE_ID}`)
  })

  it('anchors list pagination at messageId and continues older pages with cursor', async () => {
    const older = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d301'
    const middle = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d302'
    const target = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d303'
    const newer = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d304'
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: older,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: middle,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: target,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'target' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: newer,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer' }] },
        status: 'success',
        createdAt: 400,
        updatedAt: 400
      }
    ])

    const firstPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      limit: 2
    })
    const secondPage = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: target,
      cursor: firstPage.nextCursor,
      limit: 2
    })

    expect(firstPage.items.map((item) => item.id)).toEqual([target, middle])
    expect(firstPage.nextCursor).toBe(`200:${middle}`)
    expect(secondPage.items.map((item) => item.id)).toEqual([older])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('falls back to the newest page when the anchor messageId is outside the requested session', async () => {
    const otherSessionId = 'session-other'
    const otherMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d305'
    const newestMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d306'
    await seedSession({ id: otherSessionId, name: 'Other Session', orderKey: 'b0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: otherMessageId,
        sessionId: otherSessionId,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: newestMessageId,
        sessionId: SESSION_ID,
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newest' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.listSessionMessages(SESSION_ID, {
      messageId: otherMessageId
    })

    expect(result.items.map((item) => item.id)).toEqual([newestMessageId])
    expect(result.nextCursor).toBeUndefined()
  })

  it('indexes text parts but excludes reasoning, and keeps the FTS index in sync', async () => {
    // Privacy guard: `reasoning` parts hold the model's hidden chain-of-thought, which the session
    // UI does not render. They must never reach `searchable_text` (which global-search snippets
    // show verbatim) nor the FTS index. Only `text` parts are searchable.
    await dbh.db.insert(agentSessionMessageTable).values({
      id: USER_MESSAGE_ID,
      sessionId: SESSION_ID,
      role: 'user',
      data: {
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'reasoning', text: 'thinking' }
        ]
      },
      status: 'success'
    })

    const [inserted] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))
    expect(inserted.searchableText).toBe('hello')

    const helloMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('hello') as Array<{ id: string }>
    expect(helloMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])

    const thinkingMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    expect(thinkingMatches).toHaveLength(0)

    await dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'updated target' }] } })
      .where(eq(agentSessionMessageTable.id, USER_MESSAGE_ID))

    const staleMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('thinking') as Array<{ id: string }>
    const targetMatches = dbh.sqlite
      .prepare(
        `SELECT m.id
            FROM agent_session_message m
            JOIN agent_session_message_fts fts ON m.fts_rowid = fts.rowid
            WHERE agent_session_message_fts MATCH ?`
      )
      .all('target') as Array<{ id: string }>

    expect(staleMatches).toHaveLength(0)
    expect(targetMatches.map((row) => String(row.id))).toEqual([USER_MESSAGE_ID])
  })

  it('searches session message parts text', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'agent-search',
      type: 'claude-code',
      name: 'Search Agent',
      instructions: 'Search instructions',
      model: null,
      orderKey: 'a0'
    })
    await seedSession({
      id: 'session-search',
      agentId: 'agent-search',
      name: 'Session Search',
      orderKey: 's0',
      createdAt: 150,
      updatedAt: 150
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
      sessionId: 'session-search',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'The session message has a unique needle.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({ q: 'needle' })

    expect(result.items).toEqual([
      expect.objectContaining({
        messageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
        sessionId: 'session-search',
        sessionName: 'Session Search',
        agentId: 'agent-search',
        agentName: 'Search Agent',
        role: 'assistant'
      })
    ])
    expect(result.items[0].snippet).toContain('unique needle')
  })

  it('matches extracted text instead of serialized JSON escapes', async () => {
    await seedSession({
      id: 'session-escaped',
      name: 'Session Escaped',
      orderKey: 'se0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102',
      sessionId: 'session-escaped',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'line one\nline two' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({
      q: '"line one\nline two"'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102'])
  })

  it('defaults session message search to substring matching', async () => {
    await seedSession({
      id: 'session-substring-default',
      name: 'Session Substring Default',
      orderKey: 'ssd0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa',
      sessionId: 'session-substring-default',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'abcneedledef is embedded in a larger token.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const result = agentSessionMessageService.search({ q: 'needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1aa'])
  })

  it('requires all search terms to match a session message', async () => {
    await seedSession({
      id: 'session-search-and',
      name: 'Session Search And',
      orderKey: 'ssa0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'alpha needle appear together.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bb',
        sessionId: 'session-search-and',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle appears without the other term.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.search({ q: 'alpha needle' })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ba'])
  })

  it('ranks Agent-tool search by BM25 instead of requiring every term', async () => {
    await seedSession({ id: 'session-ranked', name: 'Session Ranked', orderKey: 'sr0' })
    await seedSession({ id: 'session-ranked-secondary', name: 'Session Ranked Secondary', orderKey: 'sr1' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ca',
        sessionId: 'session-ranked-secondary',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'hyperfine benchmark setup' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cb',
        sessionId: 'session-ranked',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'install and verify hyperfine with cowsay' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'hyperfine cowsay', limit: 2 })

    expect(result.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cb',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ca'
    ])
  })

  it('applies ranked-search limit to distinct Sessions', async () => {
    await seedSession({ id: 'session-ranked-frequent', name: 'Ranked Frequent', orderKey: 'srf0' })
    await seedSession({ id: 'session-ranked-diverse', name: 'Ranked Diverse', orderKey: 'srd0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      ...Array.from({ length: 25 }, (_, index) => ({
        id: `018f6ed6-73b8-7f40-8d0d-9bb2f8f1${String(index).padStart(4, '0')}`,
        sessionId: 'session-ranked-frequent',
        role: 'assistant' as const,
        data: { parts: [{ type: 'text' as const, text: 'needle' }] },
        status: 'success' as const,
        createdAt: 500 - index,
        updatedAt: 500 - index
      })),
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cf',
        sessionId: 'session-ranked-diverse',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle appears in another Session' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'needle', limit: 2 })

    expect(result.map((item) => item.sessionId)).toEqual(['session-ranked-frequent', 'session-ranked-diverse'])
  })

  it('bounds synchronous ranked-search evidence scanning', async () => {
    await seedSession({ id: 'session-ranked-overflow', name: 'Ranked Overflow', orderKey: 'sro0' })
    await seedSession({ id: 'session-ranked-after-cap', name: 'Ranked After Cap', orderKey: 'srac0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      ...Array.from({ length: 400 }, (_, index) => ({
        id: `ranked-overflow-${String(index).padStart(4, '0')}`,
        sessionId: 'session-ranked-overflow',
        role: 'assistant' as const,
        data: { parts: [{ type: 'text' as const, text: 'boundedneedle' }] },
        status: 'success' as const,
        createdAt: 1_000 - index,
        updatedAt: 1_000 - index
      })),
      {
        id: 'ranked-after-cap',
        sessionId: 'session-ranked-after-cap',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'boundedneedle' }] },
        status: 'success',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    expect(
      agentSessionMessageService.searchRanked({ q: 'boundedneedle', limit: 2 }).map((item) => item.sessionId)
    ).toEqual(['session-ranked-overflow'])
  })

  it('applies the Agent filter before the ranked-search limit', async () => {
    await seedAgent('agent-ranked-a', 'Ranked A')
    await seedAgent('agent-ranked-b', 'Ranked B')
    await seedSession({ id: 'session-ranked-a', agentId: 'agent-ranked-a', name: 'Ranked A', orderKey: 'sra0' })
    await seedSession({ id: 'session-ranked-b', agentId: 'agent-ranked-b', name: 'Ranked B', orderKey: 'srb0' })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cc',
        sessionId: 'session-ranked-a',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle from another Agent' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cd',
        sessionId: 'session-ranked-b',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle from the requested Agent' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const result = agentSessionMessageService.searchRanked({ q: 'needle', agentId: 'agent-ranked-b', limit: 1 })

    expect(result.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1cd'])
  })

  it('supports exact identifiers, short CJK fallback, and empty ranked results', async () => {
    await seedSession({ id: 'session-ranked-shapes', name: 'Ranked Shapes', orderKey: 'srs0' })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce',
      sessionId: 'session-ranked-shapes',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'TEST_ECHO_42 今天天气很好' }] },
      status: 'success',
      createdAt: 100,
      updatedAt: 100
    })

    expect(agentSessionMessageService.searchRanked({ q: 'TEST_ECHO_42' }).map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce'
    ])
    expect(agentSessionMessageService.searchRanked({ q: '天气' }).map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ce'
    ])
    expect(agentSessionMessageService.searchRanked({ q: '全部不存在xyzzy' })).toEqual([])
  })

  it('deduplicates and caps pure-LIKE fallback terms below SQLite expression depth', async () => {
    await seedSession({ id: 'session-ranked-fallback-cap', name: 'Fallback Cap', orderKey: 'srfc0' })
    const uniqueShortTerms = Array.from({ length: 512 }, (_, index) => String.fromCodePoint(0x400 + index))
      .filter((term) => /^\p{L}$/u.test(term))
      .slice(0, 129)
    expect(uniqueShortTerms).toHaveLength(129)
    await dbh.db.insert(agentSessionMessageTable).values({
      id: 'ranked-fallback-cap',
      sessionId: 'session-ranked-fallback-cap',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: uniqueShortTerms.slice(0, 128).join(' ') }] },
      status: 'success',
      createdAt: 100,
      updatedAt: 100
    })

    expect(() =>
      agentSessionMessageService.searchRanked({ q: `${'a '.repeat(993)}${uniqueShortTerms[0]}` })
    ).not.toThrow()
    expect(
      agentSessionMessageService.searchRanked({ q: uniqueShortTerms.join(' ') }).map((item) => item.messageId)
    ).toEqual(['ranked-fallback-cap'])
  })

  it('treats LIKE wildcards as literal session-message search text after FTS prefiltering', async () => {
    await seedSession({
      id: 'session-search-literal',
      name: 'Session Search Literal',
      orderKey: 'ssl0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50% off today.' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bd',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50X off today.' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be',
        sessionId: 'session-search-literal',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'Save 50_ off today.' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const percentResult = agentSessionMessageService.search({ q: '50%' })
    const underscoreResult = agentSessionMessageService.search({ q: '50_' })

    expect(percentResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1bc'])
    expect(underscoreResult.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1be'])
  })

  it('uses the session message FTS index as the search candidate source', async () => {
    await seedSession({
      id: 'session-fts-candidate',
      name: 'Session FTS Candidate',
      orderKey: 'sfc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab',
      sessionId: 'session-fts-candidate',
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'needle exists in the base session message text.' }] },
      status: 'success',
      createdAt: 300,
      updatedAt: 300
    })

    const ftsRow = dbh.sqlite
      .prepare('SELECT fts_rowid, searchable_text FROM agent_session_message WHERE id = ?')
      .get('018f6ed6-73b8-7f40-8d0d-9bb2f8f1d1ab') as { fts_rowid: number; searchable_text: string }
    dbh.sqlite
      .prepare(
        `INSERT INTO agent_session_message_fts(agent_session_message_fts, rowid, searchable_text)
            VALUES ('delete', ?, ?)`
      )
      .run(ftsRow.fts_rowid, ftsRow.searchable_text)

    let result: Awaited<ReturnType<typeof agentSessionMessageService.search>>
    try {
      result = agentSessionMessageService.search({ q: 'needle' })
    } finally {
      dbh.sqlite.prepare(`INSERT INTO agent_session_message_fts(agent_session_message_fts) VALUES ('rebuild')`).run()
    }

    expect(result.items).toEqual([])
  })

  it('filters session message search by session id', async () => {
    await seedSessions([
      {
        id: 'session-source-filter',
        name: 'Session Source Filter',
        orderKey: 'sf0'
      },
      {
        id: 'session-source-other',
        name: 'Session Source Other',
        orderKey: 'sf1'
      }
    ])
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103',
        sessionId: 'session-source-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'session-only needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d104',
        sessionId: 'session-source-other',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'other session needle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      }
    ])

    const result = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-source-filter'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d103'])
  })

  it('filters session message search by createdAtFrom', async () => {
    await seedSession({
      id: 'session-created-filter',
      name: 'Session Created Filter',
      orderKey: 'sc0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d108',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'older session needle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 500
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109',
        sessionId: 'session-created-filter',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'newer session needle' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const result = agentSessionMessageService.search({
      q: 'needle',
      createdAtFrom: '1970-01-01T00:00:00.250Z'
    })

    expect(result.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d109'])
  })

  it('paginates search with message ids as row-id cursors', async () => {
    await seedSession({
      id: 'session-page',
      name: 'Session Page',
      orderKey: 'sp0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle middle' }] },
        status: 'success',
        createdAt: 200,
        updatedAt: 200
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
        sessionId: 'session-page',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle newest' }] },
        status: 'success',
        createdAt: 300,
        updatedAt: 300
      }
    ])

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d107',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106'
    ])
    expect(firstPage.nextCursor).toBe('200:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d106')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d105'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('uses session message id as the search cursor tiebreaker when createdAt values match', async () => {
    await seedSession({
      id: 'session-page-tie',
      name: 'Session Page Tie',
      orderKey: 'spt0'
    })
    await dbh.db.insert(agentSessionMessageTable).values([
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie oldest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie middle' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      },
      {
        id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
        sessionId: 'session-page-tie',
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'needle tie newest' }] },
        status: 'success',
        createdAt: 100,
        updatedAt: 100
      }
    ])

    const firstPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2
    })
    const secondPage = agentSessionMessageService.search({
      q: 'needle',
      sessionId: 'session-page-tie',
      limit: 2,
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items.map((item) => item.messageId)).toEqual([
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d207',
      '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206'
    ])
    expect(firstPage.nextCursor).toBe('100:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206')
    expect(secondPage.items.map((item) => item.messageId)).toEqual(['018f6ed6-73b8-7f40-8d0d-9bb2f8f1d205'])
    expect(secondPage.nextCursor).toBeUndefined()
  })

  it('rejects malformed session message search cursors', () => {
    let malformedError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'not-a-cursor' })
    } catch (error) {
      malformedError = error
    }
    expect(malformedError).toMatchObject({ code: 'VALIDATION_ERROR' })

    let nonNumericKeyError: unknown
    try {
      agentSessionMessageService.search({ q: 'needle', cursor: 'abc:018f6ed6-73b8-7f40-8d0d-9bb2f8f1d206' })
    } catch (error) {
      nonNumericKeyError = error
    }
    expect(nonNumericKeyError).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  describe('saveMessage — record projection ownership', () => {
    const USAGE_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d301'
    const USAGE_AGENT_ID = 'agent-usage'

    beforeEach(() => {
      dbh.db
        .insert(agentTable)
        .values({
          id: USAGE_AGENT_ID,
          type: 'claude_code',
          name: 'Usage Agent',
          instructions: '',
          model: null,
          orderKey: 'a0'
        })
        .run()
      dbh.db
        .update(agentSessionTable)
        .set({ agentId: USAGE_AGENT_ID })
        .where(eq(agentSessionTable.id, SESSION_ID))
        .run()
    })

    function seedModel() {
      dbh.db.insert(userProviderTable).values({ providerId: 'anthropic', name: 'Anthropic', orderKey: 'p0' }).run()
      dbh.db
        .insert(userModelTable)
        .values({
          id: 'anthropic::claude-sonnet',
          providerId: 'anthropic',
          modelId: 'claude-sonnet',
          presetModelId: 'claude-sonnet',
          name: 'claude-sonnet',
          isEnabled: true,
          isHidden: false,
          orderKey: 'm0'
        })
        .run()
    }

    it('persists runtime timing without turning it into a usage record', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        runtimeStats: {
          runtimeTiming: {
            startedAt: 1_000,
            completedAt: 2_000,
            spans: []
          }
        },
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
      expect(
        dbh.db
          .select({ stats: agentSessionMessageTable.stats })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()?.stats
      ).toEqual({
        requestCount: 0,
        estimatedRequestCount: 0,
        unpricedRequestCount: 0,
        costs: [],
        runtimeTiming: {
          startedAt: 1_000,
          completedAt: 2_000,
          spans: []
        }
      })
    })

    it('needs no route-owner flag to suppress stats-less message persistence', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })

    it('projects a provider-call record that arrived before the agent message row', async () => {
      seedModel()

      aiUsageRecordService.recordInvocation({
        requestId: 'gateway-provider-call',
        context: createAiUsageCaptureContext({
          providerId: 'anthropic',
          providerName: 'Anthropic',
          modelId: 'claude-sonnet',
          modelName: 'Claude Sonnet',
          credentialReceipt: {
            attribution: 'explicit',
            id: 'key-primary',
            label: 'Primary',
            masked: 'sk-a****aaaa'
          },
          source: { type: 'agent', id: USAGE_AGENT_ID, name: 'Usage Agent', icon: null },
          messageRef: { kind: 'agent-session', id: USAGE_MESSAGE_ID }
        }),
        modality: 'language',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        completedAt: 1_000
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      const rows = dbh.db.select().from(aiUsageRecordTable).all()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        requestId: 'gateway-provider-call',
        totalTokens: 15,
        apiKeyId: 'key-primary',
        sourceType: 'agent',
        sourceId: USAGE_AGENT_ID
      })
      expect(
        dbh.db
          .select({ stats: agentSessionMessageTable.stats })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()?.stats
      ).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15, requestCount: 1 })
    })

    it('does not infer usage from a persisted model snapshot after the model row is deleted', async () => {
      seedModel()
      const messageSnapshot = {
        id: 'agent-at-request-time',
        name: 'Agent at request time',
        model: {
          id: 'claude-sonnet',
          name: 'Claude Sonnet',
          provider: 'anthropic'
        }
      }

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'pending',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet',
          messageSnapshot
        }
      })
      dbh.db.delete(userModelTable).where(eq(userModelTable.id, 'anthropic::claude-sonnet')).run()
      expect(
        dbh.db
          .select({ modelId: agentSessionMessageTable.modelId })
          .from(agentSessionMessageTable)
          .where(eq(agentSessionMessageTable.id, USAGE_MESSAGE_ID))
          .get()
      ).toEqual({ modelId: null })

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: USAGE_MESSAGE_ID,
          role: 'assistant',
          status: 'success',
          data: { parts: [] }
        }
      })

      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })

    it('does not record user messages or stats-less assistant messages', async () => {
      seedModel()

      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d302',
          role: 'user',
          status: 'success',
          data: { parts: [] }
        }
      })
      agentSessionMessageService.saveMessage({
        sessionId: SESSION_ID,
        message: {
          id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d303',
          role: 'assistant',
          status: 'success',
          data: { parts: [] },
          modelId: 'anthropic::claude-sonnet'
        }
      })

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(0)
    })
  })
})
