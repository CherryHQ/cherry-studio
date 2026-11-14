import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import PlantUmlPreview from '../PlantUmlPreview'

const mocks = vi.hoisted(() => ({
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as ((content: string, container: HTMLDivElement) => Promise<void>) | undefined
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (
    _content: string,
    renderFunction: (content: string, container: HTMLDivElement) => Promise<void>
  ) => {
    mocks.renderFunction = renderFunction
    return {
      containerRef: { current: null },
      error: null,
      isLoading: false,
      triggerRender: vi.fn(),
      cancelRender: vi.fn(),
      clearError: vi.fn(),
      setLoading: vi.fn()
    }
  }
}))

vi.mock('../ImagePreviewLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('../utils', () => ({
  renderSvgInShadowHost: mocks.renderSvgInShadowHost
}))

describe('PlantUmlPreview', () => {
  const content = '@startuml\nA -> B\n@enduml'
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.renderFunction = undefined
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches and renders the encoded PlantUML diagram', async () => {
    const container = document.createElement('div')
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<svg><text>diagram</text></svg>')
    })

    render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    await mocks.renderFunction?.(content, container)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\/[A-Za-z0-9_-]+$/)
    )
    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith('<svg><text>diagram</text></svg>', container)
  })

  it.each([
    { status: 400, statusText: 'Bad Request', message: () => i18n.t('preview.plantuml.bad_request', { status: 400 }) },
    {
      status: 503,
      statusText: 'Service Unavailable',
      message: () => i18n.t('preview.plantuml.server', { status: 503 })
    },
    {
      status: 418,
      statusText: "I'm a teapot",
      message: () => i18n.t('preview.plantuml.other', { status: 418, statusText: "I'm a teapot" })
    }
  ])('reports the user-facing error for a $status response', async ({ status, statusText, message }) => {
    fetchMock.mockResolvedValue({ ok: false, status, statusText })
    render(<PlantUmlPreview>{content}</PlantUmlPreview>)

    await expect(mocks.renderFunction?.(content, document.createElement('div'))).rejects.toThrow(message())
  })
})
