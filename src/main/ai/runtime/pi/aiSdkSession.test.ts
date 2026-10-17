import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { Type } from '@earendil-works/pi-ai'
import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, onTestFinished } from 'vitest'

import { createAgentRuntimeSession } from '@cherrystudio/agent-runtime-pi'

import { createAiSdkModelBinding } from './aiSdkModelBinding'
import {
  createTestSession,
  finish,
  lastAssistant,
  MODEL,
  scriptedModel,
  streamTextPort,
  tempDir,
  textParts
} from './aiSdkSupport'
import type { ModelCallPort } from './aiSdkTypes'

const noopTool = (name: string) =>
  defineTool({
    name,
    label: name,
    description: `The ${name} tool`,
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: 'text', text: 'done' }], details: undefined }
    }
  })

function write(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

describe('createAgentRuntimeSession', () => {
  it('loads nothing from the working or agent directory, using only the host system prompt', async () => {
    const cwd = tempDir('cwd')
    const agentDir = tempDir('agent')
    const sentinel = path.join(tempDir('sentinel'), 'extension-loaded')
    write(path.join(cwd, 'AGENTS.md'), 'MARKER context file')
    for (const dir of [path.join(cwd, '.pi'), agentDir]) {
      write(path.join(dir, 'SYSTEM.md'), 'MARKER system prompt')
      write(path.join(dir, 'APPEND_SYSTEM.md'), 'MARKER appended prompt')
      write(path.join(dir, 'skills', 'marker', 'SKILL.md'), '---\nname: marker\ndescription: MARKER skill\n---\nMARKER')
      write(path.join(dir, 'prompts', 'marker.md'), 'MARKER prompt template')
      write(
        path.join(dir, 'extensions', 'marker.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'loaded'); module.exports = () => {}`
      )
    }
    const { model } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({ port, cwd, agentDir, builtinTools: ['read'] })
    await session.prompt('hi')

    expect(requests[0].system).toMatch(/^You are Cherry\./)
    expect(requests[0].system).toContain('<cwd>')
    expect(JSON.stringify(requests[0])).not.toContain('MARKER')
    expect(existsSync(sentinel)).toBe(false)
  })

  it('falls back to Pi’s own prompt, never a SYSTEM.md on disk, and keeps the host’s appended prompt', async () => {
    const agentDir = tempDir('agent')
    write(path.join(agentDir, 'SYSTEM.md'), 'MARKER system prompt')
    const { model } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      agentDir,
      systemPrompt: undefined,
      appendSystemPrompt: ['Answer in Chinese.']
    })
    await session.prompt('hi')

    expect(requests[0].system).toContain('operating inside pi')
    expect(requests[0].system).toContain('Answer in Chinese.')
    expect(requests[0].system).not.toContain('MARKER')
  })

  it('loads workspace context files and host-enabled skills when asked', async () => {
    const cwd = tempDir('cwd')
    write(path.join(cwd, 'AGENTS.md'), 'Use tabs in this repository.')
    const skillDir = path.join(tempDir('skills'), 'release-notes')
    write(path.join(skillDir, 'SKILL.md'), '---\nname: release-notes\ndescription: Drafts release notes\n---\nSteps')
    const { model } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      cwd,
      builtinTools: ['read'],
      contextFiles: true,
      skillPaths: [skillDir]
    })
    await session.prompt('hi')

    expect(requests[0].system).toContain('Use tabs in this repository.')
    expect(requests[0].system).toContain('Drafts release notes')
  })

  it('exposes only the requested built-in tools next to host and extension tools', async () => {
    const { model } = scriptedModel([[...textParts('t', 'ok'), finish('stop')]])
    const { port, requests } = streamTextPort(model)
    const { session } = await createTestSession({
      port,
      builtinTools: ['read'],
      tools: [noopTool('host_tool')],
      extensionFactories: [(pi) => pi.registerTool(noopTool('extension_tool'))]
    })
    await session.prompt('hi')

    expect(Object.keys(requests[0].tools).sort()).toEqual(['extension_tool', 'host_tool', 'read'])
  })

  it('keeps concurrent sessions of the same model on their own ports', async () => {
    const sessions = await Promise.all(
      ['A', 'B'].map(async (label) => {
        const { model } = scriptedModel([[...textParts('t', `from ${label}`), finish('stop')]], 5)
        const { port, requests } = streamTextPort(model)
        const { session } = await createTestSession({ port })
        return { label, session, requests }
      })
    )
    await Promise.all(sessions.map(({ label, session }) => session.prompt(`to ${label}`)))

    for (const { label, session, requests } of sessions) {
      expect(requests).toHaveLength(1)
      expect(JSON.stringify(requests[0].messages)).toContain(`to ${label}`)
      expect(lastAssistant(session).content).toEqual([{ type: 'text', text: `from ${label}` }])
    }
  })

  it('dispose aborts the running turn and shuts extensions down', async () => {
    const chunks = Array.from({ length: 50 }, (_, i) => `chunk${i} `)
    const { model } = scriptedModel([[...textParts('t', ...chunks), finish('stop')]], 30)
    const shutdowns: string[] = []
    const runtime = await createTestSession({
      port: streamTextPort(model).port,
      extensionFactories: [
        (pi) => {
          pi.on('session_shutdown', (event) => void shutdowns.push(event.reason))
        }
      ]
    })
    let started!: () => void
    const streaming = new Promise<void>((resolve) => (started = resolve))
    runtime.session.subscribe((event) => {
      if (event.type === 'message_update') started()
    })
    const turn = runtime.session.prompt('long answer')
    await streaming
    await runtime.dispose()
    await turn

    expect(lastAssistant(runtime.session).stopReason).toBe('aborted')
    expect(shutdowns).toEqual(['quit'])
  })
})

