import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { type CallToolResult, Server, type Tool } from '@modelcontextprotocol/server'
import { serveMcpTestServer } from '@test-helpers/mcp/client'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDshRuntimeEntry } from '@cherrystudio/dsh-bridge'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

const { buildDshCherryToolBridge, buildDshCherryToolName } = await import('../DshCherryToolBridge')

function createServer(
  tools: Tool[],
  call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>,
  listTools: () => Promise<{ tools: Tool[] }> = async () => ({ tools })
) {
  const onClose = vi.fn()
  const connect = serveMcpTestServer(() => {
    const server = new Server({ name: 'test', version: '1.0.0' }, { capabilities: { tools: {} } })
    server.setRequestHandler('tools/list', listTools)
    server.setRequestHandler('tools/call', async (request, ctx) =>
      call(request.params.name, request.params.arguments ?? {}, ctx.mcpReq.signal)
    )
    server.onclose = onClose
    return server
  })
  return { connect, onClose }
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

  it('keeps two same-named servers callable instead of failing the whole turn', async () => {
    const first = createServer([tool('same')], async () => ({ content: [{ type: 'text', text: 'first' }] }))
    const second = createServer([tool('same')], async () => ({ content: [{ type: 'text', text: 'second' }] }))
    const bridge = await buildDshCherryToolBridge(
      {
        first: { name: 'duplicate', connect: first.connect },
        second: { name: 'duplicate', connect: second.connect }
      },
      bridgeOptions()
    )

    const names = bridge.tools.map(({ name }) => name)
    expect(names[0]).toBe('mcp__duplicate__same')
    expect(names[1]).toMatch(/^mcp__duplicate__same_[0-9a-f]{6,}$/)
    expect(new Set(names).size).toBe(names.length)
    // Each public name still routes to its own server.
    await expect(bridge.callTool(names[0], {}, undefined)).resolves.toMatchObject({ text: 'first' })
    await expect(bridge.callTool(names[1], {}, undefined)).resolves.toMatchObject({ text: 'second' })
    await bridge.close()
  })

  it('disambiguates when two server+tool pairs concatenate to the same identity', async () => {
    // `docs` exposing `search__all` and `docs__search` exposing `all` both flatten to
    // `mcp__docs__search__all` — valid servers and tools, so neither may fail the turn.
    const docs = createServer([tool('search__all')], async () => ({ content: [{ type: 'text', text: 'docs' }] }))
    const docsSearch = createServer([tool('all')], async () => ({ content: [{ type: 'text', text: 'docs__search' }] }))
    const bridge = await buildDshCherryToolBridge(
      {
        docs: { name: 'docs', connect: docs.connect },
        docs__search: { name: 'docs__search', connect: docsSearch.connect }
      },
      bridgeOptions()
    )

    const names = bridge.tools.map(({ name }) => name)
    expect(names).toHaveLength(2)
    expect(names[0]).toBe('mcp__docs__search__all')
    expect(names[1]).toMatch(/^mcp__docs__search__all_[0-9a-f]{6,}$/)
    expect(new Set(names).size).toBe(names.length)
    await expect(bridge.callTool(names[0], {}, undefined)).resolves.toMatchObject({ text: 'docs' })
    await expect(bridge.callTool(names[1], {}, undefined)).resolves.toMatchObject({ text: 'docs__search' })
    await bridge.close()
  })

  it('keeps lossy-normalized tools within one server distinct', async () => {
    // Same server exposing `searchAll` and `search all` — lossy camelCase would collapse both.
    const server = createServer([tool('searchAll'), tool('search all')], async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    const bridge = await buildDshCherryToolBridge({ only: { name: 'tools', connect: server.connect } }, bridgeOptions())

    const names = bridge.tools.map(({ name }) => name)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(names.length)
    await bridge.close()
  })

  it('keeps the collision counter effective so allocation terminates when the hash fallback is taken', async () => {
    // `docs` exposes `search__all` (plain `mcp__docs__search__all`) and
    // `search__all_353988fff1e9` (plain `mcp__docs__search__all_353988fff1e9`), then
    // `docs__search` exposes `all`: its plain name hits the first server and its hash
    // fallback suffix (sha256("docs__search\0all") = 353988fff1e9...) hits the second —
    // the counter must change the retained suffix or allocation loops forever.
    const docs = createServer([tool('search__all'), tool('search__all_353988fff1e9')], async () => ({
      content: [{ type: 'text', text: 'docs' }]
    }))
    const docsSearch = createServer([tool('all')], async () => ({ content: [{ type: 'text', text: 'docs__search' }] }))
    const bridge = await buildDshCherryToolBridge(
      {
        docs: { name: 'docs', connect: docs.connect },
        docs__search: { name: 'docs__search', connect: docsSearch.connect }
      },
      bridgeOptions()
    )

    const names = bridge.tools.map(({ name }) => name)
    expect(names).toHaveLength(3)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name.length).toBeLessThanOrEqual(63)
    await expect(bridge.callTool(names[2], {}, undefined)).resolves.toMatchObject({ text: 'docs__search' })
    await bridge.close()
  })

  it('exposes the raw-tool to runtime-name mapping so denial rules can target lossy identities', async () => {
    // A server named `Old server` is not provider-safe: the executable tool is the lossy
    // `mcp__oldServer__run_<hash>` while a legacy denial translated through the server key
    // reads `mcp__Old server__run`. The mapping lets the policy layer rewrite onto the
    // identity the bridge actually registered.
    const server = createServer([tool('run')], async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    const bridge = await buildDshCherryToolBridge(
      { only: { name: 'Old server', connect: server.connect } },
      bridgeOptions()
    )

    const runtimeName = bridge.tools.map(({ name }) => name)[0]
    expect(runtimeName).toBe('mcp__oldServer__run_4f7413c24ae4')
    expect(bridge.ruleNames.get('mcp__Old server__run')).toBe(runtimeName)
    await bridge.close()
  })

  it('skips one unavailable server without hiding the remaining tool catalog', async () => {
    const unavailable = createServer(
      [],
      async () => ({ content: [] }),
      async () => {
        throw new Error('offline')
      }
    )
    const available = createServer([tool('kb_search')], async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))

    const bridge = await buildDshCherryToolBridge(
      {
        unavailable: { name: 'offline', connect: unavailable.connect },
        available: { name: 'cherry-tools', connect: available.connect }
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
    const bridge = await buildDshCherryToolBridge(
      { server: { name: 'server', connect: server.connect } },
      bridgeOptions()
    )

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
        '[resource link: name="remote", uri="https://example.com/report.pdf", mimeType="application/pdf"]',
        '{"total":7}'
      ].join('\n'),
      data: { total: 7 }
    })
    expect(call).toHaveBeenCalledWith('run', { value: 'x' }, expect.any(AbortSignal))
    await expect(readFile(imagePath)).resolves.toEqual(image)
    await expect(readFile(audioPath)).resolves.toEqual(audio)
    await expect(readFile(videoPath)).resolves.toEqual(video)
    await expect(readFile(documentPath)).resolves.toEqual(document)
    const { prepareImageFile } = await import(
      pathToFileURL(resolveDshRuntimeEntry('@deepseek-ai/dsh-attachment-local')).href
    )
    const prepared = await prepareImageFile(
      { data: await readFile(imagePath), mediaType: 'image/png' },
      {
        maxImageBytes: 1048576,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1048576,
        maxImagePixels: 1024,
        maxImageDimension: 32
      },
      { maxPixels: 1024, maxDimension: 32, maxBytes: 1048576 }
    )
    expect(prepared.ref).toMatchObject({
      mediaType: 'image/png',
      width: 1,
      height: 1
    })
    if (process.platform !== 'win32') expect((await stat(imagePath)).mode & 0o777).toBe(0o600)
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
    const bridge = await buildDshCherryToolBridge(
      { server: { name: 'server', connect: server.connect } },
      bridgeOptions()
    )
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
    const bridge = await buildDshCherryToolBridge(
      { server: { name: 'server', connect: server.connect } },
      bridgeOptions()
    )

    await expect(bridge.callTool('mcp__server__run', {})).rejects.toThrow('tool failed')
    await expect(access(toolResultRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await bridge.close()
  })

  // Real-chain behavior tests driven by fake timers: the SDK client's request timer actually
  // runs, so a regression to the 60s default fires it and turns these red (#20266). Outcomes
  // are asserted, never the RequestOptions shape (#20297 review).
  describe('forwarding behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('completes a signal-less call that outlasts the SDK 60s default timeout (#20266)', async () => {
      const server = createServer([tool('run')], async () => {
        await new Promise((resolve) => setTimeout(resolve, 65_000))
        return { content: [{ type: 'text', text: 'slow but done' }] }
      })
      const bridge = await buildDshCherryToolBridge(
        { server: { name: 'server', connect: server.connect } },
        bridgeOptions()
      )

      const completion = expect(bridge.callTool('mcp__server__run', { value: 'x' })).resolves.toMatchObject({
        text: 'slow but done'
      })
      await vi.advanceTimersByTimeAsync(65_000)
      await completion
      await bridge.close()
    })
  })
})
