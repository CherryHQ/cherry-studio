import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import type { ExternalOpenTarget } from '@shared/types/externalApp'

import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../types'
import { ClickableFilePath } from '../shared/ClickableFilePath'

// Opt out of the global @cherrystudio/ui mock: its PopoverContent ignores `open`,
// so menu dismissal is only observable against the real popover.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mockOpenArtifactFile = vi.fn().mockResolvedValue(undefined)
const mockOpenPath = vi.fn().mockResolvedValue(undefined)
const mockNotifyError = vi.fn()
const mockGetMetadata = vi.fn()

vi.stubGlobal('api', {
  file: {
    getMetadata: mockGetMetadata
  }
})
const { externalOpenTargets, mockOpenTarget, mockUseExternalOpenTargets } = vi.hoisted(() => {
  const targets = [
    { id: 'system_default', name: 'TextEdit', kind: 'system_default' },
    { id: 'file_manager', name: 'Finder', kind: 'file_manager' },
    { id: 'known:vscode', name: 'Visual Studio Code', kind: 'application' },
    { id: 'known:cursor', name: 'Cursor', kind: 'application' }
  ] satisfies ExternalOpenTarget[]
  const openTarget = vi.fn().mockResolvedValue(undefined)
  return {
    externalOpenTargets: targets,
    mockOpenTarget: openTarget,
    mockUseExternalOpenTargets: vi.fn(
      (targetPath: string, _pathKind: 'file' | 'directory', options?: { enabled?: boolean }) => ({
        data: options?.enabled
          ? { pathKind: 'file' as const, recommendedTargetId: 'system_default', targets }
          : undefined,
        error: undefined,
        isLoading: false,
        targets: options?.enabled ? targets : [],
        openTarget: (target: ExternalOpenTarget) => openTarget(targetPath, target)
      })
    )
  }
})

vi.mock('@renderer/hooks/useExternalOpenTargets', () => ({
  useExternalOpenTargets: mockUseExternalOpenTargets
}))

vi.mock('@renderer/components/OpenTarget', () => ({
  getOpenTargetBadge: () => undefined,
  getOpenTargetLabel: (target: ExternalOpenTarget) => target.name,
  OpenTargetIcon: ({ target }: { target: ExternalOpenTarget }) => <span data-testid={`${target.id}-icon`} />
}))

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

  it('should render displayName when provided', () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" displayName="bar.tsx" />, {
      openArtifactFile: mockOpenArtifactFile
    })
    const link = screen.getByRole('link', { name: 'bar.tsx' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveTextContent('bar.tsx')
  })

  it('should open relative paths directly', async () => {
    renderWithProvider(<ClickableFilePath path="src/renderer/index.tsx" />, {
      openArtifactFile: mockOpenArtifactFile
    })
    const link = screen.getByRole('link', { name: 'src/renderer/index.tsx' })
    expect(link).toHaveAttribute('tabindex', '0')
    fireEvent.click(link)
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

  it('should delegate directory-looking paths to the artifact pane', async () => {
    renderWithProvider(<ClickableFilePath path="/Users/foo/essays/" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath
    })
    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/essays/' }))
    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/Users/foo/essays/')
    })
    expect(mockGetMetadata).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('should open via openPath when only openPath is available (no preview pane)', async () => {
    // Home-chat surfaces wire openPath but neither openArtifactFile nor
    // isDirectory; a non-directory path must still open via the file manager
    // rather than silently dead-ending on the missing preview pane.
    renderWithProvider(<ClickableFilePath path="/Users/foo/bar.tsx" />, {
      openPath: mockOpenPath
    })
    const link = screen.getByRole('link', { name: '/Users/foo/bar.tsx' })
    expect(link).toBeInTheDocument()
    fireEvent.click(link)
    await waitFor(() => {
      expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
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

  it('should render ellipsis dropdown trigger when open targets are available', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    expect(mockUseExternalOpenTargets).toHaveBeenLastCalledWith('/tmp/test.ts', 'file', { enabled: false })
  })

  it('should show the path-specific system, file-manager, and app targets without separators', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })

    fireEvent.click(screen.getByRole('button', { name: 'More' }))

    expect(mockUseExternalOpenTargets).toHaveBeenLastCalledWith('/tmp/test.ts', 'file', { enabled: true })
    expect(screen.getByText('Finder')).toBeInTheDocument()
    expect(screen.queryByText('Reveal in Finder')).not.toBeInTheDocument()
    expect(screen.getByText('Visual Studio Code')).toBeInTheDocument()
    expect(screen.queryByRole('separator')).toBeNull()
  })

  it('should open the selected target and dismiss the actions menu', async () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByRole('button', { name: /Finder/ }))

    await waitFor(() => expect(mockOpenTarget).toHaveBeenCalledWith('/tmp/test.ts', externalOpenTargets[1]))
    expect(screen.queryByRole('button', { name: /Finder/ })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getAllByText('/tmp/test.ts').length).toBeGreaterThan(0)
  })

  it('should disable all file actions when interactive is false', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" interactive={false} />, {
      openArtifactFile: mockOpenArtifactFile
    })

    expect(screen.queryByRole('link', { name: '/tmp/test.ts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getAllByText('/tmp/test.ts').length).toBeGreaterThan(0)
  })
})
