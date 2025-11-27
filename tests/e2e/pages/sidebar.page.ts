import { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Page Object for the Sidebar/Navigation component.
 * Handles navigation between different sections of the app.
 */
export class SidebarPage extends BasePage {
  readonly sidebar: Locator
  readonly homeLink: Locator
  readonly storeLink: Locator
  readonly knowledgeLink: Locator
  readonly filesLink: Locator
  readonly settingsLink: Locator
  readonly appsLink: Locator
  readonly translateLink: Locator

  constructor(page: Page) {
    super(page)
    this.sidebar = page.locator('[class*="Sidebar"], nav, aside')
    this.homeLink = page.locator('a[href="#/"], a[href="#!/"]').first()
    this.storeLink = page.locator('a[href*="/store"]')
    this.knowledgeLink = page.locator('a[href*="/knowledge"]')
    this.filesLink = page.locator('a[href*="/files"]')
    this.settingsLink = page.locator('a[href*="/settings"]')
    this.appsLink = page.locator('a[href*="/apps"]')
    this.translateLink = page.locator('a[href*="/translate"]')
  }

  /**
   * Navigate to Home page.
   */
  async goToHome(): Promise<void> {
    // Try clicking the home link, or navigate directly
    try {
      await this.homeLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/')
    }
    await this.page.waitForURL(/.*#\/$|.*#$|.*#\/home.*/, { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Knowledge page.
   */
  async goToKnowledge(): Promise<void> {
    try {
      await this.knowledgeLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/knowledge')
    }
    await this.page.waitForURL('**/#/knowledge**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Settings page.
   */
  async goToSettings(): Promise<void> {
    try {
      await this.settingsLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/provider')
    }
    await this.page.waitForURL('**/#/settings/**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Files page.
   */
  async goToFiles(): Promise<void> {
    try {
      await this.filesLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/files')
    }
    await this.page.waitForURL('**/#/files**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Apps page.
   */
  async goToApps(): Promise<void> {
    try {
      await this.appsLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/apps')
    }
    await this.page.waitForURL('**/#/apps**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Store page.
   */
  async goToStore(): Promise<void> {
    try {
      await this.storeLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/store')
    }
    await this.page.waitForURL('**/#/store**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Translate page.
   */
  async goToTranslate(): Promise<void> {
    try {
      await this.translateLink.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/translate')
    }
    await this.page.waitForURL('**/#/translate**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Check if sidebar is visible.
   */
  async isVisible(): Promise<boolean> {
    return this.sidebar.first().isVisible()
  }
}
