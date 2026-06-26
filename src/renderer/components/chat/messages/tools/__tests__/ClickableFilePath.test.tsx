import type { ExternalAppInfo } from '@shared/types/externalApp'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../types'
import { setInlineFilePathHomePath } from '../../utils/filePath'
import { ClickableFilePath } from '../agent/ClickableFilePath'

const mockOpenArtifactFile = vi.fn().mockResolvedValue(undefined)
const mockShowInFolder = vi.fn().mockResolvedValue(undefined)
const mockOpenInExternalApp = vi.fn()
const mockNotifyError = vi.fn()
const mockGetMetadata = vi.fn()

vi.stubGlobal('api', {
  file: {
    getMetadata: mockGetMetadata
  }
})
const externalCodeEditors: ExternalAppInfo[] = [
  { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'], path: '/app/vscode' },
  { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'], path: '/app/cursor' }
]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'chat.input.tools.open_file': 'Open File',
        'chat.input.tools.reveal_in_finder': 'Reveal in Finder',
        'chat.input.tools.file_not_found': `File not found: ${vars?.path ?? ''}`,
        'chat.input.tools.open_file_error': `Failed to open file: ${vars?.path ?? ''}`,
        'agent.session.file_manager.finder': 'Finder',
        'common.more': 'More'
      }
      return map[key] ?? key
    }
  })
}))

vi.mock('@renderer/config/constant', () => ({
  isMac: true,
  isWin: false
}))

vi.mock('@renderer/utils/editorUtils', () => ({
  getEditorIcon: ({ id }: { id: string }) => <span data-testid={`${id}-icon`} />
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
      renderConfig: defaultMessageRenderConfig,
      externalCodeEditors: [...externalCodeEditors]
    },
    actions,
    meta: { selectionLayer: false }
  }

  return render(<MessageListProvider value={value}>{ui}</MessageListProvider>)
}

describe('ClickableFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setInlineFilePathHomePath(undefined)
    mockGetMetadata.mockResolvedValue({
      kind: 'file',
      type: 'other',
      size: 1,
      createdAt: 1,
      modifiedAt: 1,
      mime: 'text/plain'
    })
  })

  it('should render the path as text', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openArtifactFile: mockOpenArtifactFile })
    expect(screen.getByRole('link', { name: '/Users/foo/bar.tsx' })).toBeInTheDocument()
  })

  it('should render displayName when provided', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" displayName="bar.tsx" />, {
      openArtifactFile: mockOpenArtifactFile
    })
    const link = screen.getByRole('link', { name: 'bar.tsx' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveTextContent('bar.tsx')
  })

  it('should call openArtifactFile on click (no existence preflight)', async () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openArtifactFile: mockOpenArtifactFile })
    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }))
    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/bar.tsx')
    })
    expect(mockGetMetadata).not.toHaveBeenCalled()
  })

  it('should open relative paths directly', async () => {
    renderWithProvider(<ClickableFilePath path="src/renderer/index.tsx" />, {
      openArtifactFile: mockOpenArtifactFile
    })
    fireEvent.click(screen.getByRole('link', { name: 'src/renderer/index.tsx' }))
    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('src/renderer/index.tsx')
    })
    expect(mockGetMetadata).not.toHaveBeenCalled()
  })

  it('should keep home-relative paths readable and open the resolved file path', async () => {
    setInlineFilePathHomePath('/Users/foo')
    renderWithProvider(<ClickableFilePath path="~/Desktop/report.html" />, {
      openArtifactFile: mockOpenArtifactFile
    })

    fireEvent.click(screen.getByRole('link', { name: '~/Desktop/report.html' }))

    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/Desktop/report.html')
    })
  })

  it('should notify when opening the file fails', async () => {
    mockOpenArtifactFile.mockRejectedValueOnce(new Error('boom'))
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, {
      openArtifactFile: mockOpenArtifactFile,
      notifyError: mockNotifyError
    })
    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }))
    await waitFor(() => {
      expect(mockNotifyError).toHaveBeenCalledWith('Failed to open file: /Users/foo/bar.tsx')
    })
  })

  it('should normalize paths wrapped in backticks before opening', async () => {
    renderWithProvider(<ClickableFilePath path="`/Users/foo/bar.tsx`" />, { openArtifactFile: mockOpenArtifactFile })

    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }))

    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/bar.tsx')
    })
  })

  it('should strip line suffixes before opening', async () => {
    renderWithProvider(<ClickableFilePath path="src/renderer/src/index.tsx:42:5" />, {
      openArtifactFile: mockOpenArtifactFile
    })

    fireEvent.click(screen.getByRole('link', { name: 'src/renderer/src/index.tsx' }))

    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('src/renderer/src/index.tsx')
    })
  })

  it('should have clickable styling', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, {
      openArtifactFile: mockOpenArtifactFile
    })
    const span = screen.getByRole('link', { name: '/tmp/test.ts' })
    expect(span).toHaveClass('cursor-pointer', 'items-center')
    expect(span).toHaveClass('text-primary')
    expect(span.parentElement).toHaveClass('flex', 'flex-row', 'items-center')
  })

  it('should render ellipsis dropdown trigger', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { showInFolder: mockShowInFolder })
    expect(screen.getByRole('button', { name: 'More' })).toHaveClass('items-center')
  })

  it('should render ellipsis dropdown trigger for external editor capability', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openInExternalApp: mockOpenInExternalApp })
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
  })

  it('should align the file manager menu item with the agent navbar style without separators', () => {
    const { container } = renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, {
      showInFolder: mockShowInFolder,
      openInExternalApp: mockOpenInExternalApp
    })

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(screen.getByText('Finder')).toBeInTheDocument()
    expect(screen.queryByText('Reveal in Finder')).not.toBeInTheDocument()
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument()
    expect(container.querySelector('[role="separator"], hr')).toBeNull()
  })

  it('should have role="link" and tabIndex for keyboard accessibility', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    const span = screen.getByRole('link', { name: '/tmp/test.ts' })
    expect(span).toHaveAttribute('role', 'link')
    expect(span).toHaveAttribute('tabindex', '0')
  })

  it('should call openArtifactFile on Enter key', async () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openArtifactFile: mockOpenArtifactFile })
    fireEvent.keyDown(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }), { key: 'Enter' })
    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/bar.tsx')
    })
  })

  it('should call openArtifactFile on Space key', async () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, { openArtifactFile: mockOpenArtifactFile })
    fireEvent.keyDown(screen.getByRole('link', { name: '/Users/foo/bar.tsx' }), { key: ' ' })
    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/bar.tsx')
    })
  })

  it('should render plain text when openArtifactFile capability is unavailable', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />)
    expect(screen.queryByRole('link', { name: '/tmp/test.ts' })).not.toBeInTheDocument()
    expect(screen.getAllByText('/tmp/test.ts').some((element) => element.classList.contains('cursor-default'))).toBe(
      true
    )
  })

  it('should disable all file actions when interactive is false', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" interactive={false} />, {
      openArtifactFile: mockOpenArtifactFile,
      showInFolder: mockShowInFolder,
      openInExternalApp: mockOpenInExternalApp
    })

    expect(screen.queryByRole('link', { name: '/tmp/test.ts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    const text = screen.getAllByText('/tmp/test.ts').find((element) => element.classList.contains('cursor-default'))
    expect(text).toBeInTheDocument()
    expect(text).toHaveClass('text-foreground-secondary')
  })
})
