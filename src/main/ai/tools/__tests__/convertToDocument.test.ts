import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { registerDocumentTools } from '@main/ai/mcp/servers/cherryDocumentTools'
import type * as DocumentConversion from '@main/services/documentConversion'
import { CONVERT_TO_DOCUMENT_TOOL_NAME, parseConvertedDocumentOutput } from '@shared/ai/documentConversionTool'

import { convertToDocumentToWorkspace } from '../convertToDocument'

const { convertDocumentBundle, attachments, physicalPath } = vi.hoisted(() => ({
  convertDocumentBundle: vi.fn(),
  attachments: vi.fn(),
  physicalPath: vi.fn()
}))
vi.mock('@main/ai/messages/agentSessionAttachments', () => ({ listAgentSessionAttachments: attachments }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const module = mockApplicationFactory()
  const original = module.application.get
  module.application.get = vi.fn((name) =>
    name === 'FileManager' ? { getPhysicalPath: physicalPath } : original(name)
  )
  return module
})
vi.mock('@main/services/documentConversion', async (importOriginal) => ({
  ...(await importOriginal<typeof DocumentConversion>()),
  convertDocumentBundle
}))

const signal = new AbortController().signal
const bytes = Buffer.from('converted document bytes')
const document = { bytes, assets: new Map<string, Buffer>(), warnings: [] }

