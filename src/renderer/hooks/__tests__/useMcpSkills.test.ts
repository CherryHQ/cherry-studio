import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { McpSkillEntry } from '@shared/types/mcpSkills'

import { useMcpSkills } from '../useMcpSkills'

const skill: McpSkillEntry = {
  serverId: 'healthy',
  serverName: 'Healthy origin',
  uri: 'skill://reports/SKILL.md',
  frontmatter: { name: 'reports', description: 'Build a report' },
  resources: [{ uri: 'skill://reports/SKILL.md', size: 0, digest: `sha256:${'0'.repeat(64)}` }]
}

type Discovery = PromiseWithResolvers<McpSkillEntry[]> & { serverId: string; requestId: string }
let pending: Discovery[]
let cancelled: string[]

beforeEach(() => {
  pending = []
  cancelled = []
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(async (route, input) => {
    if (route === 'mcp.request.cancel') {
      cancelled.push((input as { requestId: string }).requestId)
      return { ok: true, data: undefined }
    }
    if (route !== 'mcp.server.list_skills') throw new Error(`Unexpected route: ${route}`)
    const request = {
      ...(input as { serverId: string; requestId: string }),
      ...Promise.withResolvers<McpSkillEntry[]>()
    }
    pending.push(request)
    return { ok: true, data: await request.promise }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useMcpSkills', () => {
  it.each([false, true])('publishes a healthy catalog with a stalled origin: %s', async (includeStalled) => {
    const serverIds = includeStalled ? ['healthy', 'a-stalled'] : ['healthy']
    const { result } = renderHook(() => useMcpSkills(serverIds, true))

    await act(async () => pending.find((request) => request.serverId === 'healthy')!.resolve([skill]))
    expect(result.current).toEqual([{ serverId: 'healthy', skills: [skill] }])

    if (includeStalled) {
      await act(async () => pending.find((request) => request.serverId === 'a-stalled')!.resolve([]))
      expect(result.current).toEqual([
        { serverId: 'a-stalled', skills: [] },
        { serverId: 'healthy', skills: [skill] }
      ])
    }
  })

  it('publishes an origin error independently and retains healthy results when they arrive', async () => {
    const { result } = renderHook(() => useMcpSkills(['failed', 'healthy'], true))

    await act(async () => pending.find((request) => request.serverId === 'failed')!.reject(new Error('Offline')))
    expect(result.current).toEqual([{ serverId: 'failed', skills: [], error: 'Offline' }])

    await act(async () => pending.find((request) => request.serverId === 'healthy')!.resolve([skill]))
    expect(result.current).toEqual([
      { serverId: 'failed', skills: [], error: 'Offline' },
      { serverId: 'healthy', skills: [skill] }
    ])
  })

  it.each(['reopen', 'selection change'] as const)(
    'cancels previous discovery and ignores its late result after %s',
    async (change) => {
      const { result, rerender } = renderHook(({ ids, enabled }) => useMcpSkills(ids, enabled), {
        initialProps: { ids: ['healthy'], enabled: true }
      })
      const previous = pending[0]
      if (change === 'reopen') {
        rerender({ ids: ['healthy'], enabled: false })
        expect(result.current).toEqual([])
      }
      const serverId = change === 'reopen' ? 'healthy' : 'replacement'
      rerender({ ids: [serverId], enabled: true })
      expect(cancelled).toContain(previous.requestId)

      const current = { ...skill, serverId, frontmatter: { name: 'current', description: 'Current report' } }
      await act(async () => pending[1].resolve([current]))
      expect(result.current).toEqual([{ serverId, skills: [current] }])

      await act(async () => previous.resolve([skill]))
      expect(result.current).toEqual([{ serverId, skills: [current] }])
    }
  )
})
