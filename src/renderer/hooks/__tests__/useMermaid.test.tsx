import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

vi.mock('mermaid', () => ({
  default: {
    initialize() {
      throw 'engine missing'
    }
  }
}))

import { useMermaid } from '../useMermaid'

describe('useMermaid', () => {
  it('shows a translated init fallback and keeps the raw failure', async () => {
    const { result } = renderHook(() => useMermaid())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe(i18n.t('preview.mermaid.init_failed'))
    expect(result.current.cause).toBe('engine missing')
  })
})
