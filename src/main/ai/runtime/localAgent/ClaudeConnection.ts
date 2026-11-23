import type { ChildProcess } from 'node:child_process'

import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { FinishReason } from 'ai'

import { crossPlatformSpawn } from '@main/utils/processRunner'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import {
  CLAUDE_LOCAL_MODE_ID,
  CLAUDE_LOCAL_MODE_OPTIONS,
  CLAUDE_LOCAL_THOUGHT_LEVEL_ID,
  CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS
} from '@shared/ai/localAgent'
import { AsyncEventQueue } from '@shared/utils/async'

import { ClaudeCodeStreamAdapter } from '../claudeCode'
import type { AgentRuntimeUserInput } from '../types'
import { bindLocalGatewayUsage } from './gatewayUsage'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

const CLAUDE_DEFAULT_COMMANDS: AgentSessionSlashCommand[] = [
  { name: 'clear', description: 'Start a new conversation with empty context', argumentHint: '', builtin: true },
  {
    name: 'compact',
    description: 'Free up context by summarizing the conversation so far',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'context',
    description: 'Visualize current context usage as a colored grid',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'usage',
    description: 'Show session cost, plan usage limits, and activity stats',
    argumentHint: '',
    builtin: true
  },
  {
    name: 'goal',
    description: 'Set a goal to work toward until it is completed',
    argumentHint: '<goal>',
    builtin: true
  }
]

const UNSUPPORTED_CLAUDE_SLASH_COMMANDS = new Set([
  '__remote-workflow',
  'workflow-launch-exec',
  'auto-mode-setup',
  'color',
  'design-consent',
  'design-revoke',
  'effort',
  'fast',
  'focus',
  'heapdump',
  'ultraplan',
  'voice'
])

type ClaudePermissionModeValue = (typeof CLAUDE_LOCAL_MODE_OPTIONS)[number]['value']
type ClaudeThoughtLevelValue = (typeof CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS)[number]['value']

function filterClaudeSlashCommands(commands: AgentSessionSlashCommand[]): AgentSessionSlashCommand[] {
  return commands.filter((command) => !UNSUPPORTED_CLAUDE_SLASH_COMMANDS.has(command.name))
}

export class ClaudeConnection extends LocalConnection {
  private readonly processes = new Set<ChildProcess>()
  private query?: Query
  private resume?: string
  private cwd = ''
  private launch?: Awaited<ReturnType<typeof resolveLocalAgentLaunch>>
  private gatewayLease?: { dispose: () => void }
  private dynamicCommandsLoaded = false
  private permissionModeOverride?: ClaudePermissionModeValue
  private thoughtLevelOverride?: ClaudeThoughtLevelValue

  override async getSupportedCommands(): Promise<AgentSessionSlashCommand[] | null> {
    if (!this.dynamicCommandsLoaded && !this.closed && this.launch) {
      this.dynamicCommandsLoaded = true
      const input = new AsyncEventQueue<SDKUserMessage>()
      const stream = this.createQuery(input)
      try {
        const commands = filterClaudeSlashCommands(await stream.supportedCommands())
        if (commands.length > 0) this.supportedCommands = commands
      } catch {
        // Fall back to default built-in commands if the probe query fails.
      } finally {
        input.close()
        stream.close()
      }
    }
    return this.supportedCommands
  }