describe('convertToDocumentToWorkspace', () => {
  let root: string
  let workspacePath: string
  let temporaryPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(path.join(tmpdir(), 'convert-document-'))
    workspacePath = path.join(root, 'workspace')
    temporaryPath = path.join(root, 'temporary')
    await Promise.all([mkdir(workspacePath), mkdir(temporaryPath)])
    vi.mocked(application.getPath).mockImplementation((_key, filename) =>
      filename ? path.join(temporaryPath, filename) : temporaryPath
    )
    convertDocumentBundle.mockResolvedValue(document)
    attachments.mockReturnValue([])
  })

  afterEach(async () => {
    vi.mocked(application.getPath).mockReset()
    await rm(root, { recursive: true, force: true })
  })

  it('routes the MCP conversion call and publishes a file receipt without a second tool call', async () => {
    const client = await connectMcpTestClient(() => {
      const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
      registerDocumentTools(server, { workspacePath, agentDataPath: root, sessionId: 'session' })
      return server
    })
    const result = await client.callTool({
      name: CONVERT_TO_DOCUMENT_TOOL_NAME,
      arguments: { markdown: '# Report', format: 'pdf', output_path: 'report.pdf' }
    })
    await client.close()

    expect(parseConvertedDocumentOutput(result)).toEqual({
      path: 'report.pdf',
      format: 'pdf',
      mime: 'application/pdf',
      warnings: []
    })
    expect(await readFile(path.join(workspacePath, 'report.pdf'))).toEqual(bytes)
    expect(await readdir(temporaryPath)).toEqual([])
  })

  it('allows workspace, agent-data and exact session attachments while denying neighboring private files', async () => {
    const agentDataPath = path.join(root, 'agent-data')
    await mkdir(agentDataPath)
    const attached = path.join(root, 'attached.md')
    const privateFile = path.join(root, 'private.md')
    const inside = path.join(workspacePath, 'source.md')
    const agentFile = path.join(agentDataPath, 'source.md')
    await Promise.all([inside, agentFile, attached, privateFile].map((file) => writeFile(file, '# Original')))
    attachments.mockReturnValue([{ fileEntryId: 'attached', handle: 'attached.md', displayName: 'attached.md' }])
    physicalPath.mockReturnValue(attached)
    const client = await connectMcpTestClient(() => {
      const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
      registerDocumentTools(server, { workspacePath, agentDataPath, sessionId: 'session' })
      return server
    })
    try {
      for (const [index, source_path] of [inside, agentFile, attached].entries()) {
        const result = await client.callTool({
          name: CONVERT_TO_DOCUMENT_TOOL_NAME,
          arguments: { source_path, format: 'docx', output_path: `allowed-${index}.docx` }
        })
        expect(result.isError).toBeFalsy()
        expect(await readFile(path.join(workspacePath, `allowed-${index}.docx`))).toEqual(bytes)
        expect(await readFile(source_path, 'utf8')).toBe('# Original')
      }
      const denied = await client.callTool({
        name: CONVERT_TO_DOCUMENT_TOOL_NAME,
        arguments: { source_path: privateFile, format: 'docx', output_path: 'denied.docx' }
      })
      expect(denied.isError).toBe(true)
      await expect(readFile(path.join(workspacePath, 'denied.docx'))).rejects.toMatchObject({ code: 'ENOENT' })
      const attachmentInput = convertDocumentBundle.mock.calls[2][0]
      expect(attachmentInput.assetRoot).toBe('')
      expect(attachmentInput.sourceBytes.toString()).toBe('# Original')
    } finally {
      await client.close()
    }
  })

  it('rolls back its resource directory when final publication loses a race without touching the existing output', async () => {
    const target = path.join(workspacePath, 'report.md')
    convertDocumentBundle.mockImplementationOnce(async () => {
      await writeFile(target, 'other writer')
      return {
        bytes: Buffer.from('![picture](report.assets/image-1.png)'),
        assets: new Map([['image-1.png', bytes]]),
        resourceDirectory: 'report.assets',
        warnings: []
      }
    })
    await expect(
      convertToDocumentToWorkspace(
        workspacePath,
        { markdown: '# Report', format: 'md', output_path: 'report.md' },
        signal
      )
    ).rejects.toThrow(/already exist/)
    expect(await readFile(target, 'utf8')).toBe('other writer')
    expect(await readdir(workspacePath)).toEqual(['report.md'])
    expect(await readdir(temporaryPath)).toEqual([])
  })

  it('does not replace an existing resource directory or publish a broken Markdown file', async () => {
    const resource = path.join(workspacePath, 'report.assets')
    await mkdir(resource)
    await writeFile(path.join(resource, 'original.png'), bytes)
    convertDocumentBundle.mockResolvedValueOnce({
      bytes: Buffer.from('![picture](report.assets/image-1.png)'),
      assets: new Map([['image-1.png', bytes]]),
      resourceDirectory: 'report.assets',
      warnings: []
    })
    await expect(
      convertToDocumentToWorkspace(
        workspacePath,
        { markdown: '# Report', format: 'md', output_path: 'report.md' },
        signal
      )
    ).rejects.toThrow(/already exist/)
    expect(await readdir(workspacePath)).toEqual(['report.assets'])
    expect(await readFile(path.join(resource, 'original.png'))).toEqual(bytes)
  })

  it('uses distinct workspace-relative names when no output path is supplied', async () => {
    const first = await convertToDocumentToWorkspace(workspacePath, { markdown: '# One', format: 'docx' }, signal)
    const second = await convertToDocumentToWorkspace(workspacePath, { markdown: '# Two', format: 'docx' }, signal)
    expect(first.path).toMatch(/^generated-[\w-]+\.docx$/)
    expect(second.path).not.toBe(first.path)
    expect(await readFile(path.join(workspacePath, first.path))).toEqual(bytes)
    expect(await readFile(path.join(workspacePath, second.path))).toEqual(bytes)
  })

  it('rejects absolute, traversing, invalid, and mismatched output paths before conversion', async () => {
    for (const output_path of [
      path.join(workspacePath, 'a.pdf'),
      '../a.pdf',
      '..\\a.pdf',
      'C:a.pdf',
      'a?.pdf',
      'a.xlsx'
    ]) {
      await expect(
        convertToDocumentToWorkspace(workspacePath, { markdown: '# Report', format: 'pdf', output_path }, signal)
      ).rejects.toThrow()
    }
    expect(convertDocumentBundle).not.toHaveBeenCalled()
    expect(await readdir(workspacePath)).toEqual([])
  })

  it('rejects symlink escapes and a missing parent directory', async () => {
    await symlink(temporaryPath, path.join(workspacePath, 'outside'), 'dir')
    for (const output_path of ['outside/report.pdf', 'missing/report.pdf']) {
      await expect(
        convertToDocumentToWorkspace(workspacePath, { markdown: '# Report', format: 'pdf', output_path }, signal)
      ).rejects.toThrow()
    }
    expect(convertDocumentBundle).not.toHaveBeenCalled()
    expect(await readdir(temporaryPath)).toEqual([])
  })

  it('preserves an existing file and rejects a file created during conversion', async () => {
    const destination = path.join(workspacePath, 'report.pdf')
    await writeFile(destination, 'existing')
    await expect(
      convertToDocumentToWorkspace(
        workspacePath,
        { markdown: '# Report', format: 'pdf', output_path: 'report.pdf' },
        signal
      )
    ).rejects.toThrow(/already exist/)
    expect(await readFile(destination, 'utf8')).toBe('existing')
    expect(convertDocumentBundle).not.toHaveBeenCalled()

    convertDocumentBundle.mockImplementationOnce(async () => {
      await writeFile(path.join(workspacePath, 'raced.pdf'), 'raced')
      return document
    })
    await expect(
      convertToDocumentToWorkspace(
        workspacePath,
        { markdown: '# Report', format: 'pdf', output_path: 'raced.pdf' },
        signal
      )
    ).rejects.toThrow(/already exist/)
    expect(await readFile(path.join(workspacePath, 'raced.pdf'), 'utf8')).toBe('raced')
    expect(await readdir(temporaryPath)).toEqual([])
  })

  it('does not publish a file when conversion is cancelled or fails', async () => {
    const controller = new AbortController()
    convertDocumentBundle.mockImplementationOnce(async () => {
      controller.abort()
      return document
    })
    await expect(
      convertToDocumentToWorkspace(workspacePath, { markdown: '# Report', format: 'pdf' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    convertDocumentBundle.mockRejectedValueOnce(new Error('Invalid table'))
    await expect(
      convertToDocumentToWorkspace(workspacePath, { markdown: '| invalid |', format: 'xlsx' }, signal)
    ).rejects.toThrow('Invalid table')
    expect(await readdir(workspacePath)).toEqual([])
    expect(await readdir(temporaryPath)).toEqual([])
  })
})
