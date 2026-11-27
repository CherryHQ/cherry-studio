import type {
  RuntimeAccountResult,
  SubscriptionUsageResult,
  SubscriptionUsageWindow
} from '@cherrystudio/agent-runtime'
import type { InstalledCli } from '@cherrystudio/agent-runtime/cli'
import type { LaunchSpec, SpawnStdio } from '@cherrystudio/agent-runtime/stdio'

import {
  CodexRequestError,
  connectCodexAppServer,
  type CodexAppServerClient,
  type CodexClientHandlers
} from './appServerClient'
import { codexCli } from './cli'
import type { ClientInfo } from './protocol'

export interface CodexLaunch {
  readonly installation: InstalledCli<typeof codexCli.executable>
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly args: readonly string[]
  readonly executableOverride: boolean
}

export interface CodexProcessHost {
  readonly spawnStdio: SpawnStdio
  readonly clientInfo: ClientInfo
  redactDiagnostic(text: string, env: LaunchSpec['env']): string
}

export interface CodexAppServerConnection {
  readonly ready: Promise<CodexAppServerClient>
  close(): Promise<void>
}

function prepareLaunch(target: CodexLaunch, overrides: readonly string[]): LaunchSpec {
  const { installation, cwd, env, args } = target
  const hasSubcommand = args.includes(codexCli.args[0])
  if (target.executableOverride && !hasSubcommand)
    return { executable: installation.path, cwd, env, args: [...args, ...overrides] }
  const listener = args.findIndex((arg) => arg === '--listen' || arg.startsWith('--listen='))
  const usesStdioFlag = args.includes('--stdio')
  if (listener !== -1) {
    const option = args[listener]
    const endpoint = option === '--listen' ? args[listener + 1] : option.slice('--listen='.length)
    if (endpoint !== 'stdio://' || usesStdioFlag)
      throw new Error('Cherry requires the Codex App Server stdio transport')
  }
  return {
    executable: installation.path,
    cwd,
    env,
    args: [
      ...(!hasSubcommand ? codexCli.args : []),
      ...args,
      ...overrides,
      ...(listener === -1 && !usesStdioFlag ? ['--listen', 'stdio://'] : [])
    ]
  }
}

export function launchCodexAppServer(
  target: CodexLaunch,
  host: CodexProcessHost,
  handlers: CodexClientHandlers = {},
  overrides: readonly string[] = []
): CodexAppServerConnection {
  const process = host.spawnStdio(prepareLaunch(target, overrides))
  let stderr = ''
  let stderrTruncated = false
  process.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderrTruncated ||= stderr.length + chunk.length > 4000
    stderr = (stderr + chunk).slice(-4000)
  })
  let failure: Error | undefined

  function describe(error: Error) {
    const firstLineEnd = stderr.indexOf('\n')
    const tail = stderrTruncated ? (firstLineEnd === -1 ? '' : stderr.slice(firstLineEnd + 1)) : stderr
    const detail = tail.trim()
    const message = host.redactDiagnostic(detail ? error.message + '\n' + detail : error.message, target.env)
    if (message === error.message) return error
    return error instanceof CodexRequestError
      ? new CodexRequestError(message, error.code, error.data)
      : new Error(message)
  }

  const client = connectCodexAppServer(process.stdin, process.stdout, host.clientInfo, {
    ...handlers,
    onDisconnect: (error) => {
      failure = error
      void process.closeAndJoin().catch(() => {})
      handlers.onDisconnect?.(describe(error))
    }
  })
  void process.closed.then((outcome) => {
    client.close(
      outcome.kind === 'spawn-failed'
        ? outcome.error
        : new Error(`Codex process exited (${outcome.signal ?? outcome.code})`)
    )
  })

  const close = () => {
    client.close()
    return process.closeAndJoin()
  }
  const ready = client.ready.catch(async (error: unknown) => {
    await close().catch(() => {})
    throw describe(failure ?? (error instanceof Error ? error : new Error(String(error))))
  })
  return { ready, close }
}

export type CodexProbeClient = Pick<CodexAppServerClient, 'listModels'>

export function withCodexAppServer<T>(
  target: CodexLaunch,
  host: CodexProcessHost,
  signal: AbortSignal,
  read: (client: CodexProbeClient) => T | Promise<T>
): Promise<T> {
  return withManagementClient(target, host, signal, read)
}

