import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import type { AppErrorDetailRequest, InlineErrorDetailInput } from '@renderer/services/AppErrorDetailService'

const mocks = vi.hoisted(() => ({
  built: 0,
  factoryCalls: 0,
  open: vi.fn<(request: AppErrorDetailRequest) => Promise<'opened'>>().mockResolvedValue('opened'),
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
      const message = input.error instanceof Error ? input.error.message : ''
      return {
        context: {
          id: `fault-${mocks.built}`,
          message,
          occurredAt: '2026-01-01T00:00:00.000Z',
          operation: input.operation,
          source: input.source
        }
      }
    },
    appErrorDetailService: { openAppErrorDetail: mocks.open }
  }
})

import { ErrorDetailAction } from '../ErrorDetailAction'

describe('ErrorDetailAction occurrence identity', () => {
  it('keeps one occurrence id when a click races the detail preload', async () => {
    const user = userEvent.setup()
    const error = new Error('disk full')
    const view = render(<ErrorDetailAction error={error} operation="file.delete" source="files" />)
    view.rerender(<ErrorDetailAction error={error} operation="file.delete" source="files" />)

    await vi.waitFor(() => {
      expect(mocks.factoryCalls).toBe(1)
    })
    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))
    await act(async () => {
      mocks.release()
    })
    await vi.waitFor(() => {
      expect(mocks.open).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: i18n.t('error.details') }))

    expect(mocks.built).toBe(1)
    expect(mocks.open).toHaveBeenCalledTimes(2)
    expect(mocks.open.mock.calls[0]?.[0]).toEqual(mocks.open.mock.calls[1]?.[0])
    expect(mocks.open.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ context: expect.objectContaining({ id: 'fault-1', message: 'disk full' }) })
    )
  })
})
