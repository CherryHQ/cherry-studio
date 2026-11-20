import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { ipcApi } from '@renderer/ipc'

import { ThemeSubmissionDialog } from '../ThemeSubmissionDialog'

vi.mock('@cherrystudio/ui', async (original) => original())
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn() } }))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps the draft after failure and retries it with the original submission key', async () => {
  await i18next.changeLanguage('en-us')
  const request = vi
    .spyOn(ipcApi, 'request')
    .mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce(undefined)
  const user = userEvent.setup()
  render(<ThemeSubmissionDialog />)
  await user.click(screen.getByRole('button', { name: 'Submit a theme' }))
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Night')
  await user.type(screen.getByRole('textbox', { name: /^Author/ }), 'Editor')
  await user.type(screen.getByRole('textbox', { name: /^CSS \*/ }), 'body {{ color: blue }')
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:test-preview'
      }
      static revokeObjectURL() {}
    }
  )
  const file = Object.assign(new File(['png'], 'night.png', { type: 'image/png' }), {
    arrayBuffer: async () => Uint8Array.of(1, 2, 3).buffer
  })
  await user.click(screen.getByRole('radio', { name: /^Dark/ }))
  await user.upload(screen.getByLabelText(/Dark mode preview/), file)
  expect(screen.getByRole('img', { name: 'Dark mode preview' })).toBeVisible()
  await user.click(screen.getByRole('radio', { name: 'Light' }))
  expect(screen.queryByRole('img')).toBeNull()
  await user.click(screen.getByRole('radio', { name: /^Dark/ }))
  expect(screen.getByRole('img', { name: 'Dark mode preview' })).toBeVisible()
  const button = screen.getByRole('button', { name: 'Submit' })
  await user.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not submit')
  await user.click(button)
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[0]).toEqual(request.mock.calls[1])
  expect(request.mock.calls[1]).toEqual([
    'theme.marketplace.submit',
    expect.objectContaining({
      name: 'Night',
      author: 'Editor',
      code: 'body { color: blue }',
      light_pic: null,
      dark_pic: expect.objectContaining({ name: 'night.png' }),
      key: expect.any(String)
    })
  ])
  expect(screen.queryByRole('dialog')).toBeNull()
})