async function withManagementClient<T>(
  target: CodexLaunch,
  host: CodexProcessHost,
  signal: AbortSignal,
  read: (client: CodexAppServerClient) => T | Promise<T>
): Promise<T> {
  signal.throwIfAborted()
  const server = launchCodexAppServer(target, host)
  const cancel = () => void server.close().catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  try {
    const client = await server.ready
    signal.throwIfAborted()
    const result = await read(client)
    signal.throwIfAborted()
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
    await server.close()
  }
}

export function readCodexAccount(
  target: CodexLaunch,
  host: CodexProcessHost,
  signal: AbortSignal
): Promise<RuntimeAccountResult> {
  if (target.env.OPENAI_API_KEY || target.env.OPENAI_BASE_URL) return Promise.resolve({ status: 'unknown' })
  return withManagementClient<RuntimeAccountResult>(target, host, signal, async (client) => {
    const { config } = await client.request('config/read', { cwd: target.cwd })
    if (config.model_provider && config.model_provider !== 'openai') return { status: 'unsupported' }
    const { account, requiresOpenaiAuth, userId, workspaceRouting } = await client.request('account/read', {
      refreshToken: false
    })
    if (!requiresOpenaiAuth) return { status: 'unsupported' }
    if (!account) return { status: 'signed-out' }
    if (account.type !== 'chatgpt') return { status: 'signed-in' }
    const email = account.email ?? undefined
    const id = userId ?? undefined
    const workspace = workspaceRouting ? { id: workspaceRouting.chatgptAccountId } : undefined
    return { status: 'signed-in', ...(email || id || workspace ? { account: { email, id, workspace } } : {}) }
  })
}

export async function readCodexSubscriptionUsage(
  target: CodexLaunch,
  host: CodexProcessHost,
  signal: AbortSignal
): Promise<SubscriptionUsageResult> {
  if (target.env.OPENAI_API_KEY || target.env.OPENAI_BASE_URL) return { status: 'unsupported' }
  try {
    return await withManagementClient(target, host, signal, async (client): Promise<SubscriptionUsageResult> => {
      const { config } = await client.request('config/read', { cwd: target.cwd })
      if (config.model_provider && config.model_provider !== 'openai') return { status: 'unsupported' }
      const { account, requiresOpenaiAuth, userId, workspaceRouting } = await client.request('account/read', {
        refreshToken: false
      })
      if (!requiresOpenaiAuth) return { status: 'unsupported' }
      if (!account) return { status: 'signed-out' }
      if (account.type !== 'chatgpt') return { status: 'unsupported' }

      const { accountId, rateLimits, rateLimitsByLimitId } = await client.request('account/rateLimits/read', {})
      const current = await client.request('account/read', { refreshToken: false })
      const workspaceId = workspaceRouting?.chatgptAccountId
      if (
        account.type !== current.account?.type ||
        account.email !== current.account.email ||
        userId !== current.userId ||
        workspaceId !== current.workspaceRouting?.chatgptAccountId ||
        (accountId && workspaceId && accountId !== workspaceId)
      )
        return { status: 'unavailable' }
      const buckets = Object.entries(rateLimitsByLimitId ?? {})
      if (!buckets.length) buckets.push([rateLimits.limitId ?? 'codex', rateLimits])
      const windows: SubscriptionUsageWindow[] = []
      for (const [id, bucket] of buckets) {
        const nativeLabel = bucket.limitName || id
        const label = nativeLabel === 'codex' ? 'Codex' : nativeLabel
        for (const name of ['primary', 'secondary'] as const) {
          const window = bucket[name]
          if (!window) continue
          windows.push({
            id: id + ':' + name,
            label,
            groupLabel: window.windowDurationMins ? label : undefined,
            usedRatio: window.usedPercent / 100,
            durationMinutes: window.windowDurationMins ?? undefined,
            resetsAt: window.resetsAt == null ? undefined : window.resetsAt * 1000
          })
        }
      }
      return windows.length ? { status: 'available', readAt: Date.now(), windows } : { status: 'unavailable' }
    })
  } catch (error) {
    signal.throwIfAborted()
    return { status: error instanceof CodexRequestError && error.code === -32601 ? 'unsupported' : 'unavailable' }
  }
}
