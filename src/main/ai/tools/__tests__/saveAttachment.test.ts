import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { createFileAttachmentHandle } from '@main/ai/messages/attachmentHandle'
import type { FileAttachmentRef } from '@main/ai/messages/attachmentTypes'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveAttachmentToWorkspace } from '../saveAttachment'

const signal = new AbortController().signal
const sourceBytes = Buffer.from([0x52, 0x65, 0x67, 0x69, 0x6f, 0x6e, 0x00, 0xff])
const attachment: FileAttachmentRef = {
  fileEntryId: 'entry-secret',
  handle: createFileAttachmentHandle('entry-secret'),
  displayName: 'sales.csv'
}

describe('saveAttachmentToWorkspace', () => {
  let workspacePath: string
  let sourcePath: string
  const withTempCopy = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    workspacePath = await mkdtemp(path.join(tmpdir(), 'save-attachment-workspace-'))
    const sourceDirectory = await mkdtemp(path.join(tmpdir(), 'save-attachment-source-'))
    sourcePath = path.join(sourceDirectory, 'sales.csv')
    await writeFile(sourcePath, sourceBytes)
    withTempCopy.mockImplementation(async (_id: string, fn: (tempPath: string) => Promise<unknown>) => fn(sourcePath))
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'FileManager') return { withTempCopy } as never
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  afterEach(async () => {
    await Promise.all([
      rm(workspacePath, { recursive: true, force: true }),
      rm(path.dirname(sourcePath), { recursive: true, force: true })
    ])
  })

  it('copies the original attachment bytes into a new workspace file', async () => {
    const result = await saveAttachmentToWorkspace(
      workspacePath,
      { filename: attachment.handle, output_path: 'sales.csv' },
      [attachment],
      signal
    )

    expect(withTempCopy).toHaveBeenCalledWith('entry-secret', expect.any(Function))
    expect(await readFile(path.join(workspacePath, 'sales.csv'))).toEqual(sourceBytes)
    expect(result).toEqual({ path: 'sales.csv' })
    expect(JSON.stringify(result)).not.toContain('entry-secret')
  })

  it('saves into an existing workspace subdirectory', async () => {
    await mkdir(path.join(workspacePath, 'inputs'))
    const result = await saveAttachmentToWorkspace(
      workspacePath,
      { filename: attachment.handle, output_path: 'inputs/sales.csv' },
      [attachment],
      signal
    )

    expect(await readFile(path.join(workspacePath, 'inputs', 'sales.csv'))).toEqual(sourceBytes)
    expect(result).toEqual({ path: 'inputs/sales.csv' })
  })

  it('rejects a missing output directory before opening the attachment', async () => {
    await expect(
      saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: 'missing/sales.csv' },
        [attachment],
        signal
      )
    ).rejects.toThrow(/output directory does not exist/i)

    expect(withTempCopy).not.toHaveBeenCalled()
  })

  it('rejects an absolute output path even when it points inside the workspace', async () => {
    const absoluteOutput = path.join(workspacePath, 'absolute.csv')

    await expect(
      saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: absoluteOutput },
        [attachment],
        signal
      )
    ).rejects.toThrow(/workspace-relative/i)

    expect(withTempCopy).not.toHaveBeenCalled()
    await expect(readFile(absoluteOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a filename outside the current attachment allow-list without leaking internal paths or ids', async () => {
    let error: Error | undefined
    try {
      await saveAttachmentToWorkspace(
        workspacePath,
        { filename: 'other.csv', output_path: 'other.csv' },
        [attachment],
        signal
      )
    } catch (caught) {
      error = caught as Error
    }

    expect(error?.message).toContain(`Available: ${attachment.handle}`)
    expect(error?.message).not.toContain('entry-secret')
    expect(error?.message).not.toContain(sourcePath)
    expect(withTempCopy).not.toHaveBeenCalled()
  })

  it('rejects parent traversal before copying the attachment', async () => {
    const escapedOutput = path.join(path.dirname(workspacePath), 'escaped.csv')

    await expect(
      saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: '../escaped.csv' },
        [attachment],
        signal
      )
    ).rejects.toThrow(/traverse outside/i)

    expect(withTempCopy).not.toHaveBeenCalled()
    await expect(readFile(escapedOutput)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an output directory symlink that escapes the workspace', async () => {
    const outsideDirectory = path.dirname(sourcePath)
    await symlink(outsideDirectory, path.join(workspacePath, 'escaped'))

    let error: Error | undefined
    try {
      await saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: 'escaped/copied.csv' },
        [attachment],
        signal
      )
    } catch (caught) {
      error = caught as Error
    }

    expect(error?.message).toMatch(/outside .*workspace/i)
    expect(error?.message).not.toContain('entry-secret')
    expect(error?.message).not.toContain(sourcePath)
    expect(withTempCopy).not.toHaveBeenCalled()
    await expect(readFile(path.join(outsideDirectory, 'copied.csv'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not copy bytes when an output directory becomes an escaping symlink during staging', async () => {
    const outputDirectory = path.join(workspacePath, 'output')
    const outsideDirectory = path.dirname(sourcePath)
    await mkdir(outputDirectory)
    withTempCopy.mockImplementationOnce(async (_id: string, fn: (tempPath: string) => Promise<unknown>) => {
      await rm(outputDirectory, { recursive: true, force: true })
      await symlink(outsideDirectory, outputDirectory)
      return fn(sourcePath)
    })

    await expect(
      saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: 'output/copied.csv' },
        [attachment],
        signal
      )
    ).rejects.toThrow(/failed to save attached file/i)

    await expect(readFile(path.join(outsideDirectory, 'copied.csv'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never replaces an existing workspace file', async () => {
    const outputPath = path.join(workspacePath, 'sales.csv')
    await writeFile(outputPath, 'keep me')

    let error: Error | undefined
    try {
      await saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: 'sales.csv' },
        [attachment],
        signal
      )
    } catch (caught) {
      error = caught as Error
    }

    expect(await readFile(outputPath, 'utf8')).toBe('keep me')
    expect(error?.message).toMatch(/already exists/i)
    expect(error?.message).not.toContain('entry-secret')
    expect(error?.message).not.toContain(sourcePath)
  })

  it('sanitizes filesystem failures so the attachment temp path is not returned', async () => {
    await rm(sourcePath)

    let error: Error | undefined
    try {
      await saveAttachmentToWorkspace(
        workspacePath,
        { filename: attachment.handle, output_path: 'sales.csv' },
        [attachment],
        signal
      )
    } catch (caught) {
      error = caught as Error
    }

    expect(error?.message).toMatch(/failed to save attached file/i)
    expect(error?.message).not.toContain('entry-secret')
    expect(error?.message).not.toContain(sourcePath)
  })
})
