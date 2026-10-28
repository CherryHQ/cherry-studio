import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { setInlineFilePathHomePath } from '@renderer/utils/filePath'
import type { ExternalOpenTarget } from '@shared/types/externalApp'
import type { PhysicalFileMetadata } from '@shared/types/file'

import { findBareFilePathMatches } from '../../markdown/plugins/rehypeBareFilePaths'
import { MessageListProvider } from '../../MessageListProvider'
import { defaultMessageRenderConfig, type MessageListProviderValue } from '../../types'
import { ClickableFilePath } from '../shared/ClickableFilePath'

// Use the real menu to verify right-click activation, selection and dismissal.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

const mockPlatform = vi.hoisted(() => ({ value: 'darwin' }))
vi.mock('@renderer/utils/platform', () => ({
  get isMac() {
    return mockPlatform.value === 'darwin'
  },
  get isWin() {
    return mockPlatform.value === 'win32'
  },
  get platform() {
    return mockPlatform.value
  }
}))

const mockOpenArtifactFile = vi.fn().mockResolvedValue(undefined)
const mockOpenPath = vi.fn().mockResolvedValue(undefined)
const mockNotifyError = vi.fn()
const mockNotifySuccess = vi.fn()
const mockReadText = vi.fn()
const mockSave = vi.fn()
let metadata: PhysicalFileMetadata | null
const bytes = new Uint8Array([0, 255, 10, 128])
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
        'common.more': 'More',
        'common.open': 'Open',
        'chat.input.tools.open_with': 'Open With',
        'chat.input.tools.reveal_in_file_explorer': 'Show in File Explorer',
        'chat.input.tools.reveal_in_file_manager': 'Show in File Manager',
        'agent.preview_pane.copy_path': 'Copy Path',
        'chat.input.tools.copy_file_content': 'Copy File Contents',
        'preview.save_as': 'Save As'
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

  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MessageListProvider value={value}>{ui}</MessageListProvider>
    </SWRConfig>
  )
}

