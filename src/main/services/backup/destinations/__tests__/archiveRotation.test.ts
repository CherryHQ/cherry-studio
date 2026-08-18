import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/utils/system', () => ({
  getHostname: () => 'work-laptop',
  getDeviceType: () => 'mac'
}))

const { archiveName, isOwnArchive, pruneToLimit } = await import('../archiveRotation')

function transport(names: string[]) {
  const remove = vi.fn().mockResolvedValue(undefined)
  return {
    remove,
    list: vi.fn().mockResolvedValue(
      names.map((name, index) => ({
        name,
        // Descending age: the first entry is the newest.
        modifiedAt: 1_000_000 - index,
        size: 1
      }))
    ),
    upload: vi.fn(),
    download: vi.fn(),
    check: vi.fn()
  }
}

const OWN = ['cherry-studio.20260104000000.work-laptop.mac.zip', 'cherry-studio.20260103000000.work-laptop.mac.zip']
const OTHER_HOST = 'cherry-studio.20260102000000.home-desktop.mac.zip'
const OTHER_DEVICE = 'cherry-studio.20260101000000.work-laptop.windows.zip'
// Written before the name carried a hostname — Nutstore's old convention.
const LEGACY = 'cherry-studio.20251201000000.mac.zip'

describe('archiveName', () => {
  it('carries the timestamp, host and device the rotation filter reads back', () => {
    const name = archiveName(new Date(2026, 0, 4, 9, 5, 3))

    expect(name).toBe('cherry-studio.20260104090503.work-laptop.mac.zip')
    expect(isOwnArchive(name)).toBe(true)
  })
})

describe('isOwnArchive', () => {
  it('claims only this device', () => {
    expect(isOwnArchive(OWN[0])).toBe(true)
    expect(isOwnArchive(OTHER_HOST)).toBe(false)
    expect(isOwnArchive(OTHER_DEVICE)).toBe(false)
  })

  it('does not claim archives written before the convention', () => {
    expect(isOwnArchive(LEGACY)).toBe(false)
  })

  it('ignores unrelated files sharing the folder', () => {
    expect(isOwnArchive('notes.zip')).toBe(false)
    expect(isOwnArchive('cherry-studio.20260104000000.work-laptop.mac.txt')).toBe(false)
  })
})

describe('pruneToLimit', () => {
  beforeEach(() => vi.clearAllMocks())

  // Several machines commonly sync one cloud folder. Counting the pooled listing
  // against one machine's limit is how they delete each other's backups.
  it('never touches another device or an unrecognized archive', async () => {
    const remote = transport([...OWN, OTHER_HOST, OTHER_DEVICE, LEGACY])

    await pruneToLimit(remote, 1)

    expect(remote.remove).toHaveBeenCalledExactlyOnceWith(OWN[1])
  })

  it('drops the oldest first, keeping exactly the limit', async () => {
    const remote = transport([...OWN, 'cherry-studio.20260102000000.work-laptop.mac.zip'])

    await pruneToLimit(remote, 2)

    expect(remote.remove).toHaveBeenCalledExactlyOnceWith('cherry-studio.20260102000000.work-laptop.mac.zip')
  })

  it('keeps everything when the limit is not exceeded', async () => {
    const remote = transport(OWN)

    await pruneToLimit(remote, 5)

    expect(remote.remove).not.toHaveBeenCalled()
  })

  it('treats a limit of zero as rotation disabled', async () => {
    const remote = transport(OWN)

    await pruneToLimit(remote, 0)

    expect(remote.list).not.toHaveBeenCalled()
    expect(remote.remove).not.toHaveBeenCalled()
  })

  // The upload already succeeded by this point; a stuck delete is not worth
  // reporting it as a failed backup.
  it('carries on when one archive cannot be deleted', async () => {
    const remote = transport([...OWN, 'cherry-studio.20260102000000.work-laptop.mac.zip'])
    remote.remove.mockRejectedValueOnce(new Error('locked'))

    await expect(pruneToLimit(remote, 1)).resolves.toBeUndefined()

    expect(remote.remove).toHaveBeenCalledTimes(2)
  })
})
