import type { Locator, Page } from '@playwright/test'

import { BasePage } from './base.page'

/**
 * Page Object for the Settings page.
 * Handles navigation and interaction with various settings sections.
 */
export class SettingsPage extends BasePage {
  readonly settingsContainer: Locator
  readonly providerMenuItem: Locator
  readonly modelMenuItem: Locator
  readonly generalMenuItem: Locator
  readonly displayMenuItem: Locator
  readonly dataMenuItem: Locator
  readonly mcpMenuItem: Locator
  readonly memoryMenuItem: Locator
  readonly aboutMenuItem: Locator

  constructor(page: Page) {
    super(page)
    this.settingsContainer = page.locator('[id="content-container"], [class*="Settings"]')
    this.providerMenuItem = page.locator('a[href*="/settings/provider"]')
    this.modelMenuItem = page.locator('a[href*="/settings/model"]')
    this.generalMenuItem = page.locator('a[href*="/settings/general"]')
    this.displayMenuItem = page.locator('a[href*="/settings/display"]')
    this.dataMenuItem = page.locator('a[href*="/settings/data"]')
    this.mcpMenuItem = page.locator('a[href*="/settings/mcp"]')
    this.memoryMenuItem = page.locator('a[href*="/settings/memory"]')
    this.aboutMenuItem = page.locator('a[href*="/settings/about"]')
  }

  /**
   * Navigate to settings page (provider by default).
   */
  async goto(): Promise<void> {
    await this.navigateTo('/settings/provider')
    await this.waitForElement('[id="content-container"], [class*="Settings"]')
  }

  /**
   * Check if settings page is loaded.
   */
  async isLoaded(): Promise<boolean> {
    return this.settingsContainer.first().isVisible()
  }

  /**
   * Navigate to Provider settings.
   */
  async goToProvider(): Promise<void> {
    try {
      await this.providerMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/provider')
    }
    await this.page.waitForURL('**/#/settings/provider**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Model settings.
   */
  async goToModel(): Promise<void> {
    try {
      await this.modelMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/model')
    }
    await this.page.waitForURL('**/#/settings/model**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to General settings.
   */
  async goToGeneral(): Promise<void> {
    try {
      await this.generalMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/general')
    }
    await this.page.waitForURL('**/#/settings/general**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Display settings.
   */
  async goToDisplay(): Promise<void> {
    try {
      await this.displayMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/display')
    }
    await this.page.waitForURL('**/#/settings/display**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Data settings.
   */
  async goToData(): Promise<void> {
    try {
      await this.dataMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/data')
    }
    await this.page.waitForURL('**/#/settings/data**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to MCP settings.
   */
  async goToMCP(): Promise<void> {
    try {
      await this.mcpMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/mcp')
    }
    await this.page.waitForURL('**/#/settings/mcp**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to Memory settings.
   */
  async goToMemory(): Promise<void> {
    try {
      await this.memoryMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/memory')
    }
    await this.page.waitForURL('**/#/settings/memory**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Navigate to About page.
   */
  async goToAbout(): Promise<void> {
    try {
      await this.aboutMenuItem.click({ timeout: 5000 })
    } catch {
      await this.navigateTo('/settings/about')
    }
    await this.page.waitForURL('**/#/settings/about**', { timeout: 10000 }).catch(() => {})
  }

  /**
   * Toggle a switch setting by its label.
   */
  async toggleSwitch(label: string): Promise<void> {
    const switchElement = this.page.locator(`text=${label}`).locator('..').locator('button[role="switch"], .ant-switch')
    await switchElement.first().click()
  }

  /**
   * Check if a menu item is active/selected.
   */
  async isMenuItemActive(menuItem: Locator): Promise<boolean> {
    const className = await menuItem.getAttribute('class')
    return className?.includes('active') || className?.includes('selected') || false
  }
}
