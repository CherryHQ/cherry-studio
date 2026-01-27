import type { VersionGuide } from '@renderer/types/onboarding'
import { describe, expect, it, vi } from 'vitest'

// Mock the allGuides to control test data
vi.mock('../guides', () => ({
  allGuides: [] as VersionGuide[]
}))

import { allGuides } from '../guides'
import { selectApplicableGuides } from '../index'

// Helper to set mock guides
function setMockGuides(guides: VersionGuide[]) {
  ;(allGuides as VersionGuide[]).length = 0
  ;(allGuides as VersionGuide[]).push(...guides)
}

// Test fixture: minimal guide factory
function createGuide(overrides: Partial<VersionGuide> & Pick<VersionGuide, 'version' | 'type'>): VersionGuide {
  return {
    titleKey: 'test.title',
    descriptionKey: 'test.description',
    steps: [],
    ...overrides
  }
}

describe('selectApplicableGuides', () => {
  describe('New User (completedOnboardingVersion === null && !onboardingSkipped)', () => {
    it('should return latest onboarding guide for new user', () => {
      setMockGuides([
        createGuide({ version: '1.6.0', type: 'onboarding' }),
        createGuide({ version: '1.7.0', type: 'onboarding' }),
        createGuide({ version: '1.5.0', type: 'onboarding' })
      ])

      const result = selectApplicableGuides('1.7.0', null, [], false)

      expect(result.isNewUser).toBe(true)
      expect(result.previousVersion).toBe(null)
      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].version).toBe('1.7.0')
    })

    it('should only return onboarding guides, not feature guides', () => {
      setMockGuides([
        createGuide({ version: '1.7.0', type: 'onboarding' }),
        createGuide({ version: '1.7.0', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', null, [], false)

      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].type).toBe('onboarding')
    })

    it('should return empty array when no onboarding guides exist', () => {
      setMockGuides([
        createGuide({ version: '1.7.0', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', null, [], false)

      expect(result.isNewUser).toBe(true)
      expect(result.guides).toHaveLength(0)
    })
  })

  describe('Skipped User (onboardingSkipped === true)', () => {
    it('should return no guides when user has skipped', () => {
      setMockGuides([
        createGuide({ version: '1.7.0', type: 'onboarding' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', null, [], true)

      expect(result.isNewUser).toBe(false)
      expect(result.guides).toHaveLength(0)
    })

    it('should preserve previousVersion when user has skipped', () => {
      setMockGuides([createGuide({ version: '1.7.0', type: 'onboarding' })])

      const result = selectApplicableGuides('1.8.0', '1.6.0', [], true)

      expect(result.previousVersion).toBe('1.6.0')
    })
  })

  describe('Upgrade User (completed onboarding, checking feature guides)', () => {
    it('should return feature guides newer than completed version', () => {
      setMockGuides([
        createGuide({ version: '1.7.0', type: 'onboarding' }),
        createGuide({ version: '1.7.5', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.isNewUser).toBe(false)
      expect(result.previousVersion).toBe('1.7.0')
      expect(result.guides).toHaveLength(2)
      expect(result.guides.map((g) => g.version)).toEqual(['1.7.5', '1.8.0'])
    })

    it('should not return feature guides older than completed version', () => {
      setMockGuides([
        createGuide({ version: '1.5.0', type: 'feature' }),
        createGuide({ version: '1.6.0', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].version).toBe('1.8.0')
    })

    it('should not return feature guides newer than current app version', () => {
      setMockGuides([
        createGuide({ version: '1.8.0', type: 'feature' }),
        createGuide({ version: '1.9.0', type: 'feature' }),
        createGuide({ version: '2.0.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].version).toBe('1.8.0')
    })

    it('should exclude already completed feature guides', () => {
      setMockGuides([
        createGuide({ version: '1.7.5', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', ['1.7.5'], false)

      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].version).toBe('1.8.0')
    })

    it('should not return onboarding guides for upgrade users', () => {
      setMockGuides([
        createGuide({ version: '1.8.0', type: 'onboarding' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].type).toBe('feature')
    })
  })

  describe('Sorting', () => {
    it('should sort feature guides by version ascending', () => {
      setMockGuides([
        createGuide({ version: '1.9.0', type: 'feature' }),
        createGuide({ version: '1.7.5', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.9.0', '1.7.0', [], false)

      expect(result.guides.map((g) => g.version)).toEqual(['1.7.5', '1.8.0', '1.9.0'])
    })

    it('should sort by priority (descending) when versions are equal', () => {
      setMockGuides([
        createGuide({ version: '1.8.0', type: 'feature', priority: 10 }),
        createGuide({ version: '1.8.0', type: 'feature', priority: 50 }),
        createGuide({ version: '1.8.0', type: 'feature', priority: 30 })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.guides.map((g) => g.priority)).toEqual([50, 30, 10])
    })

    it('should handle guides without priority (default to 0)', () => {
      setMockGuides([
        createGuide({ version: '1.8.0', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature', priority: 20 })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      expect(result.guides[0].priority).toBe(20)
      expect(result.guides[1].priority).toBeUndefined()
    })

    it('should sort onboarding guides by version descending (latest first)', () => {
      setMockGuides([
        createGuide({ version: '1.5.0', type: 'onboarding' }),
        createGuide({ version: '1.8.0', type: 'onboarding' }),
        createGuide({ version: '1.7.0', type: 'onboarding' })
      ])

      const result = selectApplicableGuides('1.8.0', null, [], false)

      // Only returns the latest one
      expect(result.guides).toHaveLength(1)
      expect(result.guides[0].version).toBe('1.8.0')
    })
  })

  describe('Edge Cases', () => {
    it('should return empty array when no guides exist', () => {
      setMockGuides([])

      const newUserResult = selectApplicableGuides('1.8.0', null, [], false)
      expect(newUserResult.guides).toHaveLength(0)

      const upgradeResult = selectApplicableGuides('1.8.0', '1.7.0', [], false)
      expect(upgradeResult.guides).toHaveLength(0)
    })

    it('should handle semver pre-release versions', () => {
      setMockGuides([
        createGuide({ version: '1.8.0-beta.1', type: 'feature' }),
        createGuide({ version: '1.8.0', type: 'feature' })
      ])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      // Pre-release < release for same version
      expect(result.guides.map((g) => g.version)).toEqual(['1.8.0-beta.1', '1.8.0'])
    })

    it('should handle feature guide version equal to completed version (not shown)', () => {
      setMockGuides([createGuide({ version: '1.7.0', type: 'feature' })])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      // 1.7.0 is not > 1.7.0, so should not be included
      expect(result.guides).toHaveLength(0)
    })

    it('should handle current version equal to feature guide version', () => {
      setMockGuides([createGuide({ version: '1.8.0', type: 'feature' })])

      const result = selectApplicableGuides('1.8.0', '1.7.0', [], false)

      // 1.8.0 <= 1.8.0, so should be included
      expect(result.guides).toHaveLength(1)
    })
  })
})
