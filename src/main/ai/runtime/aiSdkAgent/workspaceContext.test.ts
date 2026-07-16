import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildWorkspaceContextSection,
  MAX_WORKSPACE_CONTEXT_FILE_BYTES,
  readWorkspaceContextFiles
} from './workspaceContext'

describe('readWorkspaceContextFiles', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'aisdk-agent-ws-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('returns nothing for a workspace without context files', async () => {
    await expect(readWorkspaceContextFiles(workspace)).resolves.toEqual([])
  })

  it('reads AGENTS.md and CLAUDE.md in inclusion order', async () => {
    await writeFile(path.join(workspace, 'CLAUDE.md'), 'claude rules')
    await writeFile(path.join(workspace, 'AGENTS.md'), 'agents rules')

    const files = await readWorkspaceContextFiles(workspace)

    expect(files.map((file) => file.fileName)).toEqual(['AGENTS.md', 'CLAUDE.md'])
    expect(files.map((file) => file.content)).toEqual(['agents rules', 'claude rules'])
    expect(files.every((file) => !file.truncated)).toBe(true)
  })

  it('caps oversized files and marks them truncated', async () => {
    await writeFile(path.join(workspace, 'AGENTS.md'), 'x'.repeat(MAX_WORKSPACE_CONTEXT_FILE_BYTES + 500))

    const [file] = await readWorkspaceContextFiles(workspace)

    expect(file.truncated).toBe(true)
    expect(Buffer.byteLength(file.content)).toBe(MAX_WORKSPACE_CONTEXT_FILE_BYTES)
    expect(buildWorkspaceContextSection(workspace, [file])).toContain('[Truncated:')
  })

  it('skips whitespace-only files and non-file entries', async () => {
    await writeFile(path.join(workspace, 'AGENTS.md'), '   \n  ')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(workspace, 'CLAUDE.md'))

    await expect(readWorkspaceContextFiles(workspace)).resolves.toEqual([])
  })
})

describe('buildWorkspaceContextSection', () => {
  it('always states the working directory and appends one heading per file', () => {
    const section = buildWorkspaceContextSection('/tmp/ws', [
      { fileName: 'AGENTS.md', content: 'rules', truncated: false }
    ])
    expect(section).toContain('Your working directory is: /tmp/ws')
    expect(section).toContain('## AGENTS.md')
    expect(section).toContain('rules')
    expect(section).not.toContain('[Truncated:')
  })
})
