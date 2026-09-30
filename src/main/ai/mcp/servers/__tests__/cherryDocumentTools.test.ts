import { mkdir, mkdtemp, readFile, rm, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'

const {
  formatFromExtensionMock,
  getPhysicalPathMock,
  listAgentSessionAttachmentsMock,
  loggerErrorMock,
  loggerWarnMock,
  toMarkdownBytesMock
} = vi.hoisted(() => ({
  formatFromExtensionMock: vi.fn(),
  getPhysicalPathMock: vi.fn(),
  listAgentSessionAttachmentsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  toMarkdownBytesMock: vi.fn()
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

vi.mock('@application', () => ({
  application: { get: () => ({ getPhysicalPath: getPhysicalPathMock }) }
}))

vi.mock('@main/ai/messages/agentSessionAttachments', () => ({
  listAgentSessionAttachments: listAgentSessionAttachmentsMock
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

describe('CherryDocumentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    formatFromExtensionMock.mockReturnValue('docx')
    listAgentSessionAttachmentsMock.mockReturnValue([])
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

  // This tool is auto-approved, so an unauthorized path must fail before the converter runs.
  it('rejects an absolute path outside every trusted root', async () => {
    const { tools, workspacePath } = await makeTools()
    const outside = path.join(path.dirname(workspacePath), 'outside.pdf')
    await writeFile(outside, Buffer.from([1, 2, 3]))

    const result = await tools.call({ path: outside }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('outside the workspace')
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  it('rejects relative traversal and symlinks that leave the workspace', async () => {
    const { tools, workspacePath } = await makeTools()
    const outside = path.join(path.dirname(workspacePath), 'outside.docx')
    await writeFile(outside, 'document')
    await symlink(outside, path.join(workspacePath, 'link.docx'))

    const traversal = await tools.call({ path: '../outside.docx' }, signal)
    const symlinkResult = await tools.call({ path: 'link.docx' }, signal)

    expect(traversal.isError).toBe(true)
    expect(symlinkResult.isError).toBe(true)
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  it('converts a managed file attached to the current session', async () => {
    const { tools, workspacePath } = await makeTools()
    const managed = path.join(path.dirname(workspacePath), 'managed-entry.pdf')
    const bytes = Buffer.from([1, 2, 3])
    await writeFile(managed, bytes)
    listAgentSessionAttachmentsMock.mockReturnValue([{ fileEntryId: 'entry-1', handle: 'a.pdf', displayName: 'a.pdf' }])
    getPhysicalPathMock.mockReturnValue(managed)
    formatFromExtensionMock.mockReturnValue('pdf')
    toMarkdownBytesMock.mockResolvedValue('# Converted report')

    const result = await tools.call({ path: managed }, signal)

    expect(result.isError).toBeFalsy()
    expect(toMarkdownBytesMock).toHaveBeenCalledWith(bytes, 'pdf')
  })

  it('rejects a managed file that is not attached to the current session', async () => {
    const { tools, workspacePath } = await makeTools()
    const managedDirectory = path.dirname(workspacePath)
    const mine = path.join(managedDirectory, 'mine.pdf')
    const someoneElses = path.join(managedDirectory, 'other-session.pdf')
    await Promise.all([writeFile(mine, 'a'), writeFile(someoneElses, 'b')])
    listAgentSessionAttachmentsMock.mockReturnValue([{ fileEntryId: 'entry-1', handle: 'a.pdf', displayName: 'a.pdf' }])
    getPhysicalPathMock.mockReturnValue(mine)

    // Sharing a parent directory with an authorized attachment must not authorize a sibling.
    const result = await tools.call({ path: someoneElses }, signal)

    expect(result.isError).toBe(true)
    expect(toMarkdownBytesMock).not.toHaveBeenCalled()
  })

  // A document the agent downloaded or wrote into its own data directory.
  it('converts a file inside the agent data directory', async () => {
    const { agentDataPath, tools } = await makeTools()
    const downloaded = path.join(agentDataPath, 'downloads', 'spec.pdf')
    await mkdir(path.dirname(downloaded), { recursive: true })
    await writeFile(downloaded, Buffer.from([9]))
    formatFromExtensionMock.mockReturnValue('pdf')
    toMarkdownBytesMock.mockResolvedValue('converted')

    const result = await tools.call({ path: downloaded }, signal)

    expect(result.isError).toBeFalsy()
  })

  it('enforces the file-size limit before reading an authorized file', async () => {
    const { tools, workspacePath } = await makeTools()
    const oversize = path.join(workspacePath, 'oversize.pdf')
    await writeFile(oversize, '')
    await truncate(oversize, MAX_FILE_SIZE_BYTES + 1)

    const result = await tools.call({ path: 'oversize.pdf' }, signal)

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('byte limit')
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
