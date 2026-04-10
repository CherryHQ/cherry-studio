import type { Locator, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Base Page Object class.
 * All page objects should extend this class.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  /**
   * Navigate to a path using HashRouter.
   * The app uses HashRouter, so we need to change window.location.hash.
   */
  async navigateTo(routePath: string): Promise<void> {
    await this.page.evaluate((p) => {
      window.location.hash = p
    }, routePath)
    await this.page.waitForLoadState('domcontentloaded')
  }

  /**
   * Wait for an element to be visible.
   */
  async waitForElement(selector: string, timeout: number = 10000): Promise<Locator> {
    const locator = this.page.locator(selector)
    await locator.waitFor({ state: 'visible', timeout })
    return locator
  }

  /**
   * Wait for an element to be hidden.
   */
  async waitForElementHidden(selector: string, timeout: number = 10000): Promise<void> {
    const locator = this.page.locator(selector)
    await locator.waitFor({ state: 'hidden', timeout })
  }

  /**
   * Take a screenshot for debugging.
   */
  async takeScreenshot(name: string): Promise<void> {
    const screenshotsDir = path.join(process.cwd(), 'test-results', 'screenshots')
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true })
    }

    await this.page.screenshot({
      path: path.join(screenshotsDir, `${name}.png`),
      fullPage: true
    })
  }

  /**
   * Get the current route from the hash.
   */
  async getCurrentRoute(): Promise<string> {
    const url = this.page.url()
    const hash = new URL(url).hash
    return hash.replace('#', '') || '/'
  }

  /**
   * Click an element with retry.
   */
  async clickWithRetry(selector: string, maxRetries: number = 3): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.page.click(selector, { timeout: 5000 })
        return
      } catch (error) {
        if (i === maxRetries - 1) throw error
        await this.page.waitForTimeout(500)
      }
    }
  }

  /**
   * Fill an input field.
   */
  async fillInput(selector: string, value: string): Promise<void> {
    const input = this.page.locator(selector)
    await input.fill(value)
  }

  /**
   * Get text content of an element.
   */
  async getTextContent(selector: string): Promise<string | null> {
    const locator = this.page.locator(selector)
    return locator.textContent()
  }

  /**
   * Check if an element is visible.
   */
  async isElementVisible(selector: string): Promise<boolean> {
    const locator = this.page.locator(selector)
    return locator.isVisible()
  }

  /**
   * Count elements matching a selector.
   */
  async countElements(selector: string): Promise<number> {
    const locator = this.page.locator(selector)
    return locator.count()
  }
}
