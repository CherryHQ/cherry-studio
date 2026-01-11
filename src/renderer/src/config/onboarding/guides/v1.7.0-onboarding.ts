import type { VersionGuide } from '@renderer/types/onboarding'

/**
 * Initial onboarding guide for new users
 * Covers: free built-in model, adding providers, adding models, use cases
 */
export const v170Onboarding: VersionGuide = {
  version: '1.7.0',
  type: 'onboarding',
  titleKey: 'onboarding.welcome.title',
  descriptionKey: 'onboarding.welcome.description',
  route: '/',
  priority: 100,
  steps: [
    {
      id: 'welcome',
      titleKey: 'onboarding.steps.welcome.title',
      descriptionKey: 'onboarding.steps.welcome.description',
      side: 'over'
    },
    {
      id: 'free-model',
      element: '.home-navbar',
      titleKey: 'onboarding.steps.freeModel.title',
      descriptionKey: 'onboarding.steps.freeModel.description',
      side: 'bottom',
      align: 'center'
    },
    {
      id: 'settings-intro',
      // TODO: improve selector to work in both sidebar and top nav layouts
      element: () => document.querySelector('#sidebar-settings') || document.querySelector('#navbar-settings'),
      titleKey: 'onboarding.steps.settingsIntro.title',
      descriptionKey: 'onboarding.steps.settingsIntro.description',
      side: 'bottom',
      align: 'center'
    },
    {
      id: 'add-provider',
      navigateTo: '/settings/provider',
      element: '#add-provider-btn',
      titleKey: 'onboarding.steps.addProvider.title',
      descriptionKey: 'onboarding.steps.addProvider.description',
      side: 'top',
      align: 'center'
    },
    {
      id: 'fill-api-key',
      element: '#api-key-input',
      titleKey: 'onboarding.steps.fillApiKey.title',
      descriptionKey: 'onboarding.steps.fillApiKey.description',
      side: 'bottom',
      align: 'start'
    },
    {
      id: 'add-model',
      element: '#add-model-btn',
      titleKey: 'onboarding.steps.addModel.title',
      descriptionKey: 'onboarding.steps.addModel.description',
      side: 'bottom',
      align: 'center'
    },
    {
      id: 'use-cases',
      navigateTo: '/',
      element: '#inputbar',
      titleKey: 'onboarding.steps.useCases.title',
      descriptionKey: 'onboarding.steps.useCases.description',
      side: 'top',
      align: 'center'
    },
    {
      id: 'complete',
      titleKey: 'onboarding.steps.complete.title',
      descriptionKey: 'onboarding.steps.complete.description',
      side: 'over'
    }
  ]
}
