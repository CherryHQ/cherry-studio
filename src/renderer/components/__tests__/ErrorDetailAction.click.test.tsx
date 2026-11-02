import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

const mocks = vi.hoisted(() => ({
  factoryCalls: 0,
  open: vi.fn(async () => 'opened' as const),
  release: (() => undefined) as () => void
}))

vi.mock('@renderer/services/AppErrorDetailService', async () => {
  mocks.factoryCalls += 1
  await new Promise<void>((resolve) => {
    mocks.release = resolve
  })
  return {
    buildInlineErrorDetailRequest: (input: InlineErrorDetailInput) => ({
      context: {
        id: input.operation,
        message: input.error instanceof Error ? input.error.message : '',
        occurredAt: '2026-01-01T00:00:00.000Z',
        operation: input.operation,
        source: input.source
      }
    }),
    appErrorDetailService: { openAppErrorDetail: mocks.open }
  }
})

import { ErrorDetailAction } from '../ErrorDetailAction'

describe('ErrorDetailAction click snapshot', () => {
  it('keeps the fault that was clicked while the detail chunk is still loading', async () => {
    const user = userEvent.setup()
    const view = render(<ErrorDetailAction error={new Error('first fault')} operation="file.delete" source="files" />)

    await vi.waitFor(() => {
      expect(mocks.factoryCalls).toBe(1)
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    view.rerender(<ErrorDetailAction error={new Error('second fault')} operation="file.delete" source="files" />)

    await act(async () => {
      mocks.release()
    })
    await vi.waitFor(() => {
      expect(mocks.open).toHaveBeenCalled()
    })

    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ message: 'first fault' }) })
    )
  })
})
