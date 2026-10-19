import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { t } from '@main/i18n'

import { mapGatewayBindError } from '../bindError'

const endpoint = { host: '127.0.0.1', port: 23333 }
const denied = (fields = {}) =>
  Object.assign(new Error('raw bind failure'), { code: 'EACCES', syscall: 'listen', ...fields })

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
})

describe('gateway bind diagnostics', () => {
  it.each(['public', 'internal'] as const)(
    'gives %s listeners actionable recovery without losing the cause',
    (listener) => {
      const error = denied()
      const original = Object.getOwnPropertyDescriptors(error)
      const mapped = mapGatewayBindError(error, endpoint, listener) as Error
      expect(mapped.message).toContain('refused permission')
      expect(mapped.message).toContain('127.0.0.1,')
      expect(mapped.message).toContain('23333')
      expect(mapped.message).toContain('EACCES')
      if (listener === 'public') {
        expect(mapped.message).toContain('different Port')
        expect(mapped.message).toContain('click Start')
      } else {
        expect(mapped.message).toContain('Retry the request')
        expect(mapped.message).toContain('restrictions on loopback listeners')
        expect(mapped.message).not.toContain('Settings')
        expect(mapped.message).not.toContain('Port')
      }
      expect(mapped.cause).toBe(error)
      expect(Object.getOwnPropertyDescriptors(error)).toEqual(original)
      expect(mapped).not.toHaveProperty('code')
      expect(mapped).not.toHaveProperty('address')
    }
  )

  it.each([
    ['::1', 49152],
    ['::', 0],
    ['0.0.0.0', 24444]
  ] as const)('reports the failed Node endpoint %s:%s rather than a stale snapshot', (address, port) => {
    const mapped = mapGatewayBindError(denied({ address, port }), endpoint, 'internal') as Error
    expect(mapped.message).toContain(`${address}, requested TCP port ${port}`)
    expect(mapped.message).not.toContain('23333')
    expect(mapped.message).not.toContain(`[${address}]`)
  })

  it.each(['public', 'internal'] as const)('resolves real English and Chinese %s recovery copy', (listener) => {
    const key = `api_gateway.errors.${listener}_bind_permission_denied`
    const params = { address: '::1', port: 49152 }
    expect(t(key, params, 'en-US')).toContain('refused permission')
    const chinese = t(key, params, 'zh-CN')
    expect(chinese).toContain('操作系统拒绝')
    expect(chinese).toContain('::1')
    expect(chinese).toContain('49152')
    expect(chinese).toContain(listener === 'public' ? '启动' : '重试请求')
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
    expect((mapGatewayBindError(denied(params), endpoint, listener) as Error).message).toBe(chinese)
  })

  it.each([
    Object.assign(new Error('occupied'), { code: 'EADDRINUSE', syscall: 'listen' }),
    Object.assign(new Error('unavailable'), { code: 'EADDRNOTAVAIL', syscall: 'listen' }),
    Object.assign(new Error('unsupported'), { code: 'EAFNOSUPPORT', syscall: 'listen' }),
    denied({ syscall: 'open' }),
    Object.assign(new Error('EACCES'), { code: 'EACCES' }),
    new Error('listen EACCES'),
    { code: 'EACCES', syscall: 'listen' },
    'EACCES',
    null
  ])('preserves unrelated failures by identity: %s', (error) => {
    expect(mapGatewayBindError(error, endpoint, 'public')).toBe(error)
  })
})
