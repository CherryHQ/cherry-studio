import { afterEach, describe, expect, it, vi } from 'vitest'

const originalGetSystemVersion = process.getSystemVersion

async function loadWindowUtil({ isWin, systemVersion = '' }: { isWin: boolean; systemVersion?: string }) {
  vi.resetModules()
  vi.doMock('../../constant', () => ({
    isDev: false,
    isWin
  }))

  const getSystemVersionMock = vi.fn(() => systemVersion)
  Object.defineProperty(process, 'getSystemVersion', {
    value: getSystemVersionMock,
    configurable: true
  })

  const windowUtil = await import('../windowUtil')
  return { ...windowUtil }
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.doUnmock('../../constant')

  Object.defineProperty(process, 'getSystemVersion', {
    value: originalGetSystemVersion,
    configurable: true
  })
})

describe('getWindowsBackgroundMaterial', () => {
  it('returns mica on Windows 11 22H2 and newer', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: '10.0.22621'
    })

    expect(getWindowsBackgroundMaterial()).toBe('mica')
  })

  it('returns undefined below the Windows 11 22H2 build threshold', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: '10.0.22000'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })

  it('returns undefined when the system version cannot be parsed', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: true,
      systemVersion: 'Windows 11'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })

  it('returns undefined on non-Windows platforms', async () => {
    const { getWindowsBackgroundMaterial } = await loadWindowUtil({
      isWin: false,
      systemVersion: '10.0.22621'
    })

    expect(getWindowsBackgroundMaterial()).toBeUndefined()
  })
})
