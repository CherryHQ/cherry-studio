import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { experimental_runCodeMode, type CodeModeToolExecutionEndEvent } from '@ai-sdk/code-mode'
import { isStepCount, readUIMessageStream, tool, type UIMessage } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod'

import { toModelMessages } from '@main/ai/messages/messageRules'
import { getToolCallContext, requestContextSchema } from '@main/ai/tools/adapters/aiSdk/context'
import { applyDeferExposition } from '@main/ai/tools/adapters/aiSdk/exposition/applyDeferExposition'
import { ToolRegistry } from '@main/ai/tools/adapters/aiSdk/registry'

import { Agent } from '../Agent'
import { withCodeMode } from '../codeMode'
import { markTrustedLocalToolTerminalFailure } from '../loop/localToolTerminalOutcome'

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}
const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function scriptedModel(programs: string[]) {
  let index = 0
  return new MockLanguageModelV4({
    doStream: async () => {
      const js = programs[index++]
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] })
            if (js)
              controller.enqueue({
                type: 'tool-call',
                toolCallId: `program-${index}`,
                toolName: 'code_mode',
                input: JSON.stringify({ js })
              })
            else {
              controller.enqueue({ type: 'text-start', id: 'text' })
              controller.enqueue({ type: 'text-delta', id: 'text', delta: 'Done' })
              controller.enqueue({ type: 'text-end', id: 'text' })
            }
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: js ? 'tool-calls' : 'stop', raw: undefined },
              usage
            })
            controller.close()
          }
        })
      }
    }
  })
}

