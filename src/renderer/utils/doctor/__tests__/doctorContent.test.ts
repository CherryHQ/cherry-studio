import { createInstance } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { ERROR_CATEGORIES } from '@shared/utils/errorCategory'

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

  // Missing catalog entries expose machine tokens such as bad_request to users.
  it('translates all 20 categories through every real renderer catalog', async () => {
    const catalogs = import.meta.glob<Record<string, string>>('../../../i18n/locales/*.json', {
      eager: true,
      import: 'default'
    })
    expect(Object.keys(catalogs)).toHaveLength(15)
    expect(ERROR_CATEGORIES).toHaveLength(20)
    for (const [path, catalog] of Object.entries(catalogs)) {
      const i18n = createInstance()
      await i18n.init({
        lng: 'test',
        fallbackLng: false,
        keySeparator: false,
        resources: { test: { translation: catalog } }
      })
      for (const category of ERROR_CATEGORIES) {
        const translated = doctorCheckDetailParams(i18n.t.bind(i18n), { category })?.category
        expect(translated, `${path}: ${category}`).not.toBe(category)
        expect(translated).toBeTruthy()
        expect(translated).not.toContain('[to be translated]')
      }
    }
  })

  it('leaves other params unchanged when there is no category', () => {
    expect(doctorCheckDetailParams(vi.fn(), { provider: 'DeepSeek' })).toEqual({ provider: 'DeepSeek' })
  })
})
