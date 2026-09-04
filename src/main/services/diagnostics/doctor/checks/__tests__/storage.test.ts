import { describe, expect, it, vi } from 'vitest'

const preboot = vi.hoisted(() => ({ isUsableDataDir: vi.fn() }))
vi.mock('@main/core/preboot/userDataLocation', () => preboot)

const { userDataWritable } = await import('../storage')
const ctx = { signal: new AbortController().signal }

describe('storage-userdata-writable', () => {
  it('passes when the user data directory is usable', async () => {
    preboot.isUsableDataDir.mockReturnValue(true)
    await expect(userDataWritable.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(preboot.isUsableDataDir).toHaveBeenCalledWith('/mock/app.userdata')
  })

  it('fails with the path and both escape hatches when it is not', async () => {
    preboot.isUsableDataDir.mockReturnValue(false)
    await expect(userDataWritable.run(ctx)).resolves.toMatchObject({
      status: 'fail',
      detail: { variant: 'not_writable', params: { path: '/mock/app.userdata' } },
      actions: [
        { kind: 'open_path', path: '/mock/app.userdata' },
        { kind: 'navigate', target: '/settings/data' }
      ]
    })
  })
})
