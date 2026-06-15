import { describe, expect, it } from 'vitest'

import { systemRequestSchemas } from '../system'

describe('systemRequestSchemas', () => {
  it('declares exactly the migrated system routes', () => {
    expect(Object.keys(systemRequestSchemas).sort()).toEqual(
      [
        'system.get_cpu_name',
        'system.get_device_type',
        'system.get_fonts',
        'system.get_hostname',
        'system.is_process_trusted',
        'system.request_process_trust'
      ].sort()
    )
  })

  it('all routes accept void input', () => {
    for (const route of Object.keys(systemRequestSchemas) as Array<keyof typeof systemRequestSchemas>) {
      expect(systemRequestSchemas[route].input.safeParse(undefined).success).toBe(true)
    }
  })

  it('system info outputs parse as declared', () => {
    expect(systemRequestSchemas['system.get_device_type'].output.safeParse('mac').success).toBe(true)
    expect(systemRequestSchemas['system.get_hostname'].output.safeParse('host.local').success).toBe(true)
    expect(systemRequestSchemas['system.get_cpu_name'].output.safeParse('Apple M4').success).toBe(true)
  })

  it('font and process trust outputs parse as declared', () => {
    expect(systemRequestSchemas['system.get_fonts'].output.safeParse(['Inter', 'SF Pro']).success).toBe(true)
    expect(systemRequestSchemas['system.get_fonts'].output.safeParse([123]).success).toBe(false)
    expect(systemRequestSchemas['system.is_process_trusted'].output.safeParse(true).success).toBe(true)
    expect(systemRequestSchemas['system.request_process_trust'].output.safeParse(false).success).toBe(true)
  })
})
