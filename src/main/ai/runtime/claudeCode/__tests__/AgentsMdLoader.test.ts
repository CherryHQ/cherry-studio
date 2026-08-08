import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
  }
}))

const { AgentsMdLoader } = await import('../AgentsMdLoader')

describe('AgentsMdLoader', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'cherry-agents-md-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('loads the workspace AGENTS.md as initial context', async () => {
    await writeFile(path.join(workspace, 'AGENTS.md'), 'Run pnpm test before finishing.\n')
    const loader = await AgentsMdLoader.create(workspace)

    const context = await loader.loadInitialContext()

    expect(context).toContain('## Workspace Instructions (AGENTS.md)')
    expect(context).toContain('Scope: this file applies to the entire workspace')
    expect(context).toContain('Run pnpm test before finishing.')
  })

  it('loads nested instructions root-first before a structured file operation', async () => {
    await mkdir(path.join(workspace, 'packages', 'editor'), { recursive: true })
    await writeFile(path.join(workspace, 'AGENTS.md'), 'Root instructions')
    await writeFile(path.join(workspace, 'packages', 'AGENTS.md'), 'Package instructions')
    await writeFile(path.join(workspace, 'packages', 'editor', 'AGENTS.md'), 'Editor instructions')
    const loader = await AgentsMdLoader.create(workspace)

    const context = await loader.loadForTool('Edit', {
      file_path: path.join(workspace, 'packages', 'editor', 'Editor.tsx')
    })

    expect(context).toBeDefined()
    expect(context!.indexOf('Root instructions')).toBeLessThan(context!.indexOf('Package instructions'))
    expect(context!.indexOf('Package instructions')).toBeLessThan(context!.indexOf('Editor instructions'))
    expect(context).toContain('the file closest to the target path takes precedence')
  })

  it('loads each scoped file once while still discovering sibling instructions', async () => {
    await mkdir(path.join(workspace, 'packages', 'alpha'), { recursive: true })
    await mkdir(path.join(workspace, 'packages', 'beta'), { recursive: true })
    await writeFile(path.join(workspace, 'AGENTS.md'), 'Root instructions')
    await writeFile(path.join(workspace, 'packages', 'alpha', 'AGENTS.md'), 'Alpha instructions')
    await writeFile(path.join(workspace, 'packages', 'beta', 'AGENTS.md'), 'Beta instructions')
    const loader = await AgentsMdLoader.create(workspace)

    const alpha = await loader.loadForTool('Read', {
      file_path: path.join(workspace, 'packages', 'alpha', 'index.ts')
    })
    const beta = await loader.loadForTool('Write', {
      file_path: path.join(workspace, 'packages', 'beta', 'index.ts')
    })

    expect(alpha).toContain('Root instructions')
    expect(alpha).toContain('Alpha instructions')
    expect(beta).not.toContain('Root instructions')
    expect(beta).toContain('Beta instructions')
  })

  it('uses directory paths for Glob and Grep scope discovery', async () => {
    await mkdir(path.join(workspace, 'src', 'renderer'), { recursive: true })
    await writeFile(path.join(workspace, 'src', 'AGENTS.md'), 'Renderer parent instructions')
    const loader = await AgentsMdLoader.create(workspace)

    const context = await loader.loadForTool('Glob', { path: path.join(workspace, 'src', 'renderer') })

    expect(context).toContain('Renderer parent instructions')
  })

  it('uses the parent directory when Grep targets a file', async () => {
    await mkdir(path.join(workspace, 'src'), { recursive: true })
    await writeFile(path.join(workspace, 'src', 'AGENTS.md'), 'Source instructions')
    const targetFile = path.join(workspace, 'src', 'index.ts')
    await writeFile(targetFile, 'export {}')
    const loader = await AgentsMdLoader.create(workspace)

    const context = await loader.loadForTool('Grep', { path: targetFile })

    expect(context).toContain('Source instructions')
  })

  it('ignores target paths outside the workspace', async () => {
    await writeFile(path.join(workspace, 'AGENTS.md'), 'Workspace instructions')
    const loader = await AgentsMdLoader.create(workspace)

    await expect(
      loader.loadForTool('Read', { file_path: path.join(os.tmpdir(), 'outside.ts') })
    ).resolves.toBeUndefined()
  })

  it.runIf(process.platform !== 'win32')('deduplicates AGENTS.md symlinked to a native CLAUDE.md', async () => {
    await writeFile(path.join(workspace, 'CLAUDE.md'), 'Shared instructions')
    await symlink('CLAUDE.md', path.join(workspace, 'AGENTS.md'))
    const loader = await AgentsMdLoader.create(workspace)

    const context = await loader.loadInitialContext()

    expect(context).toContain('Structured file tools load applicable AGENTS.md files automatically')
    expect(context).not.toContain('Shared instructions')
  })

  it.runIf(process.platform !== 'win32')('does not follow AGENTS.md symlinks outside the workspace', async () => {
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), 'cherry-agents-md-outside-'))
    try {
      const outsideFile = path.join(outsideDirectory, 'instructions.md')
      await writeFile(outsideFile, 'Do not expose this file')
      await symlink(outsideFile, path.join(workspace, 'AGENTS.md'))
      const loader = await AgentsMdLoader.create(workspace)

      const context = await loader.loadInitialContext()

      expect(context).not.toContain('Do not expose this file')
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true })
    }
  })

  it('injects newly discovered instructions through the PreToolUse hook', async () => {
    await mkdir(path.join(workspace, 'src'), { recursive: true })
    await writeFile(path.join(workspace, 'src', 'AGENTS.md'), 'Use the source conventions')
    const loader = await AgentsMdLoader.create(workspace)
    const hook = loader.createPreToolUseHook()

    const output = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(workspace, 'src', 'index.ts') }
      } as never,
      undefined,
      { signal: new AbortController().signal }
    )

    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: expect.stringContaining('Use the source conventions')
      }
    })
  })
})
