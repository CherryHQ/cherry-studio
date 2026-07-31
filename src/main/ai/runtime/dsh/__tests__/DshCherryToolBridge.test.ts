import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDshRuntimeEntry } from '@cherrystudio/dsh-bridge'

const mocks = vi.hoisted(() => ({
  findByIdOrName: vi.fn(),
  refreshTools: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))
vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: { findByIdOrName: mocks.findByIdOrName }
}))
vi.mock('@application', () => ({
  application: { get: () => ({ refreshTools: mocks.refreshTools }) }
}))

const { buildDshCherryToolBridge, buildDshCherryToolName } = await import('../DshCherryToolBridge')

function createServer(
  tools: Tool[],
  call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>
): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    call(request.params.name, request.params.arguments ?? {}, extra.signal)
  )
  return server
}

const tool = (name: string): Tool => ({
  name,
  description: `${name} desc`,
  inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
})

let tempRoot: string
let agentsDataRoot: string
let toolResultRoot: string

function bridgeOptions() {
  return { agentsDataRoot, toolResultRoot }
}

beforeEach(async () => {
  vi.clearAllMocks()
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dsh-cherry-tool-bridge-'))
  agentsDataRoot = path.join(tempRoot, 'Agents')
  toolResultRoot = path.join(agentsDataRoot, 'agent-1', 'tool-results', 'v1', 'objects')
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('DshCherryToolBridge', () => {
  it('preserves provider-safe names and keeps lossy long identities distinct', () => {
    expect(buildDshCherryToolName('github', 'search_issues')).toBe('mcp__github__search_issues')
    const prefix = 'tool with a shared prefix '.repeat(4)
    const first = buildDshCherryToolName('server', `${prefix}first`)
    const second = buildDshCherryToolName('server', `${prefix}second`)

    expect(first).not.toBe(second)
    expect(first).toMatch(/_[a-f0-9]{12}$/)
    expect(first.length).toBeLessThanOrEqual(63)
  })

  it('fails closed when two MCP identities map to the same public name', async () => {
    const first = createServer([tool('same')], async () => ({ content: [] }))
    const second = createServer([tool('same')], async () => ({ content: [] }))
    const firstClosed = vi.fn()
    first.server.onclose = firstClosed

    await expect(
      buildDshCherryToolBridge(
        {
          first: { name: 'duplicate', instance: first },
          second: { name: 'duplicate', instance: second }
        },
        bridgeOptions()
      )
    ).rejects.toThrow('Duplicate dsh Cherry tool name: mcp__duplicate__same')
    expect(firstClosed).toHaveBeenCalledOnce()
  })

  it('skips one unavailable server without hiding the remaining tool catalog', async () => {
    const unavailable = new McpServer({ name: 'bad', version: '1.0.0' }, { capabilities: { tools: {} } })
    unavailable.server.setRequestHandler(ListToolsRequestSchema, async () => {
      throw new Error('offline')
    })
    const available = createServer([tool('kb_search')], async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))

    const bridge = await buildDshCherryToolBridge(
      {
        unavailable: { name: 'offline', instance: unavailable },
        available: { name: 'cherry-tools', instance: available }
      },
      bridgeOptions()
    )

    expect(bridge.tools).toEqual([
      {
        name: 'mcp__cherry-tools__kb_search',
        description: 'kb_search desc',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } } }
      }
    ])
    await bridge.close()
  })

  it('proxies calls and maps text plus structured content to the bridge result', async () => {
    const image = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
    })
      .png()
      .toBuffer()
    const audio = Buffer.from('audio bytes')
    const video = Buffer.from('video bytes')
    const document = Buffer.from('document bytes')
    const call = vi.fn(async () => ({
      content: [
        { type: 'text' as const, text: 'ok' },
        { type: 'image' as const, data: image.toString('base64'), mimeType: 'image/png' },
        { type: 'audio' as const, data: audio.toString('base64'), mimeType: 'audio/wav' },
        { type: 'resource' as const, resource: { uri: 'file:///doc', text: 'body' } },
        {
          type: 'resource' as const,
          resource: { uri: 'file:///clip.mp4', blob: video.toString('base64'), mimeType: 'video/mp4' }
        },
        {
          type: 'resource' as const,
          resource: { uri: 'file:///report.pdf', blob: document.toString('base64'), mimeType: 'application/pdf' }
        },
        {
          type: 'resource_link' as const,
          name: 'remote',
          uri: 'https://example.com/report.pdf',
          mimeType: 'application/pdf'
        }
      ],
      structuredContent: { total: 7 }
    }))
    const server = createServer([tool('run')], call)
    const bridge = await buildDshCherryToolBridge({ server: { name: 'server', instance: server } }, bridgeOptions())

    const imageHash = createHash('sha256').update(image).digest('hex')
    const audioHash = createHash('sha256').update(audio).digest('hex')
    const videoHash = createHash('sha256').update(video).digest('hex')
    const documentHash = createHash('sha256').update(document).digest('hex')
    const imagePath = path.join(toolResultRoot, imageHash.slice(0, 2), `${imageHash}.png`)
    const audioPath = path.join(toolResultRoot, audioHash.slice(0, 2), `${audioHash}.wav`)
    const videoPath = path.join(toolResultRoot, videoHash.slice(0, 2), `${videoHash}.mp4`)
    const documentPath = path.join(toolResultRoot, documentHash.slice(0, 2), `${documentHash}.pdf`)

    await expect(bridge.callTool('mcp__server__run', { value: 'x' })).resolves.toEqual({
      text: [
        'ok',
        `[image: image/png, saved to ${JSON.stringify(imagePath)}; use read_image to inspect]`,
        `[audio: audio/wav, saved to ${JSON.stringify(audioPath)}]`,
        'body',
        `[resource: video/mp4, uri="file:///clip.mp4", saved to ${JSON.stringify(videoPath)}]`,
        `[resource: application/pdf, uri="file:///report.pdf", saved to ${JSON.stringify(documentPath)}]`,
        '[resource link: name="remote", uri="https://example.com/report.pdf", mimeType="application/pdf"]'
      ].join('\n'),
      data: { total: 7 }
    })
    expect(call).toHaveBeenCalledWith('run', { value: 'x' }, expect.any(AbortSignal))
    await expect(readFile(imagePath)).resolves.toEqual(image)
    await expect(readFile(audioPath)).resolves.toEqual(audio)
    await expect(readFile(videoPath)).resolves.toEqual(video)
    await expect(readFile(documentPath)).resolves.toEqual(document)
    const { detectImage } = await import(
      pathToFileURL(resolveDshRuntimeEntry('@deepseek-ai/dsh-attachment-local')).href
    )
    await expect(detectImage(await readFile(imagePath))).resolves.toEqual({
      mediaType: 'image/png',
      width: 1,
      height: 1
    })
    expect((await stat(imagePath)).mode & 0o777).toBe(0o600)
    await bridge.close()
  })

  it('throws MCP soft errors and forwards cancellation when a caller supplies a signal', async () => {
    const aborted = vi.fn()
    const server = createServer([tool('run')], async (_name, _args, signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted()
            resolve()
          },
          { once: true }
        )
      })
      return { content: [{ type: 'text', text: 'cancelled' }], isError: true }
    })
    const bridge = await buildDshCherryToolBridge({ server: { name: 'server', instance: server } }, bridgeOptions())
    const controller = new AbortController()

    const pending = bridge.callTool('mcp__server__run', {}, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(pending).rejects.toThrow(/abort/i)
    expect(aborted).toHaveBeenCalledOnce()
    await bridge.close()
  })

  it('does not materialize binary blocks from MCP error results', async () => {
    const server = createServer([tool('run')], async () => ({
      content: [
        { type: 'image', data: Buffer.from('error image').toString('base64'), mimeType: 'image/png' },
        { type: 'text', text: 'tool failed' }
      ],
      isError: true
    }))
    const bridge = await buildDshCherryToolBridge({ server: { name: 'server', instance: server } }, bridgeOptions())

    await expect(bridge.callTool('mcp__server__run', {})).rejects.toThrow('tool failed')
    await expect(access(toolResultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await bridge.close()
  })
})
