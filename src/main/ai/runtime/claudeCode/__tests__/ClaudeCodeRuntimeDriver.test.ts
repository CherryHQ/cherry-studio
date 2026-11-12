import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runForkWorker, type RuntimeForkResult } from '../../fork'
import { forkClaudeSession } from '../claudeFork'

vi.mock('../forkValidationWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../forkValidationWorker.ts', import.meta.url), options)
}))

vi.mock('../forkWorker?nodeWorker', () => ({
  default: (options: ConstructorParameters<typeof Worker>[1]) =>
    new Worker(new URL('../forkWorker.ts', import.meta.url), options)
}))

describe('Claude native forks', () => {
  it('maps UUIDs once in isolated SDK workers through a child and grandchild', async () => {
    const userUuid = '20249b48-e174-4610-84c2-af6224228290'
    let entries = [
      { type: 'user', uuid: userUuid, parentUuid: null, sessionId, message: { role: 'user', content: 'PAST_ONLY' } },
      {
        type: 'assistant',
        uuid: messageUuid,
        parentUuid: userUuid,
        sessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'PAST_ONLY' }] }
      }
    ]
    let currentId = sessionId
    let currentUuid = messageUuid
    const parentEnv = process.env.CLAUDE_CONFIG_DIR
    for (const name of ['child', 'grandchild']) {
      const checkpoint = {
        runtime: 'claude-code',
        runtimeSessionId: currentId,
        messageUuid: currentUuid,
        configDir: directory
      }
      const worker = new Worker(new URL('../forkWorker.ts', import.meta.url), {
        workerData: {
          entries,
          checkpoint,
          checkpoints: [checkpoint],
          artifactDirectory: path.join(directory, name),
          targetCwd: directory
        },
        env: { ...process.env }
      })
      let result: RuntimeForkResult
      try {
        result = await new Promise<RuntimeForkResult>((resolve, reject) => {
          worker.once('message', (message) =>
            message.error ? reject(new Error(message.error)) : resolve(message.result)
          )
          worker.once('error', reject)
          worker.once('exit', (code) => reject(new Error('worker exited: ' + code)))
        })
      } finally {
        await worker.terminate()
      }
      const output = (await readFile(result.publish[0].source, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const mapped = output.find((entry) => entry.forkedFrom?.messageUuid === currentUuid)
      expect(mapped).toBeDefined()
      expect(mapped.uuid).not.toBe(currentUuid)
      expect(result.checkpoints[0]).toMatchObject({ messageUuid: mapped.uuid, configDir: directory })
      expect(JSON.stringify(output)).toContain('PAST_ONLY')
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(parentEnv)
      entries = output
      currentId = result.resumeToken
      currentUuid = mapped.uuid
      await rm(result.publish[0].source)
    }
  })
  const sessionId = '374c8467-e787-4c67-b890-a3d91b50dba6'
  const messageUuid = '9ad4b714-fe5d-4664-9f76-2b0cd13f4c03'
  let directory: string
  let file: string
  const entry = JSON.stringify({
    type: 'assistant',
    uuid: messageUuid,
    isSidechain: false,
    message: { content: '检查点' }
  })
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-checkpoint-test-'))
    file = path.join(directory, 'projects', 'project', sessionId + '.jsonl')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function forkInput() {
    const checkpoint = {
      runtime: 'claude-code' as const,
      runtimeSessionId: sessionId,
      messageUuid,
      configDir: directory
    }
    return {
      sourceSessionId: 'source',
      targetSessionId: 'child',
      targetCwd: directory,
      artifactDirectory: path.join(directory, 'artifacts'),
      checkpoint,
      checkpoints: [checkpoint],
      signal: new AbortController().signal
    }
  }

  it('rejects malformed native checkpoints before looking for history', async () => {
    const input = forkInput()
    input.checkpoint.messageUuid = 'not-a-uuid'
    await expect(forkClaudeSession(input)).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
  })

  describe('compacted context', () => {
    const userUuid = '20249b48-e174-4610-84c2-af6224228290'
    const replyUuid = '8ac51a42-1adb-4fe0-a139-64af7af18232'
    const boundaryUuid = '590bf21c-a5c3-413d-821e-cd33a4016d33'
    const summaryUuid = '2fcdb52e-39d4-4cc9-aee0-53db2df99c33'
    const promptUuid = '781c8715-59da-426a-8688-481660b69d16'
    const preservedSegment = { headUuid: userUuid, tailUuid: replyUuid, anchorUuid: summaryUuid }

    async function writeCompactedHistory(compactMetadata: unknown) {
      const entries = [
        {
          type: 'user',
          uuid: userUuid,
          parentUuid: null,
          sessionId,
          message: { role: 'user', content: 'PRESERVED_USER' }
        },
        {
          type: 'assistant',
          uuid: replyUuid,
          parentUuid: userUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'PRESERVED_REPLY' }] }
        },
        {
          type: 'system',
          subtype: 'compact_boundary',
          uuid: boundaryUuid,
          parentUuid: null,
          logicalParentUuid: replyUuid,
          sessionId,
          compactMetadata
        },
        {
          type: 'user',
          uuid: summaryUuid,
          parentUuid: boundaryUuid,
          sessionId,
          isCompactSummary: true,
          message: { role: 'user', content: 'COMPACT_SUMMARY secret=24250' }
        },
        {
          type: 'user',
          uuid: promptUuid,
          parentUuid: summaryUuid,
          sessionId,
          message: { role: 'user', content: 'POST_COMPACT_PROMPT' }
        },
        {
          type: 'assistant',
          uuid: messageUuid,
          parentUuid: promptUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'POST_COMPACT_REPLY' }] }
        },
        {
          type: 'user',
          uuid: '706dc088-43ba-425e-ae5e-64d436fbdccb',
          parentUuid: messageUuid,
          sessionId,
          message: { role: 'user', content: 'FUTURE_ONLY' }
        }
      ]
      await mkdir(path.dirname(file), { recursive: true })
      const source = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
      await writeFile(file, source)
      return source
    }

    it.each(['primary', 'earlier'] as const)(
      'rejects a %s boundary checkpoint before creating artifacts',
      async (which) => {
        const source = await writeCompactedHistory({ trigger: 'manual', preTokens: 1000 })
        const input = forkInput()
        const boundary = { ...input.checkpoint, messageUuid: boundaryUuid }
        if (which === 'primary') input.checkpoint = boundary
        input.checkpoints = [boundary, ...(which === 'earlier' ? [input.checkpoint] : [])]
        await mkdir(input.artifactDirectory)
        await expect(forkClaudeSession(input)).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
        expect(await readdir(input.artifactDirectory)).toEqual([])
        expect(await readFile(file)).toEqual(source)
      }
    )

    it.each([
      {
        name: 'preservedSegment with reordered object keys',
        compactMetadata: { preservedSegment, trigger: 'manual', preTokens: 1000 }
      },
      {
        name: 'preservedMessages and root runningTurnSends',
        compactMetadata: {
          trigger: 'manual',
          preTokens: 1000,
          preservedMessages: {
            anchorUuid: summaryUuid,
            uuids: [userUuid, replyUuid],
            allUuids: [userUuid, replyUuid]
          },
          runningTurnSends: [{ uuid: userUuid }]
        }
      },
      { name: 'verbatim metadata', compactMetadata: { trigger: 'manual', preTokens: 1000 } }
    ])('preserves loaded compacted context for $name', async ({ compactMetadata }) => {
      const source = await writeCompactedHistory(compactMetadata)
      const result = await forkClaudeSession(forkInput())
      const staged = await readFile(result.publish[0].source, 'utf8')
      const output = staged
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const child = (uuid: string) => output.find((entry) => entry.forkedFrom?.messageUuid === uuid)
      const boundary = child(boundaryUuid)
      expect(output.findIndex((entry) => entry.uuid === boundary.uuid)).toBe(2)
      const summary = child(summaryUuid)
      expect(boundary).toMatchObject({ type: 'system', subtype: 'compact_boundary' })
      expect(summary).toMatchObject({
        parentUuid: boundary.uuid,
        isCompactSummary: true,
        message: { content: 'COMPACT_SUMMARY secret=24250' }
      })
      expect(boundary.compactMetadata).toMatchObject({ trigger: 'manual', preTokens: 1000 })
      expect(boundary.compactMetadata).not.toHaveProperty('runningTurnSends')
      expect(result.resumeToken).not.toBe(sessionId)
      expect(result.checkpoints).toEqual([
        { ...forkInput().checkpoint, runtimeSessionId: result.resumeToken, messageUuid: child(messageUuid).uuid }
      ])
      expect(staged).not.toContain('FUTURE_ONLY')
      expect(await readFile(file)).toEqual(source)
      await mkdir(path.dirname(result.publish[0].target), { recursive: true })
      await writeFile(result.publish[0].target, staged)
      await expect(result.validatePublication!(new AbortController().signal)).resolves.toBeUndefined()
      const shifted = new Worker(new URL('../forkValidationWorker.ts', import.meta.url), {
        workerData: {
          configDir: directory,
          targetCwd: directory,
          sessionId: result.resumeToken,
          file: result.publish[0].target,
          expectation: {
            messageCount: 'preservedSegment' in compactMetadata || 'preservedMessages' in compactMetadata ? 6 : 4,
            boundaries: [{ uuid: boundary.uuid, index: 1 }]
          }
        },
        env: { ...process.env }
      })
      await expect(runForkWorker(shifted, new AbortController().signal)).rejects.toMatchObject({
        reason: 'unsupported_checkpoint'
      })
      await writeFile(
        result.publish[0].target,
        output
          .filter((entry) => entry.uuid !== boundary.uuid)
          .map((entry) => JSON.stringify(entry))
          .join('\n') + '\n'
      )
      await expect(result.validatePublication!(new AbortController().signal)).rejects.toMatchObject({
        reason: 'unsupported_checkpoint'
      })
      await writeFile(result.publish[0].target, staged + '{bad json}\n')
      await expect(result.validatePublication!(new AbortController().signal)).rejects.toMatchObject({
        reason: 'history_corrupt'
      })

      const hasPreservedMessages = 'preservedSegment' in compactMetadata || 'preservedMessages' in compactMetadata
      if ('preservedSegment' in compactMetadata) {
        expect(boundary.compactMetadata.preservedSegment).toEqual({
          headUuid: child(userUuid).uuid,
          tailUuid: child(replyUuid).uuid,
          anchorUuid: summary.uuid
        })
      }
      if ('preservedMessages' in compactMetadata) {
        expect(boundary.compactMetadata.preservedMessages).toEqual({
          anchorUuid: summary.uuid,
          uuids: [child(userUuid).uuid, child(replyUuid).uuid],
          allUuids: [child(userUuid).uuid, child(replyUuid).uuid]
        })
      }
      const expectedContents = [
        'COMPACT_SUMMARY secret=24250',
        ...(hasPreservedMessages ? ['PRESERVED_USER', 'PRESERVED_REPLY'] : []),
        'POST_COMPACT_PROMPT',
        'POST_COMPACT_REPLY'
      ]
      if (hasPreservedMessages) {
        expect(output.filter((entry) => entry.message).map((entry) => entry.message.content)).toEqual([
          'PRESERVED_USER',
          [{ type: 'text', text: 'PRESERVED_REPLY' }],
          'COMPACT_SUMMARY secret=24250',
          'POST_COMPACT_PROMPT',
          [{ type: 'text', text: 'POST_COMPACT_REPLY' }]
        ])
      }
      const messages = await getSessionMessages(result.resumeToken, {
        dir: directory,
        includeSystemMessages: true,
        sessionStore: {
          async load(key) {
            return key.sessionId === result.resumeToken ? structuredClone(output) : null
          },
          async append() {
            throw new Error('Loading context must not write to the transcript')
          }
        }
      })
      expect(messages.findIndex((entry) => entry.uuid === boundary.uuid)).toBe(0)
      if (hasPreservedMessages) expect(messages).toHaveLength(6)
      expect(messages.map((entry) => entry.type)).toEqual([
        'system',
        'user',
        ...(hasPreservedMessages ? ['user', 'assistant'] : []),
        'user',
        'assistant'
      ])
      expect(
        messages
          .filter((entry) => entry.type !== 'system')
          .map((entry) => {
            const { content } = entry.message as { content: string | { type: string; text: string }[] }
            return typeof content === 'string' ? content : content.map((block) => block.text).join('')
          })
      ).toEqual(expectedContents)
    })

    it.each([
      {
        name: 'a dropped progress record',
        progressUuid: 'a17ef839-8a1d-4f13-99e8-e9636f123456',
        compactMetadata: { trigger: 'manual', preTokens: 1000, preservedSegment }
      }
    ])('preserves loaded compacted context with $name', async ({ compactMetadata, progressUuid }) => {
      const history = await writeCompactedHistory(compactMetadata)
      const entries = history
        .toString('utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      if (progressUuid) {
        entries.splice(2, 0, { type: 'progress', uuid: progressUuid, parentUuid: replyUuid, sessionId })
      }
      const source = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
      await writeFile(file, source)
      const input = forkInput()
      const result = await forkClaudeSession(input)
      const staged = await readFile(result.publish[0].source, 'utf8')
      const output = staged
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const child = (uuid: string) => output.find((entry) => entry.forkedFrom?.messageUuid === uuid)
      const boundary = child(boundaryUuid)
      expect(boundary).toMatchObject({ type: 'system', subtype: 'compact_boundary' })
      expect(child(summaryUuid)).toMatchObject({ parentUuid: boundary.uuid, isCompactSummary: true })
      if (progressUuid) {
        expect(output.filter((entry) => entry.forkedFrom?.messageUuid === progressUuid)).toEqual([])
        expect(boundary.compactMetadata.preservedSegment).toEqual({
          headUuid: child(userUuid).uuid,
          tailUuid: child(replyUuid).uuid,
          anchorUuid: child(summaryUuid).uuid
        })
      } else {
        expect(boundary.compactMetadata.preservedMessages).toEqual({
          anchorUuid: child(summaryUuid).uuid,
          uuids: [child(userUuid).uuid, child(userUuid).uuid, child(replyUuid).uuid],
          allUuids: [child(userUuid).uuid, child(userUuid).uuid, child(replyUuid).uuid]
        })
      }
      expect(staged).not.toContain('FUTURE_ONLY')
      expect(await readFile(file)).toEqual(source)
      const messages = await getSessionMessages(result.resumeToken, {
        dir: directory,
        includeSystemMessages: true,
        sessionStore: {
          async load(key) {
            return key.sessionId === result.resumeToken ? structuredClone(output) : null
          },
          async append() {
            throw new Error('Loading context must not write to the transcript')
          }
        }
      })
      expect(messages.map((entry) => entry.type)).toEqual(['system', 'user', 'user', 'assistant', 'user', 'assistant'])
      expect(
        messages
          .filter((entry) => entry.type !== 'system')
          .map((entry) => {
            const { content } = entry.message as { content: string | { type: string; text: string }[] }
            return typeof content === 'string' ? content : content.map((block) => block.text).join('')
          })
      ).toEqual([
        'COMPACT_SUMMARY secret=24250',
        'PRESERVED_USER',
        'PRESERVED_REPLY',
        'POST_COMPACT_PROMPT',
        'POST_COMPACT_REPLY'
      ])

      if (progressUuid) {
        await rm(input.artifactDirectory, { recursive: true })
        await mkdir(input.artifactDirectory)
        entries.find((entry) => entry.uuid === boundaryUuid).compactMetadata.unknownReference = progressUuid
        const unresolvedSource = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
        await writeFile(file, unresolvedSource)
        await expect(forkClaudeSession(input)).resolves.toBeDefined()
        expect(await readFile(file)).toEqual(unresolvedSource)
      }
    })

    it('rejects duplicate ordered preserved messages', async () => {
      await writeCompactedHistory({
        preservedMessages: { anchorUuid: summaryUuid, uuids: [userUuid, userUuid, replyUuid] }
      })
      await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason: 'history_corrupt' })
    })

    it('accepts opaque non-system compaction metadata', async () => {
      const history = await writeCompactedHistory({ trigger: 'manual', preTokens: 1000, preservedSegment })
      const entries = history
        .toString('utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      entries[0].compactMetadata = { unknownReference: userUuid }
      const source = Buffer.from(entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
      await writeFile(file, source)
      const input = forkInput()
      await mkdir(input.artifactDirectory)
      await expect(forkClaudeSession(input)).resolves.toBeDefined()
      expect(await readFile(file)).toEqual(source)
    })

    it.each([
      {
        name: 'unknown reference alone',
        compactMetadata: { trigger: 'manual', preTokens: 1000, unknownReference: userUuid }
      },
      {
        name: 'unknown reference alongside preservedSegment',
        compactMetadata: { trigger: 'manual', preTokens: 1000, preservedSegment, unknownReference: userUuid }
      },
      {
        name: 'nested UUID object key',
        compactMetadata: {
          trigger: 'manual',
          preTokens: 1000,
          unknownReference: { nested: { [userUuid]: 'retained' } }
        }
      }
    ])('accepts opaque metadata in $name', async ({ compactMetadata }) => {
      const source = await writeCompactedHistory(compactMetadata)
      const input = forkInput()
      await mkdir(input.artifactDirectory)
      await expect(forkClaudeSession(input)).resolves.toBeDefined()
      expect(await readFile(file)).toEqual(source)
    })
  })

  it('refuses a fork retaining source UUIDs in replacement metadata', async () => {
    const userUuid = '20249b48-e174-4610-84c2-af6224228290'
    const entries = [
      { type: 'user', uuid: userUuid, parentUuid: null, sessionId, message: { role: 'user', content: 'Before' } },
      { type: 'content-replacement', sessionId, replacements: [{ messageUuid: userUuid, content: 'Replaced' }] },
      {
        type: 'assistant',
        uuid: messageUuid,
        parentUuid: userUuid,
        sessionId,
        message: { role: 'assistant', content: [{ type: 'text', text: 'After' }] }
      }
    ]
    await mkdir(path.dirname(file), { recursive: true })
    const source = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    await writeFile(file, source)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason: 'unsupported_checkpoint' })
    expect(await readFile(file, 'utf8')).toBe(source)
  })

  it.each(['\n', '\r\n'])('forks the exact UUID on demand and excludes later history (%j)', async (newline) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      entry +
        newline +
        JSON.stringify({ type: 'user', uuid: 'future-message', message: { content: 'FUTURE_ONLY' } }) +
        newline
    )
    const before = await readFile(file)
    const result = await forkClaudeSession(forkInput())
    const output = await readFile(result.publish[0].source, 'utf8')
    expect(output).not.toContain('FUTURE_ONLY')
    expect(JSON.parse(output.trim().split('\n')[0]).forkedFrom.messageUuid).toBe(messageUuid)
    expect(result.resumeToken).not.toBe(sessionId)
    expect(await readFile(file)).toEqual(before)
  })

  it.each([
    { name: 'empty LF', framing: '\n', leading: '', newline: '\n' },
    { name: 'empty CRLF', framing: '\r\n', leading: '', newline: '\r\n' },
    { name: 'spaces and tabs', framing: '\t  \n', leading: '', newline: '\n' },
    { name: 'leading blank', framing: '\n', leading: '\n', newline: '\n' },
    { name: 'consecutive blanks', framing: '\n\n', leading: '', newline: '\n' }
  ])(
    'forks blank-framed committed history without changing source bytes or including later turns ($name)',
    async ({ framing, leading, newline }) => {
      const userUuid = '20249b48-e174-4610-84c2-af6224228290'
      const inheritedUuid = '590bf21c-a5c3-413d-821e-cd33a4016d33'
      const futureUuid = '706dc088-43ba-425e-ae5e-64d436fbdccb'
      const entries = [
        {
          type: 'user',
          uuid: userUuid,
          parentUuid: null,
          sessionId,
          message: { role: 'user', content: 'EARLIER_USER' }
        },
        {
          type: 'assistant',
          uuid: inheritedUuid,
          parentUuid: userUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'INHERITED_ASSISTANT' }] }
        },
        {
          type: 'assistant',
          uuid: messageUuid,
          parentUuid: inheritedUuid,
          sessionId,
          message: { role: 'assistant', content: [{ type: 'text', text: 'EARLIER_ASSISTANT 检查点' }] }
        },
        {
          type: 'user',
          uuid: futureUuid,
          parentUuid: messageUuid,
          sessionId,
          message: { role: 'user', content: 'FUTURE_ONLY' }
        }
      ].map((value) => JSON.stringify(value))
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(
        file,
        leading +
          entries[0] +
          newline +
          entries[1] +
          newline +
          framing +
          entries[2] +
          newline +
          newline +
          entries[3] +
          newline
      )
      const before = await readFile(file)
      const input = forkInput()
      input.checkpoints = [{ ...input.checkpoint, messageUuid: inheritedUuid }, input.checkpoint]

      const result = await forkClaudeSession(input)

      expect(result.resumeToken).not.toBe(sessionId)
      const output = await readFile(result.publish[0].source, 'utf8')
      expect(output).toContain('EARLIER_USER')
      expect(output).toContain('INHERITED_ASSISTANT')
      expect(output).toContain('EARLIER_ASSISTANT 检查点')
      expect(output).not.toContain('FUTURE_ONLY')
      expect(output).not.toContain(futureUuid)
      const assistants = output
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .filter((value) => value.type === 'assistant')
      expect(assistants.map((value) => value.forkedFrom.messageUuid)).toEqual([inheritedUuid, messageUuid])
      expect(result.checkpoints).toEqual(
        assistants.map((value) => ({
          ...input.checkpoint,
          runtimeSessionId: result.resumeToken,
          messageUuid: value.uuid
        }))
      )
      expect(await readFile(file)).toEqual(before)
    }
  )

  it.each([
    ['all blank', '\n\r\n\t  \n'],
    ['bare CR', entry + '\r'],
    ['unterminated checkpoint after a committed record', '{"type":"user"}\n' + entry]
  ])('reports missing history for %s without a committed checkpoint', async (_name, content) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason: 'history_missing' })
  })

  it('forks a committed checkpoint before an incomplete tail', async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, entry + '\n\n{"type":"user","message":"INCOMPLETE_TAIL')
    const before = await readFile(file)
    const result = await forkClaudeSession(forkInput())
    const output = await readFile(result.publish[0].source, 'utf8')
    expect(JSON.parse(output.trim().split('\n')[0]).forkedFrom.messageUuid).toBe(messageUuid)
    expect(output).not.toContain('INCOMPLETE_TAIL')
    expect(await readFile(file)).toEqual(before)
  })

  it.each([
    ['missing', '', 'history_missing'],
    ['unflushed', entry, 'history_missing'],
    ['corrupt', 'invalid-json\n' + entry + '\n', 'history_corrupt']
  ])('reports %s history instead of selecting another boundary', async (_name, content, reason) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, content)
    await expect(forkClaudeSession(forkInput())).rejects.toMatchObject({ reason })
  })
})
