import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { LegacyInstallState, LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

import LegacyUpgradeApp from '../LegacyUpgradeApp'

const copy: LegacyUpgradeScreen = {
  title: 'Upgrade safely',
  olderVersions: 'Older version upgrade instructions',
  detail: 'Keep your existing data',
  prerequisite: 'Run 1.9.12 if the old version is earlier or unknown',
  download: 'Download 2.1.0',
  downloadPrerequisite: 'Download 1.9.12',
  quit: 'Quit',
  dark: false
}

beforeEach(() => vi.clearAllMocks())

it.each([
  ['Download 2.1.0', 'bridge'],
  ['Download 1.9.12', 'prerequisite']
])('routes %s to its fixed installer choice and prevents duplicate actions', (label, target) => {
  render(<LegacyUpgradeApp screen={copy} />)
  expect(screen.queryByText(copy.prerequisite)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: copy.olderVersions }))
  expect(screen.getByText(copy.prerequisite)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: label }))
  expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('legacy-upgrade:download', target)
  expect(screen.getByRole('button', { name: 'Download 2.1.0' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download 1.9.12' })).toBeDisabled()
})

it('offers an exit without starting a download', () => {
  render(<LegacyUpgradeApp screen={copy} />)
  fireEvent.click(screen.getByRole('button', { name: 'Quit' }))
  expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith('legacy-upgrade:quit')
})

const installation = {
  enabled: true,
  prerequisite: false,
  action: 'Install migration version',
  detail: 'Restart into 2.1.0',
  cancel: 'Cancel',
  retry: 'Retry',
  preparing: 'Preparing',
  downloading: 'Downloading and verifying',
  installing: 'Restarting',
  failed: 'Install failed'
}

it('shows progress, cancellation and retry while never offering a second install during handoff', async () => {
  let publish!: (event: unknown, state: LegacyInstallState) => void
  vi.mocked(window.electron.ipcRenderer.on).mockImplementation((_channel, listener) => {
    publish = (event, state) => listener(event as Electron.IpcRendererEvent, state)
    return vi.fn()
  })
  vi.mocked(window.electron.ipcRenderer.invoke).mockImplementation(async (channel) =>
    channel === 'legacy-upgrade:get-state' ? { phase: 'idle' } : undefined
  )
  render(<LegacyUpgradeApp screen={{ ...copy, installation }} />)
  await screen.findByText(installation.detail)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: installation.action })))
  expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('legacy-upgrade:install')
  await act(async () => publish({}, { phase: 'downloading', percent: 42 }))
  expect(screen.getByText('42%')).toBeVisible()
  expect(screen.getByRole('button', { name: installation.action })).toBeDisabled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: installation.cancel })))
  expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('legacy-upgrade:cancel')
  await act(async () => publish({}, { phase: 'failed' }))
  expect(screen.getByRole('button', { name: installation.retry })).toBeEnabled()
  await act(async () => publish({}, { phase: 'installing' }))
  expect(screen.getByRole('button', { name: copy.quit })).toBeDisabled()
  expect(screen.queryByRole('button', { name: installation.cancel })).not.toBeInTheDocument()
})

it('uses the prerequisite installer instead of starting an unsafe bridge installation', async () => {
  render(
    <LegacyUpgradeApp screen={{ ...copy, installation: { ...installation, enabled: false, prerequisite: true } }} />
  )
  expect(screen.getByText(copy.prerequisite)).toBeVisible()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: copy.downloadPrerequisite })))
  expect(window.electron.ipcRenderer.invoke).toHaveBeenCalledWith('legacy-upgrade:download', 'prerequisite')
  expect(screen.queryByRole('button', { name: installation.action })).not.toBeInTheDocument()
})
