import { dialog } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'

import { StartupRecoveryCanceled, withStartupRecoveryProgress } from '../startupRecoveryProgress'

afterEach(() => vi.restoreAllMocks())

it('keeps the progress dialog open until work completes and dismisses it afterward', async () => {
  let finish!: (value: number) => void
  let signal!: AbortSignal
  vi.mocked(dialog.showMessageBox).mockImplementation(
    (options) =>
      new Promise((resolve) => {
        signal = options.signal!
        signal.addEventListener('abort', () => resolve({ response: 0, checkboxChecked: false }))
      })
  )
  const result = withStartupRecoveryProgress(
    'en-US',
    () =>
      new Promise<number>((resolve) => {
        finish = resolve
      })
  )
  await Promise.resolve()
  expect(signal.aborted).toBe(false)
  finish(42)
  expect(await result).toBe(42)
  expect(signal.aborted).toBe(true)
})

it('aborts ongoing helper work and reports cancellation rather than success', async () => {
  let cancel!: () => void
  vi.mocked(dialog.showMessageBox).mockImplementation(
    () =>
      new Promise((resolve) => {
        cancel = () => resolve({ response: 0, checkboxChecked: false })
      })
  )
  const result = withStartupRecoveryProgress(
    'en-US',
    (signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('helper aborted')))
      })
  )
  const rejected = expect(result).rejects.toBeInstanceOf(StartupRecoveryCanceled)
  await Promise.resolve()
  cancel()
  await rejected
})
