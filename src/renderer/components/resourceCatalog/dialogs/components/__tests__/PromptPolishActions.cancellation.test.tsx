import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

const mocks = vi.hoisted(() => ({
  fetchGenerate: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn(),
  openSettingsTab: vi.fn(),
  defaultModel: null as null | { id: string; name: string; providerId: string }
}))

const TEST_DEFAULT_MODEL = {
  id: 'openai::gpt-4o',
  name: 'GPT-4o',
  providerId: 'openai'
}

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError }
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))
vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ defaultModel: mocks.defaultModel })
}))
vi.mock('@renderer/utils/aiGeneration', () => ({
  fetchGenerate: mocks.fetchGenerate
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'common.cancel') return 'Cancel'
      if (key === 'common.undo') return 'Undo'
      if (key === 'error.request_timeout') return 'Request timed out'
      if (key === 'library.config.prompt.polish') return 'Polish prompt'
      if (key === 'library.config.prompt.generate') return 'Generate prompt'
      if (key === 'library.config.prompt.polish_with_model') return `Polish prompt · ${String(options?.model ?? '')}`
      if (key === 'library.config.prompt.generate_with_model')
        return `Generate prompt · ${String(options?.model ?? '')}`
      if (key === 'library.config.prompt.cancel_with_model') return `Cancel · ${String(options?.model ?? '')}`
      if (key === 'library.config.prompt.open_default_model_settings') return 'Open default model settings'
      if (key === 'library.config.prompt.no_default_model') return 'No default model'
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
  mocks.defaultModel = { ...TEST_DEFAULT_MODEL }
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

    await user.click(screen.getByRole('button', { name: 'Polish prompt · GPT-4o' }))
    await screen.findByRole('button', { name: 'Cancel · GPT-4o' })

    const firstSignal = mocks.fetchGenerate.mock.calls[0][0].signal as AbortSignal
    await user.click(screen.getByRole('button', { name: 'Cancel · GPT-4o' }))

    expect(firstSignal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Polish prompt · GPT-4o' })).toBeInTheDocument()
    expect(mocks.toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Polish prompt · GPT-4o' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('Retried prompt'))

    await act(async () => first.resolve('Late cancelled response'))
    expect(onChange).not.toHaveBeenCalledWith('Late cancelled response')
  })

  it('ends a never-resolving request at the deadline even if the request promise ignores abort', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mocks.fetchGenerate.mockReturnValueOnce(new Promise<string>(() => undefined))
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Polish prompt · GPT-4o' }))
    expect(screen.getByRole('button', { name: 'Cancel · GPT-4o' })).toBeInTheDocument()
    const signal = mocks.fetchGenerate.mock.calls[0][0].signal as AbortSignal

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })

    expect(signal.aborted).toBe(true)
    expect(mocks.toastError).toHaveBeenCalledWith({
      title: 'library.config.prompt.polish_failed_title',
      description: 'Request timed out',
      action: {
        label: 'Open default model settings',
        onClick: expect.any(Function)
      }
    })
    expect(screen.getByRole('button', { name: 'Polish prompt · GPT-4o' })).toBeInTheDocument()
    expect(mocks.loggerError).not.toHaveBeenCalled()

    const toast = mocks.toastError.mock.calls[0]?.[0] as { action: { onClick: () => void } }
    toast.action.onClick()
    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/model')
  })
})
