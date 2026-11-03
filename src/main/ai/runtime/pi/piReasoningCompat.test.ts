import type { ProviderConfig } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import type { ReasoningWireMode, ReasoningWireProfile } from '@cherrystudio/provider-registry'
import type { ResolvedReasoningProfile } from '@data/services/ProviderRegistryService'
import { resolveReasoningInvocation } from '@main/ai/utils/reasoningSerializers'
import type { Model } from '@shared/data/types/model'

import { projectPiReasoningCompat, withPiReasoningOff } from './piReasoningCompat'

type Profile = Pick<ResolvedReasoningProfile, 'wireDialect' | 'wire'>
type NonBudgetOperation = Exclude<ReasoningWireMode, { budget: unknown }>['operations'][number]

const adaptive: NonBudgetOperation = { target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } }
const enabled: NonBudgetOperation = { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } }
const effort: NonBudgetOperation = { target: 'thinking.type', value: { source: 'effort' } }
const summarized: NonBudgetOperation = {
  target: 'thinking.display',
  value: { source: 'literal', value: 'summarized' }
}

function profile(operations: NonBudgetOperation[], overrides: Partial<Profile> = {}): Profile {
  return { wireDialect: 'adaptive-always', wire: { effort: { operations } }, ...overrides }
}

describe('projectPiReasoningCompat', () => {
  it('prevents loss of the adaptive-always dialect projection', () => {
    expect(projectPiReasoningCompat(profile([adaptive]))).toEqual({ forceAdaptiveThinking: true })
  })

  it.each(['effort', 'adaptive-between-tools', 'budget'] as const)(
    'prevents dialect widening to %s even with an adaptive literal',
    (wireDialect) => {
      expect(projectPiReasoningCompat(profile([adaptive], { wireDialect }))).toEqual({})
    }
  )

  it('preserves override precedence when the profile is undefined', () => {
    expect(projectPiReasoningCompat(undefined)).toEqual({})
  })

  it('prevents dialect widening when the dialect is missing', () => {
    expect(projectPiReasoningCompat(profile([adaptive], { wireDialect: undefined }))).toEqual({})
  })

  it('preserves disabled-wire override precedence over the adaptive dialect', () => {
    expect(
      projectPiReasoningCompat(profile([adaptive], { wire: { disabled: true, effort: { operations: [adaptive] } } }))
    ).toEqual({})
  })

  it('preserves enabled-wire override precedence over the adaptive dialect', () => {
    expect(projectPiReasoningCompat(profile([enabled]))).toEqual({})
  })

  it('honors operation ordering when enabled follows adaptive', () => {
    expect(projectPiReasoningCompat(profile([adaptive, enabled]))).toEqual({})
  })

  it('honors operation ordering when adaptive follows enabled', () => {
    expect(projectPiReasoningCompat(profile([enabled, adaptive]))).toEqual({ forceAdaptiveThinking: true })
  })

  it('preserves override precedence when disabled follows adaptive', () => {
    expect(
      projectPiReasoningCompat(
        profile([adaptive, { target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }])
      )
    ).toEqual({})
  })

  it('preserves non-literal override precedence when effort follows adaptive', () => {
    expect(projectPiReasoningCompat(profile([adaptive, effort]))).toEqual({})
  })

  it.each(['default', 'auto', 'off'] as const)('restricts mode selection when adaptive exists only in %s', (mode) => {
    expect(projectPiReasoningCompat(profile([], { wire: { [mode]: { operations: [adaptive] } } }))).toEqual({})
  })

  it('restricts target selection when effort only writes thinking.display', () => {
    expect(projectPiReasoningCompat(profile([summarized]))).toEqual({})
  })

  it('restricts target selection when adaptive is nested under extra_body', () => {
    expect(
      projectPiReasoningCompat(
        profile([{ target: 'extra_body.thinking.type', value: { source: 'literal', value: 'adaptive' } }])
      )
    ).toEqual({})
  })

  it('keeps target selection independent of a later unrelated operation', () => {
    expect(projectPiReasoningCompat(profile([adaptive, summarized]))).toEqual({ forceAdaptiveThinking: true })
  })

  it('rejects an unauthorized rule that any budget operation disqualifies the adaptive dialect', () => {
    expect(
      projectPiReasoningCompat({
        wireDialect: 'adaptive-always',
        wire: {
          effort: {
            operations: [{ target: 'thinking.budget_tokens', value: { source: 'budget' } }, adaptive],
            budget: { missing: { type: 'fallback', value: 1024 } }
          }
        }
      })
    ).toEqual({ forceAdaptiveThinking: true })
  })
})