/** A host that hands the session builder only the binding's runtime and model, and its own options. */
async function hostSession(
  port: ModelCallPort,
  options: Partial<Parameters<typeof createAgentRuntimeSession>[0]> = {}
) {
  const { modelRuntime, model } = await createAiSdkModelBinding({ port, requestOptions: undefined, model: MODEL })
  const runtime = await createAgentRuntimeSession({
    modelRuntime,
    model,
    cwd: tempDir('cwd'),
    agentDir: tempDir('agent'),
    systemPrompt: 'You are Cherry.',
    ...options
  })
  onTestFinished(() => runtime.dispose())
  return runtime
}

describe('sessions on the AI SDK binding', () => {
  // Breaks when Pi's retry depends on the host spreading the binding's settings: the AI SDK call
  // already retries, so a failure would be retried by both layers.
  it('never lets Pi retry a failed call, whatever retry settings the host gives', async () => {
    let portCalls = 0
    const { model } = scriptedModel([[{ type: 'error', error: new Error('Overloaded') }]])
    const inner = streamTextPort(model).port
    const { session } = await hostSession(
      {
        streamText: (request) => {
          portCalls++
          return inner.streamText(request)
        }
      },
      { settings: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } } }
    )
    const events: string[] = []
    session.subscribe((event) => events.push(event.type))
    await session.prompt('hi').catch(() => {})

    expect(portCalls).toBe(1)
    expect(events).not.toContain('auto_retry_start')
    expect(lastAssistant(session)).toMatchObject({ stopReason: 'error', errorMessage: 'Overloaded' })
  })

  // Breaks when the invalid-tool-call guard depends on the host installing the binding's factories.
  it('keeps a call with unparsable input from running and from host tool_call handlers', async () => {
    const listCalls: unknown[] = []
    const asked: string[] = []
    const approvalPrompt: ExtensionFactory = (pi) => {
      pi.on('tool_call', (event) => void asked.push(event.toolCallId))
    }
    const listFiles = defineTool({
      name: 'list_files',
      label: 'List files',
      description: 'List a directory, the workspace root by default',
      parameters: Type.Object({ path: Type.Optional(Type.String()) }),
      async execute(_id, params) {
        listCalls.push(params)
        return { content: [{ type: 'text', text: 'a.txt' }], details: undefined }
      }
    })
    const { model } = scriptedModel([
      [
        { type: 'tool-call', toolCallId: 'call_bad', toolName: 'list_files', input: '{"path":"/tm' },
        finish('tool-calls')
      ],
      [...textParts('t', 'Let me retry.'), finish('stop')]
    ])
    const { session } = await hostSession(streamTextPort(model).port, {
      tools: [listFiles],
      extensionFactories: [approvalPrompt]
    })
    await session.prompt('List my files')

    expect(listCalls).toEqual([])
    expect(asked).toEqual([])
  })
})
