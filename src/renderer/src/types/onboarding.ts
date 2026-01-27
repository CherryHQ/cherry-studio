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
  /** Interpolation values for description (e.g., { imageUrl: 'path/to/image.gif' }) */
  descriptionInterpolation?: Record<string, string>
  /** Popover position relative to element */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over'
  /** Popover alignment */
  align?: 'start' | 'center' | 'end'
  /** Route to navigate to before showing this step */
  navigateTo?: string
  /** Custom next button text (i18n key) */
  nextBtnTextKey?: string
  /** Custom done button text (i18n key, for last step) */
  doneBtnTextKey?: string
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
  /** Custom popover class for styling (e.g., 'user-guide-popover') */
  popoverClass?: string
}

/** Task status for user guide checklist */
export interface UserGuideTaskStatus {
  /** Whether user has used a free model */
  useFreeModel: boolean
  /** Whether user has configured a provider */
  configureProvider: boolean
  /** Whether user has sent the first message */
  sendFirstMessage: boolean
}

/** Redux state for onboarding */
export interface OnboardingState {
  /** Last completed onboarding version (e.g., "1.7.0") */
  completedOnboardingVersion: string | null
  /** Array of completed feature guide versions */
  completedFeatureGuides: string[]
  /** Whether user has explicitly skipped onboarding */
  onboardingSkipped: boolean
  /** Whether the initial guide page has been completed */
  guidePageCompleted: boolean
  /** Whether the checklist has been dismissed by user */
  checklistDismissed: boolean
  /** Whether the checklist popover is currently visible */
  checklistVisible: boolean
  /** Status of user guide tasks */
  taskStatus: UserGuideTaskStatus
  /** Whether the completion modal has been shown */
  completionModalShown: boolean
}
