import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'
import type { OnboardingState } from '@renderer/types/onboarding'

const initialState: OnboardingState = {
  completedOnboardingVersion: null,
  completedFeatureGuides: [],
  onboardingSkipped: false
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
    resetOnboarding: () => initialState
  }
})

export const { completeOnboarding, completeFeatureGuide, skipOnboarding, resetOnboarding } = onboardingSlice.actions

export default onboardingSlice.reducer
