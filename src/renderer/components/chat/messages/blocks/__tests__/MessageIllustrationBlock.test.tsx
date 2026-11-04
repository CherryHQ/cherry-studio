import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { IllustrationData } from '@shared/data/types/illustration'

import MessageIllustrationBlock from '../MessageIllustrationBlock'

const actions = vi.hoisted(() => ({ retryIllustration: vi.fn(), cancelIllustration: vi.fn(), notifyError: vi.fn() }))
vi.mock('../../MessageListProvider', () => ({ useMessageListActions: () => actions }))
vi.mock('../MessageImageBlock', () => ({ default: () => <img alt="Generated illustration" /> }))
const target = { topicId: 'topic', messageId: 'reply', id: 'image' }
const pending: IllustrationData = { id: target.id, revision: 1, status: 'generating', prompt: 'hidden bird prompt' }
let event: ((payload: unknown) => void) | undefined

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.mocked(window.api.ipcApi.request).mockResolvedValue({ ok: true, data: pending })
  vi.mocked(window.api.ipcApi.on).mockImplementation((_name, handler) => {
    event = handler
    return () => {
      event = undefined
    }
  })
  actions.retryIllustration.mockReset()
  actions.cancelIllustration.mockReset()
})

// Catches stale stream snapshots reverting a late completed image back to its spinner.
it('shows a placeholder, replaces it on completion, and ignores older task events', async () => {
  render(<MessageIllustrationBlock target={target} data={pending} />)
  expect(screen.getByRole('status')).toHaveTextContent('Generating illustration')
  expect(screen.queryByText(pending.prompt)).not.toBeInTheDocument()
  await waitFor(() => expect(event).toBeDefined())
  act(() =>
    event?.({ ...target, data: { ...pending, revision: 3, status: 'ready', files: [{ id: 'file', name: 'bird' }] } })
  )
  expect(screen.getByRole('img', { name: 'Generated illustration' })).toBeInTheDocument()
  act(() => event?.({ ...target, data: { ...pending, revision: 2 } }))
  expect(screen.getByRole('img', { name: 'Generated illustration' })).toBeInTheDocument()
  expect(actions.retryIllustration).not.toHaveBeenCalled()
})

it('keeps the image prompt collapsed beside the image until the user expands it', async () => {
  const user = userEvent.setup()
  const prompt = 'A **bold** bird\non a branch'
  render(
    <MessageIllustrationBlock
      target={target}
      data={{ ...pending, status: 'ready', prompt, files: [{ id: 'file', name: 'bird' }] }}
    />
  )

  expect(screen.getByRole('img', { name: 'Generated illustration' })).toBeInTheDocument()
  expect(screen.queryByText(prompt, { exact: true })).not.toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: 'Show prompt' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await user.click(toggle)
  expect(screen.getByText(prompt, { normalizer: (text) => text })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Hide prompt' })).toHaveAttribute('aria-expanded', 'true')

  await user.click(screen.getByRole('button', { name: 'Hide prompt' }))
  expect(screen.queryByText(prompt, { normalizer: (text) => text })).not.toBeInTheDocument()
})

it('offers explicit cancellation and retry without generating on mount', async () => {
  const user = userEvent.setup()
  const view = render(<MessageIllustrationBlock target={target} data={pending} />)
  await user.click(screen.getByRole('button', { name: 'Show prompt' }))
  expect(screen.getByText(pending.prompt)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(actions.cancelIllustration).toHaveBeenCalledWith(target)
  view.rerender(
    <MessageIllustrationBlock
      target={target}
      data={{ ...pending, revision: 4, status: 'error', error: 'generation' }}
    />
  )
  expect(screen.getByRole('status')).toHaveTextContent('Illustration failed')
  expect(screen.getByText(pending.prompt)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(actions.retryIllustration).toHaveBeenCalledWith(target)
})
