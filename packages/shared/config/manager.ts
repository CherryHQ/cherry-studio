import { LanguageVarious, Shortcut, ThemeMode } from '@types'

import { UpgradeChannel } from './constant'

export enum ConfigKeys {
  Language = 'language',
  Theme = 'theme',
  LaunchToTray = 'launchToTray',
  Tray = 'tray',
  TrayOnClose = 'trayOnClose',
  ZoomFactor = 'ZoomFactor',
  Shortcuts = 'shortcuts',
  ClickTrayToShowQuickAssistant = 'clickTrayToShowQuickAssistant',
  EnableQuickAssistant = 'enableQuickAssistant',
  AutoUpdate = 'autoUpdate',
  TestPlan = 'testPlan',
  TestChannel = 'testChannel',
  EnableDataCollection = 'enableDataCollection',
  SelectionAssistantEnabled = 'selectionAssistantEnabled',
  SelectionAssistantTriggerMode = 'selectionAssistantTriggerMode',
  SelectionAssistantFollowToolbar = 'selectionAssistantFollowToolbar',
  SelectionAssistantRemeberWinSize = 'selectionAssistantRemeberWinSize',
  SelectionAssistantFilterMode = 'selectionAssistantFilterMode',
  SelectionAssistantFilterList = 'selectionAssistantFilterList',
  DisableHardwareAcceleration = 'disableHardwareAcceleration',
  Proxy = 'proxy',
  EnableDeveloperMode = 'enableDeveloperMode'
}

export type Config = Partial<{
  [ConfigKeys.Language]: LanguageVarious
  [ConfigKeys.Theme]: ThemeMode
  [ConfigKeys.LaunchToTray]: boolean
  [ConfigKeys.Tray]: boolean
  [ConfigKeys.TrayOnClose]: boolean
  [ConfigKeys.ZoomFactor]: number
  [ConfigKeys.Shortcuts]: Shortcut[]
  [ConfigKeys.ClickTrayToShowQuickAssistant]: boolean
  [ConfigKeys.EnableQuickAssistant]: boolean
  [ConfigKeys.AutoUpdate]: boolean
  [ConfigKeys.TestPlan]: boolean
  [ConfigKeys.TestChannel]: UpgradeChannel
  [ConfigKeys.EnableDataCollection]: boolean
  [ConfigKeys.SelectionAssistantEnabled]: boolean
  [ConfigKeys.SelectionAssistantTriggerMode]: string
  [ConfigKeys.SelectionAssistantFollowToolbar]: boolean
  [ConfigKeys.SelectionAssistantRemeberWinSize]: boolean
  [ConfigKeys.SelectionAssistantFilterMode]: string
  [ConfigKeys.SelectionAssistantFilterList]: string[]
  [ConfigKeys.DisableHardwareAcceleration]: boolean
  [ConfigKeys.Proxy]: string // proxy 似乎没在 config manager里面管理，我也不知道为什么这里有个键
  [ConfigKeys.EnableDeveloperMode]: boolean
}>

export type RestoreData = {}
