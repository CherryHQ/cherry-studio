import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useAttachment } from '../useAttachment'

const translate = vi.hoisted(() => vi.fn((key: string) => key))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: translate })
}))

describe('useAttachment', () => {
  it('keeps the preview action stable when translation is unchanged', () => {
    const { result, rerender } = renderHook(() => useAttachment())
    const initialPreview = result.current.preview

    rerender()

    expect(result.current.preview).toBe(initialPreview)
  })
})
