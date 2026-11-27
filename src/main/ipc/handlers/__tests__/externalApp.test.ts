import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listOpenTargets, openTarget } = vi.hoisted(() => ({
  listOpenTargets: vi.fn(),
  openTarget: vi.fn()
}))

vi.mock('@main/services/externalApp', () => ({
  externalAppService: { listOpenTargets, openTarget }
}))

import { externalAppHandlers } from '../externalApp'

const input = { targetId: 'known:wt', targetPath: 'C:\\work\\project', pathKind: 'directory' as const }

describe('externalAppHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists targets through ExternalAppService', async () => {
    const result = {
      pathKind: 'directory' as const,
      recommendedTargetId: 'file_manager',
      targets: [{ id: 'file_manager', name: 'File Explorer', kind: 'file_manager' as const }]
    }
    listOpenTargets.mockResolvedValue(result)

    await expect(
      externalAppHandlers['external_app.target.list'](
        { targetPath: input.targetPath, pathKind: input.pathKind },
        { senderId: 'main-1' }
      )
    ).resolves.toBe(result)
    expect(listOpenTargets).toHaveBeenCalledWith(input.targetPath, input.pathKind)
  })

  it('preserves the merged default row, recommendation, and remaining editor through the handler', async () => {
    const result = {
      pathKind: 'file' as const,
      recommendedTargetId: 'system_default',
      targets: [
        {
          id: 'system_default',
          kind: 'system_default' as const,
          name: 'Visual Studio Code.app',
          iconDataUrl: 'data:image/png;base64,app'
        },
        { id: 'file_manager', kind: 'file_manager' as const },
        { id: 'known:cursor', kind: 'application' as const, name: 'Cursor' }
      ]
    }
    listOpenTargets.mockResolvedValue(result)

    await expect(
      externalAppHandlers['external_app.target.list'](
        { targetPath: '/tmp/README.md', pathKind: 'file' },
        { senderId: 'main-1' }
      )
    ).resolves.toBe(result)
  })

  it('opens the requested target through ExternalAppService', async () => {
    openTarget.mockResolvedValue(undefined)

    await externalAppHandlers['external_app.target.open'](input, { senderId: 'main-1' })

    expect(openTarget).toHaveBeenCalledWith('C:\\work\\project', 'known:wt', 'directory')
  })

  it('accepts a trusted caller without a managed window id', async () => {
    openTarget.mockResolvedValue(undefined)

    await externalAppHandlers['external_app.target.open'](input, { senderId: null })

    expect(openTarget).toHaveBeenCalledWith('C:\\work\\project', 'known:wt', 'directory')
  })

  it('forwards launch failures', async () => {
    openTarget.mockRejectedValue(new Error('spawn failed'))

    await expect(externalAppHandlers['external_app.target.open'](input, { senderId: 'main-1' })).rejects.toThrow(
      'spawn failed'
    )
  })
})
