import { describe, expect, it } from 'vitest'

import {
  allOf,
  anyOf,
  createConditionContext,
  not,
  onArch,
  onCpuVendor,
  onEnvVar,
  onPlatform,
  when
} from '../conditions'
import type { ConditionContext } from '../types'

const baseContext: ConditionContext = {
  platform: 'win32',
  arch: 'x64',
  cpuModel: '12th Gen Intel(R) Core(TM) i7-12700H',
  env: { DEBUG: 'true', NODE_ENV: 'development' }
}

describe('onPlatform', () => {
  it('should match when platform is in the list', () => {
    expect(onPlatform('win32').matches(baseContext)).toBe(true)
  })

  it('should not match when platform is not in the list', () => {
    expect(onPlatform('darwin').matches(baseContext)).toBe(false)
  })

  it('should match any of multiple platforms', () => {
    expect(onPlatform('darwin', 'win32').matches(baseContext)).toBe(true)
  })

  it('should have a descriptive description', () => {
    expect(onPlatform('darwin', 'win32').description).toBe('requires platform darwin | win32')
  })
})

describe('onArch', () => {
  it('should match when arch is in the list', () => {
    expect(onArch('x64').matches(baseContext)).toBe(true)
  })

  it('should not match when arch is not in the list', () => {
    expect(onArch('arm64').matches(baseContext)).toBe(false)
  })

  it('should match any of multiple architectures', () => {
    expect(onArch('arm64', 'x64').matches(baseContext)).toBe(true)
  })
})

describe('onCpuVendor', () => {
  it('should match Intel CPU (case-insensitive)', () => {
    expect(onCpuVendor('intel').matches(baseContext)).toBe(true)
    expect(onCpuVendor('Intel').matches(baseContext)).toBe(true)
    expect(onCpuVendor('INTEL').matches(baseContext)).toBe(true)
  })

  it('should not match AMD on Intel CPU', () => {
    expect(onCpuVendor('amd').matches(baseContext)).toBe(false)
  })

  it('should not match when cpuModel is empty', () => {
    const ctx: ConditionContext = { ...baseContext, cpuModel: '' }
    expect(onCpuVendor('intel').matches(ctx)).toBe(false)
  })

  it('should match AMD on AMD CPU', () => {
    const ctx: ConditionContext = { ...baseContext, cpuModel: 'AMD Ryzen 9 7950X' }
    expect(onCpuVendor('amd').matches(ctx)).toBe(true)
  })
})

describe('onEnvVar', () => {
  it('should match when env var exists (no value specified)', () => {
    expect(onEnvVar('DEBUG').matches(baseContext)).toBe(true)
  })

  it('should not match when env var does not exist', () => {
    expect(onEnvVar('NONEXISTENT').matches(baseContext)).toBe(false)
  })

  it('should match when env var has the specified value', () => {
    expect(onEnvVar('DEBUG', 'true').matches(baseContext)).toBe(true)
  })

  it('should not match when env var has a different value', () => {
    expect(onEnvVar('DEBUG', 'false').matches(baseContext)).toBe(false)
  })

  it('should have a descriptive description', () => {
    expect(onEnvVar('DEBUG').description).toBe('requires env DEBUG')
    expect(onEnvVar('DEBUG', 'true').description).toBe('requires env DEBUG=true')
  })
})

describe('when', () => {
  it('should call the predicate with context', () => {
    const condition = when((ctx) => ctx.platform === 'win32', 'Windows check')
    expect(condition.matches(baseContext)).toBe(true)
  })

  it('should return false when predicate returns false', () => {
    const condition = when(() => false, 'always false')
    expect(condition.matches(baseContext)).toBe(false)
  })

  it('should use the provided description', () => {
    const condition = when(() => true, 'my custom condition')
    expect(condition.description).toBe('my custom condition')
  })
})

describe('not', () => {
  it('should negate a true condition', () => {
    expect(not(onPlatform('win32')).matches(baseContext)).toBe(false)
  })

  it('should negate a false condition', () => {
    expect(not(onPlatform('linux')).matches(baseContext)).toBe(true)
  })

  it('should include NOT in description', () => {
    expect(not(onPlatform('linux')).description).toBe('NOT (requires platform linux)')
  })
})

describe('anyOf', () => {
  it('should match when any condition matches', () => {
    expect(anyOf(onPlatform('darwin'), onPlatform('win32')).matches(baseContext)).toBe(true)
  })

  it('should not match when no conditions match', () => {
    expect(anyOf(onPlatform('darwin'), onPlatform('linux')).matches(baseContext)).toBe(false)
  })

  it('should join descriptions with OR', () => {
    expect(anyOf(onPlatform('darwin'), onPlatform('win32')).description).toBe(
      'requires platform darwin OR requires platform win32'
    )
  })
})

describe('allOf', () => {
  it('should match when all conditions match', () => {
    expect(allOf(onPlatform('win32'), onArch('x64')).matches(baseContext)).toBe(true)
  })

  it('should not match when any condition fails', () => {
    expect(allOf(onPlatform('win32'), onArch('arm64')).matches(baseContext)).toBe(false)
  })

  it('should join descriptions with AND', () => {
    expect(allOf(onPlatform('win32'), onArch('x64')).description).toBe('requires platform win32 AND requires arch x64')
  })
})

describe('nested combinators', () => {
  it('should support anyOf(allOf(...), allOf(...))', () => {
    // OR(AND(win32, x64), AND(linux, arm64))
    const condition = anyOf(allOf(onPlatform('win32'), onArch('x64')), allOf(onPlatform('linux'), onArch('arm64')))
    // baseContext is win32 + x64 → first branch matches
    expect(condition.matches(baseContext)).toBe(true)

    // linux + arm64 → second branch matches
    const linuxArm: ConditionContext = { ...baseContext, platform: 'linux', arch: 'arm64' }
    expect(condition.matches(linuxArm)).toBe(true)

    // darwin + x64 → neither branch matches
    const darwinCtx: ConditionContext = { ...baseContext, platform: 'darwin' }
    expect(condition.matches(darwinCtx)).toBe(false)
  })
})

describe('createConditionContext', () => {
  it('should return a context with platform and arch', () => {
    const ctx = createConditionContext()
    expect(ctx.platform).toBe(process.platform)
    expect(ctx.arch).toBe(process.arch)
  })

  it('should return a context with cpuModel as string', () => {
    const ctx = createConditionContext()
    expect(typeof ctx.cpuModel).toBe('string')
  })

  it('should return a context with env', () => {
    const ctx = createConditionContext()
    expect(ctx.env).toBe(process.env)
  })
})
