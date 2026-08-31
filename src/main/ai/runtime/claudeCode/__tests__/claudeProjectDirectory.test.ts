import { mkdir, mkdtemp, readFile, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { claudeProjectDirectoryName, ensureTranscriptAvailableForWorkspace } from '../claudeProjectDirectory'

const roots: string[] = []

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cherry-transcript-relocation-'))
  roots.push(root)
  const claudeRoot = path.join(root, '.claude')
  const projectsDirectory = path.join(claudeRoot, 'projects')
  const workspacePath = path.join(root, 'restored', 'workspace')
  await mkdir(projectsDirectory, { recursive: true })
  return { claudeRoot, projectsDirectory, workspacePath }
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ensureTranscriptAvailableForWorkspace', () => {
  it('keeps an existing transcript without overwriting it', async () => {
    const fixture = await createFixture()
    const targetDirectory = path.join(
      fixture.projectsDirectory,
      claudeProjectDirectoryName(path.resolve(fixture.workspacePath))
    )
    await mkdir(targetDirectory)
    await writeFile(path.join(targetDirectory, 'session-1.jsonl'), 'current')

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('present')
    await expect(readFile(path.join(targetDirectory, 'session-1.jsonl'), 'utf8')).resolves.toBe('current')
  })

  it('keeps a newer current transcript when an older copy exists under another project key', async () => {
    const fixture = await createFixture()
    const oldDirectory = path.join(fixture.projectsDirectory, 'old-workspace-key')
    const targetDirectory = path.join(
      fixture.projectsDirectory,
      claudeProjectDirectoryName(path.resolve(fixture.workspacePath))
    )
    await mkdir(oldDirectory)
    await mkdir(targetDirectory)
    const oldTranscript = path.join(oldDirectory, 'session-1.jsonl')
    const currentTranscript = path.join(targetDirectory, 'session-1.jsonl')
    await writeFile(oldTranscript, 'older history')
    await writeFile(currentTranscript, 'current history with new messages')
    await utimes(oldTranscript, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    await utimes(currentTranscript, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('present')
    await expect(readFile(currentTranscript, 'utf8')).resolves.toBe('current history with new messages')
  })

  it('restores the newest matching transcript when multiple old project keys contain the token', async () => {
    const fixture = await createFixture()
    const olderDirectory = path.join(fixture.projectsDirectory, 'a-older-workspace-key')
    const newerDirectory = path.join(fixture.projectsDirectory, 'z-newer-workspace-key')
    await mkdir(olderDirectory)
    await mkdir(newerDirectory)
    const olderTranscript = path.join(olderDirectory, 'session-1.jsonl')
    const newerTranscript = path.join(newerDirectory, 'session-1.jsonl')
    await writeFile(olderTranscript, 'older history')
    await writeFile(newerTranscript, 'newer history')
    await utimes(olderTranscript, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    await utimes(newerTranscript, new Date('2026-01-02T00:00:00Z'), new Date('2026-01-02T00:00:00Z'))

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('copied')
    const targetPath = path.join(
      fixture.projectsDirectory,
      claudeProjectDirectoryName(path.resolve(fixture.workspacePath)),
      'session-1.jsonl'
    )
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('newer history')
  })

  it('copies a restored transcript from an old workspace key', async () => {
    const fixture = await createFixture()
    const oldDirectory = path.join(fixture.projectsDirectory, 'old-workspace-key')
    await mkdir(oldDirectory)
    await writeFile(path.join(oldDirectory, 'session-1.jsonl'), 'restored history')

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('copied')
    const targetPath = path.join(
      fixture.projectsDirectory,
      claudeProjectDirectoryName(path.resolve(fixture.workspacePath)),
      'session-1.jsonl'
    )
    await expect(readFile(targetPath, 'utf8')).resolves.toBe('restored history')
  })

  it('handles concurrent recovery into a missing project directory', async () => {
    const fixture = await createFixture()
    const oldDirectory = path.join(fixture.projectsDirectory, 'old-workspace-key')
    await mkdir(oldDirectory)
    await writeFile(path.join(oldDirectory, 'session-1.jsonl'), 'restored history')

    const results = await Promise.all([
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1'),
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ])

    expect(results).toContain('copied')
    expect(results.every((result) => result === 'copied' || result === 'present')).toBe(true)
  })

  it('atomically repairs an interrupted destination copy', async () => {
    const fixture = await createFixture()
    const oldDirectory = path.join(fixture.projectsDirectory, 'old-workspace-key')
    const targetDirectory = path.join(
      fixture.projectsDirectory,
      claudeProjectDirectoryName(path.resolve(fixture.workspacePath))
    )
    await mkdir(oldDirectory)
    await mkdir(targetDirectory)
    await writeFile(path.join(oldDirectory, 'session-1.jsonl'), 'complete restored history')
    await writeFile(path.join(targetDirectory, 'session-1.jsonl'), 'partial')
    await utimes(
      path.join(targetDirectory, 'session-1.jsonl'),
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-01T00:00:00Z')
    )
    await utimes(
      path.join(oldDirectory, 'session-1.jsonl'),
      new Date('2026-01-02T00:00:00Z'),
      new Date('2026-01-02T00:00:00Z')
    )

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('copied')
    await expect(readFile(path.join(targetDirectory, 'session-1.jsonl'), 'utf8')).resolves.toBe(
      'complete restored history'
    )
  })

  it('returns missing when no matching transcript exists', async () => {
    const fixture = await createFixture()

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('missing')
  })

  it('returns missing when the projects directory does not exist', async () => {
    const fixture = await createFixture()

    await expect(
      ensureTranscriptAvailableForWorkspace(path.join(fixture.claudeRoot, 'absent'), fixture.workspacePath, 'session-1')
    ).resolves.toBe('missing')
  })

  it('rejects unsafe tokens and ignores symbolic-link transcripts', async () => {
    const fixture = await createFixture()
    const oldDirectory = path.join(fixture.projectsDirectory, 'old-workspace-key')
    const source = path.join(fixture.claudeRoot, 'outside.jsonl')
    await mkdir(oldDirectory)
    await writeFile(source, 'outside')
    await symlink(source, path.join(oldDirectory, 'session-1.jsonl'))

    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, '../outside')
    ).resolves.toBe('unsafe')
    await expect(
      ensureTranscriptAvailableForWorkspace(fixture.claudeRoot, fixture.workspacePath, 'session-1')
    ).resolves.toBe('missing')
  })
})
