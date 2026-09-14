import { uuid } from 'systeminformation'
import { afterEach, expect, it, vi } from 'vitest'

import { getMachineCode } from '../machineCode'

vi.mock('systeminformation', () => ({ uuid: vi.fn() }))
afterEach(() => vi.resetAllMocks())

function systemIdentity(os: string) {
  return { os, hardware: 'unused-serial', macs: ['00:11:22:33:44:55'] }
}

it('normalizes equivalent system IDs into the same machine code', async () => {
  vi.mocked(uuid).mockResolvedValueOnce(systemIdentity('ABCDEF12-1234-5678-9ABC-1234567890AB'))
  const first = await getMachineCode()
  vi.mocked(uuid).mockResolvedValueOnce(systemIdentity('abcdef12123456789abc1234567890ab\n'))
  expect(await getMachineCode()).toBe(first)
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
})

it('distinguishes different system machine IDs', async () => {
  vi.mocked(uuid).mockResolvedValueOnce(systemIdentity('abcdef12123456789abc1234567890ab'))
  const first = await getMachineCode()
  vi.mocked(uuid).mockResolvedValueOnce(systemIdentity('abcdef12123456789abc1234567890ac'))
  expect(await getMachineCode()).not.toBe(first)
})

it.each(['', 'unknown', 'hostname', '0'.repeat(32), 'f'.repeat(32), '00000000-0000-0000-0000-000000000000'])(
  'rejects unavailable or placeholder machine IDs rather than generating an identity: %s',
  async (os) => {
    vi.mocked(uuid).mockResolvedValue(systemIdentity(os))
    await expect(getMachineCode()).rejects.toThrow('valid system machine ID is required')
  }
)
