import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlantUmlPreview, { PLANTUML_HOST } from '../PlantUmlPreview'

const mocks = vi.hoisted(() => ({
  renderSvgInShadowHost: vi.fn(),
  renderFunction: undefined as ((content: string, container: HTMLDivElement) => Promise<void>) | undefined,
  lastDebouncedValue: undefined as string | undefined,
  lastShouldRender: undefined as (() => boolean) | undefined
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => (params?.host ? `${key}:${params.host}` : key)
  })
}))

vi.mock('../hooks/useDebouncedRender', () => ({
  useDebouncedRender: (
    content: string,
    renderFunction: (content: string, container: HTMLDivElement) => Promise<void>,
    options?: { shouldRender?: () => boolean }
  ) => {
    mocks.lastDebouncedValue = content
    mocks.renderFunction = renderFunction
    mocks.lastShouldRender = options?.shouldRender
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
    mocks.lastDebouncedValue = undefined
    mocks.lastShouldRender = undefined
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires explicit user confirmation disclosing www.plantuml.com before rendering remotely', () => {
    render(<PlantUmlPreview>{content}</PlantUmlPreview>)

    expect(screen.getByText(`code_block.preview.plantuml_remote_notice:${PLANTUML_HOST}`)).toBeInTheDocument()
    expect(mocks.lastDebouncedValue).toBe('')
    expect(mocks.lastShouldRender?.()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'code_block.preview.plantuml_remote_render' }))

    expect(mocks.lastDebouncedValue).toBe(content)
    expect(mocks.lastShouldRender?.()).toBe(true)
    expect(screen.queryByRole('button', { name: 'code_block.preview.plantuml_remote_render' })).not.toBeInTheDocument()
  })

  it('fetches and renders the encoded PlantUML diagram after user confirmation', async () => {
    const container = document.createElement('div')
    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<svg><text>diagram</text></svg>')
    })

    render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    fireEvent.click(screen.getByRole('button', { name: 'code_block.preview.plantuml_remote_render' }))
    await mocks.renderFunction?.(content, container)

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\/[A-Za-z0-9_-]+$/)
    )
    expect(mocks.renderSvgInShadowHost).toHaveBeenCalledWith('<svg><text>diagram</text></svg>', container)
  })

  it.each([
    {
      status: 400,
      statusText: 'Bad Request',
      message:
        'Diagram rendering failed (400): This is likely due to a syntax error in the diagram. Please check your code.'
    },
    {
      status: 503,
      statusText: 'Service Unavailable',
      message: 'Diagram rendering failed (503): The PlantUML server is temporarily unavailable. Please try again later.'
    },
    {
      status: 418,
      statusText: "I'm a teapot",
      message: "Diagram rendering failed, server returned: 418 I'm a teapot"
    }
  ])('reports the user-facing error for a $status response', async ({ status, statusText, message }) => {
    fetchMock.mockResolvedValue({ ok: false, status, statusText })
    render(<PlantUmlPreview>{content}</PlantUmlPreview>)
    fireEvent.click(screen.getByRole('button', { name: 'code_block.preview.plantuml_remote_render' }))

    await expect(mocks.renderFunction?.(content, document.createElement('div'))).rejects.toThrow(message)
  })
})
