import { ZOOM_SHORTCUTS } from '@shared/config/constant'
import { LanguageVarious, Shortcut, ThemeMode } from '@types'
import { app } from 'electron'
import Store from 'electron-store'

import { locales } from '../utils/locales'

export class ConfigManager {
  private store: Store
  private subscribers: Map<string, Array<(newValue: any) => void>> = new Map()

  constructor() {
    this.store = new Store()
  }

  getLanguage(): LanguageVarious {
    const locale = Object.keys(locales).includes(app.getLocale()) ? app.getLocale() : 'en-US'
    return this.store.get('language', locale) as LanguageVarious
  }

  setLanguage(theme: LanguageVarious) {
    this.store.set('language', theme)
  }

  getTheme(): ThemeMode {
    return this.store.get('theme', ThemeMode.light) as ThemeMode
  }

  setTheme(theme: ThemeMode) {
    this.store.set('theme', theme)
  }

  getLaunchToTray(): boolean {
    return !!this.store.get('launchToTray', false)
  }

  setLaunchToTray(value: boolean) {
    this.store.set('launchToTray', value)
  }

  getTray(): boolean {
    return !!this.store.get('tray', true)
  }

  setTray(value: boolean) {
    this.store.set('tray', value)
    this.notifySubscribers('tray', value)
  }

  getTrayOnClose(): boolean {
    return !!this.store.get('trayOnClose', true)
  }

  setTrayOnClose(value: boolean) {
    this.store.set('trayOnClose', value)
  }

  getZoomFactor(): number {
    return this.store.get('zoomFactor', 1) as number
  }

  setZoomFactor(factor: number) {
    this.store.set('zoomFactor', factor)
    this.notifySubscribers('zoomFactor', factor)
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
    return this.store.get('shortcuts', ZOOM_SHORTCUTS) as Shortcut[] | []
  }

  setShortcuts(shortcuts: Shortcut[]) {
    this.store.set(
      'shortcuts',
      shortcuts.filter((shortcut) => shortcut.system)
    )
    this.notifySubscribers('shortcuts', shortcuts)
  }

  getClickTrayToShowQuickAssistant(): boolean {
    return this.store.get('clickTrayToShowQuickAssistant', false) as boolean
  }

  setClickTrayToShowQuickAssistant(value: boolean) {
    this.store.set('clickTrayToShowQuickAssistant', value)
  }

  getEnableQuickAssistant(): boolean {
    return this.store.get('enableQuickAssistant', false) as boolean
  }

  setEnableQuickAssistant(value: boolean) {
    this.store.set('enableQuickAssistant', value)
  }

  set(key: string, value: any) {
    this.store.set(key, value)
  }

  get(key: string) {
    return this.store.get(key)
  }
}

export const configManager = new ConfigManager()
