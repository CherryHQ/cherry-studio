import { useLocalBackupModal } from '@renderer/components/LocalBackupModals'
import { useS3BackupModal } from '@renderer/components/S3Modals'
import { useWebdavBackupModal } from '@renderer/components/WebdavModals'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockIpcRequest = vi.hoisted(() => vi.fn())
const mockGetHostname = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mockIpcRequest
  }
}))

vi.mock('@renderer/services/BackupService', () => ({
  backupToLocal: vi.fn(),
  backupToS3: vi.fn(),
  backupToWebdav: vi.fn()
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

type BackupModalHook = () => {
  isModalVisible: boolean
  showBackupModal: () => Promise<void>
}

async function expectMetadataRequestsToStartTogether(useBackupModal: BackupModalHook) {
  const deviceType = createDeferred<string>()
  const hostname = createDeferred<string>()
  mockIpcRequest.mockReturnValue(deviceType.promise)
  mockGetHostname.mockReturnValue(hostname.promise)

  const { result } = renderHook(useBackupModal)
  let opening!: Promise<void>
  act(() => {
    opening = result.current.showBackupModal()
  })

  expect(mockIpcRequest).toHaveBeenCalledWith('system.get_device_type')
  expect(mockGetHostname).toHaveBeenCalledOnce()
  expect(result.current.isModalVisible).toBe(false)

  await act(async () => {
    deviceType.resolve('mac')
    hostname.resolve('workstation')
    await opening
  })

  expect(result.current.isModalVisible).toBe(true)
}

describe('backup modal metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.api = {
      ...window.api,
      system: {
        ...window.api.system,
        getHostname: mockGetHostname
      }
    } as typeof window.api
  })

  it('starts S3 metadata requests together', async () => {
    await expectMetadataRequestsToStartTogether(useS3BackupModal)
  })

  it('starts local metadata requests together', async () => {
    await expectMetadataRequestsToStartTogether(() => useLocalBackupModal('/backups'))
  })

  it('starts WebDAV metadata requests together', async () => {
    await expectMetadataRequestsToStartTogether(useWebdavBackupModal)
  })
})
