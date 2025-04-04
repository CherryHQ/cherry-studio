import { defaultLanguage, ZOOM_SHORTCUTS } from '@shared/config/constant'
import { LanguageVarious, Shortcut, ThemeMode } from '@types'
import { app } from 'electron'
import Store from 'electron-store'

import { locales } from '../utils/locales'

enum ConfigKeys {
  Language = 'language',
  Theme = 'theme',
  LaunchToTray = 'launchToTray',
  Tray = 'tray',
  TrayOnClose = 'trayOnClose',
  ZoomFactor = 'ZoomFactor',
  Shortcuts = 'shortcuts',
  ClickTrayToShowQuickAssistant = 'clickTrayToShowQuickAssistant',
  EnableQuickAssistant = 'enableQuickAssistant'
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
    return this.get(ConfigKeys.Theme, ThemeMode.light)
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

  set(key: string, value: unknown) {
    this.store.set(key, value)
  }

  get<T>(key: string, defaultValue?: T) {
    return this.store.get(key, defaultValue) as T
  }
}

export const configManager = new ConfigManager()
