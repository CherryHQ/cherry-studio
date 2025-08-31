import { loggerService } from '@logger'
import { defaultLanguage, UpgradeChannel, ZOOM_SHORTCUTS } from '@shared/config/constant'
import { Config, ConfigKeys } from '@shared/config/manager'
import { LanguageVarious, Shortcut, ThemeMode } from '@types'
import { app } from 'electron'
import Store from 'electron-store'

import { locales } from '../utils/locales'

const logger = loggerService.withContext('ConfigManager')
export class ConfigManager {
  private store: Store
  private subscribers: Map<string, Array<(newValue: any) => void>> = new Map()

  constructor() {
    this.store = new Store()
  }

  clearStore() {
    this.store.clear()
    // 用默认值触发部分notify
    this.setZoomFactor(1.0)
    this.setEnableQuickAssistant(false)
    this.setSelectionAssistantEnabled(false)
    logger.info('Config cleared')
  }

  update(data: Config) {
    if (data[ConfigKeys.Language]) {
      this.setLanguage(data[ConfigKeys.Language])
    }
    if (data[ConfigKeys.Theme]) {
      this.setTheme(data[ConfigKeys.Theme])
    }
    if (data[ConfigKeys.LaunchToTray] !== undefined) {
      this.setLaunchToTray(data[ConfigKeys.LaunchToTray])
    }
    if (data[ConfigKeys.Tray] !== undefined) {
      this.setTray(data[ConfigKeys.Tray])
    }
    if (data[ConfigKeys.TrayOnClose] !== undefined) {
      this.setTrayOnClose(data[ConfigKeys.TrayOnClose])
    }
    if (data[ConfigKeys.ZoomFactor]) {
      this.setZoomFactor(data[ConfigKeys.ZoomFactor])
    }
    if (data[ConfigKeys.Shortcuts]) {
      this.setShortcuts(data[ConfigKeys.Shortcuts])
    }
    if (data[ConfigKeys.ClickTrayToShowQuickAssistant] !== undefined) {
      this.setClickTrayToShowQuickAssistant(data[ConfigKeys.ClickTrayToShowQuickAssistant])
    }
    if (data[ConfigKeys.EnableQuickAssistant] !== undefined) {
      this.setEnableQuickAssistant(data[ConfigKeys.EnableQuickAssistant])
    }
    if (data[ConfigKeys.AutoUpdate] !== undefined) {
      this.setAutoUpdate(data[ConfigKeys.AutoUpdate])
    }
    if (data[ConfigKeys.TestPlan] !== undefined) {
      this.setTestPlan(data[ConfigKeys.TestPlan] as boolean)
    }
    if (data[ConfigKeys.TestChannel]) {
      this.setTestChannel(data[ConfigKeys.TestChannel])
    }
    if (data[ConfigKeys.EnableDataCollection] !== undefined) {
      this.setEnableDataCollection(data[ConfigKeys.EnableDataCollection])
    }
    if (data[ConfigKeys.SelectionAssistantEnabled] !== undefined) {
      this.setSelectionAssistantEnabled(data[ConfigKeys.SelectionAssistantEnabled])
    }
    if (data[ConfigKeys.SelectionAssistantTriggerMode]) {
      this.setSelectionAssistantTriggerMode(data[ConfigKeys.SelectionAssistantTriggerMode])
    }
    if (data[ConfigKeys.SelectionAssistantFollowToolbar] !== undefined) {
      this.setSelectionAssistantFollowToolbar(data[ConfigKeys.SelectionAssistantFollowToolbar])
    }
    if (data[ConfigKeys.SelectionAssistantRemeberWinSize] !== undefined) {
      this.setSelectionAssistantRemeberWinSize(data[ConfigKeys.SelectionAssistantRemeberWinSize])
    }
    if (data[ConfigKeys.SelectionAssistantFilterMode]) {
      this.setSelectionAssistantFilterMode(data[ConfigKeys.SelectionAssistantFilterMode])
    }
    if (data[ConfigKeys.SelectionAssistantFilterList]) {
      this.setSelectionAssistantFilterList(data[ConfigKeys.SelectionAssistantFilterList])
    }
    if (data[ConfigKeys.DisableHardwareAcceleration] !== undefined) {
      this.setDisableHardwareAcceleration(data[ConfigKeys.DisableHardwareAcceleration])
    }
    if (data[ConfigKeys.EnableDeveloperMode] !== undefined) {
      this.setEnableDeveloperMode(data[ConfigKeys.EnableDeveloperMode])
    }
  }

