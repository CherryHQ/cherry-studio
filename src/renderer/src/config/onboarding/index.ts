import type { VersionGuide } from '@renderer/types/onboarding'
import { compare } from 'semver'

import { allGuides } from './guides'

export interface GuideSelectionResult {
  guides: VersionGuide[]
  isNewUser: boolean
  previousVersion: string | null
}

/**
 * Select applicable guides based on user's onboarding history
 */
export function selectApplicableGuides(
  currentVersion: string,
  completedOnboardingVersion: string | null,
  completedFeatureGuides: string[],
  onboardingSkipped: boolean
): GuideSelectionResult {
  const isNewUser = completedOnboardingVersion === null && !onboardingSkipped

  if (isNewUser) {
    // New user: Show latest onboarding guide only
    const onboardingGuides = allGuides
      .filter((g) => g.type === 'onboarding')
      .sort((a, b) => compare(b.version, a.version))

    return {
      guides: onboardingGuides.slice(0, 1),
      isNewUser: true,
      previousVersion: null
    }
  }

  if (onboardingSkipped) {
    // User has skipped onboarding, don't show any guides automatically
    return {
      guides: [],
      isNewUser: false,
      previousVersion: completedOnboardingVersion
    }
  }

  // Upgrade user: Show feature guides for versions between last completed and current
  const pendingFeatureGuides = allGuides
    .filter((g) => {
      if (g.type !== 'feature') return false
      if (completedFeatureGuides.includes(g.version)) return false

      // Guide version must be > completed version AND <= current version
      return compare(g.version, completedOnboardingVersion!) > 0 && compare(g.version, currentVersion) <= 0
    })
    .sort((a, b) => {
      // Sort by version (ascending) then priority (descending)
      const versionCompare = compare(a.version, b.version)
      if (versionCompare !== 0) return versionCompare
      return (b.priority ?? 0) - (a.priority ?? 0)
    })

  return {
    guides: pendingFeatureGuides,
    isNewUser: false,
    previousVersion: completedOnboardingVersion
  }
}

export { allGuides }
