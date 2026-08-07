import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  fileManagerGetMetadataMock,
  fileManagerGetPhysicalPathMock,
  fileManagerReadMock,
  formatFromExtensionMock,
  listSessionMessagesMock,
  loggerErrorMock,
  loggerWarnMock,
  toMarkdownBytesMock
} = vi.hoisted(() => ({
  fileManagerGetMetadataMock: vi.fn(),
  fileManagerGetPhysicalPathMock: vi.fn(),
  fileManagerReadMock: vi.fn(),
  formatFromExtensionMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  toMarkdownBytesMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: {
      getMetadata: fileManagerGetMetadataMock,
      getPhysicalPath: fileManagerGetPhysicalPathMock,
      read: fileManagerReadMock
    }
  })
})

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { listSessionMessages: listSessionMessagesMock }
}))

vi.mock('@firecrawl/anydoc', () => ({
  formatFromExtension: formatFromExtensionMock,
  toMarkdownBytes: toMarkdownBytesMock
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: loggerErrorMock, warn: loggerWarnMock })
  }
}))

const { CherryDocumentTools } = await import('../cherryDocumentTools')

const roots: string[] = []
const signal = new AbortController().signal

async function makeTools() {
  const root = await mkdtemp(path.join(tmpdir(), 'cherry-to-markdown-'))
  roots.push(root)
  const workspacePath = path.join(root, 'workspace')
  const agentDataPath = path.join(root, 'agent-data')
  await Promise.all([mkdir(workspacePath), mkdir(agentDataPath)])
  return {
    agentDataPath,
    tools: new CherryDocumentTools({ agentDataPath, sessionId: 'session-1', workspacePath }),
    workspacePath
  }
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const part = result.content[0]
  return part.type === 'text' ? (part.text ?? '') : ''
}

function attachmentMessage(fileEntryId: string, filename: string) {
  return {
    id: `message-${fileEntryId}`,
    role: 'user',
    data: {
      parts: [
        {
          type: 'file',
          url: `file:///stale/${filename}`,
          mediaType: 'application/pdf',
          filename,
          providerMetadata: { cherry: { fileEntryId } }
        }
      ]
    }
  }
}

