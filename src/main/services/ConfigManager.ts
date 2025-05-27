import { defaultLanguage, ZOOM_SHORTCUTS } from '@shared/config/constant'
import { LanguageVarious, Shortcut, ThemeMode } from '@types'
import { app } from 'electron'
import Store from 'electron-store'

import { locales } from '../utils/locales'

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
  EnableDataCollection = 'enableDataCollection',
  SelectionAssistantEnabled = 'selectionAssistantEnabled',
  SelectionAssistantTriggerMode = 'selectionAssistantTriggerMode',
  SelectionAssistantFollowToolbar = 'selectionAssistantFollowToolbar'
}

export class ConfigManager {
  private store: Store
  private subscribers: Map<string, Array<(newValue: any) => void>> = new Map()

  constructor() {
    this.store = new Store()
  }

  getLanguage(): LanguageVarious {
    const locale = Object.keys(locales).includes(app.getLocale()) ? app.getLocale() : defaultLanguage
    return this.get(ConfigKeys.Language, locale) as LanguageVarious
  }

  setLanguage(theme: LanguageVarious) {
    this.set(ConfigKeys.Language, theme)
  }

  getTheme(): ThemeMode {
    return this.get(ConfigKeys.Theme, ThemeMode.auto)
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
    this.set(ConfigKeys.Tray, value)
    this.notifySubscribers(ConfigKeys.Tray, value)
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
    this.set(ConfigKeys.ZoomFactor, factor)
    this.notifySubscribers(ConfigKeys.ZoomFactor, factor)
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
    this.set(
      ConfigKeys.Shortcuts,
      shortcuts.filter((shortcut) => shortcut.system)
    )
    this.notifySubscribers(ConfigKeys.Shortcuts, shortcuts)
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
    this.set(ConfigKeys.EnableQuickAssistant, value)
  }

  getAutoUpdate(): boolean {
    return this.get<boolean>(ConfigKeys.AutoUpdate, true)
  }

  setAutoUpdate(value: boolean) {
    this.set(ConfigKeys.AutoUpdate, value)
  }

  getEnableDataCollection(): boolean {
    return this.get<boolean>(ConfigKeys.EnableDataCollection, true)
  }

  setEnableDataCollection(value: boolean) {
    this.set(ConfigKeys.EnableDataCollection, value)
  }

  // Selection Assistant: is enabled the selection assistant
  getSelectionAssistantEnabled(): boolean {
    return this.get<boolean>(ConfigKeys.SelectionAssistantEnabled, true)
  }

  setSelectionAssistantEnabled(value: boolean) {
    this.set(ConfigKeys.SelectionAssistantEnabled, value)
    this.notifySubscribers(ConfigKeys.SelectionAssistantEnabled, value)
  }

  // Selection Assistant: trigger mode (selected, ctrlkey)
  getSelectionAssistantTriggerMode(): string {
    return this.get<string>(ConfigKeys.SelectionAssistantTriggerMode, 'selected')
  }

  setSelectionAssistantTriggerMode(value: string) {
    this.set(ConfigKeys.SelectionAssistantTriggerMode, value)
    this.notifySubscribers(ConfigKeys.SelectionAssistantTriggerMode, value)
  }

  // Selection Assistant: if action window position follow toolbar
  getSelectionAssistantFollowToolbar(): boolean {
    return this.get<boolean>(ConfigKeys.SelectionAssistantFollowToolbar, true)
  }

  setSelectionAssistantFollowToolbar(value: boolean) {
    this.set(ConfigKeys.SelectionAssistantFollowToolbar, value)
    this.notifySubscribers(ConfigKeys.SelectionAssistantFollowToolbar, value)
  }

  set(key: string, value: unknown) {
    this.store.set(key, value)
  }

  get<T>(key: string, defaultValue?: T) {
    return this.store.get(key, defaultValue) as T
  }
}

export const configManager = new ConfigManager()
