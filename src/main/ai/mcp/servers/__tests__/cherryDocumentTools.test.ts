import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { formatFromExtensionMock, loggerErrorMock, loggerWarnMock, toMarkdownBytesMock } = vi.hoisted(() => ({
  formatFromExtensionMock: vi.fn(),
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
    tools: new CherryDocumentTools({ agentDataPath, workspacePath }),
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
