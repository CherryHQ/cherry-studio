import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AgentToolResult } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertUnchangedBeforeCommand,
  createPiActionFusionExtension,
  executeMutationThenRun,
  normalizeWindowsShellPath,
  resolveFusionPath,
  THEN_RUN_BLOCKED,
  THEN_RUN_FAILED,
  THEN_RUN_SUCCEEDED,
  THEN_RUN_SKIPPED,
  withFusedFileQueue,
  type PiActionFusionOptions
} from '../actionFusion'

const cleanupDirs: string[] = []
afterEach(() => {
  while (cleanupDirs.length) rmSync(cleanupDirs.pop()!, { recursive: true, force: true })
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'cherry-action-fusion-'))
  cleanupDirs.push(dir)
  return dir
}

/** A real file so the fused hash guard has something to read. */
function makeTempFile(name = 'target.txt', content = 'seed') {
  const file = join(makeTempDir(), name)
  writeFileSync(file, content)
  return file
}

const BASE_SCHEMA = Type.Object({
  path: Type.String({ description: 'file path' }),
  content: Type.Optional(Type.String())
})

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: undefined }
}

interface RegisteredTool {
  name: string
  parameters: { properties: Record<string, unknown> }
  execute: (id: string, input: unknown, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<any>
}

function makeHarness(options: { editError?: Error; bashError?: Error } = {}) {
  const registered: RegisteredTool[] = []
  const bashCalls: Array<{ id: string; input: unknown }> = []
  const sdk = {
    createEditToolDefinition: () => ({
      name: 'edit',
      label: 'edit',
      parameters: BASE_SCHEMA,
      execute: async () => {
        if (options.editError) throw options.editError
        return textResult('edited the file')
      }
    }),
    createWriteToolDefinition: () => ({
      name: 'write',
      label: 'write',
      parameters: BASE_SCHEMA,
      execute: async () => textResult('wrote the file')
    }),
    createBashToolDefinition: () => ({
      name: 'bash',
      label: 'bash',
      parameters: BASE_SCHEMA,
      execute: async (id: string, input: { command: string }) => {
        if (options.bashError) throw options.bashError
        bashCalls.push({ id, input })
        return textResult(`ran: ${input.command}`)
      }
    })
  }
  const authorize = vi.fn(async () => undefined)
  const options_: PiActionFusionOptions = { workspacePath: '/ws', authorize }
  void createPiActionFusionExtension(
    sdk as never,
    options_
  )({
    registerTool: (tool: RegisteredTool) => registered.push(tool)
  } as never)
  const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]))
  return { authorize, bashCalls, edit: byName.edit, write: byName.write }
}

const TOOL_CTX = { cwd: '/ws' }

describe('action fusion tool registration', () => {
  it('replaces edit and write with schemas that carry then_run', () => {
    const { edit, write } = makeHarness()
    expect(edit).toBeDefined()
    expect(write).toBeDefined()
    expect(edit.parameters.properties.then_run).toBeDefined()
    expect(write.parameters.properties.then_run).toBeDefined()
    expect(edit.parameters.properties.path).toBeDefined()
  })
})

describe('action fusion fused execution', () => {
  it('passes through unchanged when the model sends no then_run', async () => {
    const { edit, authorize, bashCalls } = makeHarness()
    const result = await edit.execute('t1', { path: 'a.txt' }, undefined, undefined, TOOL_CTX)
    expect(result.content[0]).toMatchObject({ text: 'edited the file' })
    expect(authorize).not.toHaveBeenCalled()
    expect(bashCalls).toHaveLength(0)
  })

  it('runs the follow-up command and appends one combined observation', async () => {
    const file = makeTempFile()
    const { edit, authorize, bashCalls } = makeHarness()
    const result = await edit.execute(
      't1',
      { path: file, then_run: { command: 'make test' } },
      undefined,
      undefined,
      TOOL_CTX
    )
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'bash', toolCallId: 't1:then_run', input: { command: 'make test' } })
    )
    expect(bashCalls).toHaveLength(1)
    expect(bashCalls[0].id).toBe('t1:then_run')
    const texts = result.content.map((block: { type: string; text?: string }) => block.text)
    expect(texts.at(-1)).toContain(THEN_RUN_SUCCEEDED)
    expect(texts.at(-1)).toContain('ran: make test')
  })

  it('reports then_run as skipped when the mutation fails', async () => {
    const file = makeTempFile()
    const { edit, bashCalls } = makeHarness({ editError: new Error('no such file') })
    await expect(
      edit.execute('t1', { path: file, then_run: { command: 'make test' } }, undefined, undefined, TOOL_CTX)
    ).rejects.toThrow(THEN_RUN_SKIPPED)
    expect(bashCalls).toHaveLength(0)
  })

  it('preserves the mutation output and marks the failure when the command fails', async () => {
    const file = makeTempFile()
    const { edit } = makeHarness({ bashError: new Error('exit 1') })
    const error = await edit
      .execute('t1', { path: file, then_run: { command: 'make test' } }, undefined, undefined, TOOL_CTX)
      .catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain(THEN_RUN_FAILED)
    expect(error.message).toContain('exit 1')
  })

  it('appends a blocked note instead of running a denied command', async () => {
    const file = makeTempFile()
    const { edit, bashCalls, authorize } = makeHarnessWithAuthorizer()
    const result = await edit.execute(
      't1',
      { path: file, then_run: { command: 'rm -rf /' } },
      undefined,
      undefined,
      TOOL_CTX
    )
    expect(authorize).toHaveBeenCalled()
    const texts = result.content.map((block: { type: string; text?: string }) => block.text)
    expect(texts.at(-1)).toContain(THEN_RUN_BLOCKED)
    expect(texts.at(-1)).toContain('denied in default mode')
    expect(bashCalls).toHaveLength(0)
  })

  it('runs the fused command when the target is untouched', async () => {
    const file = makeTempFile()
    let bashRan = false
    const result = await executeMutationThenRun({
      toolCallId: 't1',
      absolutePath: file,
      thenRun: { command: 'make test' },
      mutate: async () => {
        writeFileSync(file, 'mutated')
        return textResult('wrote the file')
      },
      bash: {
        execute: async () => {
          bashRan = true
          return textResult('ok')
        }
      },
      authorize: vi.fn(async () => undefined),
      signal: undefined,
      ctx: undefined as never
    })
    expect(bashRan).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('mutated')
    expect(result.content.at(-1)).toMatchObject({ text: expect.stringContaining(THEN_RUN_SUCCEEDED) })
  })
})

