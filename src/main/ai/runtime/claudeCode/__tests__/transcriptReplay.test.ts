import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { setupTestDatabase } from '@test-helpers/db'
import { afterAll, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as storedMessages } from '@data/services/AgentSessionMessageService'
import { RootMessageProjection } from '@main/ai/agentSession/RootMessageProjection'
import { ThreadMessageProjection } from '@main/ai/agentSession/ThreadMessageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import { confirmed } from '../../../../../../packages/agent-runtime-claude-code/tests/nativeFixture'
import { wireFixture } from '../../../../../../packages/agent-runtime-claude-code/tests/wireFixture'
import { ClaudeMessageMetadata } from '../ClaudeMessageMetadata'

type Block = Record<string, any>
interface TranscriptCase {
  name: string
  source: { sha256: string; lines: number[]; child: boolean; versions: string[] }
  features: string[]
  messages: {
    type: 'assistant' | 'user'
    uuid: string
    message: { content: string | Block[] }
    isAbortedMidStream?: boolean
  }[]
}
interface Difference {
  source: string
  field: string
  expected: string
  actual: string
}

const corpus: TranscriptCase[] = JSON.parse(
  readFileSync(
    process.env.CLAUDE_TRANSCRIPT_REPLAY_CORPUS ?? new URL('./fixtures/transcriptReplay.json', import.meta.url),
    'utf8'
  )
)
const reports: object[] = []
const dbh = setupTestDatabase()
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value) ?? 'undefined')
    .digest('hex')

afterAll(() => {
  if (process.env.CLAUDE_TRANSCRIPT_REPLAY_REPORT)
    writeFileSync(process.env.CLAUDE_TRANSCRIPT_REPLAY_REPORT, JSON.stringify(reports, null, 2))
})

function verifyContent(source: TranscriptCase, messages: readonly CherryUIMessage[]) {
  const differences: Difference[] = []
  let checks = 0
  let unmatchedToolResults = 0
  const check = (id: string, field: string, actual: unknown, expected: unknown) => {
    checks++
    if (!isDeepStrictEqual(actual, expected))
      differences.push({ source: digest(id).slice(0, 12), field, expected: digest(expected), actual: digest(actual) })
  }
  const calls = new Map<string, any>()
  for (const message of messages)
    for (const part of message.parts) if (part.type === 'dynamic-tool') calls.set(part.toolCallId, part)
  const latest = new Map(source.messages.map((message) => [message.uuid, message]))
  const order: string[] = []
  for (const message of latest.values()) {
    const content = message.message.content
    const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : content
    for (const [index, block] of blocks.entries()) {
      const id = `${message.uuid}:${index}`
      const projected = messages.find((value) => value.id === id)
      if (!('tool_use_id' in block)) {
        order.push(id)
        check(id, 'role', projected?.role, message.type)
      }
      if (block.type === 'text') {
        check(
          id,
          'text',
          projected?.parts[0]?.type === 'text' ? projected.parts[0].text : undefined,
          block.text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
        )
      } else if (block.type === 'thinking') {
        const part = projected?.parts[0]
        check(id, 'thinking', part?.type === 'reasoning' ? part.text : undefined, block.thinking)
        if (typeof block.signature === 'string')
          check(
            id,
            'signature',
            part?.type === 'reasoning' ? part.providerMetadata?.anthropic?.signature : undefined,
            block.signature
          )
      } else if (block.type === 'tool_use') {
        const tool = calls.get(block.id)
        check(id, 'tool-name', tool?.toolName, block.name)
        check(id, 'tool-input', tool?.input, block.input)
      } else if (block.type === 'tool_result') {
        const tool = calls.get(block.tool_use_id)
        if (!tool) {
          unmatchedToolResults++
          continue
        }
        check(id, 'tool-state', tool.state, block.is_error ? 'output-error' : 'output-available')
        if (block.is_error) {
          const text =
            typeof block.content === 'string'
              ? block.content
              : block.content
                  .filter((part: Block) => part.type === 'text')
                  .map((part: Block) => part.text)
                  .join('\n')
          check(id, 'tool-error', tool.errorText, text)
        } else {
          let expected: unknown = block.content
          if (Array.isArray(expected) && expected.length && expected.every((part) => part.type === 'text'))
            expected = expected.map((part) => part.text).join('\n')
          if (typeof expected === 'string') {
            try {
              expected = JSON.parse(expected)
            } catch {
              /* Plain text is a valid tool result. */
            }
          }
          const actual = tool.output?.metadata?.type === 'mcp' ? tool.output.content : tool.output
          if (!Array.isArray(block.content) || block.content.every((part: Block) => part.type === 'text'))
            check(id, 'tool-output', actual, expected)
          else {
            check(id, 'tool-rich-count', Array.isArray(actual) ? actual.length : undefined, block.content.length)
            for (const [index, part] of block.content.entries()) {
              let rendered = actual?.[index]
              if (part.type === 'image' && part.source?.type === 'base64' && rendered?.type === 'image') {
                check(
                  id,
                  'tool-image',
                  rendered.source ?? { type: 'base64', data: rendered.data, media_type: rendered.mimeType },
                  part.source
                )
              } else {
                if (part.type !== 'text' && rendered?.type === 'text') {
                  try {
                    rendered = JSON.parse(rendered.text)
                  } catch {
                    /* Unknown blocks must retain their original data. */
                  }
                }
                check(id, 'tool-rich-block', rendered, part)
              }
            }
          }
        }
      }
    }
  }
  check(
    source.name,
    'source-order',
    messages.map((message) => message.id),
    order
  )
  return { differences, checks, unmatchedToolResults }
}

