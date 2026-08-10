import { beforeEach, describe, expect, it, vi } from 'vitest'

const { open } = vi.hoisted(() => ({
  open: vi.fn()
}))

vi.mock('@main/services/ExternalAppsService', () => ({
  externalAppsService: { open }
}))

import { externalAppHandlers } from '../externalApp'

const input = { appId: 'wt' as const, targetPath: 'C:\\work\\project' }

describe('externalAppHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the requested external app through ExternalAppsService', async () => {
    open.mockResolvedValue(undefined)

    await externalAppHandlers['external_app.open'](input, { senderId: 'main-1' })

    expect(open).toHaveBeenCalledWith('wt', 'C:\\work\\project')
  })

  it('accepts a trusted caller without a managed window id', async () => {
    open.mockResolvedValue(undefined)

    await externalAppHandlers['external_app.open'](input, { senderId: null })

    expect(open).toHaveBeenCalledWith('wt', 'C:\\work\\project')
  })

  it('forwards launch failures', async () => {
    open.mockRejectedValue(new Error('spawn failed'))

    await expect(externalAppHandlers['external_app.open'](input, { senderId: 'main-1' })).rejects.toThrow(
      'spawn failed'
    )
  })
})
