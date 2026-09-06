import { DIALOG_UNMOUNT_DELAY_MS } from '@cherrystudio/ui/utils'
import type { InstalledSkill } from '@shared/types/skill'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SkillDetailDialog from '../SkillDetailDialog'

const { ipcRequestMock, loggerErrorMock, toastErrorMock, uiLanguage } = vi.hoisted(() => ({
  ipcRequestMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  toastErrorMock: vi.fn(),
  uiLanguage: { current: 'en-US', resolved: undefined as string | undefined }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequestMock }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: toastErrorMock }
}))

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: { withContext: () => ({ error: loggerErrorMock }) }
}))

vi.mock('../SkillFileBrowser', () => ({
  SkillFileBrowser: ({ skillId }: { skillId: string }) => <section>skill browser: {skillId}</section>
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: uiLanguage.current, resolvedLanguage: uiLanguage.resolved }
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
    Scrollbar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    version: null,
    sourceTags: ['review'],
    contentHash: 'hash',
    isGlobalEnabled: true,
    isEnabled: true,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...overrides
  }
}

describe('SkillDetailDialog', () => {
  beforeEach(() => {
    ipcRequestMock.mockReset()
    loggerErrorMock.mockReset()
    toastErrorMock.mockReset()
    uiLanguage.current = 'en-US'
    uiLanguage.resolved = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The system locale and the app language differ often enough that one machine's default hides the
  // bug; asserting both orders means whichever locale the runner has, one case still catches it.
  it.each([
    ['zh-CN', /^2026\/\d{2}\/\d{2}$/],
    ['en-US', /^\d{2}\/\d{2}\/2026$/]
  ])('formats dates for the selected app language (%s), not the system locale', (language, expected) => {
    uiLanguage.current = language
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('follows the locale that supplied the copy when the requested one has no bundle', () => {
    // `en-GB` has no locale pack, so i18next renders `en-US` strings; formatting the date as `en-GB`
    // would put UK-ordered dates next to US English text.
    uiLanguage.current = 'en-GB'
    uiLanguage.resolved = 'en-US'
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    expect(screen.getByText(/^\d{2}\/\d{2}\/2026$/)).toBeInTheDocument()
  })

  it('shows skill metadata and the restored file browser without delete entry points', () => {
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review Helper' })).toBeInTheDocument()
    expect(screen.getByText('Review pull requests')).toBeInTheDocument()
    expect(screen.getByText('library.skill_detail.created_at')).toBeInTheDocument()
    expect(screen.getByText('library.skill_detail.updated_at')).toBeInTheDocument()
    expect(screen.getByText('skill browser: skill-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'library.action.uninstall' })).not.toBeInTheDocument()
  })

  it('opens the selected installed skill folder through the skill-scoped IPC route', async () => {
    const user = userEvent.setup()
    ipcRequestMock.mockResolvedValue(undefined)
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'library.skill_detail.open_folder' }))

    expect(ipcRequestMock).toHaveBeenCalledWith('skill.folder.open', { skillId: 'skill-1' })
  })

  it('reports an OS failure to open the skill folder', async () => {
    const user = userEvent.setup()
    ipcRequestMock.mockRejectedValue(new Error('open failed'))
    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'library.skill_detail.open_folder' }))

    expect(toastErrorMock).toHaveBeenCalledWith('library.skill_detail.open_folder_failed')
  })

  it('keeps the selected skill mounted until the close animation finishes', async () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()

    render(<SkillDetailDialog skill={createSkill()} open onOpenChange={onOpenChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))

    expect(onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(DIALOG_UNMOUNT_DELAY_MS - 1))
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(() => vi.advanceTimersByTime(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not render without a selected skill', () => {
    render(<SkillDetailDialog skill={null} open onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
