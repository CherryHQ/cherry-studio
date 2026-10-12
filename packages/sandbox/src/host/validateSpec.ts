import { isAbsolute, normalize } from 'node:path'

import type { SandboxSpec } from '../types.js'
import { SandboxError } from './SandboxError.js'

export function validateSpec(spec: SandboxSpec): SandboxSpec {
  const invalid = () => {
    throw new SandboxError('INVALID_SPEC', 'Invalid sandbox specification')
  }
  const string = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0')
  const path = (value: unknown) =>
    string(value) &&
    isAbsolute(value) &&
    normalize(value) === value &&
    (process.platform !== 'win32' || (/^[a-z]:\\/i.test(value) && !value.slice(2).includes(':'))) &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  if (!spec || !string(spec.ownerId) || !spec.ownerId || !string(spec.environmentId) || !string(spec.runtimeProfileId))
    invalid()
  if (
    !spec.command ||
    !path(spec.command.executable) ||
    !path(spec.command.cwd) ||
    !Array.isArray(spec.command.args) ||
    !spec.command.args.every(string) ||
    !spec.command.env ||
    Object.entries(spec.command.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !string(value))
  )
    invalid()
  if (
    !spec.filesystem ||
    ['read', 'write', 'denyRead', 'denyWrite'].some((key) => {
      const paths = spec.filesystem[key as keyof SandboxSpec['filesystem']]
      return !Array.isArray(paths) || !paths.every(path)
    })
  )
    invalid()
  if (
    spec.mounts !== undefined &&
    (!Array.isArray(spec.mounts) ||
      spec.mounts.some(
        (mount) =>
          !mount || !path(mount.source) || !path(mount.target) || !['read', 'read-write'].includes(mount.access)
      ))
  )
    invalid()
  if (
    !spec.network ||
    !['deny', 'proxy', 'unrestricted'].includes(spec.network.mode) ||
    !['none', 'dedicated', 'stdio'].includes(spec.channel) ||
    !spec.limits
  )
    invalid()
  for (const key of [
    'startupTimeoutMs',
    'stopGraceMs',
    'stopTimeoutMs',
    'cleanupTimeoutMs',
    'ioDrainTimeoutMs',
    'ioBufferBytes'
  ] as const) {
    if (!Number.isSafeInteger(spec.limits[key]) || spec.limits[key] <= 0) invalid()
  }
  for (const value of Object.values(spec.limits)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647)) invalid()
  }
  if (spec.limits.stopGraceMs >= spec.limits.stopTimeoutMs) invalid()
  const copy = structuredClone(spec)
  function freeze(value: object) {
    Object.values(value).forEach((child) => {
      if (child && typeof child === 'object') freeze(child)
    })
    Object.freeze(value)
  }
  freeze(copy)
  return copy
}
