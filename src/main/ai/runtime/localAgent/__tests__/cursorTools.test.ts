import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Agent, type AgentOptions } from '@cursor/sdk'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { openCursorSession } from '@cherrystudio/agent-runtime-cursor'
import { localAgentChatProtocol, LocalAgentConfigurationSchema } from '@shared/ai/localAgent'

import { cursorWorkspaceTools } from '../cursorTools'

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'cursor-approval-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

function tools(
  approve: Parameters<typeof cursorWorkspaceTools>[0]['approve'],
  signal = new AbortController().signal,
  isReadOnly = () => false
) {
  return cursorWorkspaceTools({ cwd, env: {}, signal, approve, isReadOnly, start() {}, finish() {} })
}

it('keeps the file untouched while approval is pending and writes only the approved replacement', async () => {
  const file = path.join(cwd, 'note.txt')
  await writeFile(file, 'original')
  const decision = Promise.withResolvers<{ approved: boolean; updatedInput: Record<string, unknown> }>()
  const { write } = tools(() => decision.promise)
  const pending = write.execute({ file_path: file, content: 'proposed' }, { toolCallId: 'write-1' })
  expect(await readFile(file, 'utf8')).toBe('original')
  decision.resolve({ approved: true, updatedInput: { file_path: file, content: 'reviewed' } })
  await pending
  expect(await readFile(file, 'utf8')).toBe('reviewed')
})

it.each(['deny', 'cancel', 'plan'] as const)('prevents both writes and process execution after %s', async (cause) => {
  const file = path.join(cwd, 'marker')
  for (const name of ['write', 'execute'] as const) {
    const controller = new AbortController()
    let readOnly = false
    const registry = tools(
      async () => {
        if (cause === 'cancel') controller.abort()
        if (cause === 'plan') readOnly = true
        return { approved: cause !== 'deny' }
      },
      controller.signal,
      () => readOnly
    )
    const result =
      name === 'write'
        ? await registry.write.execute({ file_path: file, content: 'unexpected' }, { toolCallId: name })
        : await registry.execute.execute(
            {
              command: process.execPath,
              args: ['-e', "require('node:fs').writeFileSync(process.argv[1], 'unexpected')", file]
            },
            { toolCallId: name }
          )
    expect(result).toMatchObject({ isError: true })
    await expect(readFile(file)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('executes the approved command in this workspace', async () => {
  const { execute } = tools(async () => ({ approved: true }))
  await execute.execute(
    { command: process.execPath, args: ['-e', "require('node:fs').writeFileSync('marker', 'approved')"] },
    { toolCallId: 'x' }
  )
  expect(await readFile(path.join(cwd, 'marker'), 'utf8')).toBe('approved')
})

it('restores Cursor sessions using the protocol that issued their identity', () => {
  const previous = LocalAgentConfigurationSchema.parse({ presetId: 'cursor', protocol: 'acp' })
  expect(localAgentChatProtocol(previous)).toBe('cursor')
  expect(localAgentChatProtocol(previous, 'old-native-id')).toBe('acp')
  const override = { ...previous, executableOverride: '/custom/cursor-agent' }
  expect(localAgentChatProtocol(override)).toBe('acp')
  expect(localAgentChatProtocol(override, 'cursor-sdk:existing')).toBe('cursor')
})

it.each([undefined, 'saved-cursor-agent'])('isolates the native tool surface for %s', async (agentId) => {
  const file = path.join(cwd, 'private.txt')
  await writeFile(file, 'host file')
  const capture = async (options?: Partial<AgentOptions>): Promise<never> => {
    expect(options?.tools).toEqual(['mcp'])
    expect(options?.mcpServers).toEqual({})
    expect(options?.local?.settingSources).toEqual([])
    const fs = options?.local?.fs
    if (!fs || typeof fs === 'function') throw new Error('Missing isolated filesystem')
    await expect(fs.read(file)).rejects.toThrow()
    throw new Error('Captured isolated session')
  }
  const create = vi.spyOn(Agent, 'create').mockImplementation(capture)
  const resume = vi.spyOn(Agent, 'resume').mockImplementation(async (id, options) => {
    expect(id).toBe(agentId)
    return capture(options)
  })
  try {
    await expect(openCursorSession({ cwd, model: 'auto', agentId })).rejects.toThrow('Captured isolated session')
    expect(resume.mock.calls.length).toBe(agentId ? 1 : 0)
    expect(create.mock.calls.length).toBe(agentId ? 0 : 1)
  } finally {
    create.mockRestore()
    resume.mockRestore()
  }
})
