import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

const mocks = vi.hoisted(() => ({
  built: 0,
  factoryCalls: 0,
  last: '',
  open: vi.fn(async () => 'opened' as const),
  release: (() => undefined) as () => void
}))

vi.mock('@renderer/services/AppErrorDetailService', async () => {
  mocks.factoryCalls += 1
  await new Promise<void>((resolve) => {
    mocks.release = resolve
  })
  return {
    buildInlineErrorDetailRequest: (input: InlineErrorDetailInput) => {
      mocks.built += 1
      mocks.last = input.error instanceof Error ? input.error.message : ''
      return {
        context: {
          id: input.operation,
          message: mocks.last,
          occurredAt: '2026-01-01T00:00:00.000Z',
          operation: input.operation,
          source: input.source
        },
        error: { name: 'Error', message: mocks.last, stack: '' }
      }
    },
    appErrorDetailService: { openAppErrorDetail: mocks.open }
  }
})

import { ErrorDetailAction } from '../ErrorDetailAction'

describe('ErrorDetailAction presentation snapshot', () => {
  it('does not open a slow snapshot after the fault changes', async () => {
    const user = userEvent.setup()
    const view = render(<ErrorDetailAction error={new Error('first fault')} operation="file.delete" source="files" />)
    view.rerender(<ErrorDetailAction error={new Error('second fault')} operation="file.delete" source="files" />)

    await vi.waitFor(() => {
      expect(mocks.factoryCalls).toBe(1)
    })
    await act(async () => {
      mocks.release()
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    await vi.waitFor(() => {
      expect(mocks.open).toHaveBeenCalledTimes(1)
    })
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ message: 'second fault' }),
        error: expect.objectContaining({ message: 'second fault' })
      })
    )
  })
})
