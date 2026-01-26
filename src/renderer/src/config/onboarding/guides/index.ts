import type { VersionGuide } from '@renderer/types/onboarding'

export const allGuides: VersionGuide[] = []

// Export User Guide Step 2 guides
export {
  configureProviderGuideStep2,
  sendMessageGuideStep2,
  useFreeModelGuideStep2
} from './userGuideSteps'
