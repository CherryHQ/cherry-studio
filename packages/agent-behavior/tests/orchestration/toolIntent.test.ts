import { describe, expect, it } from 'vitest'

import {
  createToolIntent,
  type IntentTool,
  offersToolIntent,
  TOOL_INTENT_ARG,
  withoutToolIntent
} from '../../src/orchestration/toolIntent'

const transform = createToolIntent()
const withToolIntent = <T extends IntentTool<Prepared>, Prepared = never>(tool: T & IntentTool<Prepared>) =>
  transform(tool, true)

type BashArguments = { command: string; intent?: string | null }
const prepareOf = (tool: IntentTool<BashArguments>) => {
  const prepare = withToolIntent(tool).prepareArguments
  if (!prepare) throw new Error('Missing argument preparation')
  return prepare
}

const bash = {
  name: 'bash',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
    additionalProperties: false
  }
}

describe('createToolIntent', () => {
  it('offers an optional intent string beside the tool’s own properties', () => {
    const tool = withToolIntent(bash)
    expect(tool.parameters).toMatchObject({
      properties: { command: { type: 'string' }, [TOOL_INTENT_ARG]: { type: 'string' } },
      required: ['command'],
      additionalProperties: false
    })
    expect(bash.parameters.properties).not.toHaveProperty(TOOL_INTENT_ARG)
  })

  it('offers one on an object schema that declares no properties', () => {
    const tool = withToolIntent({ parameters: { type: 'object' } })
    expect(tool.parameters).toEqual({ type: 'object', properties: { [TOOL_INTENT_ARG]: expect.any(Object) } })
  })

  it('leaves schemas that cannot take a property alone', () => {
    const array = { parameters: { type: 'array', items: { type: 'string' } } }
    const untyped = { parameters: { anyOf: [{ type: 'object' }] } }
    expect(withToolIntent(array)).toBe(array)
    expect(withToolIntent(untyped)).toBe(untyped)
  })

  it('leaves a tool that declares intent itself, and passes its intent through', () => {
    const own = {
      parameters: { type: 'object', properties: { intent: { type: 'number' } } },
      prepareArguments: <Args>(args: Args): Args => args
    }
    expect(withToolIntent(own)).toBe(own)
  })

  it('removes intent before the tool’s own repair runs, without touching the model’s call', () => {
    const seen: unknown[] = []
    const edit = {
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
      prepareArguments: (args: unknown) => {
        if (typeof args !== 'object' || args === null || !('path' in args) || typeof args.path !== 'string') {
          throw new Error('Missing path')
        }
        seen.push(args)
        return { ...args, path: args.path.trim() }
      }
    }
    const call = { path: ' a.ts ', intent: 'fix the import order' }
    const prepared = withToolIntent(edit).prepareArguments(call)
    expect(seen).toEqual([{ path: ' a.ts ' }])
    expect(prepared).toEqual({ path: 'a.ts' })
    expect(call).toEqual({ path: ' a.ts ', intent: 'fix the import order' })
  })

  it('removes intent for a tool without its own repair, including a null one', () => {
    const prepare = prepareOf(bash)
    expect(prepare({ command: 'ls', intent: 'see what the build produced' })).toEqual({ command: 'ls' })
    expect(prepare({ command: 'ls', intent: null })).toEqual({ command: 'ls' })
  })

  it('returns arguments without intent as they came', () => {
    const args = { command: 'ls' }
    expect(prepareOf(bash)(args)).toBe(args)
  })

  it.each(
    ['invalid object arguments', 0, false, null, undefined, ['invalid object arguments']].map((args) => ({ args }))
  )('preserves non-object arguments for downstream validation: %j', ({ args }) => {
    expect(withoutToolIntent(args)).toBe(args)
  })

  it('keeps unvalidated arguments typed when a tool has no repair', () => {
    const tool = transform(bash, true)
    if (!('prepareArguments' in tool) || !tool.prepareArguments) throw new Error('Missing argument preparation')
    const prepared: number | object = tool.prepareArguments(42)
    expect(prepared).toBe(42)
  })

  it('preserves a null repair result for downstream validation', () => {
    const tool = withToolIntent({ ...bash, prepareArguments: () => null })
    expect(tool.prepareArguments({ command: 'ls', intent: 'inspect the directory' })).toBeNull()
  })

  it('returns the same wrapper for the same tool', () => {
    expect(withToolIntent(bash)).toBe(withToolIntent(bash))
  })

  it('keeps the schema of a tool not offered intent, yet still runs a call that carries one', () => {
    const original: IntentTool<BashArguments> = bash
    const tool = transform(original, false)
    expect(tool.parameters).toBe(bash.parameters)
    const prepare = tool.prepareArguments
    if (!prepare) throw new Error('Missing argument preparation')
    expect(prepare({ command: 'ls', intent: 'left over from another model' })).toEqual({ command: 'ls' })
  })
})

describe('offersToolIntent', () => {
  it('offers intent to DeepSeek models however the provider names them', () => {
    for (const id of ['deepseek-v4.1-flash', 'deepseek/deepseek-chat', 'DeepSeek-V3.2']) {
      expect(offersToolIntent(id)).toBe(true)
    }
  })

  it('does not offer it to models that narrate their own steps', () => {
    for (const id of ['claude-sonnet-4-5', 'gpt-5', 'qwen3.7-plus', undefined]) {
      expect(offersToolIntent(id)).toBe(false)
    }
  })
})
