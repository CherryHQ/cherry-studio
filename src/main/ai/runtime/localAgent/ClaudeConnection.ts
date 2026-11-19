import type { ChildProcess } from 'node:child_process'

import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { FinishReason } from 'ai'

import { crossPlatformSpawn } from '@main/utils/processRunner'
import type { AgentSessionSlashCommand } from '@shared/ai/agentSessionSlashCommands'
import { AsyncEventQueue } from '@shared/utils/async'

import { ClaudeCodeStreamAdapter } from '../claudeCode'
import type { AgentRuntimeUserInput } from '../types'
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

function filterClaudeSlashCommands(commands: AgentSessionSlashCommand[]): AgentSessionSlashCommand[] {
  return commands.filter((command) => !UNSUPPORTED_CLAUDE_SLASH_COMMANDS.has(command.name))
}

export class ClaudeConnection extends LocalConnection {
  private readonly processes = new Set<ChildProcess>()
  private query?: Query
  private resume?: string
  private cwd = ''
  private launch?: Awaited<ReturnType<typeof resolveLocalAgentLaunch>>
  private dynamicCommandsLoaded = false

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
    }
    this.localSessionInfo.resume = true
    this.localSessionInfo.images = true
    return this
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
}
