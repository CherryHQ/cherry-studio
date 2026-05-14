import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../types'
import { ClickableFilePath } from '../agent/ClickableFilePath'

const mockOpenPath = vi.fn().mockResolvedValue(undefined)
const mockShowInFolder = vi.fn().mockResolvedValue(undefined)

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.input.tools.open_file': 'Open File',
        'chat.input.tools.reveal_in_finder': 'Reveal in Finder',
        'common.more': 'More'
      }
      return map[key] ?? key
    }
  })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: () => ({
    data: [
      { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'], path: '/app/vscode' },
      { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'], path: '/app/cursor' }
    ]
  })
}))

vi.mock('@renderer/utils/editorUtils', () => ({
  getEditorIcon: ({ id }: { id: string }) => <span data-testid={`${id}-icon`} />,
  buildEditorUrl: (app: { protocol: string }, path: string) =>
    `${app.protocol}file/${path.split('/').map(encodeURIComponent).join('/')}?windowId=_blank`
}))

const renderWithProvider = (ui: ReactElement, actions: MessageListProviderValue['actions'] = {}) => {
  const value: MessageListProviderValue = {
    state: {
      topic: { id: 'topic-1', name: 'Topic' } as MessageListProviderValue['state']['topic'],
      messages: [],
      partsByMessageId: {},
      messageNavigation: 'none',
      estimateSize: 0,
      overscan: 0,
      loadOlderDelayMs: 0,
      loadingResetDelayMs: 0,
      renderConfig: defaultMessageRenderConfig
    },
    actions,
    meta: { selectionLayer: false }
  }

  return render(<MessageListProvider value={value}>{ui}</MessageListProvider>)
}

describe('ClickableFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the path as text', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openPath: mockOpenPath })
    expect(screen.getByRole('link', { name: '/Users/foo/bar.tsx' })).toBeInTheDocument()
  })

  it('should render displayName when provided', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" displayName="bar.tsx" />, {
      openPath: mockOpenPath
    })
    const link = screen.getByRole('link', { name: 'bar.tsx' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveTextContent('bar.tsx')
  })

  it('should call openPath on click', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openPath: mockOpenPath })
    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }))
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })

  it('should have clickable styling', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openPath: mockOpenPath })
    const span = screen.getByRole('link', { name: '/tmp/test.ts' })
    expect(span).toHaveClass('cursor-pointer')
    expect(span).toHaveStyle({ color: 'var(--color-primary)' })
  })

  it('should render ellipsis dropdown trigger', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { showInFolder: mockShowInFolder })
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('should have role="link" and tabIndex for keyboard accessibility', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openPath: mockOpenPath })
    const span = screen.getByRole('link', { name: '/tmp/test.ts' })
    expect(span).toHaveAttribute('role', 'link')
    expect(span).toHaveAttribute('tabindex', '0')
  })

  it('should call openPath on Enter key', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openPath: mockOpenPath })
    fireEvent.keyDown(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }), { key: 'Enter' })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })

  it('should call openPath on Space key', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openPath: mockOpenPath })
    fireEvent.keyDown(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }), { key: ' ' })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })

  it('should render plain text when openPath capability is unavailable', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />)
    expect(screen.queryByRole('link', { name: '/tmp/test.ts' })).not.toBeInTheDocument()
    expect(screen.getAllByText('/tmp/test.ts').some((element) => element.classList.contains('cursor-default'))).toBe(
      true
    )
  })
})
