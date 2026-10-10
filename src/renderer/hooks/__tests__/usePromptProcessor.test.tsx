import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as PromptUtilsModule from '@renderer/utils/prompt'

vi.mock('@renderer/utils/prompt', async (importOriginal) => {
  const actual = await importOriginal<typeof PromptUtilsModule>()

  return {
    ...actual,
    replacePromptVariables: vi.fn()
  }
})

import { replacePromptVariables } from '@renderer/utils/prompt'

import { usePromptProcessor } from '../usePromptProcessor'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('usePromptProcessor', () => {
  beforeEach(() => {
    vi.mocked(replacePromptVariables).mockReset()
  })

  it('returns the current raw prompt while processing a changed model', async () => {
    const oldRequest = createDeferred<string>()
    const newRequest = createDeferred<string>()
    vi.mocked(replacePromptVariables).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const prompt = 'You are {{model_name}}.'
    const { rerender, result } = renderHook(
      ({ modelName }: { modelName: string }) => usePromptProcessor({ prompt, modelName }),
      { initialProps: { modelName: 'Old Model' } }
    )

    await act(async () => {
      oldRequest.resolve('You are Old Model.')
    })
    expect(result.current).toBe('You are Old Model.')

    rerender({ modelName: 'New Model' })

    expect(result.current).toBe(prompt)

    await act(async () => {
      newRequest.resolve('You are New Model.')
    })
    expect(result.current).toBe('You are New Model.')
  })

  it('does not let an older request overwrite the latest processed prompt', async () => {
    const oldRequest = createDeferred<string>()
    const newRequest = createDeferred<string>()
    vi.mocked(replacePromptVariables).mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise)
    const prompt = 'You are {{model_name}}.'
    const { rerender, result } = renderHook(
      ({ modelName }: { modelName: string }) => usePromptProcessor({ prompt, modelName }),
      { initialProps: { modelName: 'Old Model' } }
    )

    rerender({ modelName: 'New Model' })
    await act(async () => {
      newRequest.resolve('You are New Model.')
    })
    expect(result.current).toBe('You are New Model.')

    await act(async () => {
      oldRequest.resolve('You are Old Model.')
    })
    expect(result.current).toBe('You are New Model.')
  })
})
