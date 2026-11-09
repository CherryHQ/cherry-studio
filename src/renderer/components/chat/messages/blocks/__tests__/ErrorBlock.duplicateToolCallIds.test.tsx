import { render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'

import ErrorBlock from '../ErrorBlock'

vi.mock('../../MessageListProvider', () => ({
  useMessageListActions: () => ({})
}))

it('shows the full duplicate id and both replay positions using real translations', async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'en-US',
    fallbackLng: false,
    keySeparator: false,
    resources: { 'en-US': { translation: enUS } },
    interpolation: { escapeValue: false }
  })
  const toolCallId = 'call_00_full_duplicate_tool_call_id'
  const locations = 'messages[0].content[1], messages[2].content[0]'
  render(
    <I18nextProvider i18n={i18n}>
      <ErrorBlock
        partId="assistant-part-0"
        message={{
          id: 'assistant',
          role: 'assistant',
          topicId: 'topic',
          createdAt: '2026-01-01T00:00:00.000Z',
          status: 'success'
        }}
        error={{
          name: 'DuplicateToolCallIdError',
          message: `Duplicate tool call id '${toolCallId}' in replayed history at ${locations}.`,
          stack: null,
          i18nKey: 'duplicate_tool_call_id',
          detailI18nKey: 'duplicate_tool_call_id_detail',
          detailI18nValues: { toolCallId, locations }
        }}
      />
    </I18nextProvider>
  )
  expect(
    screen.getByText(
      `Duplicate tool call id ${toolCallId} appears more than once in the replayed history (${locations}).`
    )
  ).toBeInTheDocument()
  expect(screen.queryByText(/error\.duplicate_tool_call_id|duplicate_tool_call_id_detail|\{\{/)).not.toBeInTheDocument()
})
