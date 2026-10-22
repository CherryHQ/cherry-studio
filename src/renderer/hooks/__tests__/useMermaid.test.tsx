import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(() => {
    throw 'engine missing'
  })
}))

vi.mock('mermaid', () => ({
  default: {
    initialize: () => mermaidMock.initialize()
  }
}))

import { useMermaid } from '../useMermaid'

describe('useMermaid', () => {
  beforeEach(() => {
    mermaidMock.initialize.mockReset()
    mermaidMock.initialize.mockImplementation(() => {
      throw 'engine missing'
    })
  })

  it('shows a translated init fallback and keeps the raw failure', async () => {
    const { result } = renderHook(() => useMermaid())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe(i18n.t('preview.mermaid.init_failed'))
    expect(result.current.cause).toBe('engine missing')
  })

  it('shows the translated init failure when mermaid throws an Error', async () => {
    const failure = new Error('library exploded')
    mermaidMock.initialize.mockImplementation(() => {
      throw failure
    })
    const { result } = renderHook(() => useMermaid())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe(i18n.t('preview.mermaid.init_failed'))
    expect(result.current.cause).toBe(failure)
  })
})
