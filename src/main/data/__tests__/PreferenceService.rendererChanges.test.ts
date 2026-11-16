import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'

import type { PreferenceService as PreferenceServiceType } from '../PreferenceService'

vi.unmock('@main/data/PreferenceService')

// The global application mock resolves the app root to /mock/app.root, which the sender gate trusts.
const rendererEvent = {
  sender: { getType: () => 'window' },
  senderFrame: { url: pathToFileURL('/mock/app.root/index.html').href, parent: null }
} as unknown as IpcMainInvokeEvent

function ipcHandler(channel: string) {
  const call = vi.mocked(ipcMain.handle).mock.calls.findLast(([registered]) => registered === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<void>
}

describe('PreferenceService.onRendererPreferencesChanged', () => {
  setupTestDatabase()
  let service: PreferenceServiceType
  let changes: Array<Array<[string, unknown]>>

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.mocked(ipcMain.handle).mockClear()
    const { PreferenceService } = await import('../PreferenceService')
    service = new PreferenceService()
    await service._doInit()
    changes = []
    service.onRendererPreferencesChanged((entries) => changes.push(entries))
  })

  it('fires for a renderer write that changes a value', async () => {
    const next = !service.get('app.spell_check.enabled')
    await ipcHandler(IpcChannel.Preference_Set)(rendererEvent, 'app.spell_check.enabled', next)

    expect(changes).toEqual([[['app.spell_check.enabled', next]]])
  })

  it('does not fire for a renderer write of the current value', async () => {
    const current = service.get('app.spell_check.enabled')
    await ipcHandler(IpcChannel.Preference_Set)(rendererEvent, 'app.spell_check.enabled', current)

    expect(changes).toEqual([])
  })

  it('reports only the entries of a renderer batch write that changed', async () => {
    const tray = !service.get('app.tray.enabled')
    const zoom = service.get('app.zoom_factor') + 0.25
    await ipcHandler(IpcChannel.Preference_SetMultiple)(rendererEvent, {
      'app.spell_check.enabled': service.get('app.spell_check.enabled'),
      'app.tray.enabled': tray,
      'app.zoom_factor': zoom
    })

    expect(changes).toEqual([
      [
        ['app.tray.enabled', tray],
        ['app.zoom_factor', zoom]
      ]
    ])
  })

  it('does not fire for main-process writes', async () => {
    await service.set('app.spell_check.enabled', !service.get('app.spell_check.enabled'))
    await service.setMultiple({ 'app.tray.enabled': !service.get('app.tray.enabled') })

    expect(changes).toEqual([])
  })
})
