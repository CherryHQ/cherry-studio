import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, expect, it, vi } from 'vitest'

import { ComputerUse, type ComputerUseClient } from '@cherrystudio/computer-use'
import type * as ComputerUseModule from '@cherrystudio/computer-use'
import { BaseService } from '@main/core/lifecycle'

import { ComputerUseService } from '../ComputerUseService'
import { TrayService } from '../TrayService'

vi.mock('@cherrystudio/computer-use', async (original) => ({
  ...(await original<typeof ComputerUseModule>()),
  ComputerUse: { start: vi.fn() }
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/app' },
  Menu: { buildFromTemplate: (template: unknown) => template },
  nativeImage: { createFromPath: () => ({ resize: () => ({ setTemplateImage() {} }) }) },
  nativeTheme: { shouldUseDarkColors: false },
  Tray: class {
    on() {}
    setContextMenu() {}
    setImage() {}
    setToolTip() {}
  }
}))
vi.mock('@main/core/platform', () => ({ isLinux: true, isMac: false, isWin: false, isPortable: false }))
vi.mock('@main/core/preboot/userDataLocation', () => ({ getNormalizedExecutablePath: () => '/app' }))
vi.mock('@main/utils/appEdition', () => ({ getApplicationId: () => 'app' }))
vi.mock('@main/utils/windowsExecutableSignature', () => ({ isRunningWindowsExecutableSigned: () => true }))
vi.mock('@main/i18n', () => ({
  t: (key: string, params?: { app: string; status: string }) => (params ? `${params.app}:${params.status}` : key)
}))

type Item = { label?: string; enabled?: boolean; submenu?: Item[]; click?: () => void }

beforeEach(() => {
  BaseService.resetInstances()
  MockApplicationUtils.resetServices()
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.agent_control.enabled', true)
})

it('constructs tray actions from real stopped, active and unconfirmed controls', async () => {
  let failClose = false
  const client = {
    openAppSession: async ({ appId }: { appId: string }) => ({
      id: appId,
      app: { id: appId, name: appId === 'one' ? 'Editor' : 'Browser' },
      status: 'active'
    }),
    stopAppSession: async ({ appSessionId }: { appSessionId: string }) => ({
      appSessionId,
      status: 'stopped',
      cleanup: 'complete'
    }),
    onClosed: () => () => {},
    close: async () => {
      if (failClose) throw new Error('cleanup failed')
    }
  } as unknown as ComputerUseClient
  vi.mocked(ComputerUse.start).mockResolvedValue(client)
  const service = new ComputerUseService()
  MockApplicationUtils.setService('ComputerUseService', service)
  const tray = new TrayService()
  const menu = () => {
    tray.onActivate()
    const template = (tray as unknown as { contextMenu: Item[] }).contextMenu
    return template.find((item) => item.label === 'tray.computer_use.title')?.submenu ?? []
  }
  const task = service.createTask('owner', 'Conversation')
  await service.openApp(task, 'one')
  await service.openApp(task, 'two')
  expect(menu().find((item) => item.label?.startsWith('Editor:'))?.submenu?.[0]).toMatchObject({
    label: 'tray.computer_use.stop',
    enabled: true
  })
  await service.stopApp('owner', 'one')
  expect(menu().find((item) => item.label?.startsWith('Editor:'))?.submenu?.[0]).toMatchObject({
    label: 'tray.computer_use.allow',
    enabled: true
  })
  await service.stopAll()
  expect(menu().map((item) => item.label)).toEqual(
    expect.arrayContaining([
      'Editor:tray.computer_use.stopped',
      'Browser:tray.computer_use.stopped',
      'tray.computer_use.all_apps:tray.computer_use.stopped'
    ])
  )
  menu()
    .find((item) => item.label?.startsWith('Editor:'))
    ?.submenu?.[0].click?.()
  expect(menu().some((item) => item.label?.startsWith('Editor:'))).toBe(false)
  expect(menu().find((item) => item.label === 'tray.computer_use.stop_all')?.enabled).toBe(false)
  menu()
    .find((item) => item.label?.startsWith('tray.computer_use.all_apps:'))
    ?.submenu?.[0].click?.()
  expect(service.getControls()).toEqual([])
  failClose = true
  await service.openApp(service.createTask('owner', 'Conversation'), 'two')
  await service.stopAll()
  expect(menu().find((item) => item.label?.startsWith('Browser:'))?.submenu?.[0]).toMatchObject({
    label: 'tray.computer_use.stop',
    enabled: false
  })
})
