import { beforeEach, describe, expect, it, vi } from 'vitest'

const binaryManager = vi.hoisted(() => ({ getToolInventory: vi.fn() }))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'BinaryManager') return binaryManager
      throw new Error(`Unexpected service: ${name}`)
    }
  }
}))

const { managedTools } = await import('../runtime')
const ctx = { signal: new AbortController().signal }

beforeEach(() => {
  vi.clearAllMocks()
  binaryManager.getToolInventory.mockResolvedValue([])
})

describe('runtime-managed-tools', () => {
  it('ignores tools that are ready, absent, or not observable', async () => {
    binaryManager.getToolInventory.mockResolvedValue([
      { name: 'bun', status: 'ready' },
      { name: 'fd', status: 'not_installed' },
      { name: 'uv', status: 'unknown' }
    ])
    await expect(managedTools.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns for failed operations or broken managed installations', async () => {
    binaryManager.getToolInventory.mockResolvedValue([
      { name: 'bun', status: 'failed' },
      { name: 'fd', status: 'ready' },
      { name: 'uv', status: 'failed' }
    ])
    await expect(managedTools.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'failed', params: { count: 2 } },
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }],
      evidence: [{ key: 'tools', value: 'bun, uv', dataClass: 'public' }]
    })
  })
})
