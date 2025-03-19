/**
 * AWS Bedrock Types Definition
 * Type definitions for request and response parameters
 */
import {
  ContentBlock,
  ConversationRole,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseOutput,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  ConverseStreamOutput,
  Message,
  SystemContentBlock
} from '@aws-sdk/client-bedrock-runtime'

// Re-export AWS SDK types
export type {
  ContentBlock,
  ConversationRole,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseOutput,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  ConverseStreamOutput,
  Message,
  SystemContentBlock
}

/**
 * Message role type
 */
export type MessageRole = ConversationRole

/**
 * Inference configuration
 */
export interface InferenceConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
  additionalModelRequestFields?: Record<string, any>
  toolConfig?: {
    tools: Array<{
      toolSpec: {
        name: string
        description: string
        inputSchema: {
          json: any
        }
      }
    }>
    toolChoice?: {
      auto?: Record<string, never>
      any?: Record<string, never>
      tool?: {
        name: string
      }
    }
  }
}

/**
 * Thinking configuration - Claude models
 */
export interface ClaudeThinkingConfig {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

/**
 * Thinking configuration - DeepSeek models
 */
export interface DeepSeekThinkingConfig {
  include_reasoning: boolean
}

/**
 * Thinking configuration
 */
export type ThinkingConfig = ClaudeThinkingConfig | DeepSeekThinkingConfig

/**
 * System configuration
 */
export type SystemConfig = SystemContentBlock[]

/**
 * Converse request parameters
 */
export type ConverseRequest = ConverseCommandInput

/**
 * Converse response parameters
 */
export type ConverseResponse = ConverseCommandOutput

/**
 * Converse Stream request parameters
 */
export type ConverseStreamRequest = ConverseStreamCommandInput

/**
 * Converse Stream response parameters
 */
export type ConverseStreamResponse = ConverseStreamCommandOutput

/**
 * Converse Stream response chunk
 */
export type ConverseStreamResponseChunk = ConverseStreamOutput

/**
 * Convert message content to Bedrock message format
 * @param content Message content
 * @returns Bedrock message content
 */
export function convertToBedrockContent(content: string): ContentBlock[] {
  return [{ text: content }]
}

/**
 * Convert message to Bedrock message format
 * @param role Role
 * @param content Content
 * @returns Bedrock message
 */
export function createBedrockMessage(role: MessageRole, content: string): Message {
  return {
    role,
    content: convertToBedrockContent(content)
  }
}
