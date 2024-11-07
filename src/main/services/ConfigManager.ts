import { LanguageVarious, ThemeMode } from '@types'
import { app } from 'electron'
import Store from 'electron-store'

export class ConfigManager {
  private store: Store

  constructor() {
    this.store = new Store()
  }

  getLanguage(): LanguageVarious {
    return this.store.get('language', app.getLocale()) as LanguageVarious
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
}

export const configManager = new ConfigManager()
