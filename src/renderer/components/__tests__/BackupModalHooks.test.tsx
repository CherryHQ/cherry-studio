// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getHostname: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@renderer/services/BackupService', () => ({
  backupToLocal: vi.fn(),
  backupToS3: vi.fn(),
  backupToWebdav: vi.fn()
}))

import { useLocalBackupModal } from '../LocalBackupModals'
import { useS3BackupModal } from '../S3Modals'
import { useWebdavBackupModal } from '../WebdavModals'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

type BackupModalHook = () => {
  customFileName: string
  isModalVisible: boolean
  showBackupModal: () => Promise<void>
}

const hooks: Array<[string, BackupModalHook]> = [
  ['local', () => useLocalBackupModal('/tmp/backups')],
  ['WebDAV', () => useWebdavBackupModal()],
  ['S3', () => useS3BackupModal()]
]

describe.each(hooks)('use%sBackupModal', (_name, useBackupModal) => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { system: { getHostname: mocks.getHostname } }
    })
  })

  it('reads device type and hostname concurrently before opening', async () => {
    const deviceType = createDeferred<string>()
    const hostname = createDeferred<string>()
    mocks.request.mockReturnValue(deviceType.promise)
    mocks.getHostname.mockReturnValue(hostname.promise)
    const { result } = renderHook(() => useBackupModal())

    let opening!: Promise<void>
    act(() => {
      opening = result.current.showBackupModal()
    })

    expect(mocks.request).toHaveBeenCalledWith('system.get_device_type')
    expect(mocks.getHostname).toHaveBeenCalledOnce()

    await act(async () => {
      deviceType.resolve('macOS')
      await deviceType.promise
    })
    expect(result.current.isModalVisible).toBe(false)

    await act(async () => {
      hostname.resolve('test-host')
      await opening
    })

    expect(result.current.isModalVisible).toBe(true)
    expect(result.current.customFileName).toMatch(/^cherry-studio\.\d{14}\.test-host\.macOS\.zip$/)
  })
})
