import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { OnboardingState, UserGuideTaskStatus } from '@renderer/types/onboarding'

const initialState: OnboardingState = {
  completedOnboardingVersion: null,
  completedFeatureGuides: [],
  onboardingSkipped: false,
  guidePageCompleted: false,
  checklistDismissed: false,
  checklistVisible: false,
  taskStatus: {
    useFreeModel: false,
    configureProvider: false,
    sendFirstMessage: false
  },
  completionModalShown: false
}

const onboardingSlice = createSlice({
  name: 'onboarding',
  initialState,
  reducers: {
    completeOnboarding: (state, action: PayloadAction<string>) => {
      state.completedOnboardingVersion = action.payload
      state.onboardingSkipped = false
    },
    completeFeatureGuide: (state, action: PayloadAction<string>) => {
      if (!state.completedFeatureGuides.includes(action.payload)) {
        state.completedFeatureGuides.push(action.payload)
      }
    },
    skipOnboarding: (state, action: PayloadAction<string>) => {
      state.onboardingSkipped = true
      state.completedOnboardingVersion = action.payload
    },
    resetOnboarding: () => initialState,
    // New actions for user guide
    completeGuidePage: (state) => {
      state.guidePageCompleted = true
      // Auto-show checklist when guide page is completed
      state.checklistVisible = true
    },
    dismissChecklist: (state) => {
      state.checklistDismissed = true
      state.checklistVisible = false
    },
    toggleChecklistVisible: (state) => {
      state.checklistVisible = !state.checklistVisible
    },
    setChecklistVisible: (state, action: PayloadAction<boolean>) => {
      state.checklistVisible = action.payload
    },
    updateTaskStatus: (state, action: PayloadAction<Partial<UserGuideTaskStatus>>) => {
      state.taskStatus = { ...state.taskStatus, ...action.payload }
    },
    completeTask: (state, action: PayloadAction<keyof UserGuideTaskStatus>) => {
      state.taskStatus[action.payload] = true
    },
    showCompletionModal: (state) => {
      state.completionModalShown = true
    },
    resetUserGuide: (state) => {
      state.guidePageCompleted = false
      state.checklistDismissed = false
      state.checklistVisible = false
      state.taskStatus = {
        useFreeModel: false,
        configureProvider: false,
        sendFirstMessage: false
      }
      state.completionModalShown = false
    }
  }
})

export const {
  completeOnboarding,
  completeFeatureGuide,
  skipOnboarding,
  resetOnboarding,
  completeGuidePage,
  dismissChecklist,
  toggleChecklistVisible,
  setChecklistVisible,
  updateTaskStatus,
  completeTask,
  showCompletionModal,
  resetUserGuide
} = onboardingSlice.actions

export default onboardingSlice.reducer