describe('CherryDocumentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    formatFromExtensionMock.mockReturnValue('docx')
    listSessionMessagesMock.mockReturnValue({ items: [], nextCursor: undefined })
  })

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('writes converted Markdown to agent-private temp storage without returning its contents', async () => {
    const { agentDataPath, tools, workspacePath } = await makeTools()
    await writeFile(path.join(workspacePath, 'report.docx'), Buffer.from([1, 2, 3]))
    toMarkdownBytesMock.mockResolvedValue('# Secret title\n\nbody\n')

    const result = await tools.call({ path: 'report.docx' }, signal)
    const output = JSON.parse(textOf(result))

    expect(result.isError).toBeFalsy()
    expect(output).toEqual({
      path: expect.stringMatching(/\.md$/),
      chars: 20
    })
    expect(output.path).toContain(path.join(agentDataPath, 'tmp', 'to-markdown'))
    expect(textOf(result)).not.toContain('Secret title')
    await expect(readFile(output.path, 'utf-8')).resolves.toBe('# Secret title\n\nbody')
    expect(formatFromExtensionMock).toHaveBeenCalledWith('.docx')
    expect(toMarkdownBytesMock).toHaveBeenCalledWith(Buffer.from([1, 2, 3]), 'docx')
  })

  it('converts a managed attachment referenced by the current Agent session', async () => {
    const { tools, workspacePath } = await makeTools()
    const managedDirectory = path.join(path.dirname(workspacePath), 'managed')
    const managedPath = path.join(managedDirectory, 'entry-id.pdf')
    const bytes = Buffer.from([1, 2, 3])
    await mkdir(managedDirectory)
    await writeFile(managedPath, bytes)
    listSessionMessagesMock.mockReturnValue({
      items: [attachmentMessage('entry-id', 'quarterly-report.pdf')],
      nextCursor: undefined
    })
    fileManagerGetPhysicalPathMock.mockReturnValue(managedPath)
    fileManagerGetMetadataMock.mockResolvedValue({ size: bytes.length })
    fileManagerReadMock.mockResolvedValue({
      content: bytes.toString('base64'),
      mime: 'application/pdf',
      version: { mtime: 1, size: bytes.length }
    })
    formatFromExtensionMock.mockReturnValue('pdf')
    toMarkdownBytesMock.mockResolvedValue('# Converted report')

    const result = await tools.call({ path: managedPath }, signal)

    expect(result.isError).toBeFalsy()
    expect(formatFromExtensionMock).toHaveBeenCalledWith('.pdf')
    expect(toMarkdownBytesMock).toHaveBeenCalledWith(bytes, 'pdf')
    expect(fileManagerReadMock).toHaveBeenCalledWith('entry-id', { encoding: 'base64' })
    expect(listSessionMessagesMock).toHaveBeenCalledWith('session-1', {
      cursor: undefined,
      limit: expect.any(Number)
    })
  })

  it('enforces the file-size limit before reading a managed attachment', async () => {
    const { tools, workspacePath } = await makeTools()
    const managedPath = path.join(path.dirname(workspacePath), 'oversize.pdf')
    await writeFile(managedPath, 'placeholder')
    listSessionMessagesMock.mockReturnValue({
      items: [attachmentMessage('oversize-entry', 'oversize.pdf')],
      nextCursor: undefined
    })
    fileManagerGetPhysicalPathMock.mockReturnValue(managedPath)
    fileManagerGetMetadataMock.mockResolvedValue({ size: MAX_FILE_SIZE_BYTES + 1 })

    const result = await tools.call({ path: managedPath }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('byte limit')
    expect(fileManagerReadMock).not.toHaveBeenCalled()
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  it('still rejects an outside path that is not attached to the current Agent session', async () => {
    const { tools, workspacePath } = await makeTools()
    const outside = path.join(path.dirname(workspacePath), 'outside.pdf')
    const otherAttachment = path.join(path.dirname(workspacePath), 'other.pdf')
    await Promise.all([writeFile(outside, 'secret'), writeFile(otherAttachment, 'allowed')])
    listSessionMessagesMock.mockReturnValue({
      items: [attachmentMessage('other-entry', 'other.pdf')],
      nextCursor: undefined
    })
    fileManagerGetPhysicalPathMock.mockReturnValue(otherAttachment)

    const result = await tools.call({ path: outside }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('outside the workspace')
    expect(fileManagerReadMock).not.toHaveBeenCalled()
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  it('rejects workspace traversal and symlink escapes', async () => {
    const { tools, workspacePath } = await makeTools()
    const outside = path.join(path.dirname(workspacePath), 'outside.docx')
    await writeFile(outside, 'secret')
    await symlink(outside, path.join(workspacePath, 'escape.docx'))

    const traversal = await tools.call({ path: '../outside.docx' }, signal)
    const symlinkEscape = await tools.call({ path: 'escape.docx' }, signal)

    expect(traversal.isError).toBe(true)
    expect(textOf(traversal)).toContain('outside the workspace')
    expect(symlinkEscape.isError).toBe(true)
    expect(textOf(symlinkEscape)).toContain('outside the workspace')
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  it('returns an error instead of creating a file for blank conversion output', async () => {
    const { agentDataPath, tools, workspacePath } = await makeTools()
    await writeFile(path.join(workspacePath, 'empty.pdf'), Buffer.from([1]))
    toMarkdownBytesMock.mockResolvedValue(' \n ')

    const result = await tools.call({ path: 'empty.pdf' }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('Document conversion produced no text')
    await expect(readFile(path.join(agentDataPath, 'tmp', 'to-markdown', 'missing.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('removes stale Markdown outputs while preserving recent files', async () => {
    const { agentDataPath, tools, workspacePath } = await makeTools()
    const outputDirectory = path.join(agentDataPath, 'tmp', 'to-markdown')
    await mkdir(outputDirectory, { recursive: true })
    const stale = path.join(outputDirectory, 'stale.md')
    const recent = path.join(outputDirectory, 'recent.md')
    await Promise.all([writeFile(stale, 'old'), writeFile(recent, 'new')])
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(stale, old, old)
    await writeFile(path.join(workspacePath, 'report.docx'), Buffer.from([1]))
    toMarkdownBytesMock.mockResolvedValue('converted')

    await tools.call({ path: 'report.docx' }, signal)

    await expect(readFile(stale)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(recent, 'utf-8')).resolves.toBe('new')
  })
})
