import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import { ndJsonStream, type RequestPermissionRequest } from '@agentclientprotocol/sdk'
import { expect } from 'vitest'
import * as z from 'zod'

import { runtimeId, ThreadFeed } from '@cherrystudio/agent-runtime'

import { createAcpRuntime, type AcpThreadHandle } from '../src/v1'
import { confirmed } from './fixture'

export type NativeHarness = 'claude' | 'gemini'
const versions = { claude: '0.101.0', gemini: '0.67.0' }

function reply(res: ServerResponse, harness: NativeHarness, model: string) {
  let index = 0
  let started = false
  const send = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  const google = (parts: object[], finish = false) =>
    res.write(
      `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, ...(finish && { finishReason: 'STOP' }), index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 }, modelVersion: model })}\n\n`
    )
  const start = () => {
    if (started) return
    started = true
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
    if (harness === 'claude')
      send('message_start', {
        message: {
          id: `msg_${randomUUID()}`,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 }
        }
      })
  }
  return {
    text(text: string) {
      start()
      if (harness === 'gemini') google([{ text }])
      else {
        send('content_block_start', { index, content_block: { type: 'text', text: '' } })
        send('content_block_delta', { index, delta: { type: 'text_delta', text } })
        send('content_block_stop', { index: index++ })
      }
    },
    tool(file: string) {
      start()
      if (harness === 'gemini')
        google([{ functionCall: { name: 'write_file', args: { file_path: file, content: 'native tool evidence' } } }])
      else {
        send('content_block_start', {
          index,
          content_block: { type: 'tool_use', id: `tool_${randomUUID()}`, name: 'Write', input: {} }
        })
        send('content_block_delta', {
          index,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({ file_path: file, content: 'native tool evidence' })
          }
        })
        send('content_block_stop', { index: index++ })
      }
    },
    end(tool = false) {
      start()
      if (harness === 'gemini') google([], true)
      else {
        send('message_delta', {
          delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: 5 }
        })
        send('message_stop', {})
      }
      res.end()
    }
  }
}

