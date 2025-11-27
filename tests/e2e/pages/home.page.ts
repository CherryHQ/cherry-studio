import type { Locator, Page } from '@playwright/test'

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
    this.homePage = page.locator('#home-page, [class*="HomePage"], [class*="Home"]')
    this.chatContainer = page.locator('#chat, [class*="Chat"]')
    this.inputBar = page.locator('[class*="Inputbar"], [class*="InputBar"], [class*="input-bar"]')
    this.messagesList = page.locator('#messages, [class*="Messages"], [class*="MessageList"]')
    this.sendButton = page.locator('[class*="SendMessageButton"], [class*="send-button"], button[type="submit"]')
    this.newTopicButton = page.locator('[class*="NewTopicButton"], [class*="new-topic"]')
    this.assistantTabs = page.locator('[class*="HomeTabs"], [class*="AssistantTabs"]')
    this.topicList = page.locator('[class*="TopicList"], [class*="topic-list"]')
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
    const input = this.page.locator(
      '[class*="Inputbar"] textarea, [class*="Inputbar"] [contenteditable], [class*="InputBar"] textarea'
    )
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
    const messages = this.page.locator('[class*="Message"]:not([class*="Messages"]):not([class*="MessageList"])')
    return messages.count()
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
    const input = this.page.locator('[class*="Inputbar"] textarea, [class*="InputBar"] textarea')
    return input.first().getAttribute('placeholder')
  }
}
