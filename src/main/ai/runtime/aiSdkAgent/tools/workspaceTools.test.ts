import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { buildWorkspaceFileTools } from './workspaceTools'

const CALL_OPTIONS = { toolCallId: 'call-1', messages: [] }
const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const tempRoot = path.join(process.cwd(), '.context', 'vitest-temp')
  await fs.mkdir(tempRoot, { recursive: true })
  const tempDir = await fs.mkdtemp(path.join(tempRoot, prefix))
  tempDirs.push(tempDir)
  return tempDir
}

describe('workspace file tools', () => {
  let workspace: string
  let outside: string
  let tools: ReturnType<typeof buildWorkspaceFileTools>

  beforeEach(async () => {
    workspace = await createTempDir('aisdk-ws-')
    outside = await createTempDir('aisdk-outside-')
    await fs.writeFile(path.join(workspace, 'inside.txt'), 'hello inside\nsecond line\n')
    await fs.writeFile(path.join(outside, 'secret.txt'), 'top-secret')
    tools = buildWorkspaceFileTools(workspace)
  })

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  const run = (name: keyof typeof tools, input: Record<string, unknown>) =>
    tools[name].execute!(input as never, CALL_OPTIONS) as Promise<string>

  it('reads, writes, edits, and lists inside the workspace', async () => {
    await expect(run('read', { file_path: 'inside.txt' })).resolves.toContain('hello inside')

    await run('write', { file_path: 'notes/new.txt', content: 'created' })
    await expect(fs.readFile(path.join(workspace, 'notes/new.txt'), 'utf-8')).resolves.toBe('created')

    await run('edit', { file_path: 'inside.txt', old_string: 'hello inside', new_string: 'hello edited' })
    await expect(fs.readFile(path.join(workspace, 'inside.txt'), 'utf-8')).resolves.toContain('hello edited')

    await expect(run('ls', {})).resolves.toContain('inside.txt')
  })

  describe('path escape is rejected for every tool', () => {
    const escapeInputs: Record<string, () => Record<string, unknown>> = {
      read: () => ({ file_path: path.join(outside, 'secret.txt') }),
      ls: () => ({ path: outside }),
      glob: () => ({ pattern: '*.txt', path: outside }),
      grep: () => ({ pattern: 'secret', path: outside }),
      write: () => ({ file_path: '../escape.txt', content: 'x' }),
      edit: () => ({ file_path: path.join(outside, 'secret.txt'), old_string: 'top', new_string: 'x' })
    }

    it.each(Object.keys(escapeInputs))('%s rejects paths outside the workspace', async (name) => {
      await expect(run(name as keyof typeof tools, escapeInputs[name]())).rejects.toThrow(
        'outside the configured workspace root'
      )
    })

    it.each(['read', 'write', 'edit'])('%s rejects relative ../ traversal', async (name) => {
      const input =
        name === 'read'
          ? { file_path: `../${path.basename(outside)}/secret.txt` }
          : name === 'write'
            ? { file_path: `../${path.basename(outside)}/planted.txt`, content: 'x' }
            : { file_path: `../${path.basename(outside)}/secret.txt`, old_string: 'top', new_string: 'x' }
      await expect(run(name as keyof typeof tools, input)).rejects.toThrow('outside the configured workspace root')
    })

    it('rejects symlink escapes for read and write', async () => {
      const link = path.join(workspace, 'escape-link')
      await fs.symlink(path.join(outside, 'secret.txt'), link)

      await expect(run('read', { file_path: 'escape-link' })).rejects.toThrow('outside the configured workspace root')
      await expect(run('write', { file_path: 'escape-link', content: 'overwrite' })).rejects.toThrow(
        'outside the configured workspace root'
      )
      await expect(fs.readFile(path.join(outside, 'secret.txt'), 'utf-8')).resolves.toBe('top-secret')
    })
  })
})
