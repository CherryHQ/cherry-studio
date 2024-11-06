import { app } from 'electron'
import Store from 'electron-store'

type ThemeVarious = 'light' | 'dark'
type LanguageVarious = 'zh-CN' | 'zh-TW' | 'en-US'

export class ConfigManager {
  private store: Store

  constructor() {
    this.store = new Store()
  }

  getLanguage(): LanguageVarious {
    return this.store.get('language', app.getLocale()) as LanguageVarious
  }

  setLanguage(theme: ThemeVarious) {
    this.store.set('language', theme)
  }

  getTheme(): ThemeVarious {
    return this.store.get('theme', 'light') as ThemeVarious
  }

  setTheme(theme: ThemeVarious) {
    this.store.set('theme', theme)
  }
}

export const configManager = new ConfigManager()
