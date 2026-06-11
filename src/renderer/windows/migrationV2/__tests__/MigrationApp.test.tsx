import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { MigrationIpcChannels, type MigrationProgress } from '@shared/data/migration/v2/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n, { initI18n } from '../i18n'
import MigrationApp from '../MigrationApp'

type ConfirmDialogProps = {
  open?: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  onConfirm?: () => void | Promise<void>
  onOpenChange?: (open: boolean) => void
}

const confirmDialogMock = vi.hoisted(() => ({
  calls: [] as ConfirmDialogProps[]
}))

// Keep the real @cherrystudio/ui components (Button, Select, ...) and only stub
// ConfirmDialog so we can assert the localized props it receives and drive its callbacks.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return {
    ...actual,
    ConfirmDialog: (props: ConfirmDialogProps) => {
      confirmDialogMock.calls.push(props)
      return props.open ? <div data-testid="confirm-dialog">{props.title}</div> : null
    }
  }
})

vi.mock('antd', () => ({
  Progress: ({ percent }: { percent: number }) => <div data-testid="progress">{percent}</div>,
  Space: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Steps: ({ items }: { items: Array<{ title: string }> }) => (
    <ol>
      {items.map((item) => (
        <li key={item.title}>{item.title}</li>
      ))}
    </ol>
  )
}))

vi.mock('@renderer/config/env', () => ({
  AppLogo: 'app-logo.png'
}))

const invokeMock = vi.fn()
const onMock = vi.fn()
const removeAllListenersMock = vi.fn()

const versionIncompatibleProgress: MigrationProgress = {
  stage: 'version_incompatible',
  overallProgress: 0,
  currentMessage: 'Version incompatible',
  i18nMessage: { key: 'migration.version_incompatible.v2_gateway_skipped', params: {} },
  migrators: []
}

function installElectronMock(progress: MigrationProgress | null) {
  invokeMock.mockImplementation((channel: string) => {
    switch (channel) {
      case MigrationIpcChannels.GetProgress:
        return Promise.resolve(progress)
      case MigrationIpcChannels.GetLastError:
        return Promise.resolve(null)
      default:
        return Promise.resolve(true)
    }
  })

  Object.assign(window, {
    electron: {
      ipcRenderer: {
        invoke: invokeMock,
        on: onMock,
        removeAllListeners: removeAllListenersMock
      }
    }
  })
}

function latestConfirmProps(): ConfirmDialogProps {
  const props = confirmDialogMock.calls.at(-1)
  expect(props).toBeDefined()
  return props!
}

async function ensureI18n() {
  if (!i18n.isInitialized) {
    await initI18n()
  }
}

describe('MigrationApp skip migration confirmation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    confirmDialogMock.calls.length = 0
    await ensureI18n()
    await i18n.changeLanguage('zh-CN')
    installElectronMock(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens a localized confirm dialog and does not skip when cancelled', async () => {
    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: '跳过迁移' }))

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument())

    const props = latestConfirmProps()
    expect(props.open).toBe(true)
    expect(props.title).toBe('跳过迁移')
    expect(props.description).toBe(
      '跳过迁移后，将以全新默认配置启动 Cherry Studio。原有数据将保留在磁盘，不会删除。确定继续吗？'
    )
    expect(props.confirmText).toBe('确定')
    expect(props.cancelText).toBe('取消')
    expect(props.destructive).toBe(false)

    // Cancel -> dialog closes, no skip is performed.
    act(() => props.onOpenChange?.(false))
    expect(invokeMock).not.toHaveBeenCalledWith(MigrationIpcChannels.SkipMigration)
  })

  it('passes localized English strings and skips after confirmation', async () => {
    await i18n.changeLanguage('en-US')

    render(<MigrationApp />)

    fireEvent.click(screen.getByRole('button', { name: 'Skip Migration' }))

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument())

    const props = latestConfirmProps()
    expect(props.title).toBe('Skip Migration')
    expect(props.confirmText).toBe('OK')
    expect(props.cancelText).toBe('Cancel')
    expect(props.destructive).toBe(false)

    await act(async () => {
      await props.onConfirm?.()
    })
    expect(invokeMock).toHaveBeenCalledWith(MigrationIpcChannels.SkipMigration)
  })

  it('uses a destructive confirm dialog for ignoring incompatible migration data', async () => {
    installElectronMock(versionIncompatibleProgress)

    render(<MigrationApp />)

    fireEvent.click(await screen.findByRole('button', { name: '忽略并使用默认值' }))

    await waitFor(() => expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument())

    const props = latestConfirmProps()
    expect(props.title).toBe('忽略并使用默认值')
    expect(props.description).toBe('这将放弃所有旧数据并以全新默认值启动，继续后将重启应用。确定继续吗？')
    expect(props.destructive).toBe(true)

    await act(async () => {
      await props.onConfirm?.()
    })
    expect(invokeMock).toHaveBeenCalledWith(MigrationIpcChannels.SkipMigration)
  })
})
