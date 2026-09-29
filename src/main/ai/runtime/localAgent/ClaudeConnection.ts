import type { ChildProcess } from 'node:child_process'

import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

import { crossPlatformSpawn } from '@main/utils/processRunner'

import { AsyncEventQueue } from '../AsyncEventQueue'
import type { AgentRuntimeUserInput } from '../types'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

export class ClaudeConnection extends LocalConnection {
  private readonly processes = new Set<ChildProcess>()
  private query?: Query
  private resume?: string
  private cwd = ''
  private launch?: Awaited<ReturnType<typeof resolveLocalAgentLaunch>>

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
    const stream = this.createQuery(messages)
    this.begin()
    this.query = stream
    try {
      this.events.push({ type: 'supported-commands', commands: await stream.supportedCommands() })
      this.localSessionInfo.models = (await stream.supportedModels()).map((m) => ({ id: m.value, name: m.displayName }))
      for await (const message of stream) {
        if (message.session_id && message.session_id !== this.resume) {
          this.resume = message.session_id
          this.events.push({ type: 'resume-token', token: message.session_id })
        }
        if (
          message.type === 'stream_event' &&
          message.event.type === 'content_block_delta' &&
          message.event.delta.type === 'text_delta'
        )
          this.text(message.event.delta.text)
        if (message.type === 'assistant') {
          this.localSessionInfo.activeModel = { id: message.message.model }
          for (const part of message.message.content)
            if (part.type === 'tool_use') this.tool(part.id, part.name, part.input)
        }
        if (message.type === 'user' && Array.isArray(message.message.content)) {
          for (const part of message.message.content)
            if (part.type === 'tool_result') this.result(part.tool_use_id, part.content, part.is_error)
        }
        if (message.type === 'result') {
          this.finish(
            message.is_error
              ? new Error(message.subtype === 'success' ? message.result : message.errors.join('\n'))
              : undefined
          )
          break
        }
      }
      if (this.active) this.finish(new Error('Claude exited before completing the turn'))
    } catch (error) {
      this.finish(error)
    } finally {
      messages.close()
      stream.close()
      if (this.query === stream) this.query = undefined
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
