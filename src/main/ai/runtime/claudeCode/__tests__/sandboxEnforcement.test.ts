import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { type HookCallback, type PermissionMode, query, type SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { startTestHttpServer, type TestHttpServer } from '@test-helpers/http/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { ClaudeLoadedSettings } from '@cherrystudio/agent-runtime-claude-code'
import { resolveSandboxPolicy } from '@main/ai/toolApproval/sandboxPolicy'

import {
  assertSandboxSettingsUnchanged,
  checkClaudeCodeSandboxAvailability,
  sandboxEscapeGuidance,
  toClaudeCodeSandboxSettings
} from '../sandboxSettings'

// Each case starts the native CLI and runs one Bash turn.
vi.setConfig({ testTimeout: 90_000 })

// The main test setup stubs `os.homedir()`; the sandbox protects the real one.
const home = process.env.HOME ?? ''
const PUBLIC_HOST = 'example.com'
const isDarwin = process.platform === 'darwin'
const isLinux = process.platform === 'linux'

function bundledCliPath(): string {
  const sdk = realpathSync(path.join(process.cwd(), 'node_modules/@anthropic-ai/claude-agent-sdk'))
  return createRequire(path.join(sdk, 'package.json')).resolve(
    `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`
  )
}

const statusRoot = await mkdtemp(path.join(tmpdir(), 'cherry-sandbox-status-'))
vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) =>
  key === 'feature.agents.claude.sandbox_status.temp' ? path.join(statusRoot, filename ?? '') : `/mock/${key}`
)
const availability =
  isDarwin || isLinux
    ? await checkClaudeCodeSandboxAvailability(bundledCliPath(), process.env, process.cwd())
    : undefined

afterAll(async () => {
  await rm(statusRoot, { recursive: true, force: true })
})

// The path does not exist: native Windows must answer without starting a CLI at all.
it.runIf(process.platform === 'win32')(
  'keeps the sandbox off on native Windows without asking the CLI (AC5)',
  async () => {
    await expect(
      checkClaudeCodeSandboxAvailability('Z:\\no-such-claude.exe', process.env, process.cwd())
    ).resolves.toEqual({
      available: false,
      reason: 'the shell sandbox is not enabled on native Windows'
    })
  }
)

describe.runIf(isLinux)('Claude Code shell sandbox availability on Linux', () => {
  it('reports the sandbox unavailable when bubblewrap is not on PATH (AC3)', async () => {
    const emptyPath = await mkdtemp(path.join(tmpdir(), 'cherry-empty-path-'))
    try {
      const result = await checkClaudeCodeSandboxAvailability(
        bundledCliPath(),
        { HOME: home, PATH: emptyPath },
        emptyPath
      )

      expect(result.available).toBe(false)
      expect(result.available === false && result.reason).toMatch(/bubblewrap|bwrap|socat/i)
    } finally {
      await rm(emptyPath, { recursive: true, force: true })
    }
  })

  // The CI job installs bubblewrap and socat; without this the enforcement suite would skip silently.
  it.runIf(process.env.CI === 'true')('has a working sandbox on the CI runner', () => {
    expect(availability).toEqual({ available: true })
  })
})

type MessagesBody = { model: string; tools?: { name: string }[]; messages: { content: unknown }[] }

type ReplyBlock =
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'text'; text: string }

