import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HtmlArtifactsPopup from '../HtmlArtifactsPopup'

const mocks = vi.hoisted(() => ({
  CodeEditor: vi.fn(({ value }) => <div data-testid="code-editor">{value}</div>),
  CodeViewer: vi.fn(({ value }) => <div data-testid="code-viewer">{value}</div>),
  onOpenChange: undefined as ((open: boolean) => void) | undefined
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  CodeEditor: mocks.CodeEditor,
  Dialog: ({ open, children, onOpenChange }: any) => {
    mocks.onOpenChange = onOpenChange
    return open ? <div data-testid="dialog">{children}</div> : null
  },
  DialogContent: ({ children, closeOnOverlayClick = true, onPointerDownOutside }: any) => (
    <>
      <button
        type="button"
        data-testid="dialog-overlay"
        onClick={() => {
          const event = {
            defaultPrevented: false,
            preventDefault: () => {
              event.defaultPrevented = true
            }
          }

          onPointerDownOutside?.(event)

          if (closeOnOverlayClick) {
            mocks.onOpenChange?.(false)
          }
        }}
      />
      <div>{children}</div>
    </>
  ),
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  MenuItem: ({ label }: any) => <div>{label}</div>,
  MenuList: ({ children }: any) => <div>{children}</div>,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
  SegmentedControl: ({ options }: any) => (
    <div data-testid="segmented-control">
      {options.map((option: any) => (
        <button key={option.value} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
  Tooltip: ({ children }: any) => <>{children}</>
}))

vi.mock('@cherrystudio/ui/lib/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/utils/platform', () => ({
  isMac: false
}))

vi.mock('@renderer/utils/image', () => ({
  captureScrollableIframeAsBlob: vi.fn(),
  captureScrollableIframeAsDataUrl: vi.fn()
}))

describe('HtmlArtifactsPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('chat.message.font_size', 14)
    mocks.onOpenChange = undefined
  })

  it('renders read-only source when editable is false', () => {
    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html="<h1>Hello</h1>"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('<h1>Hello</h1>')
  })

  it('renders the editor when editable is true', () => {
    render(
      <HtmlArtifactsPopup
        open
        editable
        title="HTML Artifacts"
        html="<h1>Hello</h1>"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    )

    expect(screen.getByTestId('code-editor')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument()
  })

  it('keeps the popup open when clicking the overlay', () => {
    const onClose = vi.fn()

    render(
      <HtmlArtifactsPopup
        open
        editable={false}
        title="HTML Artifacts"
        html="<h1>Hello</h1>"
        onClose={onClose}
        onSave={vi.fn()}
      />
    )

    fireEvent.click(screen.getByTestId('dialog-overlay'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
