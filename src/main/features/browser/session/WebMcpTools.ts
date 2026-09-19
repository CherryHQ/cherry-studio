import { randomUUID } from 'node:crypto'

import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker'
import type { Protocol } from 'devtools-protocol'

import { Signal } from '@main/core/lifecycle'

import type { CommandOptions } from '../browserUse'
import { BrowserSessionError } from './BrowserSessionError'
import type { CdpEvent } from './cdpAllowList'
import type { GuestSession } from './GuestSession'

const MAX_TOOLS = 64
const MAX_METADATA = 64_000
const MAX_RESULT = 40_000

type ToolResponse = Protocol.WebMCP.ToolRespondedEvent

type WebTool = {
  toolId: string
  name: string
  description: string
  inputSchema: JsonSchemaType
  annotations?: Protocol.WebMCP.Annotation
  supported: boolean
}
type Registration = { tool: WebTool; validate?: JsonSchemaValidator<unknown> }

/** Document-local registrations; the owning GuestSession supplies CDP and command lifetimes. */
export class WebMcpTools {
  private capability?: 'cdp' | 'unsupported'
  private lifetime = new AbortController()
  private readonly tools = new Map<string, Registration>()
  private readonly responses = new Map<string, Signal<ToolResponse>>()
  private readonly earlyResponses = new Map<string, ToolResponse>()
  private awaitingIds = 0
  private truncated = false
  private readonly validator = new CfWorkerJsonSchemaValidator()

  constructor(private readonly session: GuestSession) {}

  reset(): void {
    this.lifetime.abort(new BrowserSessionError('stale_web_tool'))
    this.lifetime = new AbortController()
    this.capability = undefined
    this.tools.clear()
    this.responses.clear()
    this.earlyResponses.clear()
    this.truncated = false
  }

  record(event: CdpEvent): void {
    if (event.method === 'WebMCP.toolsAdded') {
      for (const tool of event.params.tools) {
        if (tool.frameId !== this.session.mainFrameId) continue
        this.tools.delete(tool.name)
        if (
          this.tools.size >= MAX_TOOLS ||
          tool.name.length > 128 ||
          tool.description.length > 2000 ||
          JSON.stringify(tool.inputSchema ?? {}).length > 16_000
        ) {
          this.truncated = true
          continue
        }
        this.tools.set(tool.name, {
          tool: {
            toolId: randomUUID(),
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ?? { type: 'object' },
            annotations: tool.annotations,
            supported: tool.backendNodeId === undefined
          }
        })
      }
    } else if (event.method === 'WebMCP.toolsRemoved') {
      for (const tool of event.params.tools) {
        if (tool.frameId === this.session.mainFrameId) this.tools.delete(tool.name)
      }
    } else if (event.method === 'WebMCP.toolResponded') {
      const response = this.responses.get(event.params.invocationId)
      if (response) {
        this.responses.delete(event.params.invocationId)
        response.resolve(event.params)
      } else if (this.awaitingIds && this.earlyResponses.size < MAX_TOOLS) {
        // Electron can deliver the completion event before send()'s Promise continuation runs.
        this.earlyResponses.set(event.params.invocationId, event.params)
      }
    } else if (event.method === 'Runtime.executionContextsCleared') {
      this.reset()
    }
  }

