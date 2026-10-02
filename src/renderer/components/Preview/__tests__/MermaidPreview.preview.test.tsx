import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import MermaidPreview from '../MermaidPreview'

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  render: vi.fn(),
  getConfig: vi.fn(),
  showImagePreview: vi.fn(),
  forceRenderKey: 0
}))

vi.mock('@renderer/hooks/useMermaid', () => {
  const mermaid = {
    parse: mocks.parse,
    render: mocks.render,
    mermaidAPI: { getConfig: mocks.getConfig }
  }
  return {
    useMermaid: () => ({
      mermaid,
      isLoading: false,
      error: null,
      forceRenderKey: mocks.forceRenderKey
    })
  }
})

vi.mock('@renderer/services/ImagePreviewService', () => ({
  ImagePreviewService: { show: mocks.showImagePreview }
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'light' })
}))

type PreviewCall = [SVGElement, { format: string; backgroundColor?: string }]

const previewPair = (call: PreviewCall, diagram: string, background: string) => {
  const [svg, options] = call
  expect(svg.textContent).toContain(diagram)
  expect(options.format).toBe('svg')

  const canvas = document.createElement('div')
  canvas.style.backgroundColor = options.backgroundColor ?? 'transparent'
  expect(getComputedStyle(canvas).backgroundColor).toBe(background)
}

const waitForDiagram = async (count = 1) => {
  await waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(count))
  await act(async () => {})
}

describe('MermaidPreview preview action', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.forceRenderKey = 0
    mocks.parse.mockResolvedValue(true)
    mocks.showImagePreview.mockResolvedValue(undefined)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 640 } as DOMRect)
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(480)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['light', 'white', 'rgb(255, 255, 255)'],
    ['dark', '#333', 'rgb(51, 51, 51)']
  ])('opens the %s diagram with its rendered canvas', async (theme, background, expectedCanvas) => {
    const user = userEvent.setup()
    mocks.getConfig.mockReturnValue({ themeVariables: { background } })
    mocks.render.mockResolvedValue({ svg: `<svg><text>${theme} diagram</text></svg>` })

    render(<MermaidPreview enableToolbar>{`flowchart LR\n  A --> B`}</MermaidPreview>)
    await waitForDiagram()
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }))

    await waitFor(() => expect(mocks.showImagePreview).toHaveBeenCalledOnce())
    previewPair(mocks.showImagePreview.mock.lastCall as PreviewCall, `${theme} diagram`, expectedCanvas)
  })

  it('opens a directed dark diagram with the canvas selected by that directive', async () => {
    const user = userEvent.setup()
    let background = 'white'
    mocks.getConfig.mockImplementation(() => ({ themeVariables: { background } }))
    mocks.parse.mockImplementation(async (content: string) => {
      background = content.includes('"theme": "dark"') ? '#333' : 'white'
      return true
    })
    mocks.render.mockImplementation(async (_id: string, content: string) => ({
      svg: `<svg><text>${content.includes('"theme": "dark"') ? 'directed dark diagram' : 'plain diagram'}</text></svg>`
    }))

    render(<MermaidPreview enableToolbar>{'%%{init: {"theme": "dark"}}%%\nflowchart LR\n  A --> B'}</MermaidPreview>)
    await waitForDiagram()
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }))

    await waitFor(() => expect(mocks.showImagePreview).toHaveBeenCalledOnce())
    previewPair(mocks.showImagePreview.mock.lastCall as PreviewCall, 'directed dark diagram', 'rgb(51, 51, 51)')
  })

  it('opens concurrent diagrams with their own SVG and canvas pairs', async () => {
    const user = userEvent.setup()
    const light = '%%{init: {"theme": "default"}}%%\nflowchart LR\n  A --> B'
    const dark = '%%{init: {"theme": "dark"}}%%\nflowchart LR\n  C --> D'
    let background = 'white'
    let finishLightParse: ((value: boolean) => void) | undefined
    mocks.getConfig.mockImplementation(() => ({ themeVariables: { background } }))
    mocks.parse.mockImplementation((content: string) => {
      background = content === light ? 'white' : '#333'
      return content === light
        ? new Promise<boolean>((resolve) => {
            finishLightParse = resolve
          })
        : Promise.resolve(true)
    })
    mocks.render.mockImplementation(async (_id: string, content: string) => ({
      svg: `<svg><text>${content === light ? 'light diagram' : 'dark diagram'}</text></svg>`
    }))

    render(
      <>
        <MermaidPreview enableToolbar>{light}</MermaidPreview>
        <MermaidPreview enableToolbar>{dark}</MermaidPreview>
      </>
    )
    await waitFor(() => expect(finishLightParse).toBeTypeOf('function'))
    await act(async () => finishLightParse!(true))
    await waitForDiagram(2)

    const previews = screen.getAllByRole('alert')
    await user.click(within(previews[0]).getByRole('button', { name: 'Open Dialog' }))
    await user.click(within(previews[1]).getByRole('button', { name: 'Open Dialog' }))

    await waitFor(() => expect(mocks.showImagePreview).toHaveBeenCalledTimes(2))
    previewPair(mocks.showImagePreview.mock.calls[0] as PreviewCall, 'light diagram', 'rgb(255, 255, 255)')
    previewPair(mocks.showImagePreview.mock.calls[1] as PreviewCall, 'dark diagram', 'rgb(51, 51, 51)')
  })

  it('opens the completed render with its canvas while a theme change is still rendering', async () => {
    const user = userEvent.setup()
    let background = 'white'
    mocks.getConfig.mockImplementation(() => ({ themeVariables: { background } }))
    const pendingRenders: Array<(result: { svg: string }) => void> = []
    mocks.render.mockImplementation(() => new Promise((resolve) => pendingRenders.push(resolve)))

    const content = 'flowchart LR\n  A --> B'
    const { rerender } = render(<MermaidPreview enableToolbar>{content}</MermaidPreview>)
    await waitFor(() => expect(pendingRenders).toHaveLength(1))

    background = '#333'
    mocks.forceRenderKey = 1
    rerender(<MermaidPreview enableToolbar>{content}</MermaidPreview>)

    await act(async () => pendingRenders[0]({ svg: '<svg><text>light diagram</text></svg>' }))
    await waitFor(() => expect(pendingRenders).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }))
    await waitFor(() => expect(mocks.showImagePreview).toHaveBeenCalledOnce())
    previewPair(mocks.showImagePreview.mock.calls[0] as PreviewCall, 'light diagram', 'rgb(255, 255, 255)')

    await act(async () => pendingRenders[1]({ svg: '<svg><text>dark diagram</text></svg>' }))
    await user.click(screen.getByRole('button', { name: 'Open Dialog' }))
    await waitFor(() => expect(mocks.showImagePreview).toHaveBeenCalledTimes(2))
    previewPair(mocks.showImagePreview.mock.calls[1] as PreviewCall, 'dark diagram', 'rgb(51, 51, 51)')
  })
})
