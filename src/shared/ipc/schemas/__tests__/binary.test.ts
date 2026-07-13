import type { BinaryInstallRequest, BinaryToolSnapshot } from '@shared/types/binary'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  binaryAvailabilitySchema,
  binaryInstallRequestSchema,
  binaryOperationSchema,
  binaryToolSnapshotSchema
} from '../binary'

describe('binaryInstallRequestSchema', () => {
  it('keeps durable requestedVersion separate from one-shot targetVersion', () => {
    const request = binaryInstallRequestSchema.parse({
      intent: { name: 'codex', tool: 'npm:@openai/codex', requestedVersion: '0.97.0' },
      targetVersion: '0.98.0'
    })

    expectTypeOf(request).toEqualTypeOf<BinaryInstallRequest>()
    expect(request.intent.requestedVersion).toBe('0.97.0')
    expect(request.targetVersion).toBe('0.98.0')
  })

  it('allows a floating intent without a one-shot target', () => {
    expect(binaryInstallRequestSchema.safeParse({ intent: { name: 'codex', tool: 'npm:@openai/codex' } }).success).toBe(
      true
    )
  })
})

describe('binaryAvailabilitySchema', () => {
  it.each([
    { source: 'mise', tool: 'npm:@openai/codex', path: '/mise/shims/codex', version: '0.98.0' },
    { source: 'mise', tool: 'node', path: '/mise/shims/node' },
    { source: 'bundled', path: '/cherry/bin/rg', version: '14.1.0' },
    { source: 'system', path: '/usr/local/bin/gh' },
    { source: 'none' }
  ])('accepts the $source availability branch', (availability) => {
    expect(binaryAvailabilitySchema.safeParse(availability).success).toBe(true)
  })

  it('requires the canonical mise tool spec', () => {
    expect(binaryAvailabilitySchema.safeParse({ source: 'mise', path: '/mise/shims/node' }).success).toBe(false)
  })
})

describe('binaryOperationSchema', () => {
  it.each([
    { status: 'installing' },
    { status: 'removing' },
    { status: 'failed', action: 'remove', error: 'mise failed' },
    {
      status: 'failed',
      action: 'install',
      error: 'preference write failed',
      intent: { name: 'codex', tool: 'codex' }
    }
  ])('accepts the $status operation branch', (operation) => {
    expect(binaryOperationSchema.safeParse(operation).success).toBe(true)
  })

  it('requires an action and error for a failed operation', () => {
    expect(binaryOperationSchema.safeParse({ status: 'failed', error: 'mise failed' }).success).toBe(false)
    expect(binaryOperationSchema.safeParse({ status: 'failed', action: 'install' }).success).toBe(false)
  })
})

describe('binaryToolSnapshotSchema', () => {
  it('types a complete owned snapshot', () => {
    const snapshot = binaryToolSnapshotSchema.parse({
      name: 'codex',
      intent: { name: 'codex', tool: 'codex' },
      availability: { source: 'mise', tool: 'codex', path: '/mise/shims/codex', version: '0.98.0' },
      operation: { status: 'installing' }
    })

    expectTypeOf(snapshot).toEqualTypeOf<BinaryToolSnapshot>()
  })

  it('allows an unowned unavailable snapshot', () => {
    expect(binaryToolSnapshotSchema.safeParse({ name: 'gh', availability: { source: 'none' } }).success).toBe(true)
  })
})
