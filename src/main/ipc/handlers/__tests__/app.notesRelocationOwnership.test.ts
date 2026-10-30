import { EventEmitter } from 'node:events'

import { it, expect, vi } from 'vitest'
const m = vi.hoisted(() => ({ windows: new Map<string, any>(), broadcast: vi.fn() }))
vi.mock('@application', () => ({
  application: {
    get: (name: string) =>
      name === 'WindowManager'
        ? { getWindow: (id: string) => m.windows.get(id), getWindowId: (w: any) => w.id, getWindowType: () => 'main' }
        : { broadcast: m.broadcast }
  }
}))
vi.mock('electron', () => ({ app: {}, BrowserWindow: { getAllWindows: () => [...m.windows.values()] } }))
vi.mock('@main/core/platform', () => ({ isWin: false }))
vi.mock('@main/services/cacheCleanup', () => ({ cacheCleanupService: {} }))
vi.mock('@main/services/dataReset', () => ({ requestDataReset: vi.fn(), requestV1Remigration: vi.fn() }))
vi.mock('@main/services/RegionService', () => ({ regionService: {} }))
vi.mock('@main/services/userDataRelocation', () => ({
  inspectUserDataRelocationTarget: vi.fn(),
  requestUserDataRelocation: vi.fn()
}))
vi.mock('@main/utils/mobileAppDownload', () => ({ getAndroidDownloadUrl: vi.fn() }))
vi.mock('@main/utils/zoom', () => ({ handleZoomFactor: vi.fn() }))
vi.mock('@main/services/notesRelocation', async () => ({
  ...(await import('../../../services/notesRelocation/notesRelocationSession')),
  ...(await import('../../../services/notesRelocation/notesRelocationOwnerLifecycle')),
  ...(await import('../../../services/notesRelocation/requestRendererNotesEditsFlush')),
  inspectNotesRelocation: vi.fn(),
  migrateNotesDirectory: vi.fn(),
  resolveNotesRelocationSourcePathFromPreference: vi.fn()
}))
import { resetNotesRelocationOwnerLifecycleForTests } from '../../../services/notesRelocation/notesRelocationOwnerLifecycle'
import {
  getActiveNotesRelocationSession,
  resetNotesRelocationSessionForTests
} from '../../../services/notesRelocation/notesRelocationSession'
import {
  registerRendererNotesEditsFlushWindow,
  unregisterRendererNotesEditsFlushWindow,
  acknowledgeRendererNotesEditsFlush
} from '../../../services/notesRelocation/requestRendererNotesEditsFlush'
import { appHandlers } from '../app'
function win(id: string) {
  const w: any = new EventEmitter()
  w.id = id
  w.isDestroyed = () => false
  w.webContents = new EventEmitter()
  w.webContents.isDestroyed = () => false
  return w
}
it('obsolete A flush timeout preserves B termination listener and releases B when closed', async () => {
  vi.useFakeTimers()
  resetNotesRelocationSessionForTests()
  resetNotesRelocationOwnerLifecycleForTests()
  m.broadcast.mockClear()
  const a = win('A'),
    survivor = win('survivor')
  m.windows.set('A', a)
  m.windows.set('survivor', survivor)
  registerRendererNotesEditsFlushWindow('A')
  registerRendererNotesEditsFlushWindow('survivor')
  try {
    const old = appHandlers['app.notes_relocation.begin_barrier'](undefined, { senderId: 'A' }).catch((e) => e)
    const requestA = m.broadcast.mock.calls.find((c) => c[0] === 'app.notes_relocation.flush_edits')![1].requestId
    acknowledgeRendererNotesEditsFlush(requestA, 'A', true)
    a.emit('closed')
    m.windows.delete('A')
    expect(getActiveNotesRelocationSession()).toBe(null)
    const b = win('B')
    m.windows.set('B', b)
    registerRendererNotesEditsFlushWindow('B')
    const next = appHandlers['app.notes_relocation.begin_barrier'](undefined, { senderId: 'B' })
    const requestB = m.broadcast.mock.calls
      .filter((c) => c[0] === 'app.notes_relocation.flush_edits')
      .at(-1)![1].requestId
    acknowledgeRendererNotesEditsFlush(requestB, 'B', true)
    acknowledgeRendererNotesEditsFlush(requestB, 'survivor', true)
    await next
    expect(b.listenerCount('closed')).toBe(1)
    await vi.advanceTimersByTimeAsync(30000)
    expect((await old).code).toBe('NOTES_RELOCATION_FLUSH_FAILED')
    expect(getActiveNotesRelocationSession()?.ownerId).toBe('B')
    expect(b.listenerCount('closed')).toBe(1)
    b.emit('closed')
    expect(getActiveNotesRelocationSession()).toBe(null)
    expect(m.broadcast.mock.calls.filter((c) => c[0] === 'app.notes_relocation.migrate_complete')).toHaveLength(2)
  } finally {
    for (const id of ['A', 'B', 'survivor']) unregisterRendererNotesEditsFlushWindow(id)
    m.windows.clear()
    resetNotesRelocationOwnerLifecycleForTests()
    resetNotesRelocationSessionForTests()
    vi.useRealTimers()
  }
})

it('releases and clears the matching current owner when its flush times out', async () => {
  vi.useFakeTimers()
  resetNotesRelocationSessionForTests()
  resetNotesRelocationOwnerLifecycleForTests()
  m.broadcast.mockClear()
  const current = win('current')
  m.windows.set('current', current)
  registerRendererNotesEditsFlushWindow('current')
  try {
    const pending = appHandlers['app.notes_relocation.begin_barrier'](undefined, { senderId: 'current' }).catch(
      (e) => e
    )
    expect(current.listenerCount('closed')).toBe(1)
    await vi.advanceTimersByTimeAsync(30000)
    expect((await pending).code).toBe('NOTES_RELOCATION_FLUSH_FAILED')
    expect(getActiveNotesRelocationSession()).toBe(null)
    expect(current.listenerCount('closed')).toBe(0)
    expect(m.broadcast.mock.calls.filter((c) => c[0] === 'app.notes_relocation.migrate_complete')).toHaveLength(1)
  } finally {
    unregisterRendererNotesEditsFlushWindow('current')
    m.windows.clear()
    resetNotesRelocationOwnerLifecycleForTests()
    resetNotesRelocationSessionForTests()
    vi.useRealTimers()
  }
})
