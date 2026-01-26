import { useAppSelector } from '@renderer/store'

/**
 * Hook to track task completion status for user guide
 *
 * Task completion is now handled via guide completion in OnboardingProvider.
 * When a user completes a Driver.js guide, the corresponding task is marked complete.
 *
 * This hook simply returns the current task status from Redux state.
 */
export function useTaskCompletion() {
  const { taskStatus } = useAppSelector((state) => state.onboarding)
  return taskStatus
}