  async start(cwd: string, resume?: string, probe: boolean | 'models' = false): Promise<this> {
    this.cwd = cwd
    this.resume = resume
    this.launch = await resolveLocalAgentLaunch(this.config, this.abort.signal)
    if (!probe) this.gatewayLease = await bindLocalGatewayUsage(this.config, this.sessionId, this.launch.env)
    this.abort.signal.throwIfAborted()
    if (probe) {
      const input = new AsyncEventQueue<SDKUserMessage>()
      const stream = this.createQuery(input)
      try {
        await stream.initializationResult()
        if (probe === 'models')
          this.localSessionInfo.models = (await stream.supportedModels()).map((model) => ({
            id: model.value,
            name: model.displayName
          }))
      } finally {
        input.close()
        stream.close()
      }
    } else {
      this.supportedCommands = CLAUDE_DEFAULT_COMMANDS
      this.localSessionInfo.mode = {
        id: CLAUDE_LOCAL_MODE_ID,
        currentValue: this.permissionModeOverride ?? 'default',
        options: CLAUDE_LOCAL_MODE_OPTIONS.map((option) => ({ ...option }))
      }
      this.localSessionInfo.thoughtLevel = {
        id: CLAUDE_LOCAL_THOUGHT_LEVEL_ID,
        currentValue: this.thoughtLevelOverride ?? 'default',
        options: CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS.map((option) => ({ ...option }))
      }
    }
    this.localSessionInfo.resume = true
    this.localSessionInfo.images = true
    return this
  }

  async setMode(configId: string, value: string) {
    if (this.closed || this.active) throw new Error('Claude session is unavailable or busy')
    const option = CLAUDE_LOCAL_MODE_OPTIONS.find((item) => item.value === value)
    if (configId !== CLAUDE_LOCAL_MODE_ID || !option || !this.localSessionInfo.mode) {
      throw new Error('This session option is no longer available')
    }
    this.permissionModeOverride = option.value
    this.localSessionInfo.mode.currentValue = option.value
    // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable Claude session state before queuing an event.
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
    return this.localSessionInfo
  }

  async setThoughtLevel(configId: string, value: string) {
    if (this.closed || this.active) throw new Error('Claude session is unavailable or busy')
    const option = CLAUDE_LOCAL_THOUGHT_LEVEL_OPTIONS.find((item) => item.value === value)
    if (configId !== CLAUDE_LOCAL_THOUGHT_LEVEL_ID || !option || !this.localSessionInfo.thoughtLevel) {
      throw new Error('This session option is no longer available')
    }
    this.thoughtLevelOverride = option.value
    this.localSessionInfo.thoughtLevel.currentValue = option.value
    // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable Claude session state before queuing an event.
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
    return this.localSessionInfo
  }

