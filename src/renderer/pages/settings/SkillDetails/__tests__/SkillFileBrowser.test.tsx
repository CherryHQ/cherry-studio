import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  blocker: {
    status: 'idle' as 'idle' | 'blocked',
    proceed: vi.fn(),
    reset: vi.fn()
  },
  blockerOptions: undefined as
    | { shouldBlockFn: () => Promise<boolean>; disabled: boolean; enableBeforeUnload: () => boolean }
    | undefined,
  ipcRequest: vi.fn(),
  onTreeMutation: undefined as ((event: unknown) => void) | undefined,
  tree: {
    error: null as Error | null,
    isLoading: false,
    root: null as unknown,
    version: 7
  }
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({
  useDirectoryTree: (_root: string, _options: unknown, onMutation?: (event: unknown) => void) => {
    mocks.onTreeMutation = onMutation
    return mocks.tree
  }
}))
vi.mock('@renderer/hooks/useCodeStyle', () => ({ useCodeStyle: () => ({ activeCmTheme: 'light' }) }))
vi.mock('@tanstack/react-router', () => ({
  useBlocker: (options: typeof mocks.blockerOptions) => {
    mocks.blockerOptions = options
    return mocks.blocker
  }
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn() }) } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({ 'library.skill_detail.select_file': 'Select a file' })[key] ?? key
  })
}))
vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
    const { size, variant, ...buttonProps } = props
    void size
    void variant
    return (
      <button type={buttonProps.type ?? 'button'} {...buttonProps}>
        {children}
      </button>
    )
  },
  CodeEditor: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
    <textarea aria-label="code-editor" value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
  ConfirmDialog: ({ open, title }: { open: boolean; title: ReactNode }) =>
    open ? <div role="dialog">{title}</div> : null,
  EmptyState: ({ title }: { title: ReactNode }) => <div>{title}</div>,
  SegmentedControl: ({
    'aria-label': ariaLabel,
    disabled,
    onValueChange,
    options,
    value
  }: {
    'aria-label': string
    disabled?: boolean
    onValueChange: (value: 'preview' | 'edit') => void
    options: Array<{ label: ReactNode; value: 'preview' | 'edit' }>
    value: 'preview' | 'edit'
  }) => (
    <div role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => onValueChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />
}))
vi.mock('@renderer/components/FileTree', () => ({
  FileTree: ({
    nodes,
    onSelectedChange
  }: {
    nodes: Array<{ id: string; name: string }>
    onSelectedChange: (id: string) => void
  }) => (
    <nav>
      {nodes.map((node) => (
        <button key={node.id} type="button" onClick={() => onSelectedChange(node.id)}>
          {node.name}
        </button>
      ))}
    </nav>
  )
}))
vi.mock('@renderer/components/FilePreview', () => ({
  FilePreview: ({
    filePath,
    header,
    refreshKey,
    type
  }: {
    filePath: string
    header: ReactNode
    refreshKey: number
    type: string
  }) => (
    <section
      data-file-path={filePath}
      data-preview-type={type}
      data-refresh-key={refreshKey}
      data-testid="file-preview">
      {header}
    </section>
  )
}))

import { SkillFileBrowser } from '../SkillFileBrowser'

function createFile(path: string) {
  return {
    basename: path.split('/').pop(),
    isTreeDir: () => false,
    isTreeFile: () => true,
    path
  }
}

function createRoot() {
  return {
    children: {
      readme: createFile('/managed/writer/README.md'),
      skill: createFile('/managed/writer/SKILL.md')
    }
  }
}

function renderBrowser(access: 'read_only' | 'read_write' = 'read_only') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SkillFileBrowser rootPath={'/managed/writer' as never} skillId="skill-1" access={access} />
    </SWRConfig>
  )
}