  restore(data: Config) {
    this.clearStore()
    this.update(data)
    logger.info('Config restored.')
  }

  getLanguage(): LanguageVarious {
    const locale = Object.keys(locales).includes(app.getLocale()) ? app.getLocale() : defaultLanguage
    return this.get(ConfigKeys.Language, locale) as LanguageVarious
  }

  setLanguage(lang: LanguageVarious) {
    this.setAndNotify(ConfigKeys.Language, lang)
  }

  getTheme(): ThemeMode {
    return this.get(ConfigKeys.Theme, ThemeMode.system)
  }

  setTheme(theme: ThemeMode) {
    this.set(ConfigKeys.Theme, theme)
  }

  getLaunchToTray(): boolean {
    return !!this.get(ConfigKeys.LaunchToTray, false)
  }

  setLaunchToTray(value: boolean) {
    this.set(ConfigKeys.LaunchToTray, value)
  }

  getTray(): boolean {
    return !!this.get(ConfigKeys.Tray, true)
  }

  setTray(value: boolean) {
    this.setAndNotify(ConfigKeys.Tray, value)
  }

  getTrayOnClose(): boolean {
    return !!this.get(ConfigKeys.TrayOnClose, true)
  }

  setTrayOnClose(value: boolean) {
    this.set(ConfigKeys.TrayOnClose, value)
  }

  getZoomFactor(): number {
    return this.get<number>(ConfigKeys.ZoomFactor, 1)
  }

  setZoomFactor(factor: number) {
    this.setAndNotify(ConfigKeys.ZoomFactor, factor)
  }

