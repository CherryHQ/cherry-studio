import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

const detail = vi.hoisted(() => ({ open: vi.fn(async () => 'opened' as const) }))

vi.mock('@renderer/services/AppErrorDetailService', () => ({
  buildInlineErrorDetailRequest: (input: InlineErrorDetailInput) => ({
    context: { id: 'fault', message: '', occurredAt: '', operation: input.operation, source: input.source },
    error: input.error
  }),
  appErrorDetailService: { openAppErrorDetail: detail.open }
}))

import MessageErrorBoundary from '../MessageErrorBoundary'

const renderError = new Error('markdown parser exploded')
const Bomb = (): never => {
  throw renderError
}

describe('MessageErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    detail.open.mockClear()
  })

  it('shows a localized render failure without the raw error text and opens its detail', async () => {
    const user = userEvent.setup()
    render(
      <MessageErrorBoundary>
        <Bomb />
      </MessageErrorBoundary>
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(i18n.t('error.render.title'))
    expect(alert).toHaveTextContent(i18n.t('error.render.description'))
    expect(alert).not.toHaveTextContent(renderError.message)

    await user.click(screen.getByRole('button', { name: i18n.t('common.detail') }))
    await vi.waitFor(() =>
      expect(detail.open).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ source: 'chat.message', operation: 'message.render' }),
          error: renderError
        })
      )
    )
  })
})
