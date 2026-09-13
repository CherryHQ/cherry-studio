import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PopupInjectedProps } from '@renderer/services/popup'
import { popupService } from '@renderer/services/popup'

import { PopupHost } from '../../PopupHost'
import type { DoctorDialogParams } from '../DoctorDialog'

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('../DoctorDialog', () => ({
  DoctorDialog: (props: DoctorDialogParams & PopupInjectedProps<Record<string, never>>) => {
    return (
      <div>
        <span>{`${props.initialPanel}: ${props.initialDescription}`}</span>
        <button type="button" onClick={() => props.resolve({})}>
          Close Doctor boundary
        </button>
      </div>
    )
  }
}))

import DoctorPopup from '../DoctorPopup'

afterEach(async () => {
  cleanup()
  vi.useFakeTimers()
  await act(async () => {
    for (const entry of [...popupService.getSnapshot()]) popupService.settle(entry.instanceId, {})
    await vi.runAllTimersAsync()
  })
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('DoctorPopup', () => {
  it('loads the Doctor dialog with its public parameters and resolves through the popup host', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)

    let result: Promise<Record<string, never>> | undefined
    act(() => {
      result = DoctorPopup.show({ initialPanel: 'report', initialDescription: 'diagnostic context' })
    })

    expect(await screen.findByText('report: diagnostic context')).toBeVisible()
    await user.click(await screen.findByRole('button', { name: 'Close Doctor boundary' }))

    await expect(result).resolves.toEqual({})
  })
})