function reply(res: ServerResponse, model: string, block: ReplyBlock, stopReason: 'end_turn' | 'tool_use') {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'close' })
  const send = (type: string, value: object) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
  send('message_start', {
    message: {
      id: `msg_sandbox_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 }
    }
  })
  send('content_block_start', {
    index: 0,
    content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' }
  })
  send('content_block_delta', {
    index: 0,
    delta:
      block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) }
        : { type: 'text_delta', text: block.text }
  })
  send('content_block_stop', { index: 0 })
  send('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
  send('message_stop', {})
  res.end()
}

// Seatbelt refuses a nested profile, so the CLI's own sandbox cannot apply inside this one.
function spawnInsideSeatbelt({ command, args, cwd, env, signal }: SpawnOptions) {
  return spawn('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', command, ...args], {
    cwd,
    env,
    signal,
    stdio: ['pipe', 'pipe', 'ignore']
  })
}

// Mirrors how the session hooks feed a sandboxed Bash result to `sandboxEscapeGuidance`.
const escapeGuidanceHook: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PostToolUse' && input.hook_event_name !== 'PostToolUseFailure') return {}
  const output =
    input.hook_event_name === 'PostToolUseFailure' ? input.error : JSON.stringify(input.tool_response ?? '')
  const additionalContext = sandboxEscapeGuidance(output)
  return additionalContext ? { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext } } : {}
}

function toolResultText(body: MessagesBody): string | undefined {
  const content = body.messages.at(-1)?.content
  if (!Array.isArray(content)) return undefined
  const result = content.find((block) => block?.type === 'tool_result')
  if (!result) return undefined
  return Array.isArray(result.content)
    ? result.content.map((part: { text?: string }) => part.text ?? '').join('')
    : String(result.content)
}

describe.runIf(availability?.available === true)('Claude Code shell sandbox', () => {
  let root: string
  let echo: TestHttpServer
  let echoHits = 0

  beforeAll(async () => {
    // Outside $TMPDIR, which the sandbox always lets Bash write, so the write boundary is observable.
    root = await mkdtemp(path.join(home, '.cherry-sandbox-test-'))
    await mkdir(path.join(root, 'work'))
    await mkdir(path.join(root, 'data'))
    await mkdir(path.join(root, 'outside'))
    await mkdir(path.join(root, 'config'))
    echo = await startTestHttpServer((_req, res) => {
      echoHits++
      res.writeHead(200).end('reached')
    })
  })

  afterAll(async () => {
    await echo?.close()
    if (root) await rm(root, { recursive: true, force: true })
  })

  async function runBash(
    input: Record<string, unknown>,
    permissionMode: PermissionMode,
    spawnClaudeCodeProcess?: typeof spawnInsideSeatbelt
  ) {
    let toolResult: string | undefined
    let toolSent = false
    const model = await startTestHttpServer((req, res) => {
      if (req.method !== 'POST' || req.url?.split('?')[0] !== '/v1/messages') {
        res.writeHead(404).end('{}')
        return
      }
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString()) as MessagesBody
        toolResult ??= toolResultText(body)
        if (!toolSent && body.tools?.some((tool) => tool.name === 'Bash')) {
          toolSent = true
          reply(res, body.model, { type: 'tool_use', id: 'toolu_sandbox', name: 'Bash', input }, 'tool_use')
        } else {
          reply(res, body.model, { type: 'text', text: 'done' }, 'end_turn')
        }
      })().catch(() => res.destroy())
    })
    const approvals: Record<string, unknown>[] = []
    try {
      const policy = resolveSandboxPolicy({}, home, true)
      if (!policy) throw new Error('expected a sandbox policy on macOS')
      const sdk = query({
        prompt: 'run the command',
        options: {
          cwd: path.join(root, 'work'),
          additionalDirectories: [path.join(root, 'data')],
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            CLAUDE_CONFIG_DIR: path.join(root, 'config'),
            ANTHROPIC_BASE_URL: model.url,
            ANTHROPIC_API_KEY: 'sandbox-test',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
          },
          settingSources: [],
          sandbox: toClaudeCodeSandboxSettings(policy),
          ...(spawnClaudeCodeProcess ? { spawnClaudeCodeProcess } : {}),
          permissionMode,
          allowDangerouslySkipPermissions: true,
          model: 'claude-sonnet-4-6',
          systemPrompt: 'Sandbox enforcement test.',
          tools: ['Bash'],
          canUseTool: async (_toolName, toolInput) => {
            approvals.push(toolInput)
            return { behavior: 'deny', message: 'denied by the test' }
          },
          hooks: {
            PostToolUse: [{ hooks: [escapeGuidanceHook] }],
            PostToolUseFailure: [{ hooks: [escapeGuidanceHook] }]
          },
          maxTurns: 3
        }
      })
      for await (const message of sdk) {
        if (message.type === 'result') break
      }
    } finally {
      await model.close()
    }
    return { toolResult, approvals }
  }

  // Loopback is refused by Seatbelt itself; a public host goes through the sandbox proxy, which
  // reports the denied host in the tool result.
  const networkProbe = (label: string) =>
    [
      `curl -sS --max-time 5 ${echo.url}/${label}-curl`,
      `python3 -c "import urllib.request; urllib.request.urlopen('${echo.url}/${label}-urllib', timeout=5)"`,
      `curl -sS --max-time 10 http://${PUBLIC_HOST}/`,
      `python3 -c "import urllib.request; urllib.request.urlopen('http://${PUBLIC_HOST}/', timeout=10)"`
    ].join('; ')

  it.each(['acceptEdits', 'bypassPermissions'] as const)(
    'keeps Bash off the network and inside its writable roots in %s mode (AC1, AC2, AC4, AC5)',
    async (mode) => {
      const written = {
        workspace: path.join(root, 'work', `${mode}.txt`),
        agentData: path.join(root, 'data', `${mode}.txt`),
        outside: path.join(root, 'outside', `${mode}.txt`)
      }
      const writes = Object.values(written)
        .map((file) => `touch '${file}'`)
        .join('; ')
      // The CLI points sandboxed commands at their own temp directory through $TMPDIR.
      const tempWrite = `touch "\${TMPDIR:-/tmp}/cherry-sandbox-test-${mode}.txt" && echo TEMP_WRITE_OK`
      const hitsBefore = echoHits

      const { toolResult, approvals } = await runBash(
        { command: `${writes}; ${tempWrite}; ${networkProbe(mode)}`, description: 'sandbox probe' },
        mode
      )

      expect(approvals).toEqual([])
      // One violation each for curl and urllib.
      expect(toolResult?.split(`deny network-outbound ${PUBLIC_HOST}:80 (host is not on the allow list)`)).toHaveLength(
        3
      )
      expect(echoHits).toBe(hitsBefore)
      expect(existsSync(written.workspace)).toBe(true)
      expect(existsSync(written.agentData)).toBe(true)
      expect(toolResult).toContain('TEMP_WRITE_OK')
      expect(existsSync(written.outside)).toBe(false)
    }
  )

  it.each([
    ['a zero exit code', `curl -sS --max-time 10 http://${PUBLIC_HOST}/`],
    ['a non-zero exit code', `curl -fsS --max-time 10 http://${PUBLIC_HOST}/`]
  ])('hands the model escape guidance after a network denial with %s (AC12)', async (_label, command) => {
    const { toolResult } = await runBash({ command, description: 'escape guidance probe' }, 'acceptEdits')

    expect(toolResult).toContain(`deny network-outbound ${PUBLIC_HOST}:80`)
    expect(toolResult).toContain(`The sandbox blocked network access to ${PUBLIC_HOST}.`)
    expect(toolResult).toContain('`dangerouslyDisableSandbox: true`')
  })

  describe.runIf(isDarwin)('inside another Seatbelt profile', () => {
    it.each(['acceptEdits', 'bypassPermissions'] as const)(
      'runs no Bash command when the sandbox cannot be applied in %s mode (AC11)',
      async (mode) => {
        const marker = path.join(root, 'work', `unsandboxed-${mode}.txt`)

        const { toolResult, approvals } = await runBash(
          { command: `touch '${marker}'`, description: 'sandbox start probe' },
          mode,
          spawnInsideSeatbelt
        )

        expect(approvals).toEqual([])
        expect(toolResult).toContain('sandbox_apply: Operation not permitted')
        expect(existsSync(marker)).toBe(false)
      }
    )
  })

  it('refuses the sandbox when a settings tier only the CLI loads changes it (AC11)', async () => {
    const policy = resolveSandboxPolicy({}, home, true)
    if (!policy) throw new Error('expected a sandbox policy')
    const sandbox = toClaudeCodeSandboxSettings(policy)
    // Kept in the CLI's own config directory, which the main process never reads.
    async function reportedWith(remoteSettings?: Record<string, unknown>) {
      const configDir = await mkdtemp(path.join(root, 'cli-config-'))
      if (remoteSettings) await writeFile(path.join(configDir, 'remote-settings.json'), JSON.stringify(remoteSettings))
      const sdk = query({
        // Never yields: only the settings are read, so no model request is made.
        prompt: { [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) },
        options: {
          cwd: path.join(root, 'work'),
          // No ANTHROPIC_BASE_URL: the CLI reads its policy cache only for the first-party API.
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            TMPDIR: process.env.TMPDIR,
            CLAUDE_CONFIG_DIR: configDir,
            ANTHROPIC_API_KEY: 'sandbox-test',
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
          },
          settingSources: [],
          sandbox
        }
      })
      try {
        const loaded = await (sdk as unknown as { getSettings(): Promise<ClaudeLoadedSettings> }).getSettings()
        return { status: 'confirmed' as const, value: loaded }
      } finally {
        sdk.close()
      }
    }

    const unchanged = await reportedWith()
    const unrelated = await reportedWith({ permissions: { deny: ['WebFetch'] } })
    const changed = await reportedWith({ sandbox: { excludedCommands: ['gh *'] } })
    const helper = await reportedWith({ policyHelpers: { macos: { path: '/usr/local/bin/policy' } } })

    expect(() => assertSandboxSettingsUnchanged(unchanged)).not.toThrow()
    expect(() => assertSandboxSettingsUnchanged(unrelated)).not.toThrow()
    expect(() => assertSandboxSettingsUnchanged(changed)).toThrow('policySettings: sandbox')
    expect(() => assertSandboxSettingsUnchanged(helper)).toThrow('policySettings: policyHelpers')
  })

  it('routes a request to leave the sandbox to canUseTool and does not run it when denied (AC3)', async () => {
    // The workspace is writable inside the sandbox, so the file would appear if the denied call still ran there.
    const target = path.join(root, 'work', 'escape.txt')
    const input = { command: `touch '${target}'`, description: 'escape probe', dangerouslyDisableSandbox: true }

    const { approvals } = await runBash(input, 'acceptEdits')

    expect(approvals).toEqual([expect.objectContaining({ dangerouslyDisableSandbox: true })])
    expect(existsSync(target)).toBe(false)
  })
})
