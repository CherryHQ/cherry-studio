import type { Locator, Page } from '@playwright/test'

import { uiLocator } from '../utils'
import { BasePage } from './base.page'

/**
 * Page Object for the Home/Chat page.
 * This is the main page where users interact with AI assistants.
 */
export class HomePage extends BasePage {
  readonly homePage: Locator
  readonly chatContainer: Locator
  readonly inputBar: Locator
  readonly messagesList: Locator
  readonly sendButton: Locator
  readonly newTopicButton: Locator
  readonly assistantTabs: Locator
  readonly topicList: Locator

  constructor(page: Page) {
    super(page)
    this.homePage = uiLocator(page, 'chat.view')
    this.chatContainer = uiLocator(page, 'chat.view')
    this.inputBar = uiLocator(page, 'chat.composer')
    this.messagesList = uiLocator(page, 'chat.message-list')
    this.sendButton = uiLocator(page, 'chat.composer.action.send')
    this.newTopicButton = uiLocator(page, 'chat.topic-list.action.create')
    this.assistantTabs = page.locator('[class*="HomeTabs"], [class*="AssistantTabs"]')
    this.topicList = uiLocator(page, 'chat.topic-list')
  }

  /**
   * Navigate to the home page.
   */
  async goto(): Promise<void> {
    await this.navigateTo('/')
    await this.homePage
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {})
  }

  /**
   * Check if the home page is loaded.
   */
  async isLoaded(): Promise<boolean> {
    return this.homePage.first().isVisible()
  }

  /**
   * Type a message in the input area.
   */
  async typeMessage(message: string): Promise<void> {
    const input = this.inputBar
      .locator('[data-ui~="part:composer-input"]')
      .locator('textarea, [contenteditable="true"], input[type="text"]')
    await input.first().fill(message)
  }

  /**
   * Click the send button to send a message.
   */
  async sendMessage(): Promise<void> {
    await this.sendButton.first().click()
  }

  /**
   * Type and send a message.
   */
  async sendChatMessage(message: string): Promise<void> {
    await this.typeMessage(message)
    await this.sendMessage()
  }

  /**
   * Get the count of messages in the chat.
   */
  async getMessageCount(): Promise<number> {
    return uiLocator(this.page, 'chat.message').count()
  }

  /**
   * Create a new topic/conversation.
   */
  async createNewTopic(): Promise<void> {
    await this.newTopicButton.first().click()
  }

  /**
   * Check if the chat interface is visible.
   */
  async isChatVisible(): Promise<boolean> {
    return this.chatContainer.first().isVisible()
  }

  /**
   * Check if the input bar is visible.
   */
  async isInputBarVisible(): Promise<boolean> {
    return this.inputBar.first().isVisible()
  }

  /**
   * Get the placeholder text of the input field.
   */
  async getInputPlaceholder(): Promise<string | null> {
    const input = this.inputBar
      .locator('[data-ui~="part:composer-input"]')
      .locator('textarea, [contenteditable="true"], input[type="text"]')
    return input.first().getAttribute('placeholder')
  }
}
