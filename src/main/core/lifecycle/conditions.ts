import os from 'node:os'

import type { ConditionContext, ServiceCondition } from './types'

/**
 * Create a ConditionContext from the current runtime environment.
 * Called once at ServiceContainer construction.
 */
export function createConditionContext(): ConditionContext {
  const cpus = os.cpus()
  return {
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus.length > 0 ? cpus[0].model : '',
    env: process.env as Record<string, string | undefined>
  }
}

/**
 * Activate only on the specified platform(s).
 * @example onPlatform('darwin')           // macOS only
 * @example onPlatform('win32', 'linux')   // Windows or Linux
 */
export function onPlatform(...platforms: NodeJS.Platform[]): ServiceCondition {
  return {
    description: `requires platform ${platforms.join(' | ')}`,
    matches(ctx) {
      return platforms.includes(ctx.platform)
    }
  }
}

/**
 * Activate only on the specified architecture(s).
 * @example onArch('x64')           // x64 only
 * @example onArch('x64', 'arm64')  // x64 or arm64
 */
export function onArch(...architectures: NodeJS.Architecture[]): ServiceCondition {
  return {
    description: `requires arch ${architectures.join(' | ')}`,
    matches(ctx) {
      return architectures.includes(ctx.arch)
    }
  }
}

/**
 * Activate only when CPU model string contains the vendor name (case-insensitive).
 * Returns false when cpuModel is empty (e.g., os.cpus() returned an empty array).
 * @example onCpuVendor('intel')
 * @example onCpuVendor('amd')
 */
export function onCpuVendor(vendor: string): ServiceCondition {
  const vendorLower = vendor.toLowerCase()
  return {
    description: `requires ${vendor} CPU`,
    matches(ctx) {
      return ctx.cpuModel.length > 0 && ctx.cpuModel.toLowerCase().includes(vendorLower)
    }
  }
}

/**
 * Activate only when an environment variable is set (optionally matching a specific value).
 * @example onEnvVar('DEBUG')          // DEBUG is set (any value)
 * @example onEnvVar('DEBUG', 'true')  // DEBUG is set to 'true'
 */
export function onEnvVar(name: string, value?: string): ServiceCondition {
  return {
    description: value !== undefined ? `requires env ${name}=${value}` : `requires env ${name}`,
    matches(ctx) {
      const envValue = ctx.env[name]
      if (envValue === undefined) return false
      return value === undefined || envValue === value
    }
  }
}

/**
 * Wrap an arbitrary predicate function as a ServiceCondition.
 * The predicate receives the ConditionContext for testability.
 * @example when((ctx) => checkGpuAvailable(), 'requires NVIDIA GPU')
 */
export function when(predicate: (ctx: ConditionContext) => boolean, description: string): ServiceCondition {
  return {
    description,
    matches(ctx) {
      return predicate(ctx)
    }
  }
}

/**
 * Negate a condition.
 * @example not(onPlatform('linux'))  // everything except Linux
 */
export function not(condition: ServiceCondition): ServiceCondition {
  return {
    description: `NOT (${condition.description})`,
    matches(ctx) {
      return !condition.matches(ctx)
    }
  }
}

/**
 * OR logic: activate if ANY condition matches.
 * @example anyOf(onPlatform('darwin'), onPlatform('win32'))  // macOS or Windows
 */
export function anyOf(...conditions: ServiceCondition[]): ServiceCondition {
  return {
    description: conditions.map((c) => c.description).join(' OR '),
    matches(ctx) {
      return conditions.some((c) => c.matches(ctx))
    }
  }
}

/**
 * AND logic: activate if ALL conditions match.
 * Useful inside anyOf for nested boolean expressions.
 * @example anyOf(allOf(x1, x2), allOf(y1, y2))  // OR(AND(x1,x2), AND(y1,y2))
 */
export function allOf(...conditions: ServiceCondition[]): ServiceCondition {
  return {
    description: conditions.map((c) => c.description).join(' AND '),
    matches(ctx) {
      return conditions.every((c) => c.matches(ctx))
    }
  }
}
