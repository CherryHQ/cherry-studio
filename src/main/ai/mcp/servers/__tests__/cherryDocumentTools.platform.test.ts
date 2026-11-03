import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PLATFORM_MESSAGE =
  'to_markdown is not supported on Windows ARM64 because the bundled document converter has no native build for this platform. Reinstalling dependencies will not fix this limitation.'
const CSV = 'name,value\nAlpha,7\n'
const MARKDOWN = '| name | value |\n| --- | --- |\n| Alpha | 7 |'
const roots: string[] = []
const clients: Client[] = []
let anydocImportEvaluations = 0

async function makeTools(isWinArm64: boolean) {
  vi.resetModules()
  vi.doMock('@main/core/platform', () => ({ isWinArm64 }))
  vi.doMock('@application', async () => {
    const { mockApplicationFactory } = await import('@test-mocks/main/application')
    return mockApplicationFactory()
  })
  const { MockMainPreferenceServiceUtils } = await import('@test-mocks/main/PreferenceService')
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  const { registerDocumentTools } = await import('../cherryDocumentTools')

  const root = await mkdtemp(path.join(tmpdir(), 'cherry-to-markdown-platform-'))
  roots.push(root)
  const workspacePath = path.join(root, 'workspace')
  const agentDataPath = path.join(root, 'agent-data')
  const outputDirectory = path.join(agentDataPath, 'tmp', 'to-markdown')
  await Promise.all([mkdir(workspacePath), mkdir(agentDataPath)])
  await writeFile(path.join(workspacePath, 'report.csv'), CSV)
  const client = await connectMcpTestClient(() => {
    const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
    registerDocumentTools(server, { agentDataPath, sessionId: 'session-platform', workspacePath })
    return server
  })
  clients.push(client)
  return { client, outputDirectory }
}

describe('cherry-tools to_markdown platform support', () => {
  beforeEach(() => {
    vi.doUnmock('@firecrawl/anydoc')
    anydocImportEvaluations = 0
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
    vi.doUnmock('@firecrawl/anydoc')
    vi.doUnmock('@main/core/platform')
  })

  it('keeps to_markdown discoverable on Windows ARM64 and rejects conversion without writing Markdown', async () => {
    const { client, outputDirectory } = await makeTools(true)

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('to_markdown')
    const result = await client.callTool({ name: 'to_markdown', arguments: { path: 'report.csv' } })

    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: PLATFORM_MESSAGE }] })
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects Windows ARM64 before evaluating the anydoc import factory', async () => {
    vi.doMock('@firecrawl/anydoc', () => {
      anydocImportEvaluations += 1
      throw new Error('ANYDOC_IMPORT_MUST_NOT_RUN_ON_WIN_ARM64')
    })
    const { client, outputDirectory } = await makeTools(true)

    const result = await client.callTool({ name: 'to_markdown', arguments: { path: 'report.csv' } })

    expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: PLATFORM_MESSAGE }] })
    expect(anydocImportEvaluations).toBe(0)
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('converts a CSV with real anydoc on supported platforms and returns only a private-file receipt', async () => {
    const { client, outputDirectory } = await makeTools(false)

    const result = await client.callTool({ name: 'to_markdown', arguments: { path: 'report.csv' } })

    expect(result.isError).toBeFalsy()
    const part = result.content[0]
    expect(part.type).toBe('text')
    if (part.type !== 'text') throw new Error('Expected a text receipt')
    const receipt = JSON.parse(part.text)
    expect(receipt).toEqual({ path: expect.stringMatching(/\.md$/), chars: MARKDOWN.length })
    expect(path.dirname(receipt.path)).toBe(outputDirectory)
    expect(part.text).not.toContain('Alpha')
    expect(part.text).not.toContain(CSV)
    expect(part.text).not.toContain(MARKDOWN)
    await expect(readFile(receipt.path, 'utf-8')).resolves.toBe(MARKDOWN)
  })
})
