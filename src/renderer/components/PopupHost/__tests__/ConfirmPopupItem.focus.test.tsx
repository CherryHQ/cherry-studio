import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { POPUP_EXIT_MS, popup, popupService } from '@renderer/services/popup'

import { PopupHost } from '../index'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal())
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

afterEach(() => {
  cleanup()
  vi.useFakeTimers()
  for (const entry of popupService.getSnapshot()) {
    popupService.settle(entry.instanceId, false)
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

it.each([
  ['{Enter}', true],
  ['{Escape}', false]
] as const)('focuses confirmation and resolves %s as %s', async (key, result) => {
  const user = userEvent.setup()
  render(<PopupHost />)
  let answer!: Promise<boolean>
  act(() => {
    answer = popup.confirm({
      title: 'Clear messages',
      content: 'Clear all messages in this conversation?',
      okText: 'Confirm',
      cancelText: 'Cancel',
      autoFocusConfirm: true
    })
  })

  expect(await screen.findByRole('button', { name: 'Confirm' })).toHaveFocus()
  await user.keyboard(key)
  await expect(answer).resolves.toBe(result)
})

it('preserves cancel focus when confirmation autofocus is not requested', async () => {
  render(<PopupHost />)
  act(() => {
    void popup.confirm({
      title: 'Clear messages',
      content: 'Clear all messages?',
      okText: 'Confirm',
      cancelText: 'Cancel'
    })
  })

  expect(await screen.findByRole('button', { name: 'Cancel' })).toHaveFocus()
})
