import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), show: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@cherrystudio/ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Button: ({ children, onClick, disabled }: ComponentProps<'button'>) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    RowFlex: Box,
    Select: Box,
    SelectContent: Box,
    SelectItem: Box,
    SelectTrigger: Box,
    SelectValue: Box,
    Switch: Box,
    Tooltip: Box,
    HelpTooltip: Box
  }
})
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => [false, vi.fn()] }))
vi.mock('@logger', () => ({ loggerService: { withContext: () => ({ error: vi.fn(), warn: vi.fn() }) } }))
vi.mock('@renderer/components/SettingsPrimitives', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    SettingDivider: Box,
    SettingGroup: Box,
    SettingHelpText: Box,
    SettingRow: Box,
    SettingRowTitle: Box,
    SettingTitle: Box
  }
})
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/popup', () => ({ popup: { info: mocks.info, confirm: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { warning: mocks.warning, success: vi.fn(), error: vi.fn() } }))
vi.mock('@renderer/utils/file', () => ({ formatFileSize: () => '' }))
vi.mock('@renderer/utils/style', () => ({ cn: () => '' }))
vi.mock('../BackupPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../RestorePopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../ClearCachePopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../ModelSettingsConflictPopup', () => ({ default: { show: mocks.show } }))
import BasicDataSettings from '../BasicDataSettings'
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockResolvedValue(undefined)
})
it('locks the entire preview and decision flow against concurrent import clicks', async () => {
  let resolvePreview!: (value: unknown) => void
  mocks.request.mockImplementation((route: string) =>
    route === 'model_settings.import_preview'
      ? new Promise((resolve) => {
          resolvePreview = resolve
        })
      : Promise.resolve(undefined)
  )
  render(<BasicDataSettings />)
  const button = screen.getByRole('button', { name: 'settings.data.model_settings.import_button' })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(mocks.request.mock.calls.filter(([route]) => route === 'model_settings.import_preview')).toHaveLength(1)
  expect(button).toBeDisabled()
  let resolveDecision!: (value: unknown) => void
  mocks.show.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveDecision = resolve
      })
  )
  await act(async () => {
    resolvePreview({ handle: 'opaque', conflicts: [{ key: 'provider:relay', kind: 'provider', label: 'Relay' }] })
  })
  expect(button).toBeDisabled()
  fireEvent.click(button)
  await act(async () => {
    resolveDecision(null)
  })
  expect(button).toBeEnabled()
  expect(mocks.request.mock.calls.filter(([route]) => route === 'model_settings.import_apply')).toHaveLength(0)
})
it('applies only the opaque handle and shows each failed item kind, id and reason', async () => {
  mocks.request.mockImplementation((route: string) =>
    Promise.resolve(
      route === 'model_settings.import_preview'
        ? { handle: 'opaque', conflicts: [] }
        : route === 'model_settings.import_apply'
          ? {
              created: 0,
              replaced: 0,
              skipped: 0,
              failed: [{ kind: 'model', id: 'relay::gpt', reason: 'provider_not_imported' }]
            }
          : undefined
    )
  )
  render(<BasicDataSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'settings.data.model_settings.import_button' }))
  await waitFor(() => expect(mocks.info).toHaveBeenCalledOnce())
  expect(mocks.request).toHaveBeenCalledWith('model_settings.import_apply', { handle: 'opaque', decisions: {} })
  const { content } = mocks.info.mock.calls[0][0]
  render(content)
  expect(screen.getByText('model: relay::gpt, provider_not_imported')).toBeInTheDocument()
})