async function runStream(agent: Agent, signal = new AbortController().signal) {
  let final: UIMessage | undefined
  for await (const message of readUIMessageStream({
    stream: agent.stream([{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Run the tools.' }] }], signal),
    terminateOnError: true
  }))
    final = message
  return final!
}

describe('native Code Mode host execution', () => {
  it('settles a child event if cancellation arrives before host execution starts', async () => {
    const abort = new AbortController()
    const events: CodeModeToolExecutionEndEvent[] = []
    let effects = 0
    await expect(
      experimental_runCodeMode({
        js: 'return await tools.write({})',
        tools: { write: tool({ inputSchema: z.object({}), execute: () => ++effects }) },
        options: {
          onToolExecutionStart: () => {
            abort.abort(new Error('Cancelled before dispatch'))
          },
          onToolExecutionEnd: (event) => {
            events.push(event)
          }
        },
        toolExecutionOptions: { toolCallId: 'parent', messages: [], abortSignal: abort.signal }
      })
    ).rejects.toThrow(/Cancelled|abort/i)
    expect(effects).toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0].toolOutput.type).toBe('tool-error')
  })

  it('cancels in-flight host work at the program deadline without aborting the request', async () => {
    const request = new AbortController()
    let started = false
    let cancelled = false
    const result = experimental_runCodeMode({
      js: 'return await tools.wait({})',
      tools: {
        wait: tool({
          inputSchema: z.object({}),
          contextSchema: requestContextSchema,
          execute: async (_input, options) => {
            const { abortSignal } = getToolCallContext(options)
            if (!abortSignal) throw new Error('Missing cancellation signal')
            started = true
            return new Promise((_resolve, reject) => {
              abortSignal.addEventListener(
                'abort',
                () => {
                  cancelled = true
                  reject(abortSignal.reason)
                },
                { once: true }
              )
            })
          }
        })
      },
      options: {
        toolsContext: { wait: { requestId: 'request-a', abortSignal: request.signal } },
        executionPolicy: { timeoutMs: 200 }
      },
      toolExecutionOptions: { toolCallId: 'parent', messages: [], abortSignal: request.signal }
    })
    await expect(result).rejects.toThrow(/timed out|timeout/i)
    expect(started).toBe(true)
    expect(cancelled).toBe(true)
    expect(request.signal.aborted).toBe(false)
  })

  it('validates each child context/input and attributes serial and parallel filesystem effects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cherry-code-mode-'))
    tempDirs.push(dir)
    const events: CodeModeToolExecutionEndEvent[] = []
    const output = await experimental_runCodeMode({
      js: 'const a = await tools.save({name:" first "}); const rest = await Promise.all([tools.save({name:"second"}), tools.save({name:"third"})]); return [a, ...rest];',
      tools: {
        save: tool({
          inputSchema: z.object({ name: z.string().trim(), value: z.string().default('saved') }),
          contextSchema: z.object({ topicId: z.string().transform((value) => value.toUpperCase()) }),
          execute: async ({ name, value }, { context, toolCallId }) => {
            await writeFile(join(dir, name), JSON.stringify({ value, topicId: context.topicId, toolCallId }))
            return name
          }
        })
      },
      options: {
        toolsContext: { save: { topicId: 'topic-a' } },
        onToolExecutionEnd: (event) => {
          events.push(event)
        }
      },
      toolExecutionOptions: { toolCallId: 'parent', messages: [] }
    })
    expect(output).toEqual(['first', 'second', 'third'])
    const effects = await Promise.all(
      ['first', 'second', 'third'].map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8')))
    )
    expect(effects.map(({ topicId, value }) => ({ topicId, value }))).toEqual(
      Array(3).fill({ topicId: 'TOPIC-A', value: 'saved' })
    )
    expect(new Set(effects.map(({ toolCallId }) => toolCallId)).size).toBe(3)
    expect(
      events.every((event) => event.parentToolCallId === 'parent' && event.toolOutput.type === 'tool-result')
    ).toBe(true)
    expect(events.map((event) => event.toolCall.toolCallId).sort()).toEqual(
      effects.map(({ toolCallId }) => toolCallId).sort()
    )
  })

  it.each([
    ['invalid input', { value: 1 }, { owner: 'a' }],
    ['invalid context', { value: 'ok' }, {}]
  ])('rejects %s before a host side effect', async (_name, input, context) => {
    const effects: string[] = []
    await expect(
      experimental_runCodeMode({
        js: `return await tools.save(${JSON.stringify(input)})`,
        tools: {
          save: tool({
            inputSchema: z.object({ value: z.string() }),
            contextSchema: z.object({ owner: z.string() }),
            execute: ({ value }) => {
              effects.push(value)
              return value
            }
          })
        },
        options: { toolsContext: { save: context } },
        toolExecutionOptions: { toolCallId: 'parent', messages: [] }
      })
    ).rejects.toThrow(/Invalid (input|context)/)
    expect(effects).toEqual([])
  })

  it('checks approval with the validated child context and denies effects', async () => {
    let effects = 0
    await expect(
      experimental_runCodeMode({
        js: 'return await tools.save({})',
        tools: {
          save: tool({
            inputSchema: z.object({}),
            contextSchema: z.object({ requireApproval: z.boolean() }),
            needsApproval: (_input, { context }) => context.requireApproval,
            execute: () => ++effects
          })
        },
        options: {
          toolsContext: { save: { requireApproval: true } },
          approval: { onApprovalRequired: () => 'denied' }
        },
        toolExecutionOptions: { toolCallId: 'parent', messages: [] }
      })
    ).rejects.toThrow(/denied/i)
    expect(effects).toBe(0)
  })

  it('reports the raw output before projecting it into the sandbox', async () => {
    const raw = { content: [{ type: 'image', mimeType: 'image/png', data: 'binary' }] }
    const events: CodeModeToolExecutionEndEvent[] = []
    const result = await experimental_runCodeMode({
      js: 'return await tools.screenshot({})',
      tools: { screenshot: tool({ inputSchema: z.object({}), execute: () => raw }) },
      options: {
        onToolExecutionEnd: (event) => {
          events.push(event)
        },
        transformToolOutput: () => 'attached'
      },
      toolExecutionOptions: { toolCallId: 'parent', messages: [] }
    })
    expect(result).toBe('attached')
    expect(events[0].toolOutput).toEqual({ type: 'tool-result', output: raw })
  })

  it('settles a cancelled nested call and stops later dispatch', async () => {
    const abort = new AbortController()
    const events: CodeModeToolExecutionEndEvent[] = []
    let laterEffects = 0
    const result = experimental_runCodeMode({
      js: 'await tools.wait({}); return await tools.later({})',
      tools: {
        wait: tool({
          inputSchema: z.object({}),
          execute: async () => {
            abort.abort(new Error('Cancelled'))
            await new Promise(() => {})
          }
        }),
        later: tool({ inputSchema: z.object({}), execute: () => ++laterEffects })
      },
      options: {
        onToolExecutionEnd: (event) => {
          events.push(event)
        }
      },
      toolExecutionOptions: { toolCallId: 'parent', messages: [], abortSignal: abort.signal }
    })
    await expect(result).rejects.toThrow(/Cancelled|abort/i)
    expect(laterEffects).toBe(0)
    expect(events).toHaveLength(1)
    expect(events[0].toolOutput.type).toBe('tool-error')
  })

  it.each([
    ['infinite loop', 'while (true) {}', { timeoutMs: 100 }, /timed out|timeout/i],
    ['large result', 'return "x".repeat(1000)', { maxResultBytes: 64 }, /limit|large|bytes/i],
    ['detached call', 'tools.slow({}); return 1', {}, /detached|pending|unawaited/i]
  ] as const)('bounds %s', async (_name, js, policy, error) => {
    await expect(
      experimental_runCodeMode({
        js,
        tools: {
          slow: tool({
            inputSchema: z.object({}),
            execute: async () => {
              await new Promise((resolve) => setTimeout(resolve, 300))
              return 1
            }
          })
        },
        options: { executionPolicy: policy },
        toolExecutionOptions: { toolCallId: 'parent', messages: [] }
      })
    ).rejects.toThrow(error)
  })

  it('does not expose Node, filesystem, or network globals to a program', async () => {
    expect(
      await experimental_runCodeMode({
        js: 'return [typeof process, typeof require, typeof fetch, typeof Bun]',
        tools: {},
        toolExecutionOptions: { toolCallId: 'parent', messages: [] }
      })
    ).toEqual(['undefined', 'undefined', 'undefined', 'undefined'])
  })
})

