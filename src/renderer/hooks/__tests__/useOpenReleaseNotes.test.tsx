// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openTab: vi.fn()
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({ openTab: mocks.openTab })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { useOpenReleaseNotes } from '../useOpenReleaseNotes'

describe('useOpenReleaseNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the bundled release notes in an app tab', () => {
    const { result } = renderHook(() => useOpenReleaseNotes())

    act(() => result.current())

    expect(mocks.openTab).toHaveBeenCalledWith('/app/release-notes', {
      title: 'settings.about.releases.title'
    })
  })
})
