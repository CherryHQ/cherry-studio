import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeAll, expect, it, vi } from 'vitest'

import { dataApiService } from '@renderer/data/DataApiService'
import { createSWRTestWrapper } from '@renderer/data/hooks/__tests__/testUtils'
import en from '@renderer/i18n/locales/en-us.json'

import { TaskSessionPickerField } from '../TaskFormDialog'

vi.unmock('@cherrystudio/ui')
vi.unmock('@data/hooks/useDataApi')
const i18n = createInstance()
beforeAll(async () => {
  HTMLElement.prototype.hasPointerCapture ??= () => false
  HTMLElement.prototype.setPointerCapture ??= () => {}
  HTMLElement.prototype.releasePointerCapture ??= () => {}
  HTMLElement.prototype.scrollIntoView ??= () => {}
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, keySeparator: false })
})

it('selects a conversation from a later cursor page', async () => {
  vi.spyOn(dataApiService, 'get').mockImplementation(async (_path, options) => {
    const query = (options as { query?: { cursor?: string } })?.query
    return {
      items: [
        {
          id: query?.cursor ? 'later' : 'first',
          agentId: 'a',
          name: query?.cursor ? 'Later conversation' : 'First conversation'
        }
      ],
      nextCursor: query?.cursor ? null : 'next'
    } as never
  })
  const change = vi.fn()
  const { Wrapper } = createSWRTestWrapper()
  render(
    <Wrapper>
      <I18nextProvider i18n={i18n}>
        <TaskSessionPickerField agentId="a" value={null} onChange={change} />
      </I18nextProvider>
    </Wrapper>
  )
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'More' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument())
  await user.click(screen.getByRole('combobox', { name: 'Session to reuse' }))
  await user.click(await screen.findByRole('option', { name: 'Later conversation' }))
  expect(change).toHaveBeenCalledWith('later')
})

it('hides the former Agent conversations while the next Agent request is pending', async () => {
  vi.spyOn(dataApiService, 'get').mockImplementation(async (_path, query) => {
    if ((query as { query?: { agentId?: string } })?.query?.agentId === 'b') return new Promise(() => {})
    return { items: [{ id: 'first', agentId: 'a', name: 'Agent A conversation' }], nextCursor: null } as never
  })
  const { Wrapper } = createSWRTestWrapper()
  const field = (agentId: string) => (
    <Wrapper>
      <I18nextProvider i18n={i18n}>
        <TaskSessionPickerField agentId={agentId} value={null} onChange={vi.fn()} />
      </I18nextProvider>
    </Wrapper>
  )
  const { rerender } = render(field('a'))
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Session to reuse' }))
  expect(await screen.findByRole('option', { name: 'Agent A conversation' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  rerender(field('b'))
  await user.click(screen.getByRole('combobox', { name: 'Session to reuse' }))
  expect(screen.queryByRole('option', { name: 'Agent A conversation' })).not.toBeInTheDocument()
})
