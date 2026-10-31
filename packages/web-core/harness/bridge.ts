import '../src/page/preload'
import { cacheService } from '@data/CacheService'
import { dataApiService } from '@data/DataApiService'
import { preferenceService } from '@data/PreferenceService'
import { ipcApi } from '@renderer/ipc'
import { ipcChatTransport } from '@renderer/services/aiTransport'

import { CoreClient } from '../src/client/CoreClient'
import { connectCore } from '../src/page/electron'

// The desktop renderer's services over the Core Worker; tests drive `window.bridge` through page.evaluate.
const worker = new Worker(new URL('./harnessWorker.ts', import.meta.url), { type: 'module' })
const client = new CoreClient(worker)
connectCore(client)

Object.assign(globalThis, {
  bridge: {
    client,
    api: window.api,
    electron: window.electron,
    cacheService,
    dataApiService,
    preferenceService,
    ipcApi,
    ipcChatTransport
  }
})
