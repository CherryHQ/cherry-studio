/**
 * Data Refactor, notes by fullex
 * //TODO @deprecated this file will be removed
 */

import { usePreference } from '@data/hooks/usePreference'
import { useAppSelector } from '@renderer/store'
import store from '@renderer/store'
import type { SettingsState } from '@renderer/store/settings'

export function useSettings() {
  const settings = useAppSelector((state) => state.settings)
  // const dispatch = useAppDispatch()

  return {
    ...settings
    // setSendMessageShortcut(shortcut: SendMessageShortcut) {
    //   dispatch(_setSendMessageShortcut(shortcut))
    // },

    // setLaunch(isLaunchOnBoot: boolean | undefined, isLaunchToTray: boolean | undefined = undefined) {
    //   if (isLaunchOnBoot !== undefined) {
    //     dispatch(setLaunchOnBoot(isLaunchOnBoot))
    //     window.api.setLaunchOnBoot(isLaunchOnBoot)
    //   }

    //   if (isLaunchToTray !== undefined) {
    //     dispatch(setLaunchToTray(isLaunchToTray))
    //     window.api.setLaunchToTray(isLaunchToTray)
    //   }
    // },

    // setTray(isShowTray: boolean | undefined, isTrayOnClose: boolean | undefined = undefined) {
    //   if (isShowTray !== undefined) {
    //     dispatch(_setTray(isShowTray))
    //     window.api.setTray(isShowTray)
    //   }
    //   if (isTrayOnClose !== undefined) {
    //     dispatch(setTrayOnClose(isTrayOnClose))
    //     window.api.setTrayOnClose(isTrayOnClose)
    //   }
    // },

    // setAutoCheckUpdate(isAutoUpdate: boolean) {
    //   dispatch(_setAutoCheckUpdate(isAutoUpdate))
    //   window.api.setAutoUpdate(isAutoUpdate)
    // },

    // setTestPlan(isTestPlan: boolean) {
    //   dispatch(_setTestPlan(isTestPlan))
    //   window.api.setTestPlan(isTestPlan)
    // },

    // setTestChannel(channel: UpgradeChannel) {
    //   dispatch(_setTestChannel(channel))
    //   window.api.setTestChannel(channel)
    // },

    // setTheme(theme: ThemeMode) {
    //   dispatch(setTheme(theme))
    // },
    // setWindowStyle(windowStyle: 'transparent' | 'opaque') {
    //   dispatch(setWindowStyle(windowStyle))
    // },
    // setTargetLanguage(targetLanguage: TranslateLanguageCode) {
    //   dispatch(setTargetLanguage(targetLanguage))
    // }
    // setTopicPosition(topicPosition: 'left' | 'right') {
    //   dispatch(setTopicPosition(topicPosition))
    // },
    // setPinTopicsToTop(pinTopicsToTop: boolean) {
    //   dispatch(setPinTopicsToTop(pinTopicsToTop))
    // }
    // updateSidebarIcons(icons: { visible: SidebarIcon[]; disabled: SidebarIcon[] }) {
    //   dispatch(setSidebarIcons(icons))
    // },
    // updateSidebarVisibleIcons(icons: SidebarIcon[]) {
    //   dispatch(setSidebarIcons({ visible: icons }))
    // },
    // updateSidebarDisabledIcons(icons: SidebarIcon[]) {
    //   dispatch(setSidebarIcons({ disabled: icons }))
    // },
    // setAssistantIconType(assistantIconType: AssistantIconType) {
    //   dispatch(setAssistantIconType(assistantIconType))
    // }
    // setDisableHardwareAcceleration(disableHardwareAcceleration: boolean) {
    //   dispatch(setDisableHardwareAcceleration(disableHardwareAcceleration))
    //   window.api.setDisableHardwareAcceleration(disableHardwareAcceleration)
    // }
  }
}

export function useMessageStyle() {
  const [messageStyle] = usePreference('chat.message.style')
  const isBubbleStyle = messageStyle === 'bubble'

  return {
    isBubbleStyle
  }
}

export const getStoreSetting = <K extends keyof SettingsState>(key: K): SettingsState[K] => {
  return store.getState().settings[key]
}

// export const useEnableDeveloperMode = () => {
//   const enableDeveloperMode = useAppSelector((state) => state.settings.enableDeveloperMode)
//   const dispatch = useAppDispatch()

//   return {
//     enableDeveloperMode,
//     setEnableDeveloperMode: (enableDeveloperMode: boolean) => {
//       dispatch(setEnableDeveloperMode(enableDeveloperMode))
//       window.api.config.set('enableDeveloperMode', enableDeveloperMode)
//     }
//   }
// }

// export const getEnableDeveloperMode = () => {
//   return store.getState().settings.enableDeveloperMode
// }
