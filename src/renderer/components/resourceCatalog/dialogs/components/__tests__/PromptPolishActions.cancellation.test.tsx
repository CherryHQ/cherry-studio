import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const mocks = vi.hoisted(() => ({
  fetchGenerate: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))
vi.mock('@renderer/utils/aiGeneration', () => ({
  fetchGenerate: mocks.fetchGenerate
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'common.cancel') return 'Cancel'
      if (key === 'common.undo') return 'Undo'
      if (key === 'error.request_timeout') return 'Request timed out'
      if (key === 'library.config.prompt.polish') return 'Polish prompt'
      if (key === 'library.config.prompt.generate') return 'Generate prompt'
      return key
    }
  })
}))

import { PromptPolishActions } from '../PromptPolishActions'

function deferredResponse() {
  let resolve: (value: string) => void = () => undefined
  const promise = new Promise<string>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }) {
  return (
    <PromptPolishActions
      value="Original prompt"
      emptyValueSystemPrompt="Generate a prompt"
      existingValueSystemPrompt="Polish the prompt"
      onChange={onChange}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PromptPolishActions cancellation', () => {
  it('lets the user cancel immediately and retry while the old response is still pending', async () => {
    const user = userEvent.setup()
    const first = deferredResponse()
    mocks.fetchGenerate.mockReturnValueOnce(first.promise).mockResolvedValueOnce('Retried prompt')
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Polish prompt' }))
    await screen.findByRole('button', { name: 'Cancel' })

    const firstSignal = mocks.fetchGenerate.mock.calls[0][0].signal as AbortSignal
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(firstSignal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toBeInTheDocument()
    expect(mocks.toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Polish prompt' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Retried prompt'))

    await act(async () => first.resolve('Late cancelled response'))
    expect(onChange).not.toHaveBeenCalledWith('Late cancelled response')
  })

  it('ends a never-resolving request at the deadline even if the request promise ignores abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mocks.fetchGenerate.mockReturnValueOnce(new Promise<string>(() => undefined))
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt' }))
    const signal = mocks.fetchGenerate.mock.calls[0][0].signal as AbortSignal

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(signal.aborted).toBe(true)
    expect(mocks.toastError).toHaveBeenCalledWith({
      title: 'library.config.prompt.polish_failed_title',
      description: 'Request timed out'
    })
    expect(screen.getByRole('button', { name: 'Polish prompt' })).toBeInTheDocument()
    expect(mocks.loggerError).not.toHaveBeenCalled()
  })
})
