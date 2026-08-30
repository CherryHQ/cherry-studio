import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  ipcRequest: vi.fn(),
  translate: vi.fn(),
  tree: {
    error: null as Error | null,
    isLoading: false,
    root: null as unknown,
    version: 7
  }
}))

vi.mock('@renderer/hooks/useDirectoryTree', () => ({ useDirectoryTree: () => mocks.tree }))
vi.mock('@renderer/hooks/translate', () => ({
  useTranslate: () => ({ cancel: mocks.cancel, isTranslating: false, translate: mocks.translate })
}))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.ipcRequest } }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ warn: vi.fn() }) } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'library.skill_detail.select_file': 'Select a file',
        'library.skill_detail.translate_to_chinese': 'Translate',
        'library.skill_detail.show_original': 'Original',
        'library.skill_detail.show_translation': 'Translation'
      })[key] ?? key
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
  EmptyState: ({ title }: { title: ReactNode }) => <div>{title}</div>,
  Markdown: ({ children }: { children?: ReactNode }) => <article>{children}</article>,
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
  FilePreview: ({ filePath, header, refreshKey }: { filePath: string; header: ReactNode; refreshKey: number }) => (
    <section data-file-path={filePath} data-refresh-key={refreshKey} data-testid="file-preview">
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

describe('SkillFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.tree = { error: null, isLoading: false, root: createRoot(), version: 7 }
    mocks.ipcRequest.mockResolvedValue({ content: new TextEncoder().encode('# Writer') })
    mocks.translate.mockResolvedValue('# 写作助手')
  })

  it('selects SKILL.md from the generic directory tree and previews its absolute path', async () => {
    render(<SkillFileBrowser rootPath={'/managed/writer' as never} skillId="skill-1" />)

    await waitFor(() =>
      expect(screen.getByTestId('file-preview')).toHaveAttribute('data-file-path', '/managed/writer/SKILL.md')
    )
    expect(screen.getByTestId('file-preview')).toHaveAttribute('data-refresh-key', '7')
    expect(screen.getByRole('button', { name: 'SKILL.md' })).toBeInTheDocument()
  })

  it('reads Markdown through file.read only when translation is requested', async () => {
    render(<SkillFileBrowser rootPath={'/managed/writer' as never} skillId="skill-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Translate' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))

    await waitFor(() => expect(screen.getByText('# 写作助手')).toBeInTheDocument())
    expect(mocks.ipcRequest).toHaveBeenCalledExactlyOnceWith('file.read', {
      handle: { kind: 'path', path: '/managed/writer/SKILL.md' },
      options: { mode: 'full', encoding: 'binary' }
    })
    expect(mocks.translate).toHaveBeenCalledWith('# Writer', 'zh-cn')
  })
})