function verifyPersistence(messages: readonly CherryUIMessage[]): boolean {
  const workspaceId = randomUUID()
  const sessionId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Replay', type: 'user', path: `/test/${workspaceId}`, orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Replay', orderKey: 'a0' }).run()
  const context = contexts.prepareClaudeBranch(sessionId, '/test/claude')
  const id = storedMessages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  }).id
  const root = new RootMessageProjection(context.id)
  root.accept(
    { contextId: context.id, messages, live: messages.map((message) => message.id), replaces: {}, removed: [] },
    id
  )
  const parts = root.parts(id)
  const serialized = JSON.parse(JSON.stringify(parts ?? []))
  storedMessages.replaceMessageParts(sessionId, id, parts, root.checkpoint())
  const restored = new RootMessageProjection(context.id)
  const changes = restored.accept({ contextId: context.id, messages, live: [], replaces: {}, removed: [] }, id)
  return (
    changes.size === 0 &&
    isDeepStrictEqual(storedMessages.getSessionMessage(sessionId, id).data.parts, serialized) &&
    isDeepStrictEqual(restored.parts(id), parts === undefined ? undefined : serialized)
  )
}

// Recorded content must survive the public SDK boundary, rich projection and subscriber replay unchanged.
it.each(corpus)(
  '$name preserves recorded content and identities',
  async (source) => {
    const test = await wireFixture()
    const metadata = new ClaudeMessageMetadata()
    const projection = new ThreadMessageProjection(test.root.thread, metadata.decorate)
    let accepted: (() => void) | undefined
    let target: string | undefined
    const observation = confirmed(
      await test.root.claude.observe(async (batch) => {
        metadata.accept(batch)
        for (const event of batch.events) await projection.accept(event)
        if (batch.native.some((native) => native.message.uuid === target)) accepted?.()
      })
    )
    let replay: ThreadMessageProjection | undefined
    try {
      for (const record of source.messages) {
        target = record.uuid
        const pending = new Promise<void>((resolve) => {
          accepted = resolve
        })
        test.send({
          type: record.type,
          uuid: record.uuid,
          message: record.message,
          session_id: test.sessionId,
          parent_tool_use_id: null,
          ...(record.isAbortedMidStream ? { aborted: true } : {})
        } as SDKMessage)
        await pending
      }
      const messages = structuredClone(projection.snapshot().messages)
      const content = verifyContent(source, messages)
      const replayMetadata = new ClaudeMessageMetadata()
      replay = new ThreadMessageProjection(test.root.thread, replayMetadata.decorate)
      let ready!: () => void
      const attached = new Promise<void>((resolve) => {
        ready = resolve
      })
      const replayObservation = confirmed(
        await test.root.claude.observe(async (batch) => {
          replayMetadata.accept(batch)
          for (const event of batch.events) await replay!.accept(event)
          ready()
        })
      )
      await attached
      const stable = isDeepStrictEqual(replay.snapshot().messages, messages)
      const persisted = verifyPersistence(messages)
      reports.push({
        name: source.name,
        source: source.source,
        features: source.features,
        records: source.messages.length,
        projected: messages.length,
        replayStable: stable,
        persistenceStable: persisted,
        ...content
      })
      await replayObservation.stop()
      expect(test.failures.map((error) => (error instanceof Error ? error.name : typeof error))).toEqual([])
      expect(stable, 'Subscriber replay changed committed content or source identity').toBe(true)
      expect(persisted, 'Storage or restored source mappings changed the projected content').toBe(true)
      expect(content.differences, 'Content mismatch; only hashes are printed to protect local transcripts').toEqual([])
    } finally {
      await observation.stop()
      await replay?.close()
      await projection.close()
      await test.close()
    }
  },
  30000
)
