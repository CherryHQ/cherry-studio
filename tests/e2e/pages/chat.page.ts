import type { Locator, Page } from '@playwright/test'

import { BasePage } from './base.page'

/**
 * Page Object for the Chat/Conversation interface.
 * Handles message input, sending, and conversation management.
 */
export class ChatPage extends BasePage {
  readonly chatContainer: Locator
  readonly inputArea: Locator
  readonly sendButton: Locator
  readonly messageList: Locator
  readonly userMessages: Locator
  readonly assistantMessages: Locator
  readonly newTopicButton: Locator
  readonly topicList: Locator
  readonly stopButton: Locator

  constructor(page: Page) {
    super(page)
    this.chatContainer = page.locator('#chat, [class*="Chat"]')
    this.inputArea = page.locator(
      '[class*="Inputbar"] textarea, [class*="InputBar"] textarea, [contenteditable="true"]'
    )
    this.sendButton = page.locator(
      '[class*="SendMessageButton"], [class*="send-button"], button[aria-label*="send"], button[title*="send"]'
    )
    this.messageList = page.locator('#messages, [class*="Messages"], [class*="MessageList"]')
    this.userMessages = page.locator('[class*="UserMessage"], [class*="user-message"]')
    this.assistantMessages = page.locator('[class*="AssistantMessage"], [class*="assistant-message"]')
    this.newTopicButton = page.locator('[class*="NewTopicButton"], [class*="new-topic"]')
    this.topicList = page.locator('[class*="TopicList"], [class*="topic-list"]')
    this.stopButton = page.locator('[class*="StopButton"], [class*="stop-button"]')
  }

  /**
   * Navigate to chat/home page.
   */
  async goto(): Promise<void> {
    await this.navigateTo('/')
    await this.chatContainer
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => {})
  }

  /**
   * Check if chat is visible.
   */
  async isChatVisible(): Promise<boolean> {
    return this.chatContainer.first().isVisible()
  }

  /**
   * Type a message in the input area.
   */
  async typeMessage(message: string): Promise<void> {
    await this.inputArea.first().fill(message)
  }

  /**
   * Clear the input area.
   */
  async clearInput(): Promise<void> {
    await this.inputArea.first().clear()
  }

  /**
   * Click the send button.
   */
  async clickSend(): Promise<void> {
    await this.sendButton.first().click()
  }

  /**
   * Type and send a message.
   */
  async sendMessage(message: string): Promise<void> {
    await this.typeMessage(message)
    await this.clickSend()
  }

  /**
   * Get the current input value.
   */
  async getInputValue(): Promise<string> {
    return (await this.inputArea.first().inputValue()) || (await this.inputArea.first().textContent()) || ''
  }

  /**
   * Get the count of user messages.
   */
  async getUserMessageCount(): Promise<number> {
    return this.userMessages.count()
  }

  /**
   * Get the count of assistant messages.
   */
  async getAssistantMessageCount(): Promise<number> {
    return this.assistantMessages.count()
  }

  /**
   * Check if send button is enabled.
   */
  async isSendButtonEnabled(): Promise<boolean> {
    const isDisabled = await this.sendButton.first().isDisabled()
    return !isDisabled
  }

  /**
   * Create a new topic/conversation.
   */
  async createNewTopic(): Promise<void> {
    await this.newTopicButton.first().click()
  }

  /**
   * Check if stop button is visible (indicates ongoing generation).
   */
  async isGenerating(): Promise<boolean> {
    return this.stopButton.first().isVisible()
  }

  /**
   * Click stop button to stop generation.
   */
  async stopGeneration(): Promise<void> {
    await this.stopButton.first().click()
  }

  /**
   * Wait for generation to complete.
   */
  async waitForGenerationComplete(timeout: number = 60000): Promise<void> {
    await this.stopButton.first().waitFor({ state: 'hidden', timeout })
  }
}
