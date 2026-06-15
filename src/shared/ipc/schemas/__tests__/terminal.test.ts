import { describe, expect, it } from 'vitest'

import { terminalRequestSchemas } from '../terminal'

describe('terminalRequestSchemas', () => {
  it('declares exactly the migrated terminal routes', () => {
    expect(Object.keys(terminalRequestSchemas).sort()).toEqual(
      [
        'terminal.check_git_bash',
        'terminal.get_git_bash_path',
        'terminal.get_git_bash_path_info',
        'terminal.set_git_bash_path'
      ].sort()
    )
  })

  it('void-input routes accept undefined', () => {
    const voidRoutes = [
      'terminal.check_git_bash',
      'terminal.get_git_bash_path',
      'terminal.get_git_bash_path_info'
    ] as const

    for (const route of voidRoutes) {
      expect(terminalRequestSchemas[route].input.safeParse(undefined).success).toBe(true)
    }
  })

  it('set_git_bash_path accepts a string or null and rejects other values', () => {
    const schema = terminalRequestSchemas['terminal.set_git_bash_path'].input
    expect(schema.safeParse('C:\\Program Files\\Git\\bin\\bash.exe').success).toBe(true)
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse(undefined).success).toBe(false)
    expect(schema.safeParse(123).success).toBe(false)
  })

  it('git bash query outputs match the legacy nullable contract', () => {
    expect(
      terminalRequestSchemas['terminal.get_git_bash_path'].output.safeParse('C:\\Git\\bin\\bash.exe').success
    ).toBe(true)
    expect(terminalRequestSchemas['terminal.get_git_bash_path'].output.safeParse(null).success).toBe(true)
    expect(terminalRequestSchemas['terminal.get_git_bash_path'].output.safeParse(123).success).toBe(false)

    const infoSchema = terminalRequestSchemas['terminal.get_git_bash_path_info'].output
    expect(infoSchema.safeParse({ path: 'C:\\Git\\bin\\bash.exe', source: 'manual' }).success).toBe(true)
    expect(infoSchema.safeParse({ path: 'C:\\Git\\bin\\bash.exe', source: 'auto' }).success).toBe(true)
    expect(infoSchema.safeParse({ path: null, source: null }).success).toBe(true)
    expect(infoSchema.safeParse({ path: null, source: 'env' }).success).toBe(false)
  })

  it('boolean outputs parse as declared', () => {
    expect(terminalRequestSchemas['terminal.check_git_bash'].output.safeParse(true).success).toBe(true)
    expect(terminalRequestSchemas['terminal.check_git_bash'].output.safeParse('true').success).toBe(false)
    expect(terminalRequestSchemas['terminal.set_git_bash_path'].output.safeParse(false).success).toBe(true)
  })
})
