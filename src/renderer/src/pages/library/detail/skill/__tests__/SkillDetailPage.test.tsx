import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InstalledSkill, SkillFileNode } from '@types'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SkillDetailPage from '../SkillDetailPage'

const { listFilesMock, readSkillFileMock, uninstallSkillMock } = vi.hoisted(() => ({
  listFilesMock: vi.fn(),
  readSkillFileMock: vi.fn(),
  uninstallSkillMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Alert: ({ action, children, message }: { action?: ReactNode; children?: ReactNode; message?: ReactNode }) => (
    <div>
      {message}
      {children}
      {action}
    </div>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; size?: string; variant?: string }) => {
    const buttonProps = { ...props } as ComponentProps<'button'> & Record<string, unknown>
    delete buttonProps.loading
    delete buttonProps.size
    delete buttonProps.variant
    return (
      <button type="button" {...buttonProps}>
        {children}
      </button>
    )
  },
  ConfirmDialog: ({
    confirmText,
    onConfirm,
    open,
    title
  }: {
    confirmText?: string
    onConfirm?: () => Promise<void> | void
    open?: boolean
    title: ReactNode
  }) =>
    open ? (
      <div role="dialog">
        <h2>{title}</h2>
        <button
          type="button"
          onClick={() => {
            void Promise.resolve(onConfirm?.()).catch(() => undefined)
          }}>
          {confirmText}
        </button>
      </div>
    ) : null,
  Separator: () => <hr />
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: () => <pre>code viewer</pre>
}))

vi.mock('@renderer/components/RichEditor', () => ({
  default: () => <article>rich editor</article>
}))

vi.mock('../../../editor/ConfigEditorShell', () => ({
  ResourceEditorShell: ({
    children,
    onBack,
    saveButton,
    title
  }: {
    children: ReactNode
    onBack: () => void
    saveButton?: {
      canSave: boolean
      saving: boolean
      onSave: () => void
    }
    title: string
  }) => (
    <div data-testid="resource-editor-shell">
      <button type="button" onClick={onBack}>
        common.back
      </button>
      <span>{title}</span>
      {saveButton && <button type="button">common.save</button>}
      {children}
    </div>
  )
}))

vi.mock('../../../adapters/skillAdapter', () => ({
  useSkillMutationsById: () => ({
    uninstallSkill: uninstallSkillMock
  })
}))

vi.mock('../skillFileTree', () => ({
  FileTreeNode: ({ node, onSelectFile }: { node: SkillFileNode; onSelectFile: (path: string) => void }) => (
    <button type="button" onClick={() => onSelectFile(node.path)}>
      {node.name}
    </button>
  ),
  guessLanguage: () => 'markdown',
  isMarkdownFile: (filename: string) => filename.endsWith('.md')
}))

function createSkill(overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return {
    id: 'skill-1',
    name: 'Review Helper',
    description: 'Review pull requests',
    folderName: 'review-helper',
    source: 'local',
    sourceUrl: null,
    namespace: null,
    author: null,
    sourceTags: ['review'],
    contentHash: 'hash',
    isEnabled: true,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides
  }
}

describe('SkillDetailPage', () => {
  beforeEach(() => {
    listFilesMock.mockReset()
    readSkillFileMock.mockReset()
    uninstallSkillMock.mockReset()

    listFilesMock.mockResolvedValue({
      success: true,
      data: [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }]
    })
    readSkillFileMock.mockResolvedValue({
      success: true,
      data: '# Review Helper'
    })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skill: {
          listFiles: listFilesMock,
          readSkillFile: readSkillFileMock
        }
      }
    })
    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn()
      }
    })
  })

  it('uses the shared resource shell without exposing save actions', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()

    render(<SkillDetailPage skill={createSkill()} onBack={onBack} />)

    expect(screen.getByTestId('resource-editor-shell')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.back' }))
    expect(onBack).toHaveBeenCalledTimes(1)

    expect(await screen.findAllByText('SKILL.md')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'library.action.uninstall' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('library.delete.skill.title')
  })

  it('uses the uninstall fallback message for uninstall failures', async () => {
    const user = userEvent.setup()
    uninstallSkillMock.mockRejectedValueOnce(new Error('low-level failure'))

    render(<SkillDetailPage skill={createSkill()} onBack={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'library.action.uninstall' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'library.action.uninstall' }))

    await waitFor(() => expect(window.toast.error).toHaveBeenCalledWith('library.uninstall_failed'))
    expect(window.toast.error).not.toHaveBeenCalledWith('low-level failure')
  })
})
