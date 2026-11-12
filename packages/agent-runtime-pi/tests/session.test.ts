import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { defineTool } from '@earendil-works/pi-coding-agent'
import { obj, str } from '@earendil-works/pi-schema'
import { describe, expect, it } from 'vitest'

import type { AgentRuntimeModel } from '../src/session'
import { assistantReply, createTestSession, lastAssistant, MODEL, scriptedModel, tempDir } from './sessionSupport'

const noopTool = (name: string) =>
  defineTool({
    name,
    label: name,
    description: `The ${name} tool`,
    parameters: obj({}),
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
    const { model, calls: requests } = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const { session } = await createTestSession({ stream: model, cwd, agentDir, builtinTools: ['read'] })
    await session.prompt('hi')

    expect(requests[0].systemPrompt).toMatch(/^You are Cherry\./)
    expect(requests[0].systemPrompt).toContain('<cwd>')
    expect(JSON.stringify(requests[0])).not.toContain('MARKER')
    expect(existsSync(sentinel)).toBe(false)
  })

  it('falls back to Pi’s own prompt, never a SYSTEM.md on disk, and keeps the host’s appended prompt', async () => {
    const agentDir = tempDir('agent')
    write(path.join(agentDir, 'SYSTEM.md'), 'MARKER system prompt')
    const { model, calls: requests } = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const { session } = await createTestSession({
      stream: model,
      agentDir,
      systemPrompt: undefined,
      appendSystemPrompt: ['Answer in Chinese.']
    })
    await session.prompt('hi')

    expect(requests[0].systemPrompt).toContain('inside pi')
    expect(requests[0].systemPrompt).toContain('Answer in Chinese.')
    expect(requests[0].systemPrompt).not.toContain('MARKER')
  })

  it('loads workspace context files and host-enabled skills when asked', async () => {
    const cwd = tempDir('cwd')
    write(path.join(cwd, 'AGENTS.md'), 'Use tabs in this repository.')
    const skillDir = path.join(tempDir('skills'), 'release-notes')
    write(path.join(skillDir, 'SKILL.md'), '---\nname: release-notes\ndescription: Drafts release notes\n---\nSteps')
    const { model, calls: requests } = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const { session } = await createTestSession({
      stream: model,
      cwd,
      builtinTools: ['read'],
      contextFiles: true,
      skillPaths: [skillDir]
    })
    await session.prompt('hi')

    expect(requests[0].systemPrompt).toContain('Use tabs in this repository.')
    expect(requests[0].systemPrompt).toContain('Drafts release notes')
  })

  it('exposes only the requested built-in tools next to host and extension tools', async () => {
    const { model, calls: requests } = scriptedModel([assistantReply([{ type: 'text', text: 'ok' }])])
    const { session } = await createTestSession({
      stream: model,
      builtinTools: ['read'],
      tools: [noopTool('host_tool')],
      extensionFactories: [(pi) => pi.registerTool(noopTool('extension_tool'))]
    })
    await session.prompt('hi')

    expect(requests[0].tools?.map((tool) => tool.name).sort()).toEqual(['extension_tool', 'host_tool', 'read'])
  })

  async function callWithIntent(model?: AgentRuntimeModel) {
    const executed: unknown[] = []
    const gated: unknown[] = []
    const strictTool = defineTool({
      name: 'host_tool',
      label: 'host_tool',
      description: 'Strict about its arguments',
      parameters: obj({ path: str() }),
      async execute(_id, params) {
        executed.push(params)
        return { content: [{ type: 'text', text: 'done' }], details: undefined }
      }
    })
    const call = { path: 'a.ts', intent: 'find where the key is loaded' }
    const { model: stream, calls: requests } = scriptedModel([
      assistantReply([{ type: 'toolCall', id: 'call-1', name: 'host_tool', arguments: call }], 'toolUse'),
      assistantReply([{ type: 'text', text: 'ok' }])
    ])
    const { session } = await createTestSession({
      stream,
      model,
      builtinTools: ['read'],
      tools: [strictTool],
      extensionFactories: [
        (pi) => {
          pi.registerTool(noopTool('extension_tool'))
          pi.on('tool_call', (event) => void gated.push(structuredClone(event.input)))
        }
      ]
    })
    await session.prompt('hi')
    return { executed, gated, requests }
  }

  it('offers a DeepSeek model an intent on every tool, and runs the call without it', async () => {
    const { executed, gated, requests } = await callWithIntent({ ...MODEL, id: 'deepseek-v4.1-flash' })

    for (const tool of requests[0].tools ?? []) {
      expect(tool.parameters).toMatchObject({ properties: { intent: { type: 'string' } } })
    }
    expect(requests[0].systemPrompt).toContain('`intent`')
    expect(executed).toEqual([{ path: 'a.ts' }])
    expect(gated).toEqual([{ path: 'a.ts' }])
    expect(JSON.stringify(requests[1].messages)).toContain('find where the key is loaded')
  })

  it('offers other models no intent, yet still runs a call that carries one', async () => {
    const { executed, gated, requests } = await callWithIntent()

    for (const tool of requests[0].tools ?? []) {
      expect(tool.parameters).not.toHaveProperty('properties.intent')
    }
    expect(requests[0].systemPrompt).not.toContain('`intent`')
    expect(executed).toEqual([{ path: 'a.ts' }])
    expect(gated).toEqual([{ path: 'a.ts' }])
  })

  it('keeps concurrent sessions of the same model on their own providers', async () => {
    const sessions = await Promise.all(
      ['A', 'B'].map(async (label) => {
        const { model, calls: requests } = scriptedModel([assistantReply([{ type: 'text', text: `from ${label}` }])], 5)
        const { session } = await createTestSession({ stream: model })
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
    const { model } = scriptedModel([assistantReply([{ type: 'text', text: [...chunks].join('') }])], 30)
    const shutdowns: string[] = []
    const runtime = await createTestSession({
      stream: model,
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
