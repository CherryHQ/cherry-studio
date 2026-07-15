import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  readWebUiWorkspaceBinaryPreview,
  readWebUiWorkspaceTextFile,
  resolveWebUiWorkspacePath,
  WebUiWorkspaceFileError
} from '../workspaceFiles'

describe('WebUI workspace file boundary', () => {
  let workspacePath: string
  let outsidePath: string

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'cherry-webui-workspace-'))
    outsidePath = await mkdtemp(path.join(tmpdir(), 'cherry-webui-outside-'))
    await mkdir(path.join(workspacePath, 'docs'))
  })

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true })
    await rm(outsidePath, { recursive: true, force: true })
  })

  it('resolves an existing workspace-relative file', async () => {
    const filePath = path.join(workspacePath, 'docs', 'notes.md')
    await writeFile(filePath, '# Notes')

    const result = await resolveWebUiWorkspacePath(workspacePath, 'docs/notes.md')

    expect(result.requestedRealPath).toBe(
      await resolveWebUiWorkspacePath(workspacePath, 'docs\\notes.md').then((v) => v.requestedRealPath)
    )
    expect(result.relativePath).toBe('docs/notes.md')
  })

  it.each(['../outside.txt', 'docs/../../outside.txt', '/outside.txt', 'C:/outside.txt'])(
    'rejects unsafe requested path %s',
    async (requestedPath) => {
      await expect(resolveWebUiWorkspacePath(workspacePath, requestedPath)).rejects.toBeInstanceOf(
        WebUiWorkspaceFileError
      )
    }
  )

  it('rejects a symbolic-link escape from the workspace', async () => {
    await writeFile(path.join(outsidePath, 'secret.txt'), 'secret')
    await symlink(outsidePath, path.join(workspacePath, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(resolveWebUiWorkspacePath(workspacePath, 'escape/secret.txt')).rejects.toMatchObject({
      status: 403,
      code: 'WEBUI_WORKSPACE_PATH_BLOCKED'
    })
  })

  it('returns decoded text and classifies binary files', async () => {
    await writeFile(path.join(workspacePath, 'docs', 'hello.txt'), 'hello webui')
    await writeFile(path.join(workspacePath, 'docs', 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))

    await expect(readWebUiWorkspaceTextFile(workspacePath, 'docs/hello.txt')).resolves.toMatchObject({
      kind: 'text',
      content: 'hello webui',
      size: 11
    })
    await expect(readWebUiWorkspaceTextFile(workspacePath, 'docs/binary.bin')).resolves.toMatchObject({
      kind: 'binary'
    })
  })

  it('allows only supported images, PDF, DOCX, and PPTX documents through the binary preview endpoint', async () => {
    await writeFile(path.join(workspacePath, 'pixel.png'), Buffer.from([137, 80, 78, 71]))
    await writeFile(path.join(workspacePath, 'report.pdf'), Buffer.from('%PDF-1.7'))
    await writeFile(path.join(workspacePath, 'report.docx'), Buffer.from([80, 75, 3, 4]))
    await writeFile(path.join(workspacePath, 'slides.pptx'), Buffer.from([80, 75, 3, 4]))
    await writeFile(path.join(workspacePath, 'archive.zip'), Buffer.from([80, 75, 3, 4]))

    await expect(readWebUiWorkspaceBinaryPreview(workspacePath, 'pixel.png')).resolves.toMatchObject({
      contentType: 'image/png',
      name: 'pixel.png'
    })
    await expect(readWebUiWorkspaceBinaryPreview(workspacePath, 'report.pdf')).resolves.toMatchObject({
      contentType: 'application/pdf',
      name: 'report.pdf'
    })
    await expect(readWebUiWorkspaceBinaryPreview(workspacePath, 'report.docx')).resolves.toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      name: 'report.docx'
    })
    await expect(readWebUiWorkspaceBinaryPreview(workspacePath, 'slides.pptx')).resolves.toMatchObject({
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      name: 'slides.pptx'
    })
    await expect(readWebUiWorkspaceBinaryPreview(workspacePath, 'archive.zip')).rejects.toMatchObject({
      status: 415,
      code: 'WEBUI_WORKSPACE_PREVIEW_UNSUPPORTED'
    })
  })
})