describe('withPiReasoningOff', () => {
  type PiStreamSimple = NonNullable<ProviderConfig['streamSimple']>
  const model = { reasoning: { selectableEfforts: ['none', 'high'] } } as Model
  const wire: ReasoningWireProfile = {
    off: { operations: [{ target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }] },
    auto: { operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }] },
    effort: {
      operations: [enabled, { target: 'reasoningEffort', value: { source: 'effort' } }]
    }
  }

  async function rewrite(payload: unknown, options: Parameters<PiStreamSimple>[2] = {}, profileWire = wire) {
    const invocation = resolveReasoningInvocation({ selection: 'none', model, profile: profileWire })
    let result: unknown
    let forwarded: Parameters<PiStreamSimple>[2]
    let done: Promise<void> | undefined
    const stream: PiStreamSimple = (piModel, _context, streamOptions) => {
      forwarded = streamOptions
      done = Promise.resolve(streamOptions?.onPayload?.(payload, piModel)).then((value) => {
        result = value
      })
      return {} as ReturnType<PiStreamSimple>
    }
    const wrapped = withPiReasoningOff(stream, { ...invocation, wire: profileWire })
    wrapped({} as Parameters<PiStreamSimple>[0], {} as Parameters<PiStreamSimple>[1], options)
    await done
    return { payload: result, options: forwarded! }
  }

  it('applies the declared literal and removes competing HTTP effort', async () => {
    expect((await rewrite({ model: 'fixture', reasoning_effort: 'none' })).payload).toEqual({
      model: 'fixture',
      thinking: { type: 'disabled' }
    })
  })

  it('preserves nested siblings and unrelated thinking envelopes', async () => {
    expect(
      (await rewrite({ thinking: { type: 'enabled', display: 'summarized' }, reasoning: { exclude: true } })).payload
    ).toEqual({ thinking: { type: 'disabled', display: 'summarized' }, reasoning: { exclude: true } })
  })

  it('returns an already correct body and its nested object unchanged, preserving byte order', async () => {
    const payload = { model: 'fixture', thinking: { type: 'disabled', display: 'summarized' }, stream: true }
    const before = JSON.stringify(payload)
    const thinking = payload.thinking
    expect((await rewrite(payload)).payload).toBe(payload)
    expect(payload.thinking).toBe(thinking)
    expect(JSON.stringify(payload)).toBe(before)
  })

  it('honors an asynchronous replacement and removes effort reintroduced by the callback', async () => {
    const replacement = { model: 'replacement', reasoning_effort: 'high', thinking: { display: 'summarized' } }
    const result = await rewrite(
      { model: 'original' },
      { onPayload: async () => replacement, temperature: 0.5, headers: { 'x-fixture': 'kept' } }
    )
    expect(result.payload).toBe(replacement)
    expect(result.payload).toEqual({ model: 'replacement', thinking: { type: 'disabled', display: 'summarized' } })
    expect(result.options).toMatchObject({ temperature: 0.5, headers: { 'x-fixture': 'kept' } })
  })

  it('honors in-place mutation returning undefined before enforcing the off contract', async () => {
    const payload = { model: 'original', reasoning_effort: 'none' }
    const result = await rewrite(payload, {
      onPayload: (value) => {
        Object.assign(value as object, { model: 'mutated', reasoning_effort: 'high' })
      }
    })
    expect(result.payload).toBe(payload)
    expect(result.payload).toEqual({ model: 'mutated', thinking: { type: 'disabled' } })
  })

  it.each([null, false, 0, ''])('honors a defined replacement of %s', async (replacement) => {
    expect((await rewrite({ model: 'original' }, { onPayload: () => replacement })).payload).toBe(replacement)
  })

  it('emits non-DeepSeek declarations verbatim and removes only other-mode leaves', async () => {
    const profileWire: ReasoningWireProfile = {
      off: {
        operations: [
          { target: 'chat_template_kwargs.enable_thinking', value: { source: 'literal', value: false } },
          { target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }
        ]
      },
      auto: {
        operations: [{ target: 'chat_template_kwargs.thinking_budget', value: { source: 'literal', value: 100 } }]
      },
      effort: { operations: [{ target: 'reasoning_effort', value: { source: 'effort' } }] },
      default: { operations: [{ target: 'reasoning.enabled', value: { source: 'literal', value: true } }] }
    }
    const result = await rewrite(
      {
        chat_template_kwargs: { thinking_budget: 100, unrelated: 'kept' },
        reasoning: { enabled: true, exclude: false },
        reasoning_effort: 'high',
        thinking: { type: 'unrelated' }
      },
      {},
      profileWire
    )
    expect(result.payload).toEqual({
      chat_template_kwargs: { enable_thinking: false, unrelated: 'kept' },
      reasoning: { exclude: false },
      reasoning_effort: 'none',
      thinking: { type: 'unrelated' }
    })
  })
})