export async function nativeFixture(harness: NativeHarness, executable: string) {
  const manifest = z
    .object({ version: z.literal(versions[harness]) })
    .parse(JSON.parse(await readFile(path.join(path.dirname(executable), '..', 'package.json'), 'utf8')))
  const directory = await mkdtemp(path.join(tmpdir(), `cherry-acp-${harness}-`))
  const cwd = path.join(directory, 'work')
  const config = path.join(directory, 'config')
  await mkdir(cwd)
  await mkdir(config)
  await mkdir(path.join(directory, '.gemini'))
  await writeFile(
    path.join(directory, '.gemini', 'settings.json'),
    JSON.stringify({
      security: { auth: { selectedType: 'gemini-api-key' } },
      general: { enableAutoUpdate: false },
      telemetry: { enabled: false },
      privacy: { usageStatisticsEnabled: false },
      model: { name: 'gemini-2.5-flash' }
    })
  )
  const requests: { body: unknown; response: ReturnType<typeof reply> }[] = []
  const responses = new Set<ServerResponse>()
  const errors: unknown[] = []
  const urls: string[] = []
  const requestDetails: unknown[] = []
  const server = createServer((req, res) => {
    responses.add(res)
    res.once('close', () => responses.delete(res))
    void (async () => {
      const bytes: Buffer[] = []
      for await (const chunk of req) bytes.push(Buffer.from(chunk))
      urls.push(req.url ?? '')
      if (req.url?.includes('countTokens')) {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ totalTokens: 10 }))
        return
      }
      if (
        req.url?.includes('/messages') ||
        req.url?.includes('generateContent') ||
        req.url?.includes('streamGenerateContent')
      ) {
        const body: unknown = JSON.parse(Buffer.concat(bytes).toString())
        const model = z.object({ model: z.string().optional() }).passthrough().parse(body).model ?? 'gemini-2.5-flash'
        const details = z
          .looseObject({
            model: z.string().optional(),
            max_tokens: z.number().optional(),
            stream: z.boolean().optional(),
            system: z.unknown().optional(),
            messages: z.array(z.unknown()).optional()
          })
          .parse(body)
        requestDetails.push({
          model: details.model,
          max_tokens: details.max_tokens,
          stream: details.stream,
          system: JSON.stringify(details.system)?.slice(0, 250),
          last: JSON.stringify(details.messages?.at(-1))?.slice(0, 500)
        })
        const response = reply(res, harness, model)
        if (
          harness === 'claude' &&
          (!JSON.stringify(body).includes('ACP native') ||
            JSON.stringify(details.system).includes('You are naming a coding session'))
        ) {
          response.text('Fixture probe')
          response.end()
        } else requests.push({ body, response })
      } else res.writeHead(404).end('{}')
    })().catch((error: unknown) => {
      errors.push(error)
      res.destroy()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing local model endpoint')
  const endpoint = `http://127.0.0.1:${address.port}`
  const permissions: RequestPermissionRequest[] = []
  const backendId = runtimeId<'backend'>(harness)
  const runtimes: ReturnType<typeof createAcpRuntime>[] = []
  let stderr = ''
  const configuration = {
    cwd,
    mcpServers: [],
    ...(harness === 'claude' && {
      _meta: {
        claudeCode: { options: { settingSources: [], model: 'claude-sonnet-4-6', tools: ['Write'], maxTurns: 4 } }
      }
    })
  }
  const runtime = () => {
    const result = createAcpRuntime({
      backendId,
      loadConfiguration: async () => configuration,
      report: (error) => errors.push(error),
      callbacks: {
        permission: async (request) => {
          permissions.push(request)
          const option = request.options.find((item) => item.kind === 'allow_once')
          return { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } }
        }
      },
      connect: async () => {
        const child = spawn(process.execPath, [executable, ...(harness === 'gemini' ? ['--acp'] : [])], {
          cwd,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            PATH: process.env.PATH,
            TMPDIR: tmpdir(),
            HOME: directory,
            XDG_CONFIG_HOME: config,
            CLAUDE_CONFIG_DIR: config,
            ANTHROPIC_API_KEY: 'local-acp-fixture',
            ANTHROPIC_BASE_URL: endpoint,
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
            GEMINI_API_KEY: 'local-acp-fixture',
            GOOGLE_GEMINI_BASE_URL: endpoint,
            NO_COLOR: '1'
          }
        })
        child.stderr.on('data', (bytes: Buffer) => {
          stderr = (stderr + bytes.toString()).slice(-16000)
        })
        const exited = new Promise<void>((resolve, reject) => {
          child.once('exit', () => resolve())
          child.once('error', reject)
        })
        const kill = (signal: NodeJS.Signals) => {
          if (child.pid) {
            try {
              process.kill(-child.pid, signal)
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
            }
          }
        }
        return {
          stream: ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>),
          closeAndJoin: async () => {
            kill('SIGTERM')
            const timer = setTimeout(() => kill('SIGKILL'), 2000)
            try {
              await exited
              kill('SIGKILL')
            } finally {
              clearTimeout(timer)
            }
          }
        }
      }
    })
    runtimes.push(result)
    return result
  }
  return {
    version: manifest.version,
    cwd,
    configuration,
    runtime,
    permissions,
    errors,
    async request() {
      await expect
        .poll(() => requests.length, {
          timeout: 20000,
          message: `No ${harness} model request; stderr: ${stderr}; paths: ${urls.join(', ')}`
        })
        .toBeGreaterThan(0)
      return requests.shift()!
    },
    diagnostics: () => ({ stderr, urls, errors, requestDetails }),
    async close() {
      for (const instance of runtimes) await instance.shutdown()
      for (const response of responses) response.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  }
}

export async function observeNative(handle: AcpThreadHandle) {
  const feed = new ThreadFeed({ type: 'snapshot', messages: [], inputs: [], activity: { state: 'unknown' } }, () => {})
  const observation = confirmed(await handle.observe((event) => feed.publish(event)))
  await observation.drain()
  return {
    observation,
    snapshot: () => feed.snapshot,
    async outcome(id: string, expected: string) {
      await expect
        .poll(() => feed.snapshot.inputs.find((item) => item.inputId === id)?.outcome, { timeout: 20000 })
        .toBe(expected)
    }
  }
}
