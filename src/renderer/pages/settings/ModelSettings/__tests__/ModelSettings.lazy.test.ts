import { describe, expect, it, vi } from 'vitest'

const PROBE_TIMEOUT = 45_000

const optionalPanels = vi.hoisted(() => ({
  topicPanelEvaluated: vi.fn(),
  translatePanelEvaluated: vi.fn()
}))

vi.mock('@renderer/pages/translate/TranslateSettings', () => {
  optionalPanels.translatePanelEvaluated()
  return { TranslateSettingsPanelContent: () => null }
})

vi.mock('../TopicNamingSettings', () => {
  optionalPanels.topicPanelEvaluated()
  return { TopicNamingSettings: () => null }
})

describe('ModelSettings optional panel lazy boundaries', () => {
  it(
    'does not evaluate optional panel modules with the base ModelSettings module',
    async () => {
      await import('../ModelSettings')

      expect(optionalPanels.topicPanelEvaluated).not.toHaveBeenCalled()
      expect(optionalPanels.translatePanelEvaluated).not.toHaveBeenCalled()
    },
    PROBE_TIMEOUT
  )

  it(
    'positive control: both optional panel modules remain loadable on demand',
    async () => {
      await Promise.all([import('../TopicNamingSettings'), import('@renderer/pages/translate/TranslateSettings')])

      expect(optionalPanels.topicPanelEvaluated).toHaveBeenCalledTimes(1)
      expect(optionalPanels.translatePanelEvaluated).toHaveBeenCalledTimes(1)
    },
    PROBE_TIMEOUT
  )
})
