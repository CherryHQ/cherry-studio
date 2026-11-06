import { mockDataApiService } from '@test-mocks/renderer/DataApiService'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import type { LocalAgentUsageEntry } from '@shared/ai/localAgentUsage'

import { LocalAgentUsage } from '../LocalAgentUsage'

vi.unmock('@data/hooks/useDataApi')

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

describe('native observation scopes', () => {
  it.each(['zh-cn', 'en-us'])('keeps scope, pagination and original currency visible in %s', async (language) => {
    await i18n.changeLanguage(language)
    const user = userEvent.setup()
    const row: LocalAgentUsageEntry = {
      id: 'turn',
      sessionId: 'session',
      sessionName: 'Session One',
      agentName: 'Agent One',
      model: null,
      reportedAt: 100,
      scope: 'turn',
      cost: null,
      summary: {
        nativeSessionId: 'native',
        model: null,
        reportedAt: 100,
        correlation: 'unknown',
        usage: { inputTokens: 700, outputTokens: 300, totalTokens: 1000 }
      }
    }
    mockDataApiService.get.mockImplementation(async (_path, options) => {
      if (options?.query?.scope === 'session-cost')
        return {
          items: [
            { ...row, id: 'tiny', scope: 'session-cost', cost: { amount: 0.00000001, currency: 'EUR' }, summary: null },
            { ...row, id: 'unknown', scope: 'session-cost', agentName: 'Unknown cost', cost: null, summary: null }
          ]
        }
      return options?.query?.cursor
        ? {
            items: [
              { ...row, id: 'legacy', scope: 'legacy-turn', agentName: 'Legacy Agent', summary: null, legacyTokens: 5 }
            ]
          }
        : { items: [row], nextCursor: '100:turn:turn' }
    })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <LocalAgentUsage range={{ from: 90, to: 110 }} />
      </SWRConfig>
    )
    expect(await screen.findByText('Agent One')).toBeVisible()
    expect(screen.getByText(i18n.t('common.unknown'))).toBeVisible()
    await user.click(screen.getByRole('button', { name: i18n.t('settings.usage.explore.loadMore') }))
    expect(await screen.findByText('Legacy Agent')).toBeVisible()
    await user.click(screen.getByRole('radio', { name: i18n.t('settings.usage.local.sessionCost') }))
    const costCell = await screen.findByText(
      new Intl.NumberFormat(language, { style: 'currency', currency: 'EUR', maximumSignificantDigits: 6 }).format(
        0.00000001
      )
    )
    expect(costCell).toBeVisible()
    const unknownRow = (await screen.findByText('Unknown cost')).closest('tr')!
    expect(within(unknownRow).getByText(i18n.t('chat.message.token_details.unavailable'))).toBeVisible()
    expect(screen.queryByText('Legacy Agent')).toBeNull()
    expect(screen.getByText(i18n.t('settings.usage.local.costHint'))).toBeVisible()
  })
})
