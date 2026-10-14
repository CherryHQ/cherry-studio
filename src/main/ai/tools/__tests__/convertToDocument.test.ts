import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { registerDocumentTools } from '@main/ai/mcp/servers/cherryDocumentTools'
import { CONVERT_TO_DOCUMENT_TOOL_NAME, parseConvertedDocumentOutput } from '@shared/ai/documentConversionTool'

import { convertToDocumentToWorkspace } from '../convertToDocument'

const { convertDocument } = vi.hoisted(() => ({ convertDocument: vi.fn() }))
vi.mock('@main/services/documentConversion', () => ({ convertDocument }))

const signal = new AbortController().signal
const bytes = Buffer.from('converted document bytes')
const clients: Client[] = []

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
    convertDocument.mockResolvedValue(bytes)
  })

  afterEach(async () => {
    vi.mocked(application.getPath).mockReset()
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await rm(root, { recursive: true, force: true })
  })

  it('routes the MCP conversion call and publishes a file receipt without a second tool call', async () => {
    const client = await connectMcpTestClient(() => {
      const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
      registerDocumentTools(server, { workspacePath, agentDataPath: root, sessionId: 'session' })
      return server
    })
    clients.push(client)
    expect((await client.listTools()).tools.map(({ name }) => name)).toContain(CONVERT_TO_DOCUMENT_TOOL_NAME)
    const result = await client.callTool(
      {
        name: CONVERT_TO_DOCUMENT_TOOL_NAME,
        arguments: { markdown: '# Report', format: 'pdf', output_path: 'report.pdf' }
      },
      { signal }
    )

    expect(parseConvertedDocumentOutput(result)).toEqual({ path: 'report.pdf', format: 'pdf', mime: 'application/pdf' })
    expect(await readFile(path.join(workspacePath, 'report.pdf'))).toEqual(bytes)
    expect(await readdir(temporaryPath)).toEqual([])
    expect(convertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ markdown: '# Report', format: 'pdf', assetRoot: expect.stringContaining('workspace') }),
      expect.any(AbortSignal)
    )
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
    expect(convertDocument).not.toHaveBeenCalled()
    expect(await readdir(workspacePath)).toEqual([])
  })

  it('rejects symlink escapes and a missing parent directory', async () => {
    await symlink(temporaryPath, path.join(workspacePath, 'outside'), 'dir')
    for (const output_path of ['outside/report.pdf', 'missing/report.pdf']) {
      await expect(
        convertToDocumentToWorkspace(workspacePath, { markdown: '# Report', format: 'pdf', output_path }, signal)
      ).rejects.toThrow()
    }
    expect(convertDocument).not.toHaveBeenCalled()
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
    ).rejects.toThrow(/already exists/)
    expect(await readFile(destination, 'utf8')).toBe('existing')
    expect(convertDocument).not.toHaveBeenCalled()

    convertDocument.mockImplementationOnce(async () => {
      await writeFile(path.join(workspacePath, 'raced.pdf'), 'raced')
      return bytes
    })
    await expect(
      convertToDocumentToWorkspace(
        workspacePath,
        { markdown: '# Report', format: 'pdf', output_path: 'raced.pdf' },
        signal
      )
    ).rejects.toThrow(/already exists/)
    expect(await readFile(path.join(workspacePath, 'raced.pdf'), 'utf8')).toBe('raced')
    expect(await readdir(temporaryPath)).toEqual([])
  })

  it('does not publish a file when conversion is cancelled or fails', async () => {
    const controller = new AbortController()
    convertDocument.mockImplementationOnce(async () => {
      controller.abort()
      return bytes
    })
    await expect(
      convertToDocumentToWorkspace(workspacePath, { markdown: '# Report', format: 'pdf' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    convertDocument.mockRejectedValueOnce(new Error('Invalid table'))
    await expect(
      convertToDocumentToWorkspace(workspacePath, { markdown: '| invalid |', format: 'xlsx' }, signal)
    ).rejects.toThrow('Invalid table')
    expect(await readdir(workspacePath)).toEqual([])
    expect(await readdir(temporaryPath)).toEqual([])
  })
})