describe('SkillFileBrowser', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tree = { error: null, isLoading: false, root: createRoot(), version: 7 }
    mocks.blocker = { status: 'idle', proceed: vi.fn(), reset: vi.fn() }
    mocks.blockerOptions = undefined
    mocks.onTreeMutation = undefined
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'file.read') {
        const content = new TextEncoder().encode('# Writer')
        return { content, mime: 'text/markdown', version: { mtime: 1, size: content.byteLength } }
      }
      if (route === 'file.write_if_unchanged') return { mtime: 2, size: 16 }
      return undefined
    })
  })

  it('selects SKILL.md from the generic directory tree and previews its absolute path', async () => {
    renderBrowser()

    await waitFor(() =>
      expect(screen.getByTestId('file-preview')).toHaveAttribute('data-file-path', '/managed/writer/SKILL.md')
    )
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-refresh-key', '7')
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact')
    expect(screen.getByRole('button', { name: 'SKILL.md' })).toBeInTheDocument()
  })

  it('uses one authoring mode control for an editable Markdown file', async () => {
    renderBrowser('read_write')

    await waitFor(() => expect(screen.getByTestId('file-preview')).toHaveAttribute('data-preview-type', 'artifact'))
    expect(screen.getByRole('radiogroup', { name: 'preview.label' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'settings.skills.editor.preview' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'settings.skills.editor.edit' })).not.toBeChecked()
  })

  it('autosaves editable text through generic file IPC and scopes the following reconcile', async () => {
    vi.useFakeTimers()
    try {
      renderBrowser('read_write')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByRole('radio', { name: 'settings.skills.editor.edit' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'code-editor' }), { target: { value: '# Updated Writer' } })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
      })
      await act(async () => {
        await Promise.resolve()
      })

      expect(mocks.ipcRequest).toHaveBeenCalledWith(
        'file.write_if_unchanged',
        expect.objectContaining({ handle: { kind: 'path', path: '/managed/writer/SKILL.md' } })
      )
      expect(mocks.ipcRequest).toHaveBeenCalledWith('skill.reconcile', { skillId: 'skill-1' })
      expect(mocks.ipcRequest).not.toHaveBeenCalledWith('skill.reconcile', {})
    } finally {
      vi.useRealTimers()
    }
  })

  it('scopes reconciliation when the directory watcher reports a supporting-file change', async () => {
    renderBrowser('read_write')
    await waitFor(() => expect(mocks.onTreeMutation).toBeTypeOf('function'))
    mocks.ipcRequest.mockClear()

    await act(async () => {
      mocks.onTreeMutation?.({
        type: 'updated',
        path: '/managed/writer/README.md',
        stats: { size: 12, mtime: 2, birthtime: 1 }
      })
      await Promise.resolve()
    })

    expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('skill.reconcile', { skillId: 'skill-1' })
  })

  it('reports a saved file whose scoped Skill synchronization failed', async () => {
    vi.useFakeTimers()
    try {
      mocks.ipcRequest.mockImplementation(async (route: string) => {
        if (route === 'file.read') {
          const content = new TextEncoder().encode('# Writer')
          return { content, mime: 'text/markdown', version: { mtime: 1, size: content.byteLength } }
        }
        if (route === 'file.write_if_unchanged') return { mtime: 2, size: 16 }
        if (route === 'skill.reconcile') throw new Error('mirror unavailable')
        return undefined
      })
      renderBrowser('read_write')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByRole('radio', { name: 'settings.skills.editor.edit' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'code-editor' }), { target: { value: '# Updated Writer' } })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(800)
        await Promise.resolve()
      })

      expect(screen.getByText('settings.skills.editor.syncFailed')).toBeInTheDocument()
      let shouldBlock = false
      await act(async () => {
        shouldBlock = (await mocks.blockerOptions?.shouldBlockFn()) ?? false
      })
      expect(shouldBlock).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets the user keep a conflicted draft by rebasing it onto the latest file version', async () => {
    vi.useFakeTimers()
    let readCount = 0
    let writeCount = 0
    mocks.ipcRequest.mockImplementation(async (route: string, input: { data?: Uint8Array }) => {
      if (route === 'file.read') {
        const content = new TextEncoder().encode(readCount++ === 0 ? '# Writer' : '# External')
        return {
          content,
          mime: 'text/markdown',
          version: { mtime: readCount === 1 ? 1 : 2, size: content.byteLength }
        }
      }
      if (route === 'file.write_if_unchanged') {
        writeCount += 1
        if (writeCount === 1) throw new IpcError(fileErrorCodes.STALE_VERSION, 'stale')
        expect(new TextDecoder().decode(input.data)).toBe('# Current draft')
        return { mtime: 3, size: 15 }
      }
      return undefined
    })
    renderBrowser('read_write')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    fireEvent.click(screen.getByRole('radio', { name: 'settings.skills.editor.edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'code-editor' }), {
      target: { value: '# Current draft' }
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })
    expect(screen.getByText('settings.skills.editor.conflict')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'settings.skills.editor.keepDraft' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(writeCount).toBe(2)
    expect(screen.queryByText('settings.skills.editor.conflict')).not.toBeInTheDocument()
  })

  it('never opens an edit session for a read-only built-in Skill', async () => {
    renderBrowser('read_only')

    await waitFor(() => expect(screen.getByTestId('file-preview')).toBeInTheDocument())
    expect(screen.queryByRole('radio', { name: 'settings.skills.editor.edit' })).not.toBeInTheDocument()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('file.read', expect.anything())
  })
})
