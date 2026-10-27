import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import type { SDKAssistantMessage, SDKMessage, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk'

import { runtimeId } from '@cherrystudio/agent-runtime'

import { createClaudeCodeRuntime } from '../src'
import { confirmed, inputId, observe } from './nativeFixture'

/** Replays native wire races through the real SDK transport and the public adapter. */
export async function wireFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'cherry-claude-wire-'))
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const process = new EventEmitter() as EventEmitter & SpawnedProcess
  let exited = false
  Object.assign(process, {
    stdin,
    stdout,
    kill: () => {
      exit()
      return true
    }
  })
  Object.defineProperty(process, 'exitCode', { get: () => (exited ? 0 : null) })
  Object.defineProperty(process, 'killed', { get: () => exited })
  function exit() {
    if (exited) return
    exited = true
    stdout.end()
    process.emit('exit', 0, null)
  }
  stdin.on('finish', exit)
  let buffer = ''
  stdin.on('data', (chunk) => {
    buffer += chunk.toString()
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n')
      const frame = JSON.parse(buffer.slice(0, index))
      buffer = buffer.slice(index + 1)
      if (frame.type === 'control_request') {
        stdout.write(
          JSON.stringify({
            type: 'control_response',
            response: {
              subtype: 'success',
              request_id: frame.request_id,
              response: { commands: [], models: [], agents: [] }
            }
          }) + '\n'
        )
      }
    }
  })
  const failures: unknown[] = []
  const runtime = createClaudeCodeRuntime({
    backendId: runtimeId<'backend'>('wire'),
    configDir: directory,
    onError: (error) => failures.push(error)
  })
  const root = confirmed(await runtime.create({ cwd: directory, env: {}, spawnClaudeCodeProcess: () => process }))
  const view = await observe(root)
  await root.input!.submit({ inputId: inputId(), text: 'Start wire replay', whenBusy: 'steer' })
  const sessionId = root.claude.sessionId
  const send = (message: SDKMessage) => stdout.write(JSON.stringify(message) + '\n')
  return {
    root,
    runtime,
    view,
    sessionId,
    send,
    failures,
    assistant(text: string, extras: Partial<SDKAssistantMessage> = {}): SDKAssistantMessage {
      return {
        type: 'assistant',
        uuid: randomUUID(),
        session_id: sessionId,
        parent_tool_use_id: null,
        message: {
          id: 'msg_wire',
          type: 'message',
          role: 'assistant',
          model: 'test',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        },
        ...extras
      } as SDKAssistantMessage
    },
    async close() {
      exit()
      await runtime.shutdown()
      await rm(directory, { recursive: true, force: true })
    }
  }
}
