import chatVideoLight from '@renderer/assets/images/guide/chat.mp4'
import chatVideoDark from '@renderer/assets/images/guide/chat_dark.mp4'
import configureProviderStep1Light from '@renderer/assets/images/guide/Configure_Provider_step1.mp4'
import configureProviderStep1Dark from '@renderer/assets/images/guide/Configure_Provider_step1_dark.mp4'
import configureProviderStep2Light from '@renderer/assets/images/guide/Configure_Provider_step2.mp4'
import configureProviderStep2Dark from '@renderer/assets/images/guide/Configure_Provider_step2_dark.mp4'
import freeModelGif from '@renderer/assets/images/guide/free_model.gif'
import type { VersionGuide } from '@renderer/types/onboarding'

/**
 * User Guide Step 2: Configure Provider Guide
 * Multi-step guide with videos for configuring AI provider
 */
export const configureProviderGuideStep2: VersionGuide = {
  version: 'user-guide-configure-provider',
  type: 'feature',
  titleKey: 'userGuide.guides.configureProvider.title',
  descriptionKey: 'userGuide.guides.configureProvider.description',
  route: '/settings/provider',
  popoverClass: 'user-guide-popover-minimal',
  steps: [
    {
      id: 'enable-cherryin',
      element: '[data-guide-target="provider-cherryin"]',
      titleKey: 'userGuide.guides.configureProvider.steps.cherryin.title',
      descriptionKey: 'userGuide.guides.configureProvider.steps.cherryin.description',
      descriptionInterpolation: {
        videoUrlLight: configureProviderStep1Light,
        videoUrlDark: configureProviderStep1Dark
      },
      side: 'right',
      align: 'start',
      nextBtnTextKey: 'userGuide.buttons.next'
    },
    {
      id: 'connect-service',
      element: '[data-guide-target="provider-api-key"]',
      titleKey: 'userGuide.guides.configureProvider.steps.connect.title',
      descriptionKey: 'userGuide.guides.configureProvider.steps.connect.description',
      descriptionInterpolation: {
        videoUrlLight: configureProviderStep1Light,
        videoUrlDark: configureProviderStep1Dark
      },
      side: 'left',
      align: 'start',
      nextBtnTextKey: 'userGuide.buttons.next'
    },
    {
      id: 'use-model',
      element: '[data-guide-target="provider-manage-models"]',
      titleKey: 'userGuide.guides.configureProvider.steps.useModel.title',
      descriptionKey: 'userGuide.guides.configureProvider.steps.useModel.description',
      descriptionInterpolation: {
        videoUrlLight: configureProviderStep2Light,
        videoUrlDark: configureProviderStep2Dark
      },
      side: 'left',
      align: 'start',
      doneBtnTextKey: 'userGuide.buttons.gotIt'
    }
  ]
}

/**
 * User Guide Step 2: Send First Message Guide
 * Points to chat input with video and example prompt
 */
export const sendMessageGuideStep2: VersionGuide = {
  version: 'user-guide-send-message',
  type: 'feature',
  titleKey: 'userGuide.guides.sendMessage.title',
  descriptionKey: 'userGuide.guides.sendMessage.description',
  route: '/',
  popoverClass: 'user-guide-popover-minimal',
  steps: [
    {
      id: 'chat-input',
      element: '[data-guide-target="chat-input"]',
      titleKey: 'userGuide.guides.sendMessage.steps.input.title',
      descriptionKey: 'userGuide.guides.sendMessage.steps.input.description',
      descriptionInterpolation: {
        videoUrlLight: chatVideoLight,
        videoUrlDark: chatVideoDark
      },
      side: 'top',
      align: 'center',
      doneBtnTextKey: 'userGuide.guides.sendMessage.steps.input.button'
    }
  ]
}

/**
 * User Guide Step 2: Use Free Model Guide
 * Points to the model selector with GIF image
 */
export const useFreeModelGuideStep2: VersionGuide = {
  version: 'user-guide-use-free-model',
  type: 'feature',
  titleKey: 'userGuide.guides.useFreeModel.title',
  descriptionKey: 'userGuide.guides.useFreeModel.description',
  route: '/',
  popoverClass: 'user-guide-popover-minimal',
  steps: [
    {
      id: 'model-selector',
      element: '[data-guide-target="model-selector"]',
      titleKey: 'userGuide.guides.useFreeModel.steps.selector.title',
      descriptionKey: 'userGuide.guides.useFreeModel.steps.selector.description',
      descriptionInterpolation: { imageUrl: freeModelGif },
      side: 'bottom',
      align: 'start',
      doneBtnTextKey: 'userGuide.buttons.gotIt'
    }
  ]
}
