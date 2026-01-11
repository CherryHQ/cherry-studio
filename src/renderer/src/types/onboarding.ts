/**
 * Onboarding types for user guide system
 */

/** Single step in a guide tour */
export interface GuideStep {
  /** Unique step ID for tracking */
  id: string
  /** CSS selector for target element (optional for modal-style steps) */
  element?: string | (() => Element | null)
  /** i18n key for title */
  titleKey: string
  /** i18n key for description */
  descriptionKey: string
  /** Popover position relative to element */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over'
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
  /** Route to navigate to before showing this step */
  navigateTo?: string
}

/** Version-specific guide definition */
export interface VersionGuide {
  /** Target version (semver string, e.g., "1.7.0", "1.8.0") */
  version: string
  /** Guide type: 'onboarding' for new users, 'feature' for upgrades */
  type: 'onboarding' | 'feature'
  /** i18n key for guide title */
  titleKey: string
  /** i18n key for guide description */
  descriptionKey: string
  /** Ordered list of steps */
  steps: GuideStep[]
  /** Route where this guide should be triggered (default: '/') */
  route?: string
  /** Priority for ordering when multiple guides apply (higher = first) */
  priority?: number
}

/** Redux state for onboarding */
export interface OnboardingState {
  /** Last completed onboarding version (e.g., "1.7.0") */
  completedOnboardingVersion: string | null
  /** Array of completed feature guide versions */
  completedFeatureGuides: string[]
  /** Whether user has explicitly skipped onboarding */
  onboardingSkipped: boolean
}
