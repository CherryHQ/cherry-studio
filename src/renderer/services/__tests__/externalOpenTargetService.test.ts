import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  setPersist: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@data/CacheService', () => ({ cacheService: { setPersist: mocks.setPersist } }))

import { externalOpenTargetService, getExternalOpenTargetScope } from '../externalOpenTargetService'

describe('externalOpenTargetService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scopes preferences by directory or normalized file extension', () => {
    expect(getExternalOpenTargetScope('/tmp/workspace', 'directory')).toBe('directory')
    expect(getExternalOpenTargetScope('/tmp/REPORT.PDF', 'file')).toBe('file:pdf')
    expect(getExternalOpenTargetScope('/tmp/report.PDF ', 'file')).toBe('file:pdf')
    expect(getExternalOpenTargetScope('/tmp/.env', 'file')).toBe('file:no_extension')
    expect(getExternalOpenTargetScope('/tmp/README', 'file')).toBe('file:no_extension')
  })

  it('forwards the renderer path kind when listing targets', async () => {
    const result = { pathKind: 'file', recommendedTargetId: 'system_default', targets: [] } as const
    mocks.request.mockResolvedValue(result)

    await expect(externalOpenTargetService.list('/tmp/Dockerfile', 'file')).resolves.toBe(result)
    expect(mocks.request).toHaveBeenCalledWith('external_app.target.list', {
      targetPath: '/tmp/Dockerfile',
      pathKind: 'file'
    })
  })

  it('persists the selected target only after the main process opens it successfully', async () => {
    mocks.request.mockResolvedValue(undefined)

    await externalOpenTargetService.open('/tmp/report.pdf', 'file', 'system_default')

    expect(mocks.request).toHaveBeenCalledWith('external_app.target.open', {
      targetPath: '/tmp/report.pdf',
      pathKind: 'file',
      targetId: 'system_default'
    })
    const update = mocks.setPersist.mock.calls[0][1] as (value: Record<string, string>) => Record<string, string>
    expect(update({ 'file:txt': 'system_default' })).toEqual({
      'file:txt': 'system_default',
      'file:pdf': 'system_default'
    })
  })

  it('does not change the preference when opening fails', async () => {
    mocks.request.mockRejectedValue(new Error('open failed'))

    await expect(externalOpenTargetService.open('/tmp/report.pdf', 'file', 'system_default')).rejects.toThrow(
      'open failed'
    )
    expect(mocks.setPersist).not.toHaveBeenCalled()
  })
})