  async list(options: CommandOptions = {}) {
    await this.session.send('Runtime.enable', undefined, options)
    const lifetime = this.lifetime
    if (!this.capability) {
      try {
        await this.session.send('WebMCP.enable', undefined, options)
      } catch (error) {
        if (!(error instanceof Error) || !/WebMCP\.enable.*(?:wasn't found|not found)/i.test(error.message)) throw error
        lifetime.signal.throwIfAborted()
        this.capability = 'unsupported'
      }
      if (!this.capability) {
        const { result, exceptionDetails } = await this.session.send(
          'Runtime.evaluate',
          {
            expression: 'typeof document.modelContext === "object"',
            returnByValue: true
          },
          options
        )
        lifetime.signal.throwIfAborted()
        if (exceptionDetails) throw new BrowserSessionError('webmcp_unsupported')
        this.capability = result.value === true ? 'cdp' : 'unsupported'
      }
    }
    lifetime.signal.throwIfAborted()
    const tools: WebTool[] = []
    let size = 0
    for (const { tool } of this.tools.values()) {
      size += JSON.stringify(tool).length
      if (size > MAX_METADATA) break
      tools.push(tool)
    }
    return {
      capability: this.capability,
      ...(this.capability === 'unsupported' ? { reason: 'Native WebMCP is unavailable in this document.' } : {}),
      tools: this.capability === 'cdp' ? tools : [],
      truncated: this.truncated || tools.length < this.tools.size
    }
  }

  async call(toolId: string, args: Record<string, unknown>, options: CommandOptions = {}) {
    if (this.capability === 'unsupported') throw new BrowserSessionError('webmcp_unsupported')
    const entry = [...this.tools.values()].find(({ tool }) => tool.toolId === toolId)
    if (!entry || !this.session.isAvailable()) throw new BrowserSessionError('stale_web_tool')
    if (!entry.tool.supported) throw new BrowserSessionError('unsupported_web_tool')
    if (JSON.stringify(args).length > MAX_RESULT) throw new BrowserSessionError('budget_exceeded')
    try {
      entry.validate ??= this.validator.getValidator(entry.tool.inputSchema)
      if (!entry.validate(args).valid) throw new BrowserSessionError('invalid_tool_input')
    } catch (error) {
      if (error instanceof BrowserSessionError) throw error
      throw new BrowserSessionError('unsupported_web_tool')
    }
    const signal = AbortSignal.any([this.lifetime.signal, ...(options.signal ? [options.signal] : [])])
    signal.throwIfAborted()
    const deadline = options.deadline ?? Date.now() + 30_000
    if (deadline <= Date.now()) throw new BrowserSessionError('timeout')
    let invocationId: string | undefined
    let canceled = false
    let responded = false
    let cancellation: Promise<void> | undefined
    const cancel = () => {
      canceled = true
      if (invocationId && !responded) cancellation ??= this.session.cancelWebTool(invocationId)
    }
    const response = new Signal<ToolResponse>()
    signal.addEventListener('abort', cancel, { once: true })
    this.awaitingIds++
    // Keep the short acknowledgement alive so cancellation can address a late invocation ID.
    const command = this.session.invokeWebTool(
      { frameId: this.session.mainFrameId, toolName: entry.tool.name, input: args },
      (id) => {
        invocationId = id
        if (canceled) {
          cancel()
          return cancellation
        }
        const early = this.earlyResponses.get(id)
        this.earlyResponses.delete(id)
        if (early) response.resolve(early)
        else this.responses.set(id, response)
        return undefined
      }
    )
    const invocation = this.session.wait(command, { deadline: Math.min(deadline, Date.now() + 5000) }).finally(() => {
      this.awaitingIds--
      if (!this.awaitingIds) this.earlyResponses.clear()
    })
    try {
      await this.session.wait(invocation, { signal, deadline })
      const result = await this.session.wait(Promise.resolve(response), { signal, deadline })
      responded = true
      if (result.status === 'Canceled') throw new BrowserSessionError('web_tool_canceled')
      if (result.status === 'Error') throw new BrowserSessionError('web_tool_failed')
      const text = JSON.stringify(result.output ?? null)
      return text.length > MAX_RESULT
        ? { output: text.slice(0, MAX_RESULT), truncated: true }
        : { output: result.output ?? null, truncated: false }
    } catch (error) {
      cancel()
      if (!invocationId && error instanceof Error && error.message === 'Tool not found') {
        if (this.tools.get(entry.tool.name) === entry) this.tools.delete(entry.tool.name)
        throw new BrowserSessionError('stale_web_tool')
      }
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      if (invocationId) this.responses.delete(invocationId)
      response.dispose()
      await cancellation
    }
  }
}
