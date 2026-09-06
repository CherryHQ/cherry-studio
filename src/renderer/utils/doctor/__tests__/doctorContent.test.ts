import { describe, expect, it, vi } from 'vitest'

import { resolveDoctorFixLabel } from '../doctorContent'

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