  subscribe<T>(key: string, callback: (newValue: T) => void) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, [])
    }
    this.subscribers.get(key)!.push(callback)
  }

  unsubscribe<T>(key: string, callback: (newValue: T) => void) {
    const subscribers = this.subscribers.get(key)
    if (subscribers) {
      this.subscribers.set(
        key,
        subscribers.filter((subscriber) => subscriber !== callback)
      )
    }
  }

  private notifySubscribers<T>(key: string, newValue: T) {
    const subscribers = this.subscribers.get(key)
    if (subscribers) {
      subscribers.forEach((subscriber) => subscriber(newValue))
    }
  }

  getShortcuts() {
    return this.get(ConfigKeys.Shortcuts, ZOOM_SHORTCUTS) as Shortcut[] | []
  }

  setShortcuts(shortcuts: Shortcut[]) {
    this.setAndNotify(
      ConfigKeys.Shortcuts,
      shortcuts.filter((shortcut) => shortcut.system)
    )
  }

  getClickTrayToShowQuickAssistant(): boolean {
    return this.get<boolean>(ConfigKeys.ClickTrayToShowQuickAssistant, false)
  }

  setClickTrayToShowQuickAssistant(value: boolean) {
    this.set(ConfigKeys.ClickTrayToShowQuickAssistant, value)
  }

  getEnableQuickAssistant(): boolean {
    return this.get(ConfigKeys.EnableQuickAssistant, false)
  }

  setEnableQuickAssistant(value: boolean) {
    this.setAndNotify(ConfigKeys.EnableQuickAssistant, value)
  }

  getAutoUpdate(): boolean {
    return this.get<boolean>(ConfigKeys.AutoUpdate, true)
  }

  setAutoUpdate(value: boolean) {
    this.set(ConfigKeys.AutoUpdate, value)
  }

  getTestPlan(): boolean {
    return this.get<boolean>(ConfigKeys.TestPlan, false)
  }

  setTestPlan(value: boolean) {
    this.set(ConfigKeys.TestPlan, value)
  }

  getTestChannel(): UpgradeChannel {
    return this.get<UpgradeChannel>(ConfigKeys.TestChannel)
  }

  setTestChannel(value: UpgradeChannel) {
    this.set(ConfigKeys.TestChannel, value)
  }

  getEnableDataCollection(): boolean {
    return this.get<boolean>(ConfigKeys.EnableDataCollection, true)
  }

  setEnableDataCollection(value: boolean) {
    this.set(ConfigKeys.EnableDataCollection, value)
  }

  // Selection Assistant: is enabled the selection assistant
  getSelectionAssistantEnabled(): boolean {
    return this.get<boolean>(ConfigKeys.SelectionAssistantEnabled, false)
  }

  setSelectionAssistantEnabled(value: boolean) {
    // notify only when toggled
    if (value === this.get<boolean>(ConfigKeys.SelectionAssistantEnabled)) return
    this.setAndNotify(ConfigKeys.SelectionAssistantEnabled, value)
  }

  // Selection Assistant: trigger mode (selected, ctrlkey)
  getSelectionAssistantTriggerMode(): string {
    return this.get<string>(ConfigKeys.SelectionAssistantTriggerMode, 'selected')
  }

  setSelectionAssistantTriggerMode(value: string) {
    this.setAndNotify(ConfigKeys.SelectionAssistantTriggerMode, value)
  }

  // Selection Assistant: if action window position follow toolbar
  getSelectionAssistantFollowToolbar(): boolean {
    return this.get<boolean>(ConfigKeys.SelectionAssistantFollowToolbar, true)
  }

  setSelectionAssistantFollowToolbar(value: boolean) {
    this.setAndNotify(ConfigKeys.SelectionAssistantFollowToolbar, value)
  }

  getSelectionAssistantRemeberWinSize(): boolean {
    return this.get<boolean>(ConfigKeys.SelectionAssistantRemeberWinSize, false)
  }

  setSelectionAssistantRemeberWinSize(value: boolean) {
    this.setAndNotify(ConfigKeys.SelectionAssistantRemeberWinSize, value)
  }

  getSelectionAssistantFilterMode(): string {
    return this.get<string>(ConfigKeys.SelectionAssistantFilterMode, 'default')
  }

  setSelectionAssistantFilterMode(value: string) {
    this.setAndNotify(ConfigKeys.SelectionAssistantFilterMode, value)
  }

  getSelectionAssistantFilterList(): string[] {
    return this.get<string[]>(ConfigKeys.SelectionAssistantFilterList, [])
  }

  setSelectionAssistantFilterList(value: string[]) {
    this.setAndNotify(ConfigKeys.SelectionAssistantFilterList, value)
  }

  getDisableHardwareAcceleration(): boolean {
    return this.get<boolean>(ConfigKeys.DisableHardwareAcceleration, false)
  }

  setDisableHardwareAcceleration(value: boolean) {
    this.set(ConfigKeys.DisableHardwareAcceleration, value)
  }

  setAndNotify(key: string, value: unknown) {
    this.set(key, value, true)
  }

  getEnableDeveloperMode(): boolean {
    return this.get<boolean>(ConfigKeys.EnableDeveloperMode, false)
  }

  setEnableDeveloperMode(value: boolean) {
    this.set(ConfigKeys.EnableDeveloperMode, value)
  }

  set(key: string, value: unknown, isNotify: boolean = false) {
    this.store.set(key, value)
    isNotify && this.notifySubscribers(key, value)
  }

  get<T>(key: string, defaultValue?: T) {
    return this.store.get(key, defaultValue) as T
  }
}

export const configManager = new ConfigManager()