  private createQuery(prompt: string | AsyncIterable<SDKUserMessage>) {
    if (!this.launch) throw new Error('Claude executable is unavailable')
    return query({
      prompt,
      options: {
        cwd: this.cwd,
        pathToClaudeCodeExecutable: this.launch.executable,
        env: this.launch.env,
        spawnClaudeCodeProcess: (options) => {
          const child = crossPlatformSpawn(options.command, [...options.args, ...(this.launch?.args ?? [])], {
            cwd: options.cwd,
            env: options.env,
            signal: options.signal,
            detached: process.platform !== 'win32'
          })
          if (!child.stdin || !child.stdout) throw new Error('Claude stdio is unavailable')
          child.stderr?.resume()
          this.processes.add(child)
          child.once('exit', () => this.processes.delete(child))
          return Object.assign(child, { stdin: child.stdin, stdout: child.stdout })
        },
        settingSources: ['user', 'project', 'local'],
        model: this.config.nativeModel,
        ...(this.thoughtLevelOverride && this.thoughtLevelOverride !== 'default'
          ? { effort: this.thoughtLevelOverride }
          : {}),
        ...(this.permissionModeOverride
          ? {
              permissionMode: this.permissionModeOverride,
              ...(this.permissionModeOverride === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {})
            }
          : {}),
        resume: this.resume,
        includePartialMessages: true,
        canUseTool: async (name, input, options) => {
          const answer = await this.approve(options.toolUseID, name, input, options.signal)
          return answer.approved
            ? { behavior: 'allow' as const, updatedInput: answer.updatedInput ?? input }
            : { behavior: 'deny' as const, message: answer.reason ?? 'Denied by user' }
        }
      }
    })
  }
  async send(input: AgentRuntimeUserInput) {
    const content = await localContent(input, this.localSessionInfo.images)
    const messages = new AsyncEventQueue<SDKUserMessage>()
    messages.push({
      type: 'user',
      session_id: this.resume ?? '',
      parent_tool_use_id: null,
      message: {
        role: 'user',
        content: content.map((part) =>
          part.type === 'text'
            ? part
            : {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: part.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
                  data: part.data
                }
              }
        )
      }
    })
    this.begin()
    let stream: Query | undefined
    let finishReason: FinishReason = 'stop'
    let completed = false
    let failure: unknown
    const adapter = new ClaudeCodeStreamAdapter({
      sessionId: this.sessionId,
      streamOptions: { prompt: [] },
      sink: {
        enqueue: (chunk) => {
          if (chunk.type === 'finish') {
            finishReason = chunk.finishReason ?? 'stop'
            if (chunk.messageMetadata)
              this.events.push({
                type: 'chunk',
                chunk: { type: 'message-metadata', messageMetadata: chunk.messageMetadata }
              })
          } else this.events.push({ type: 'chunk', chunk })
        }
      },
      statusSink: {
        emit: (event) => {
          // This connection owns one query per turn, so it cannot retain background work after its result.
          if (event.type !== 'background-work-state' && event.type !== 'autonomous-turn-state') this.events.push(event)
        }
      },
      onSessionId: (token) => {
        if (token === this.resume) return
        this.resume = token
        this.events.push({ type: 'resume-token', token })
      }
    })
    adapter.beginTurn()
    try {
      stream = this.createQuery(messages)
      this.query = stream
      const commands = filterClaudeSlashCommands(await stream.supportedCommands())
      if (commands.length > 0) this.publishCommands(commands)
      this.localSessionInfo.models = (await stream.supportedModels()).map((m) => ({ id: m.value, name: m.displayName }))
      for await (const message of stream) {
        if (
          !this.permissionModeOverride &&
          message.type === 'system' &&
          'subtype' in message &&
          message.subtype === 'init' &&
          'permissionMode' in message
        ) {
          const reported = CLAUDE_LOCAL_MODE_OPTIONS.find((option) => option.value === message.permissionMode)?.value
          if (reported && this.localSessionInfo.mode && this.localSessionInfo.mode.currentValue !== reported) {
            this.localSessionInfo.mode.currentValue = reported
            // oxlint-disable-next-line no-restricted-globals -- Snapshot mutable Claude session state before queuing an event.
            this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
          }
        }
        if (
          message.type === 'assistant' &&
          !message.parent_tool_use_id &&
          message.message.model &&
          message.message.model !== '<synthetic>'
        ) {
          this.localSessionInfo.activeModel = { id: message.message.model }
        }
        if (
          message.type === 'system' &&
          'subtype' in message &&
          (message as { subtype?: string }).subtype === 'session_title_changed' &&
          'title' in message &&
          typeof (message as { title?: unknown }).title === 'string'
        ) {
          this.events.push({ type: 'session-title', title: (message as { title: string }).title })
          continue
        }
        if (
          message.type === 'result' &&
          'local_command' in message &&
          (message as { local_command?: string }).local_command === 'clear'
        ) {
          this.content('Started a new conversation with empty context.')
        }
        if (adapter.handleMessage(message).type === 'result') {
          completed = true
          break
        }
      }
      if (!completed) throw new Error('Claude exited before completing the turn')
    } catch (error) {
      adapter.finalizeOpenTextParts()
      failure = error
    } finally {
      messages.close()
      stream?.close()
      if (this.query === stream) this.query = undefined
      this.finish(failure, finishReason)
    }
  }
  protected async stop() {
    if (this.active && this.query) {
      void this.query.interrupt().catch(() => {})
      await this.waitForTurn()
    }
    this.query?.close()
    await Promise.all([...this.processes].map((child) => this.stopProcess(child)))
  }
  protected override dispose() {
    this.gatewayLease?.dispose()
    this.gatewayLease = undefined
    super.dispose()
  }
}
