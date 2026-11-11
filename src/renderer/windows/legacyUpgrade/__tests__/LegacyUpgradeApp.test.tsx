import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import type { LegacyUpgradeScreen } from '@shared/types/legacyUpgrade'

import LegacyUpgradeApp from '../LegacyUpgradeApp'

const copy: LegacyUpgradeScreen = {
  title: 'Upgrade safely',
  message: 'Install 2.1.0 first',
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
