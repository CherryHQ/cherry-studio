import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { collectMcpToolResources, registerMcpToolResources } from '@main/ai/messages/mcpToolResources'
import type { McpResourceReadResult } from '@shared/ai/builtinTools'
import type { McpResource } from '@shared/types/mcp'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { mcpResultToModelOutput } from '../../mcp/utils'
import { createMcpResourceReadToolEntry, mcpResourceReadModelOutput } from '../McpResourceReadTool'

const entry = createMcpResourceReadToolEntry()
const source = { serverId: 's1', serverName: 'Reports' }
let directory: string

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cherry-tool-resources-'))
  vi.mocked(application.getPath).mockImplementation((_, filename) =>
    filename ? path.join(directory, filename) : directory
  )
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function read(uri: string, resources: Map<string, McpResource>, serverId = source.serverId, offset?: number) {
  const execute = entry.tool.execute as (
    input: unknown,
    options: ToolExecutionOptions<unknown>
  ) => Promise<McpResourceReadResult>
  return execute(
    { serverId, uri, offset },
    {
      toolCallId: 'read-1',
      messages: [],
      context: { requestId: 'request-1', mcpToolResources: resources, toolOutputCharCap: 5 }
    }
  )
}

describe('embedded MCP resource reader', () => {
  it('reads and pages a tool-returned blob without resources/list or a resources capability', async () => {
    const resource = {
      uri: 'memory://report',
      mimeType: 'text/plain',
      blob: Buffer.from('hello world').toString('base64')
    }
    const output = { content: [{ type: 'resource' as const, resource }] }
    const resources = new Map<string, McpResource>()
    registerMcpToolResources(resources, output, source)
    const uri = resource.uri
    const hint = mcpResultToModelOutput(output, source.serverId)
    expect(hint).toEqual({
      type: 'text',
      value: expect.stringContaining(JSON.stringify({ serverId: source.serverId, uri }))
    })
    expect(JSON.stringify(hint)).not.toContain(resource.blob)

    expect(await read(uri, resources)).toMatchObject({ text: 'hello', totalChars: 11, nextOffset: 5 })
    expect(await read(uri, resources, source.serverId, 5)).toMatchObject({ text: ' worl', nextOffset: 10 })
    expect(await read(uri, resources, source.serverId, 10)).toMatchObject({ text: 'd', totalChars: 11 })
    expect(entry.applies?.({ mcpToolIds: new Set(['tool']) })).toBe(true)
  })

  it('does not allow another conversation or server to read the returned resource', async () => {
    const resources = new Map<string, McpResource>()
    const resource = { uri: 'memory://private', text: 'private' }
    registerMcpToolResources(resources, { content: [{ type: 'resource', resource }] }, source)
    const uri = resource.uri
    expect(await read(uri, new Map())).toHaveProperty('error')
    expect(await read(uri, resources, 'another-server')).toHaveProperty('error')
  })

  it('restores a resource on the next turn and delivers its image as a media part', async () => {
    const resource = {
      uri: 'memory://image',
      mimeType: 'image/png',
      blob: Buffer.from('image-bytes').toString('base64')
    }
    const resources = collectMcpToolResources([
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'mcp__s1__read',
            toolCallId: 'c1',
            state: 'output-available',
            input: {},
            output: { content: [{ type: 'resource', resource }], metadata: { ...source, type: 'mcp' } }
          }
        ]
      }
    ])
    const output = await read(resource.uri, resources)
    expect(JSON.stringify(output)).not.toContain(resource.blob)
    const projected = await mcpResourceReadModelOutput(output)
    expect(projected).toMatchObject({
      type: 'content',
      value: expect.arrayContaining([{ type: 'image-data', data: resource.blob, mediaType: 'image/png' }])
    })
  })

  it('keeps unsupported binary content out of text and exposes the saved file', async () => {
    const resource = {
      uri: 'memory://binary',
      mimeType: 'application/octet-stream',
      blob: Buffer.from([0, 1, 2, 3]).toString('base64')
    }
    const resources = new Map<string, McpResource>()
    registerMcpToolResources(resources, { content: [{ type: 'resource', resource }] }, source)
    const output = await read(resource.uri, resources)
    expect(output).toMatchObject({
      text: '',
      totalChars: 0,
      blobs: [expect.objectContaining({ uri: resource.uri, blobSavedTo: expect.any(String) })]
    })
  })
})