describe('Cherry native search and Code Mode', () => {
  it('searches first, exposes definitions on the next step, and persists child results with ownership and media', async () => {
    const binary = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const effects: string[] = []
    const screenshot = tool({
      inputSchema: z.object({}),
      contextSchema: z.object({ topicId: z.string() }),
      execute: (_input, { context }) => {
        effects.push(context.topicId)
        return {
          content: [
            { type: 'image' as const, mimeType: 'image/png', data: binary },
            { type: 'text' as const, text: 'captured' }
          ]
        }
      },
      toModelOutput: ({ output }) => ({
        type: 'content',
        value: output.content.map((item) =>
          item.type === 'image' ? { type: 'image-data', mediaType: item.mimeType, data: item.data } : item
        )
      })
    })
    const registry = new ToolRegistry()
    registry.register({
      name: 'screenshot',
      namespace: 'browser',
      defer: 'always',
      description: 'screenshot',
      tool: screenshot
    })
    const exposed = await applyDeferExposition({ screenshot }, registry, 32_000)
    const model = scriptedModel([
      'await tools.tool_search({query:"screenshot"}); return await tools.screenshot({})',
      'return await tools.screenshot({})',
      'return "continued"'
    ])
    const agent = new Agent({
      providerId: 'openai',
      providerSettings: { apiKey: 'fixture' },
      modelId: 'fixture',
      wrapModel: () => model,
      tools: exposed.tools,
      options: { context: { requestId: 'request-a', topicId: 'topic-a' }, stopWhen: isStepCount(4) },
      toolResultMediaCapabilities: { image: false, audio: false, video: false }
    })
    const final = await runStream(agent)
    const child = final.parts.find((part) =>
      part.type === 'dynamic-tool' ? part.toolName === 'screenshot' : part.type === 'tool-screenshot'
    )
    expect(child).toMatchObject({
      state: 'output-available',
      output: {
        content: [
          { type: 'image', data: binary },
          { type: 'text', text: 'captured' }
        ]
      },
      toolMetadata: { cherryCodeMode: { parentToolCallId: 'program-2' } }
    })
    const program = final.parts.find((part) => 'toolCallId' in part && part.toolCallId === 'program-2')
    expect(JSON.stringify(program)).not.toContain(binary)
    expect(effects).toEqual(['topic-a'])
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain('tools.screenshot')
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain('screenshot')
    expect(JSON.stringify(model.doStreamCalls[2].prompt)).toContain(binary)
    expect(JSON.stringify(model.doStreamCalls[3].prompt).split(binary)).toHaveLength(2)
    const replay = await toModelMessages([final], undefined, exposed.tools, {
      image: false,
      audio: false,
      video: false
    })
    expect(JSON.stringify(replay)).toContain(binary)
    expect(effects).toEqual(['topic-a'])
  })

  it('preserves arbitrary JSON host results that are not MCP content', async () => {
    const output = { content: [null, 1], nested: { result: false } }
    const model = scriptedModel(['return await tools.lookup({})'])
    const agent = new Agent({
      providerId: 'openai',
      providerSettings: { apiKey: 'fixture' },
      modelId: 'fixture',
      wrapModel: () => model,
      tools: { lookup: tool({ inputSchema: z.object({}), execute: () => output }) },
      options: { stopWhen: isStepCount(2) }
    })
    const final = await runStream(agent)
    expect(final.parts.find((part) => 'toolCallId' in part && part.toolCallId === 'program-1')).toMatchObject({
      state: 'output-available',
      output
    })
  })

  it('keeps gated tools out of Code Mode while retaining direct approvals', async () => {
    let effects = 0
    const write = tool({ inputSchema: z.object({}), needsApproval: true, execute: () => ++effects })
    const lookup = tool({ inputSchema: z.object({}), execute: () => 'ok' })
    const model = scriptedModel(['return await tools.write({})'])
    const agent = new Agent({
      providerId: 'openai',
      providerSettings: { apiKey: 'fixture' },
      modelId: 'fixture',
      wrapModel: () => model,
      tools: { write, lookup },
      options: { stopWhen: isStepCount(2) }
    })
    const final = await runStream(agent)
    expect(effects).toBe(0)
    expect(final.parts.find((part) => 'toolCallId' in part && part.toolCallId === 'program-1')).toMatchObject({
      state: 'output-error'
    })
    expect(model.doStreamCalls[0].tools?.map((value) => value.name)).toContain('write')
  })

  it('terminates after a trusted child failure even when the program discards its result', async () => {
    const model = scriptedModel(['await tools.lookup({}); return "ignored"'])
    const agent = new Agent({
      providerId: 'openai',
      providerSettings: { apiKey: 'fixture' },
      modelId: 'fixture',
      wrapModel: () => model,
      tools: {
        lookup: tool({
          inputSchema: z.object({}),
          execute: () =>
            markTrustedLocalToolTerminalFailure({
              terminal: true,
              retryable: false,
              error: 'raw failure',
              userMessage: 'Fix the network.'
            })
        })
      },
      options: { stopWhen: isStepCount(3) }
    })
    await expect(runStream(agent)).rejects.toThrow('Fix the network.')
    expect(model.doStreamCalls).toHaveLength(1)
  })

  it('preserves a caller-owned code_mode and never exposes client-only tools as host functions', () => {
    const client = tool({ inputSchema: z.object({}) })
    const custom = tool({ inputSchema: z.object({}), execute: () => 'custom' })
    const tools = { code_mode: custom, client }
    expect(
      withCodeMode(
        tools,
        undefined,
        {},
        () => {},
        async () => {}
      ).tools
    ).toBe(tools)
    expect(
      withCodeMode(
        { client },
        undefined,
        {},
        () => {},
        async () => {}
      ).tools
    ).toEqual({ client })
  })
})