describe('ClickableFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPlatform.value = 'darwin'
    setInlineFilePathHomePath(undefined)
    metadata = { kind: 'file', type: 'text', mime: 'text/plain', size: 4, createdAt: 0, modifiedAt: 0 }
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) => ({
      ok: true,
      data: route === 'file.get_metadata' ? metadata : { content: bytes }
    }))
    mockReadText.mockResolvedValue('  original text\n')
    mockSave.mockResolvedValue('/tmp/saved.ts')
    vi.stubGlobal('api', {
      ...window.api,
      fs: { readText: mockReadText },
      file: { ...window.api.file, save: mockSave }
    })
  })

  // Protect discoverability and activation without opening the file or changing its external app.
  it.each([
    ['darwin', 'Reveal in Finder'],
    ['win32', 'Show in File Explorer'],
    ['linux', 'Show in File Manager']
  ])('offers the platform reveal button on %s', (platform, label) => {
    mockPlatform.value = platform
    renderWithProvider(<ClickableFilePath path="/tmp/report.md" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath
    })
    const button = screen.getByRole('button', { name: label })
    // These literal classes define the resting and touch visibility contract in unstyled jsdom.
    expect(button.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['pointer-events-none', 'opacity-0', 'no-hover:opacity-100'])
    )
  })

  it.each(['click', 'Enter', ' '] as const)('reveals the resolved path once via %s without opening', async (key) => {
    const user = userEvent.setup()
    const parentClick = vi.fn()
    const parentKeyDown = vi.fn()
    renderWithProvider(
      <div onClick={parentClick} onKeyDown={parentKeyDown}>
        <ClickableFilePath path="src/report.md" displayName="report.md" />
      </div>,
      {
        openArtifactFile: mockOpenArtifactFile,
        openPath: mockOpenPath,
        resolvePath: (path) => `/workspace/${path}`
      }
    )
    const button = screen.getByRole('button', { name: 'Reveal in Finder' })
    if (key === 'click') await user.click(button)
    else {
      button.focus()
      await user.keyboard(key === 'Enter' ? '{Enter}' : ' ')
    }
    await waitFor(() =>
      expect(window.api.ipcApi.request).toHaveBeenCalledExactlyOnceWith('file.show_in_folder', {
        kind: 'path',
        path: '/workspace/src/report.md'
      })
    )
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
    expect(mockOpenTarget).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
    expect(parentKeyDown).not.toHaveBeenCalled()
  })

  it('isolates reveal activation from a keyboard-activated tool header while preserving file opening', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()
    const parentKeyDown = vi.fn()
    renderWithProvider(
      <div
        role="button"
        tabIndex={0}
        onClick={parentClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          parentKeyDown()
        }}>
        <ClickableFilePath path="/tmp/report.md" displayName="report.md" />
      </div>,
      { openArtifactFile: mockOpenArtifactFile }
    )
    const reveal = screen.getByRole('button', { name: 'Reveal in Finder' })
    for (const [index, key] of ['click', 'Enter', ' '].entries()) {
      if (key === 'click') await user.click(reveal)
      else {
        reveal.focus()
        await user.keyboard(key === 'Enter' ? '{Enter}' : ' ')
      }
      await waitFor(() => expect(window.api.ipcApi.request).toHaveBeenCalledTimes(index + 1))
      expect(window.api.ipcApi.request).toHaveBeenNthCalledWith(index + 1, 'file.show_in_folder', {
        kind: 'path',
        path: '/tmp/report.md'
      })
      expect(parentClick).not.toHaveBeenCalled()
      expect(parentKeyDown).not.toHaveBeenCalled()
      expect(mockOpenArtifactFile).not.toHaveBeenCalled()
    }

    screen.getByRole('link', { name: 'report.md' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(mockOpenArtifactFile).toHaveBeenCalledExactlyOnceWith('/tmp/report.md'))
    expect(window.api.ipcApi.request).toHaveBeenCalledTimes(3)
  })

  it('omits the reveal button for an unresolved relative path', () => {
    renderWithProvider(<ClickableFilePath path="src/report.md" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath,
      resolvePath: (path) => path
    })
    expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).not.toBeInTheDocument()
  })

  it('omits the reveal button when interaction is disabled', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/report.md" interactive={false} />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath
    })
    expect(screen.queryByRole('button', { name: 'Reveal in Finder' })).not.toBeInTheDocument()
  })

  it('reveals a directory without opening it', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/folder/" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath,
      isDirectory: async () => true
    })
    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))
    expect(window.api.ipcApi.request).toHaveBeenCalledExactlyOnceWith('file.show_in_folder', {
      kind: 'path',
      path: '/tmp/folder/'
    })
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('reports a failed reveal without opening the file', async () => {
    const user = userEvent.setup()
    vi.mocked(window.api.ipcApi.request).mockRejectedValueOnce(new Error('Permission denied'))
    renderWithProvider(<ClickableFilePath path="/tmp/report.md" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath,
      notifyError: mockNotifyError
    })
    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('Failed to open file: /tmp/report.md'))
    expect(window.api.ipcApi.request).toHaveBeenCalledExactlyOnceWith('file.show_in_folder', {
      kind: 'path',
      path: '/tmp/report.md'
    })
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it.each([
    ['src/report.ts', '/workspace/src/report.ts'],
    ['~/Desktop/report.ts', '/Users/foo/Desktop/report.ts']
  ])('shows the full target path in the tooltip for %s', async (path, expectedPath) => {
    const user = userEvent.setup()
    setInlineFilePathHomePath('/Users/foo')
    renderWithProvider(<ClickableFilePath path={path} displayName="report.ts" />, {
      openArtifactFile: mockOpenArtifactFile,
      resolvePath: (value) => (value.startsWith('/') ? value : `/workspace/${value}`)
    })

    await user.hover(screen.getByRole('link', { name: 'report.ts' }))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(expectedPath)
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

  it('opens directories in the system file manager', async () => {
    const isDirectory = vi.fn().mockResolvedValue(true)
    renderWithProvider(<ClickableFilePath path="/Users/foo/essays/" />, {
      openArtifactFile: mockOpenArtifactFile,
      openPath: mockOpenPath,
      isDirectory
    })
    fireEvent.click(screen.getByRole('link', { name: '/Users/foo/essays/' }))
    await waitFor(() => {
      expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/essays/')
    })
    expect(isDirectory).toHaveBeenCalledWith('/Users/foo/essays/')
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
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

  it('should preserve scanned punctuation while stripping a source location before opening', async () => {
    const [match] = findBareFilePathMatches('Created /tmp/report(final)[v2].ts:42:5', 'posix')
    const path = match.path
    renderWithProvider(<ClickableFilePath path={path} preserveWrappingPunctuation />, {
      openArtifactFile: mockOpenArtifactFile
    })

    fireEvent.click(screen.getByRole('link', { name: path }))

    await waitFor(() => {
      expect(mockOpenArtifactFile).toHaveBeenCalledWith('/tmp/report(final)[v2].ts')
    })
  })

  it('opens the available targets on right-click without an ellipsis button or opening the file', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link', { name: '/tmp/test.ts' }) })

    expect(screen.queryByRole('menuitem', { name: 'Visual Studio Code' })).not.toBeInTheDocument()
    await user.hover(screen.getByRole('menuitem', { name: 'Open With' }))
    for (const target of externalOpenTargets.filter((target) => target.kind !== 'file_manager')) {
      expect(await screen.findByRole('menuitem', { name: target.name })).toBeInTheDocument()
    }
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
  })

  it('opens the selected target and dismisses the context menu', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })

    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link', { name: '/tmp/test.ts' }) })
    await user.hover(screen.getByRole('menuitem', { name: 'Open With' }))
    await screen.findByRole('menuitem', { name: 'Cursor' })
    await user.keyboard('{ArrowRight}{End}{Enter}')

    await waitFor(() => expect(mockOpenTarget).toHaveBeenCalledWith('/tmp/test.ts', externalOpenTargets[3]))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
  })

  it('opens a file from the primary menu action', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))
    expect(mockOpenArtifactFile).toHaveBeenCalledWith('/tmp/test.ts')
  })

  it.each([
    ['darwin', '/tmp/test.ts', 'Reveal in Finder'],
    ['win32', 'C:/Users/test.ts', 'Show in File Explorer'],
    ['linux', '/tmp/test.ts', 'Show in File Manager']
  ])('labels and invokes file reveal for %s', async (platform, path, label) => {
    mockPlatform.value = platform
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path={path} />, { openArtifactFile: mockOpenArtifactFile })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    await user.click(screen.getByRole('menuitem', { name: label }))
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'path', path })
    expect(mockOpenArtifactFile).not.toHaveBeenCalled()
  })

  it('copies the resolved absolute path', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="src/test.ts" />, {
      openArtifactFile: mockOpenArtifactFile,
      resolvePath: (path) => '/workspace/' + path
    })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    await user.click(screen.getByRole('menuitem', { name: 'Copy Path' }))
    expect(await navigator.clipboard.readText()).toBe('/workspace/src/test.ts')
  })

  it('copies original text including indentation and trailing newline', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    await user.click(await screen.findByRole('menuitem', { name: 'Copy File Contents' }))
    expect(await navigator.clipboard.readText()).toBe('  original text\n')
  })

  it('saves original bytes with the original filename and reports cancellation without success', async () => {
    const user = userEvent.setup()
    metadata = { kind: 'file', type: 'other', mime: 'application/octet-stream', size: 4, createdAt: 0, modifiedAt: 0 }
    mockSave.mockResolvedValueOnce(null)
    renderWithProvider(<ClickableFilePath path="/tmp/data.bin" />, {
      openArtifactFile: mockOpenArtifactFile,
      notifySuccess: mockNotifySuccess
    })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    expect(await screen.findByRole('menuitem', { name: 'Copy File Contents' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Save As' }))
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('data.bin', bytes))
    expect(mockNotifySuccess).not.toHaveBeenCalled()
    expect(mockReadText).not.toHaveBeenCalled()
  })

  it('omits content-copy and save actions for a directory', async () => {
    const user = userEvent.setup()
    metadata = { kind: 'directory', size: 0, createdAt: 0, modifiedAt: 0 }
    renderWithProvider(<ClickableFilePath path="/tmp/folder" />, { openPath: mockOpenPath })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    expect(await screen.findByRole('menuitem', { name: 'Copy Path' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Copy File Contents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Save As' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Reveal in Finder' }))
    expect(window.api.ipcApi.request).toHaveBeenCalledWith('file.show_in_folder', { kind: 'path', path: '/tmp/folder' })
    expect(mockOpenPath).not.toHaveBeenCalled()
  })

  it('reports a failed content read without replacing clipboard content', async () => {
    const user = userEvent.setup()
    await navigator.clipboard.writeText('keep this')
    mockReadText.mockRejectedValueOnce(new Error('Permission denied'))
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, {
      openArtifactFile: mockOpenArtifactFile,
      notifyError: mockNotifyError
    })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link') })
    await user.click(await screen.findByRole('menuitem', { name: 'Copy File Contents' }))
    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('message.copy.failed'))
    expect(await navigator.clipboard.readText()).toBe('keep this')
  })

  it('dismisses the context menu with Escape without opening a target', async () => {
    const user = userEvent.setup()
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" />, { openArtifactFile: mockOpenArtifactFile })
    await user.pointer({ keys: '[MouseRight]', target: screen.getByRole('link', { name: '/tmp/test.ts' }) })
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mockOpenTarget).not.toHaveBeenCalled()
  })

  it('does not offer external targets for an unresolved relative path', () => {
    renderWithProvider(<ClickableFilePath path="src/main.ts" />, { openArtifactFile: mockOpenArtifactFile })
    fireEvent.contextMenu(screen.getByRole('link', { name: 'src/main.ts' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
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
    fireEvent.contextMenu(screen.getByText('/tmp/test.ts'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('should disable all file actions when interactive is false', () => {
    renderWithProvider(<ClickableFilePath path="/tmp/test.ts" interactive={false} />, {
      openArtifactFile: mockOpenArtifactFile
    })

    expect(screen.queryByRole('link', { name: '/tmp/test.ts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('/tmp/test.ts'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
