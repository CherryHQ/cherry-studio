import { act, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ComponentProps } from 'react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import de from '@renderer/i18n/locales/de-de.json'
import en from '@renderer/i18n/locales/en-us.json'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'

import { AgentContextUsageSummary } from '../AgentContextUsageSummary'

const i18n = createInstance()
await i18n.init({
  lng: 'en-US',
  keySeparator: false,
  resources: { 'en-US': { translation: en }, 'de-DE': { translation: de } }
})

const renderSummary = (props: ComponentProps<typeof AgentContextUsageSummary>) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AgentContextUsageSummary {...props} />
    </I18nextProvider>
  )

const buildUsage = (categories: { name: string; tokens: number }[]): AgentSessionContextUsage => ({
  categories,
  totalTokens: 1000,
  maxTokens: 2000,
  percentage: 50,
  model: 'claude-opus-4-8'
})

describe('AgentContextUsageSummary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('formats category tokens using the interface language and updates when it changes', async () => {
    renderSummary({ usage: buildUsage([{ name: 'Messages', tokens: 1000 }]), percentage: 50 })

    expect(screen.getByText('1,000 (100%)')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('de-DE'))
    expect(screen.getByText('1.000 / 2.000 (50%)')).toBeInTheDocument()
    expect(screen.getByText('1.000 (100%)')).toBeInTheDocument()

    await act(() => i18n.changeLanguage('en-US'))
    expect(screen.getByText('1,000 (100%)')).toBeInTheDocument()
  })

  it('shows the empty label when usage is unavailable', () => {
    renderSummary({ usage: null, percentage: null })

    expect(screen.getByText(en['common.none'])).toBeInTheDocument()
  })

  it('translates known category names', () => {
    renderSummary({ usage: buildUsage([{ name: 'System prompt', tokens: 100 }]), percentage: 50 })

    expect(screen.getByText(en['agent.right_pane.info.context_categories.system_prompt'])).toBeInTheDocument()
  })

  it('renders the supplied model window instead of the SDK compaction budget', () => {
    // usage.maxTokens is the auto-compact window (2000); the model window is what users mean.
    renderSummary({
      usage: buildUsage([{ name: 'Messages', tokens: 1000 }]),
      percentage: 10,
      maxTokens: 10_000
    })

    expect(screen.getByText('1,000 / 10,000 (10%)')).toBeInTheDocument()
  })

  it('falls back to the SDK value when the model declares no window', () => {
    renderSummary({ usage: buildUsage([{ name: 'Messages', tokens: 1000 }]), percentage: 50 })

    expect(screen.getByText('1,000 / 2,000 (50%)')).toBeInTheDocument()
  })

  it('falls back to the raw name for unknown categories', () => {
    renderSummary({ usage: buildUsage([{ name: 'Brand new thing', tokens: 100 }]), percentage: 50 })

    expect(screen.getByText('Brand new thing')).toBeInTheDocument()
  })

  it('shows each category tokens with its share of used context', () => {
    // 100 tokens of 1000 used → 10%.
    renderSummary({ usage: buildUsage([{ name: 'System prompt', tokens: 100 }]), percentage: 50 })

    expect(screen.getByText('100 (10%)')).toBeInTheDocument()
  })

  it('renders Messages and hides window-filler categories', () => {
    renderSummary({
      usage: buildUsage([
        { name: 'Messages', tokens: 300 },
        { name: 'Free space', tokens: 900000 },
        { name: 'Autocompact buffer', tokens: 50000 },
        { name: 'Skills', tokens: 0 }
      ]),
      percentage: 50
    })

    expect(screen.getByText(en['agent.right_pane.info.context_categories.messages'])).toBeInTheDocument()
    expect(screen.queryByText(en['agent.right_pane.info.context_categories.free_space'])).not.toBeInTheDocument()
    expect(
      screen.queryByText(en['agent.right_pane.info.context_categories.autocompact_buffer'])
    ).not.toBeInTheDocument()
    expect(screen.queryByText(en['agent.right_pane.info.context_categories.skills'])).not.toBeInTheDocument()
    expect(screen.queryByText('900,000 (90000%)')).not.toBeInTheDocument()
  })

  it('omits the breakdown but keeps the total when showCategories is false', () => {
    renderSummary({
      usage: buildUsage([{ name: 'System prompt', tokens: 100 }]),
      percentage: 50,
      showCategories: false
    })

    expect(screen.getByText('1,000 / 2,000 (50%)')).toBeInTheDocument()
    expect(screen.queryByText(en['agent.right_pane.info.context_categories.system_prompt'])).not.toBeInTheDocument()
  })
})
