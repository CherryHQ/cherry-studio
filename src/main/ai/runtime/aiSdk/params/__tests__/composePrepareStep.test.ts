import type { ModelMessage } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AgentLoopHooks } from '../../loop/types'
import { composeHooks } from '../composeHooks'

type PrepareStep = NonNullable<AgentLoopHooks['prepareStep']>
const baseOptions = {
  stepNumber: 0,
  steps: [],
  messages: [{ role: 'user', content: 'hi' }] satisfies ModelMessage[],
  model: 'fake',
  experimental_context: undefined
} satisfies Parameters<PrepareStep>[0]

describe('prepareStep composition contracts', () => {
  it('threads messages without forwarding other overrides or mutating retained inputs', async () => {
    const inputs: Parameters<PrepareStep>[0][] = []
    const composed = composeHooks([
      {
        prepareStep: (options) => {
          inputs.push(options)
          return { messages: [{ role: 'user', content: 'first' }], system: 'override' }
        }
      },
      {
        prepareStep: (options) => {
          inputs.push(options)
          return { messages: [...options.messages, { role: 'user', content: 'second' }] }
        }
      },
      { prepareStep: (options) => ({ messages: [...options.messages, { role: 'user', content: 'last' }] }) }
    ])

    const result = await composed.prepareStep!(baseOptions)

    expect(result).toMatchObject({
      system: 'override',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'user', content: 'last' }
      ]
    })
    expect(inputs[0].messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(inputs[1].messages).toEqual([{ role: 'user', content: 'first' }])
    expect(inputs[1]).not.toHaveProperty('system')
  })

  it('distinguishes no overrides from an empty override', async () => {
    const absent = composeHooks([{ prepareStep: () => undefined }, { prepareStep: () => undefined }])
    const empty = composeHooks([{ prepareStep: () => undefined }, { prepareStep: () => ({}) }])

    expect(await absent.prepareStep!(baseOptions)).toBeUndefined()
    expect(await empty.prepareStep!(baseOptions)).toEqual({})
  })

  it('preserves explicit undefined, symbol keys and own __proto__ data properties', async () => {
    const marker = Symbol('plugin-data')
    const composed = composeHooks([
      { prepareStep: () => ({ system: 'first', [marker]: 'retained', ['__proto__']: 'data' }) },
      { prepareStep: () => ({ system: undefined, toolChoice: 'auto' }) }
    ])

    const result = await composed.prepareStep!(baseOptions)

    expect(result).toEqual({ system: undefined, toolChoice: 'auto', [marker]: 'retained', ['__proto__']: 'data' })
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })
})
