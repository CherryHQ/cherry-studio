import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { InstalledSkill } from '@types'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import SkillDetailDialog from '../SkillDetailDialog'

const { listFilesMock, readSkillFileMock } = vi.hoisted(() => ({
  listFilesMock: vi.fn(),
  readSkillFileMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('@cherrystudio/ui', () => {
  let onDialogOpenChange: ((open: boolean) => void) | undefined

  return {
    Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Button: ({ children, size, variant, ...props }: ComponentProps<'button'> & { size?: string; variant?: string }) => {
      void size
      void variant
      return (
        <button type="button" {...props}>
          {children}
        </button>
      )
    },
    Dialog: ({
      children,
      open,
      onOpenChange
    }: {
      children: ReactNode
      open: boolean
      onOpenChange?: (open: boolean) => void
    }) => {
      onDialogOpenChange = onOpenChange
      return open ? <>{children}</> : null
    },
    DialogContent: ({ children }: { children: ReactNode }) => (
      <div role="dialog">
        {children}
        <button type="button" onClick={() => onDialogOpenChange?.(false)}>
          common.close
        </button>
      </div>
    ),
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    Separator: () => <hr />
  }
})

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

describe('SkillDetailDialog', () => {
  beforeEach(() => {
    listFilesMock.mockReset()
    readSkillFileMock.mockReset()

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skill: {
          listFiles: listFilesMock,
          readSkillFile: readSkillFileMock
        }
      }
    })
  })

  it('shows skill metadata in a dialog without file preview or delete entry points', () => {
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review Helper' })).toBeInTheDocument()
    expect(screen.getByText('Review pull requests')).toBeInTheDocument()
    expect(screen.getByText('library.skill_detail.created_at')).toBeInTheDocument()
    expect(screen.getByText('library.skill_detail.updated_at')).toBeInTheDocument()
    expect(screen.queryByText('library.skill_detail.file_preview')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'SKILL.md' })).not.toBeInTheDocument()
    expect(screen.queryByText('rich editor: # Review Helper')).not.toBeInTheDocument()
    expect(screen.queryByText('code viewer: # Review Helper')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.action.uninstall' })).not.toBeInTheDocument()
    expect(listFilesMock).not.toHaveBeenCalled()
    expect(readSkillFileMock).not.toHaveBeenCalled()
  })

  it('closes through the dialog close button', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'common.close' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not render without a selected skill', () => {
    render(<SkillDetailDialog skill={null} open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
