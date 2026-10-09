import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { Type } from '@earendil-works/pi-ai'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import { createTestSession, finish, lastAssistant, scriptedModel, streamTextPort, tempDir, textParts } from './support'

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
