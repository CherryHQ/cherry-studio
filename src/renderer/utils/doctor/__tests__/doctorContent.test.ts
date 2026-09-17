import { describe, expect, it, vi } from 'vitest'

import { doctorCheckDetailParams, resolveDoctorFixLabel } from '../doctorContent'

describe('resolveDoctorFixLabel', () => {
  it('returns a static declaration without resolving a target name', () => {
    const resolveTargetName = vi.fn()

    expect(
      resolveDoctorFixLabel('permission-screen-capture', { kind: 'fix', fixId: 'request' }, resolveTargetName)
    ).toEqual({ key: 'settings.doctor.fixes.request_screen_capture' })
    expect(resolveTargetName).not.toHaveBeenCalled()
  })

  it('includes the current MCP server name for a targeted restart', () => {
    expect(
      resolveDoctorFixLabel(
        'mcp-servers-connected',
        { kind: 'fix', fixId: 'restart', target: 'filesystem' },
        (target) => (target === 'filesystem' ? 'Filesystem' : undefined)
      )
    ).toEqual({ key: 'settings.doctor.fixes.restart_mcp', params: { name: 'Filesystem' } })
  })

  it('falls back to a generic MCP restart label when the target no longer exists', () => {
    expect(
      resolveDoctorFixLabel(
        'mcp-servers-connected',
        { kind: 'fix', fixId: 'restart', target: 'deleted' },
        () => undefined
      )
    ).toEqual({ key: 'settings.doctor.fixes.restart_mcp_generic' })
  })
})

describe('doctorCheckDetailParams', () => {
  it('translates a machine category code for detail copy', () => {
    const t = vi.fn((key: string, options?: { defaultValue?: string }) =>
      key === 'settings.doctor.error_category.auth'
        ? 'Not signed in or the API key is invalid'
        : (options?.defaultValue ?? key)
    )

    expect(doctorCheckDetailParams(t, { category: 'auth' })).toEqual({
      category: 'Not signed in or the API key is invalid'
    })
    expect(t).toHaveBeenCalledWith('settings.doctor.error_category.auth', { defaultValue: 'auth' })
  })

  it('leaves other params unchanged when there is no category', () => {
    expect(doctorCheckDetailParams(vi.fn(), { provider: 'DeepSeek' })).toEqual({ provider: 'DeepSeek' })
  })
})
