import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { AbsoluteFilePath } from '@shared/types/file'

const { getPathStatusMock } = vi.hoisted(() => ({ getPathStatusMock: vi.fn() }))

vi.mock('@main/utils/file', () => ({ getPathStatus: getPathStatusMock }))

const { assertOpenableTarget } = await import('../openGuard')

describe('internal/system/openGuard — assertOpenableTarget', () => {
  beforeEach(() => {
    getPathStatusMock.mockReset()
  })

  it.each([
    ['missing', { ok: false, reason: 'missing' }],
    ['inaccessible', { ok: false, reason: 'inaccessible', code: 'EACCES' }]
  ])('rejects a %s target with the open-target error code', async (_label, status) => {
    getPathStatusMock.mockResolvedValueOnce(status)

    await expect(assertOpenableTarget('/tmp/gone/report.png' as AbsoluteFilePath)).rejects.toMatchObject({
      code: fileErrorCodes.OPEN_TARGET_UNAVAILABLE,
      data: { path: '/tmp/gone/report.png', reason: status.reason }
    })
  })

  it.each(['file', 'directory'])('accepts an existing %s', async (kind) => {
    getPathStatusMock.mockResolvedValueOnce({ ok: true, kind })

    await expect(assertOpenableTarget('/tmp/report.png' as AbsoluteFilePath)).resolves.toBeUndefined()
  })
})
