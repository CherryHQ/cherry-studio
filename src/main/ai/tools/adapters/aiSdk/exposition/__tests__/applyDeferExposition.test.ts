import { createOpenAI } from '@ai-sdk/openai'
import { generateText, isStepCount, tool, type ToolSet } from 'ai'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { ToolRegistry } from '../../registry'
import type { ToolDefer, ToolEntry } from '../../types'
import { applyDeferExposition } from '../applyDeferExposition'

function entry(name: string, defer: ToolDefer = 'always', description = '查询天气'): ToolEntry {
  return {
    name,
    namespace: 'mcp:server-id',
    namespaceLabel: 'mcp:天气服务',
    description,
    defer,
    tool: tool({
      description,
      inputSchema: z.object({ city: z.string().trim().default('北京') }),
      execute: ({ city }) => city
    })
  }
}

function catalog(entries: ToolEntry[]) {
  const registry = new ToolRegistry()
  const tools: ToolSet = {}
  for (const value of entries) {
    registry.register(value)
    tools[value.name] = value.tool
  }
  return { registry, tools }
}

function modelFor(steps: Array<Array<{ name: string; input: unknown }>>) {
  const requests: Array<{ tools?: Array<{ function: { name: string; parameters: unknown } }> }> = []
  const model = createOpenAI({
    apiKey: 'fixture',
    fetch: async (_url, init) => {
      const calls = steps[requests.length] ?? []
      requests.push(JSON.parse(String(init?.body)))
      return Response.json({
        id: `response-${requests.length}`,
        object: 'chat.completion',
        created: 0,
        model: 'fixture',
        choices: [
          {
            index: 0,
            finish_reason: calls.length ? 'tool_calls' : 'stop',
            message: {
              role: 'assistant',
              content: calls.length ? null : 'Done',
              ...(calls.length
                ? {
                    tool_calls: calls.map(({ name, input }, i) => ({
                      id: `call-${requests.length}-${i}`,
                      type: 'function',
                      function: { name, arguments: JSON.stringify(input) }
                    }))
                  }
                : {})
            }
          }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })
    }
  }).chat('fixture')
  return { model, requests }
}

async function run(tools: ToolSet, steps: Array<Array<{ name: string; input: unknown }>>) {
  const { model, requests } = modelFor(steps)
  const result = await generateText({
    model,
    tools,
    prompt: 'Find the weather.',
    stopWhen: isStepCount(steps.length + 1)
  })
  return { result, requests }
}

const search = (query: string) => ({ name: 'tool_search', input: { query } })
const toolNames = (request: ReturnType<typeof modelFor>['requests'][number]) =>
  request.tools?.map(({ function: f }) => f.name) ?? []

describe('native deferred tool dispatch', () => {
  it('delivers discovered schemas on the next step and validates transformed input before execution', async () => {
    const effects: string[] = []
    const weather = entry('weather')
    weather.tool.execute = ({ city }) => {
      effects.push(city)
      return { city }
    }
    const { registry, tools } = catalog([weather])
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const { result, requests } = await run(exposed.tools!, [
      [search('天气'), { name: 'weather', input: { city: 'premature' } }],
      [{ name: 'weather', input: { city: 42 } }],
      [{ name: 'weather', input: { city: ' 上海 ' } }]
    ])
    expect(toolNames(requests[0])).toEqual(['tool_search'])
    expect(toolNames(requests[1])).toContain('weather')
    expect(requests[1].tools?.find(({ function: f }) => f.name === 'weather')?.function.parameters).toMatchObject({
      properties: { city: { type: 'string' } }
    })
    expect(effects).toEqual(['上海'])
    expect(result.finalStep.text).toBe('Done')
  })

  it.each(['天气', 'mcp:天气服务', 'WEATHER'])('finds a tool by query %s', async (query) => {
    const { registry, tools } = catalog([entry('weather')])
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const { result } = await run(exposed.tools!, [[search(query)], [{ name: 'weather', input: {} }]])
    expect(result.steps[0].toolResults[0].output).toMatchObject({ tools: [{ name: 'weather' }] })
    expect(result.steps[1].toolResults[0].output).toBe('北京')
  })

  it('isolates requests and excludes tools outside the selected catalog', async () => {
    const { registry, tools } = catalog([entry('weather'), entry('secret')])
    delete tools.secret
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const [first, second] = await Promise.all([
      run(exposed.tools!, [[search('weather')]]),
      run(exposed.tools!, [[search('secret')]])
    ])
    expect(toolNames(first.requests[1])).toContain('weather')
    expect(toolNames(second.requests[1])).not.toContain('weather')
    expect(second.result.steps[0].toolResults[0].output).toEqual({ tools: [] })
    const fresh = await run(exposed.tools!, [])
    expect(toolNames(fresh.requests[0])).toEqual(['tool_search'])
  })

  it('keeps approval tools directly callable and denies effects until approval', async () => {
    let effects = 0
    const gated = entry('write', 'never')
    gated.tool.needsApproval = true
    gated.tool.execute = () => ++effects
    const { registry, tools } = catalog([entry('weather'), gated])
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const { result, requests } = await run(exposed.tools!, [[{ name: 'write', input: {} }]])
    expect(toolNames(requests[0])).toContain('write')
    expect(effects).toBe(0)
    expect(result.finalStep.content.some((part) => part.type === 'tool-approval-request')).toBe(true)
  })

  it('keeps a small inline catalog and empty requests free of discovery overhead', async () => {
    const { registry, tools } = catalog([entry('weather', 'auto')])
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const { requests } = await run(exposed.tools!, [])
    expect(toolNames(requests[0])).toEqual(['weather'])
    expect((await applyDeferExposition(undefined, registry, 32_000)).tools).toBeUndefined()
    expect((await applyDeferExposition({}, registry, 32_000)).tools).toEqual({})
  })

  it('defers a large auto catalog without deleting executable tools', async () => {
    const { registry, tools } = catalog(
      Array.from({ length: 5 }, (_, i) => entry(`weather_${i}`, 'auto', 'long description '.repeat(3000)))
    )
    const exposed = await applyDeferExposition(tools, registry, 32_000)
    const { requests, result } = await run(exposed.tools!, [[search('weather_4')], [{ name: 'weather_4', input: {} }]])
    expect(toolNames(requests[0])).toEqual(['tool_search'])
    expect(result.steps[1].toolResults[0].output).toBe('北京')
  })

  it('retains caller overrides and does not replace a caller-owned tool_search', async () => {
    const { registry, tools } = catalog([entry('weather')])
    const replacement = tool({ inputSchema: z.object({}), execute: () => 'client' })
    const overridden = await applyDeferExposition({ ...tools, weather: replacement }, registry, 32_000)
    const { result } = await run(overridden.tools!, [[{ name: 'weather', input: {} }]])
    expect(result.steps[0].toolResults[0].output).toBe('client')
    const collision = await applyDeferExposition({ ...tools, tool_search: replacement }, registry, 32_000)
    const custom = await run(collision.tools!, [[{ name: 'tool_search', input: {} }]])
    expect(custom.result.steps[0].toolResults[0].output).toBe('client')
    expect(toolNames(custom.requests[0])).toContain('weather')
  })
})
