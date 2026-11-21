import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { describe, expect, it } from 'vitest'

import { computeSkillFingerprint, evaluateSkillReadiness, type SkillEnvironmentSnapshot } from '../skillReadiness'

/**
 * Pure readiness decisions for the skill prerequisite preflight (Agent Note:
 * skill-dependency-preflight-and-isolation, spec AC1/AC2/AC7/AC8).
 */
describe('skillReadiness', () => {
  const baseSnapshot: SkillEnvironmentSnapshot = {
    platform: 'darwin',
    appVersion: '1.7.0',
    skillContentHash: 'abc123',
    binaries: { pandoc: { path: '/usr/local/bin/pandoc', version: '3.1.11' } },
    python: { path: '/usr/bin/python3', version: '3.12.1' }
  }

  describe('evaluateSkillReadiness', () => {
    it('marks a skill with no requires declaration ready, preserving current behavior (AC7)', () => {
      const result = evaluateSkillReadiness(undefined, baseSnapshot)

      expect(result).toEqual({ state: 'ready', missing: [] })
    })

    it('marks a skill whose declared binary is missing as setup_required, naming the binary (AC1)', () => {
      const snapshot = { ...baseSnapshot, binaries: { pandoc: null } }

      const result = evaluateSkillReadiness({ bins: ['pandoc'] }, snapshot)

      expect(result.state).toBe('setup_required')
      expect(result.missing).toEqual(['binary pandoc'])
    })

    it('marks a skill ready when its declared binary resolves', () => {
      const result = evaluateSkillReadiness({ bins: ['pandoc'] }, baseSnapshot)

      expect(result).toEqual({ state: 'ready', missing: [] })
    })

    it('reports an unavailable platform with the failing constraint and never marks ready (AC2)', () => {
      const result = evaluateSkillReadiness({ platforms: ['win32'] }, baseSnapshot)

      expect(result.state).toBe('setup_required')
      expect(result.missing).toEqual(['platform darwin not in [win32]'])
    })

    it('reports a missing python runtime with its constraint (AC2)', () => {
      const snapshot = { ...baseSnapshot, python: null }

      const result = evaluateSkillReadiness({ python: '>=3.10' }, snapshot)

      expect(result.state).toBe('setup_required')
      expect(result.missing).toEqual(['python (requires >=3.10)'])
    })

    it('reports a python version that violates the constraint (AC2)', () => {
      const snapshot = { ...baseSnapshot, python: { path: '/usr/bin/python3', version: '3.9.2' } }

      const result = evaluateSkillReadiness({ python: '>=3.10' }, snapshot)

      expect(result.state).toBe('setup_required')
      expect(result.missing).toEqual(['python 3.9.2 does not satisfy >=3.10'])
    })

    it('accepts a python version inside the constraint', () => {
      const result = evaluateSkillReadiness({ python: '>=3.10' }, baseSnapshot)

      expect(result).toEqual({ state: 'ready', missing: [] })
    })

    it('collects every failing prerequisite in one evaluation', () => {
      const snapshot = { ...baseSnapshot, binaries: { pandoc: null, ffmpeg: null }, python: null }

      const result = evaluateSkillReadiness({ bins: ['pandoc', 'ffmpeg'], python: '>=3.10' }, snapshot)

      expect(result.state).toBe('setup_required')
      expect(result.missing).toEqual(['binary pandoc', 'binary ffmpeg', 'python (requires >=3.10)'])
    })
  })

  it('requires verified installed package identities, and includes their versions in the fingerprint', () => {
    const requires = { packages: { pip: ['pypdf==5.1.0'] } }
    expect(evaluateSkillReadiness(requires, baseSnapshot).missing).toEqual(['pip pypdf==5.1.0'])
    const ready = { ...baseSnapshot, packages: { 'pypdf==5.1.0': { path: '/app/env/python', version: '5.1.0' } } }
    expect(evaluateSkillReadiness(requires, ready).state).toBe('ready')
    expect(computeSkillFingerprint(requires, ready)).not.toBe(computeSkillFingerprint(requires, baseSnapshot))
  })

  describe('computeSkillFingerprint', () => {
    it('is stable for identical inputs', () => {
      const requires = { bins: ['pandoc'], python: '>=3.10' }

      expect(computeSkillFingerprint(requires, baseSnapshot)).toBe(computeSkillFingerprint(requires, baseSnapshot))
    })

    it('is independent of declared binary order', () => {
      const snapshot = {
        ...baseSnapshot,
        binaries: { pandoc: baseSnapshot.binaries.pandoc, ffmpeg: { path: '/usr/bin/ffmpeg', version: '6.1' } }
      }

      expect(computeSkillFingerprint({ bins: ['pandoc', 'ffmpeg'] }, snapshot)).toBe(
        computeSkillFingerprint({ bins: ['ffmpeg', 'pandoc'] }, snapshot)
      )
    })

    it('changes when the app is upgraded (AC8)', () => {
      const requires = { bins: ['pandoc'] }
      const before = computeSkillFingerprint(requires, baseSnapshot)
      const after = computeSkillFingerprint(requires, { ...baseSnapshot, appVersion: '1.7.1' })

      expect(after).not.toBe(before)
    })

    it('changes when the skill content changes (AC8)', () => {
      const requires = { bins: ['pandoc'] }
      const before = computeSkillFingerprint(requires, baseSnapshot)
      const after = computeSkillFingerprint(requires, { ...baseSnapshot, skillContentHash: 'def456' })

      expect(after).not.toBe(before)
    })

    it('changes when a declared binary is upgraded in place (AC8)', () => {
      const requires = { bins: ['pandoc'] }
      const before = computeSkillFingerprint(requires, baseSnapshot)
      const after = computeSkillFingerprint(requires, {
        ...baseSnapshot,
        binaries: { pandoc: { path: '/usr/local/bin/pandoc', version: '3.2' } }
      })

      expect(after).not.toBe(before)
    })
  })
})