/** Harness with a denying authorizer, for the blocked-note path. */
function makeHarnessWithAuthorizer() {
  const registered: RegisteredTool[] = []
  const bashCalls: Array<{ id: string; input: unknown }> = []
  const authorize = vi.fn(async () => ({ block: true as const, reason: 'denied in default mode' }))
  const sdk = {
    createEditToolDefinition: () => ({
      name: 'edit',
      label: 'edit',
      parameters: BASE_SCHEMA,
      execute: async () => textResult('edited the file')
    }),
    createWriteToolDefinition: () => ({
      name: 'write',
      label: 'write',
      parameters: BASE_SCHEMA,
      execute: async () => textResult('wrote the file')
    }),
    createBashToolDefinition: () => ({
      name: 'bash',
      label: 'bash',
      parameters: BASE_SCHEMA,
      execute: async (id: string, input: unknown) => {
        bashCalls.push({ id, input })
        return textResult('should not run')
      }
    })
  }
  void createPiActionFusionExtension(sdk as never, { workspacePath: '/ws', authorize })({
    registerTool: (tool: RegisteredTool) => registered.push(tool)
  } as never)
  const byName = Object.fromEntries(registered.map((tool) => [tool.name, tool]))
  return { authorize, bashCalls, edit: byName.edit }
}

describe('action fusion hash guard', () => {
  it('refuses the command when the target changed between mutation and run', async () => {
    const file = makeTempFile('target.txt', 'v1')
    await expect(
      assertUnchangedBeforeCommand(file, async () => {
        // A concurrent writer lands during the yield between the two hashes —
        // exactly what the guard exists to catch.
        writeFileSync(file, 'v2')
      })
    ).rejects.toThrow(THEN_RUN_SKIPPED)
  })

  it('allows the command when the target is untouched across the yield', async () => {
    const file = makeTempFile('target.txt', 'same')
    await expect(assertUnchangedBeforeCommand(file, async () => {})).resolves.toBeUndefined()
  })
})

describe('action fusion queue', () => {
  it('serializes fused operations on the same canonical path', async () => {
    const dir = makeTempDir()
    const order: string[] = []
    const work = (name: string, ms: number) => async () => {
      order.push(`${name}-start`)
      await new Promise((resolve) => setTimeout(resolve, ms))
      order.push(`${name}-end`)
    }
    await Promise.all([
      withFusedFileQueue(join(dir, 'f.txt'), work('a', 25)),
      withFusedFileQueue(join(dir, '.', 'f.txt'), work('b', 0))
    ])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('runs different paths concurrently', async () => {
    const dir = makeTempDir()
    const order: string[] = []
    const work = (name: string) => async () => {
      order.push(`${name}-start`)
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push(`${name}-end`)
    }
    await Promise.all([
      withFusedFileQueue(join(dir, 'a.txt'), work('a')),
      withFusedFileQueue(join(dir, 'b.txt'), work('b'))
    ])
    expect(order).toEqual(['a-start', 'b-start', 'a-end', 'b-end'])
  })
})

describe('action fusion path resolution', () => {
  it('normalizes MSYS-style drive paths for the queue key on Windows', () => {
    expect(normalizeWindowsShellPath('/c/Users/x/a.txt', 'win32')).toBe('C:\\Users\\x\\a.txt')
    expect(normalizeWindowsShellPath('/mnt/d/work', 'win32')).toBe('D:\\work')
    expect(normalizeWindowsShellPath('C:\\already\\native', 'win32')).toBe('C:\\already\\native')
    expect(normalizeWindowsShellPath('/c/Users/x', 'linux')).toBe('/c/Users/x')
  })

  it('resolves @-prefixed, tilde, and file-URL paths like the mutation tools', () => {
    expect(resolveFusionPath('/ws', '@/a.txt')).toBe(resolve('/ws', '/a.txt'))
    expect(resolveFusionPath('/ws', '~/notes.md')).toBe(resolve(homedir(), 'notes.md'))
    const file = join(makeTempDir(), 'u.txt')
    expect(resolveFusionPath('/ws', pathToFileURL(file).href)).toBe(resolve(file))
  })
})
