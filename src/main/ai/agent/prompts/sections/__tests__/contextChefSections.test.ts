import {
  type ContextSettingsCompressOverride,
  DEFAULT_CONTEXT_SETTINGS,
  type EffectiveContextSettings
} from '@shared/data/types/contextSettings'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { buildSystemPrompt } from '../buildSystemPrompt'

const model = { id: 'x::y' as UniqueModelId, providerId: 'x', name: 'Y' } as Model

/**
 * Factory keeps each test's contextSettings shape readable + isolated. Builds
 * a fully resolved EffectiveContextSettings on top of the global defaults.
 */
function makeContextSettings(overrides: {
  enabled?: boolean
  compress?: Partial<ContextSettingsCompressOverride>
}): EffectiveContextSettings {
  return {
    ...DEFAULT_CONTEXT_SETTINGS,
    enabled: overrides.enabled ?? DEFAULT_CONTEXT_SETTINGS.enabled,
    compress: {
      enabled: overrides.compress?.enabled ?? DEFAULT_CONTEXT_SETTINGS.compress.enabled,
      modelId: overrides.compress?.modelId ?? DEFAULT_CONTEXT_SETTINGS.compress.modelId
    }
  }
}

beforeEach(() => {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.system_prompt.output_style', 'default')
})

afterEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.clearAllMocks()
})

/**
 * Each contextChef hint section is gated off `ctx.contextSettings`.
 * Asserting through `buildSystemPrompt` (rather than calling the
 * contributor in isolation) catches both shapes of regression: a
 * contributor that forgets the gate, and a contributor that returns
 * an empty section which only the builder filters out.
 */
describe('contextChef hint sections', () => {
  describe('persistedOutputSection', () => {
    it('is omitted when contextSettings is absent', async () => {
      const sections = await buildSystemPrompt({ model })
      expect(sections.find((s) => s.id === 'persisted_output')).toBeUndefined()
    })

    it('is omitted when contextSettings.enabled is false', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: false })
      })
      expect(sections.find((s) => s.id === 'persisted_output')).toBeUndefined()
    })

    it('emits a <context-persistence> block referencing fs__read when enabled', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: true })
      })
      const section = sections.find((s) => s.id === 'persisted_output')
      expect(section).toBeDefined()
      expect(section?.text).toContain('<context-persistence>')
      expect(section?.text).toContain('</context-persistence>')
      expect(section?.text).toContain('fs__read')
      expect(section?.text).toContain('<persisted-output>')
      expect(section?.cacheable).toBe(true)
    })
  })

  describe('compactionHintSection', () => {
    it('is omitted when contextSettings.enabled is false', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: false })
      })
      expect(sections.find((s) => s.id === 'context_compaction')).toBeUndefined()
    })

    it('emits a <context-compaction> hint when enabled', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: true })
      })
      const section = sections.find((s) => s.id === 'context_compaction')
      expect(section).toBeDefined()
      expect(section?.text).toContain('<context-compaction>')
      expect(section?.text).toContain('</context-compaction>')
      expect(section?.text.toLowerCase()).toContain('reasoning')
      expect(section?.cacheable).toBe(true)
    })
  })

  describe('compressionHintSection', () => {
    it('is omitted when contextSettings is absent', async () => {
      const sections = await buildSystemPrompt({ model })
      expect(sections.find((s) => s.id === 'context_compression')).toBeUndefined()
    })

    it('is omitted when enabled but compress.enabled is false', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: true, compress: { enabled: false } })
      })
      expect(sections.find((s) => s.id === 'context_compression')).toBeUndefined()
    })

    it('emits a <context-compression> block when both enabled and compress.enabled are true', async () => {
      const sections = await buildSystemPrompt({
        model,
        contextSettings: makeContextSettings({ enabled: true, compress: { enabled: true } })
      })
      const section = sections.find((s) => s.id === 'context_compression')
      expect(section).toBeDefined()
      expect(section?.text).toContain('<context-compression>')
      expect(section?.text).toContain('</context-compression>')
      expect(section?.text).toContain('<summary>')
      expect(section?.cacheable).toBe(true)
    })
  })

  /**
   * Ordering is part of the contract: the three context-chef sections
   * sit AFTER systemRulesSection and BEFORE toolIntrosSection, sibling
   * to agentDisciplineSection. A reorder can silently bust prompt-cache
   * stability or interleave behavior contracts with operational rules.
   */
  it('places context_* sections after system_rules and before tool_intros when fully enabled', async () => {
    const sections = await buildSystemPrompt({
      model,
      contextSettings: makeContextSettings({ enabled: true, compress: { enabled: true } })
    })
    const ids = sections.map((s) => s.id)
    const sysRulesIdx = ids.indexOf('system_rules')
    const persistedIdx = ids.indexOf('persisted_output')
    const compactIdx = ids.indexOf('context_compaction')
    const compressIdx = ids.indexOf('context_compression')
    const disciplineIdx = ids.indexOf('agent_discipline')
    expect(sysRulesIdx).toBeGreaterThanOrEqual(0)
    expect(sysRulesIdx).toBeLessThan(persistedIdx)
    expect(persistedIdx).toBeLessThan(compactIdx)
    expect(compactIdx).toBeLessThan(compressIdx)
    expect(compressIdx).toBeLessThan(disciplineIdx)
  })
})
