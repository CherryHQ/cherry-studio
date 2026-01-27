import { useAppSelector } from '@renderer/store'
import { useMemo } from 'react'

/**
 * Hook to access user guide state and computed values
 */
export function useUserGuide() {
  const onboarding = useAppSelector((state) => state.onboarding)

  const {
    guidePageCompleted,
    checklistDismissed,
    taskStatus,
    completionModalShown,
    completedOnboardingVersion,
    onboardingSkipped
  } = onboarding

  const allTasksCompleted = useMemo(
    () => taskStatus.useFreeModel && taskStatus.configureProvider && taskStatus.sendFirstMessage,
    [taskStatus]
  )

  const completedTaskCount = useMemo(() => {
    return [taskStatus.useFreeModel, taskStatus.configureProvider, taskStatus.sendFirstMessage].filter(Boolean).length
  }, [taskStatus])

  const shouldShowGuidePage = useMemo(() => {
    return !guidePageCompleted && completedOnboardingVersion === null && !onboardingSkipped
  }, [guidePageCompleted, completedOnboardingVersion, onboardingSkipped])

  const shouldShowChecklist = useMemo(() => {
    return guidePageCompleted && !checklistDismissed && !allTasksCompleted
  }, [guidePageCompleted, checklistDismissed, allTasksCompleted])

  const shouldShowCompletionModal = useMemo(() => {
    return allTasksCompleted && !completionModalShown && guidePageCompleted
  }, [allTasksCompleted, completionModalShown, guidePageCompleted])

  return {
    guidePageCompleted,
    checklistDismissed,
    taskStatus,
    completionModalShown,
    allTasksCompleted,
    completedTaskCount,
    shouldShowGuidePage,
    shouldShowChecklist,
    shouldShowCompletionModal
  }
}
