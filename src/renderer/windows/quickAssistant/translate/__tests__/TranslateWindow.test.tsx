import '@testing-library/jest-dom/vitest'

import { act, render, screen, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  targetLanguage: 'en-us',
  translateModel: { id: 'openai::gpt-4o' } as { id: string } | undefined,
  setTargetLanguage: vi.fn(),
  smoothOnUpdate: undefined as ((text: string) => void) | undefined,
  smoothReset: vi.fn<(text?: string) => void>(),
  smoothUpdate: vi.fn<(text: string, isComplete: boolean) => void>(),
  translateText:
    vi.fn<
      (
        text: string,
        targetLanguage: string,
        onResponse?: (text: string, isComplete: boolean) => void,
        signal?: AbortSignal
      ) => Promise<string>
    >(),
  t: vi.fn((key: string) => key)
}))

vi.mock('@cherrystudio/ui', () => ({
  Scrollbar: ({ children }: PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [state.targetLanguage, state.setTargetLanguage]
}))

vi.mock('@renderer/components/LanguageSelect', () => ({
  default: () => null
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useDefaultModel: () => ({ translateModel: state.translateModel })
}))

vi.mock('@renderer/hooks/useSmoothStream', () => ({
  useSmoothStream: ({ onUpdate }: { onUpdate: (text: string) => void }) => {
    state.smoothOnUpdate = onUpdate
    return {
      reset: (text = '') => {
        state.smoothReset(text)
        onUpdate(text)
      },
      update: state.smoothUpdate
    }
  }
}))

vi.mock('@renderer/utils/translate', () => ({
  translateText: (...args: Parameters<typeof state.translateText>) => state.translateText(...args)
}))

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: state.t })
}))

import TranslateWindow from '../TranslateWindow'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('TranslateWindow', () => {
  beforeEach(() => {
    state.targetLanguage = 'en-us'
    state.translateModel = { id: 'openai::gpt-4o' }
    state.setTargetLanguage.mockReset()
    state.smoothOnUpdate = undefined
    state.smoothReset.mockReset()
    state.smoothUpdate.mockReset()
    state.translateText.mockReset()
    state.t.mockClear()
  })

  it('buffers bursty translation frames before rendering them', async () => {
    state.translateText.mockImplementation((_text, _targetLanguage, onResponse) => {
      onResponse?.('bursty translation', false)
      return new Promise<string>(() => {})
    })

    render(<TranslateWindow text="hello" />)

    await waitFor(() => expect(state.smoothUpdate).toHaveBeenCalledWith('bursty translation', false))
    expect(state.smoothReset).toHaveBeenCalledWith('')
    expect(screen.queryByText('bursty translation')).not.toBeInTheDocument()

    act(() => state.smoothOnUpdate?.('smooth translation'))

    expect(screen.getByText('smooth translation')).toBeInTheDocument()
  })

  it('does not start another translation after the current request settles', async () => {
    const firstRequest = createDeferred<string>()
    state.translateText
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementation(() => new Promise<string>(() => {}))

    render(<TranslateWindow text="hello" />)

    await waitFor(() => expect(state.translateText).toHaveBeenCalledTimes(1))

    await act(async () => {
      firstRequest.resolve('你好')
      await firstRequest.promise
    })

    expect(state.translateText).toHaveBeenCalledTimes(1)
  })

  it('supersedes the active translation when the target language changes', async () => {
    const requests: Array<{ targetLanguage: string; signal?: AbortSignal }> = []
    state.translateText.mockImplementation((_text, targetLanguage, _onResponse, signal) => {
      requests.push({ targetLanguage, signal })
      return new Promise<string>(() => {})
    })

    const { rerender } = render(<TranslateWindow text="hello" />)
    await waitFor(() => expect(state.translateText).toHaveBeenCalledTimes(1))

    state.targetLanguage = 'zh-cn'
    rerender(<TranslateWindow text="hello" />)

    await waitFor(() => expect(state.translateText).toHaveBeenCalledTimes(2))
    expect(requests[0].signal?.aborted).toBe(true)
    expect(requests[1].targetLanguage).toBe('zh-cn')
  })

  it('cancels the active translation when the configured model becomes unavailable', async () => {
    let activeSignal: AbortSignal | undefined
    state.translateText.mockImplementation((_text, _targetLanguage, _onResponse, signal) => {
      activeSignal = signal
      return new Promise<string>(() => {})
    })

    const { rerender } = render(<TranslateWindow text="hello" />)
    await waitFor(() => expect(state.translateText).toHaveBeenCalledTimes(1))
    expect(activeSignal?.aborted).toBe(false)

    state.translateModel = undefined
    rerender(<TranslateWindow text="hello" />)

    await waitFor(() => expect(activeSignal?.aborted).toBe(true))
    expect(state.translateText).toHaveBeenCalledTimes(1)
  })
})
