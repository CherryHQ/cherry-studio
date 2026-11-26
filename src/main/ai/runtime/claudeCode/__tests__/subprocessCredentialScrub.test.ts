import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingHttpHeaders, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { query } from '@anthropic-ai/claude-agent-sdk'
import { startTestHttpServer } from '@test-helpers/http/server'
import { expect, it, vi } from 'vitest'

// Native CLI startup, one Bash turn and shutdown share the budget.
vi.setConfig({ testTimeout: 60_000 })

const credentials = {
  ANTHROPIC_API_KEY: 'scrub-probe-api-key',
  ANTHROPIC_AUTH_TOKEN: 'scrub-probe-auth-token',
  ANTHROPIC_CUSTOM_HEADERS: 'X-Scrub-Probe: scrub-probe-header'
}
const kept = { GH_TOKEN: 'scrub-probe-gh-token', CHERRY_STUDIO_SKILLS_DIR: 'scrub-probe-skills-dir' }

type MessagesRequest = {
  headers: IncomingHttpHeaders
  body: { tools?: { name: string }[]; messages: { content: unknown }[] }
}

function reply(res: ServerResponse, model: string, block: object, stopReason: 'end_turn' | 'tool_use') {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
  const send = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  send('message_start', {
    message: {
      id: `msg_scrub_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 }
    }
  })
  const isTool = 'name' in block
  send('content_block_start', {
    index: 0,
    content_block: isTool ? { ...block, input: {} } : { type: 'text', text: '' }
  })
  send('content_block_delta', {
    index: 0,
    delta: isTool
      ? { type: 'input_json_delta', partial_json: JSON.stringify((block as { input: object }).input) }
      : { type: 'text_delta', text: (block as { text: string }).text }
  })
  send('content_block_stop', { index: 0 })
  send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
  send('message_stop', {})
  res.end()
}

function toolResultText(request: MessagesRequest): string | undefined {
  const content = request.body.messages.at(-1)?.content
  if (!Array.isArray(content)) return undefined
  const result = content.find((block) => block?.type === 'tool_result')
  if (!result) return undefined
  return Array.isArray(result.content)
    ? result.content.map((part: { text?: string }) => part.text ?? '').join('')
    : String(result.content)
}

const forwardSlashes = (value: string) => value.replaceAll('\\', '/')

it(`keeps provider credentials out of Bash, command hooks and stdio MCP on ${process.platform}`, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cherry-claude-scrub-'))
  const cwd = path.join(directory, 'work')
  const config = path.join(directory, 'config')
  await mkdir(cwd)
  await mkdir(config)
  const dumpScript = path.join(directory, 'dump-env.cjs')
  await writeFile(dumpScript, "require('fs').writeFileSync(process.argv[2], JSON.stringify(process.env))\n")
  const hookDump = path.join(directory, 'hook-env.json')
  const mcpDump = path.join(directory, 'mcp-env.json')

  const requests: MessagesRequest[] = []
  let toolSent = false
  const server = await startTestHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/v1/messages') {
      res.writeHead(404).end('{}')
      return
    }
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ headers: req.headers, body })
      if (!toolSent && body.tools?.some((tool: { name: string }) => tool.name === 'Bash')) {
        toolSent = true
        reply(
          res,
          body.model,
          { type: 'tool_use', id: 'toolu_scrub_probe', name: 'Bash', input: { command: 'env', description: 'probe' } },
          'tool_use'
        )
      } else {
        reply(res, body.model, { type: 'text', text: 'done' }, 'end_turn')
      }
    })().catch(() => res.destroy())
  })

  try {
    const nodeCommand = `"${forwardSlashes(process.execPath)}" "${forwardSlashes(dumpScript)}"`
    const sdk = query({
      prompt: 'run the probe',
      options: {
        cwd,
        env: {
          PATH: process.env.PATH,
          TMPDIR: process.env.TMPDIR,
          SYSTEMROOT: process.env.SYSTEMROOT,
          CLAUDE_CONFIG_DIR: config,
          ANTHROPIC_BASE_URL: server.url,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
          ...credentials,
          ...kept
        },
        settingSources: [],
        settings: {
          hooks: {
            PreToolUse: [
              { matcher: 'Bash', hooks: [{ type: 'command', command: `${nodeCommand} "${forwardSlashes(hookDump)}"` }] }
            ]
          }
        },
        mcpServers: { probe: { type: 'stdio', command: process.execPath, args: [dumpScript, mcpDump] } },
        strictMcpConfig: true,
        permissionMode: 'default',
        model: 'claude-sonnet-4-6',
        systemPrompt: 'Subprocess credential scrub probe.',
        tools: ['Bash'],
        canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
        maxTurns: 3
      }
    })
    for await (const message of sdk) {
      if (message.type === 'result') break
    }

    const bashEnv = requests.map(toolResultText).find((text) => text !== undefined)
    expect(bashEnv).toBeDefined()
    const hookEnv = await readFile(hookDump, 'utf8')
    const mcpEnv = await readFile(mcpDump, 'utf8')
    for (const observed of [bashEnv!, hookEnv, mcpEnv]) {
      for (const value of Object.values(credentials)) expect(observed).not.toContain(value.split(': ').at(-1))
      for (const value of Object.values(kept)) expect(observed).toContain(value)
    }

    const authenticated = requests.filter((request) => request.body.tools?.length)
    expect(authenticated.length).toBeGreaterThan(0)
    for (const { headers } of authenticated) {
      expect(headers['x-scrub-probe']).toBe('scrub-probe-header')
      expect([headers['x-api-key'], headers.authorization].join(' ')).toMatch(/scrub-probe-(api-key|auth-token)/)
    }
  } finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
})
