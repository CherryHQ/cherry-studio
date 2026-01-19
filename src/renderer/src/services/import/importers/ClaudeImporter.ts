import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { Model, Topic } from '@renderer/types'
import {
  AssistantMessageStatus,
  type MainTextMessageBlock,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock,
  type ToolMessageBlock,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { uuid } from '@renderer/utils'

import type { ConversationImporter, ImportOptions, ImportResult } from '../types'

const logger = loggerService.withContext('ClaudeImporter')

/**
 * Claude Export Format Types (from agoramachina/claude-exporter)
 */
interface ClaudeContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  thinking?: string
  name?: string // tool name for tool_use
  input?: Record<string, unknown> // tool input for tool_use
  display_content?: {
    type: string
    code?: string
    language?: string
    filename?: string
    json_block?: string // Stringified JSON containing {code, language} for some artifacts
  }
}

interface ClaudeMessage {
  uuid: string
  parent_message_uuid: string | null
  child_message_uuids: string[]
  sender: 'human' | 'assistant'
  content: ClaudeContentBlock[]
  created_at: string
}

interface ClaudeConversation {
  uuid: string
  name: string
  model: string | null
  created_at: string
  updated_at: string
  chat_messages: ClaudeMessage[]
  current_leaf_message_uuid: string
}

/**
 * Claude conversation importer
 * Handles importing conversations from the agoramachina/claude-exporter Chrome extension
 */
export class ClaudeImporter implements ConversationImporter {
  readonly name = 'Claude'
  readonly emoji = '🤖'

  /**
   * Validate if the file content is a valid Claude export
   */
  validate(fileContent: string): boolean {
    try {
      const parsed = JSON.parse(fileContent)
      const conversations = Array.isArray(parsed) ? parsed : [parsed]

      // Check if it has the Claude conversation structure
      // Must have chat_messages array and uuid - distinguishes from ChatGPT's mapping structure
      return conversations.every(
        (conv) =>
          conv &&
          typeof conv === 'object' &&
          'chat_messages' in conv &&
          Array.isArray(conv.chat_messages) &&
          'uuid' in conv &&
          typeof conv.uuid === 'string'
      )
    } catch {
      return false
    }
  }

  /**
   * Extract model bucket info for batch import grouping.
   * Returns { key, label } for model-based assistant grouping, or null if unknown.
   * @implements ConversationImporter.getModelBucket
   */
  getModelBucket(fileContent: string): { key: string; label: string } | null {
    try {
      const parsed = JSON.parse(fileContent)
      const conversations = Array.isArray(parsed) ? parsed : [parsed]
      const models = new Set<string>()

      for (const conversation of conversations) {
        const model = typeof conversation?.model === 'string' ? conversation.model.trim() : ''
        if (model) models.add(model)
      }

      if (models.size === 1) {
        const modelKey = Array.from(models)[0]
        return { key: modelKey, label: this.getAssistantModelLabel(modelKey) }
      }
      if (models.size > 1) {
        // Use generic i18n key for user-visible string
        return { key: '__mixed__', label: i18n.t('import.model.mixed', { defaultValue: 'Mixed Models' }) }
      }
      return null // Unknown - ImportService will use fallback with i18n
    } catch {
      return null
    }
  }

  /**
   * Parse Claude conversations and convert to unified format
   * @param options.importAllBranches - If true, imports ALL branches (edit history, regenerations)
   *                                    If false (default), imports only the current/main branch
   */
  async parse(fileContent: string, assistantId: string, options?: ImportOptions): Promise<ImportResult> {
    const importAllBranches = options?.importAllBranches ?? false
    logger.info(`Starting Claude import... (importAllBranches: ${importAllBranches})`)

    // Parse JSON
    const parsed = JSON.parse(fileContent)
    const conversations: ClaudeConversation[] = Array.isArray(parsed) ? parsed : [parsed]

    if (!conversations || conversations.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_conversations'))
    }

    logger.info(`Found ${conversations.length} conversations`)

    const topics: Topic[] = []
    const allMessages: Message[] = []
    const allBlocks: MessageBlock[] = []

    // Convert each conversation (may produce multiple topics if importAllBranches is true)
    for (const conversation of conversations) {
      try {
        const results = this.convertConversationToTopics(conversation, assistantId, importAllBranches)
        for (const result of results) {
          topics.push(result.topic)
          allMessages.push(...result.messages)
          allBlocks.push(...result.blocks)
        }
      } catch (convError) {
        logger.warn(`Failed to convert conversation "${conversation.name}":`, convError as Error)
        // Continue with other conversations
      }
    }

    if (topics.length === 0) {
      throw new Error(i18n.t('import.claude.error.no_valid_conversations'))
    }

    return {
      topics,
      messages: allMessages,
      blocks: allBlocks
    }
  }

  /**
   * Find all leaf nodes in the message tree
   * Leaf nodes are messages with no children
   */
  private findAllLeafNodes(messages: ClaudeMessage[]): ClaudeMessage[] {
    return messages.filter((msg) => !msg.child_message_uuids || msg.child_message_uuids.length === 0)
  }

  /**
   * Trace from a leaf node back to the root to get a branch
   */
  private traceToRoot(messageMap: Map<string, ClaudeMessage>, leafUuid: string): ClaudeMessage[] {
    const branch: ClaudeMessage[] = []
    let currentUuid: string | null = leafUuid

    while (currentUuid) {
      const msg = messageMap.get(currentUuid)
      if (!msg) break
      branch.unshift(msg)
      currentUuid = msg.parent_message_uuid
    }

    return branch
  }

  /**
   * Extract all branches from a conversation
   * Each branch represents a different path through the conversation tree
   * Used when importAllBranches option is enabled
   */
  private extractAllBranches(messages: ClaudeMessage[], currentLeafUuid?: string): ClaudeMessage[][] {
    // Build message lookup map for O(1) access
    const messageMap = new Map<string, ClaudeMessage>()
    for (const msg of messages) {
      messageMap.set(msg.uuid, msg)
    }

    // Find all leaf nodes
    const leafNodes = this.findAllLeafNodes(messages)

    if (leafNodes.length === 0) {
      return []
    }

    // Extract each branch by tracing from leaf to root
    const branches: ClaudeMessage[][] = []
    for (const leaf of leafNodes) {
      const branch = this.traceToRoot(messageMap, leaf.uuid)
      if (branch.length > 0) {
        branches.push(branch)
      }
    }

    // Sort branches: main branch (current_leaf) first, then by earliest message timestamp
    branches.sort((a, b) => {
      const aLeafUuid = a[a.length - 1]?.uuid
      const bLeafUuid = b[b.length - 1]?.uuid

      // Current leaf branch should be first
      if (aLeafUuid === currentLeafUuid) return -1
      if (bLeafUuid === currentLeafUuid) return 1

      // Sort by earliest message timestamp (branch creation order)
      const aFirstTime = a[0]?.created_at ? new Date(a[0].created_at).getTime() : 0
      const bFirstTime = b[0]?.created_at ? new Date(b[0].created_at).getTime() : 0
      return aFirstTime - bFirstTime
    })

    return branches
  }

  /**
   * Map Claude sender to Cherry Studio role
   */
  private mapRole(sender: 'human' | 'assistant'): 'user' | 'assistant' {
    return sender === 'human' ? 'user' : 'assistant'
  }

  /**
   * Process Claude content blocks and create typed MessageBlocks
   * PRESERVES ORIGINAL ORDER from Claude's response
   * Returns blocks in the same order as they appeared in the original conversation
   */
  private processContentBlocks(
    contentBlocks: ClaudeContentBlock[],
    messageId: string,
    createdAt: string
  ): MessageBlock[] {
    const blocks: MessageBlock[] = []
    let pendingTextParts: string[] = []

    // Helper to flush accumulated text as a MainTextMessageBlock
    const flushText = () => {
      if (pendingTextParts.length > 0) {
        const mainTextBlock: MainTextMessageBlock = {
          id: uuid(),
          messageId,
          type: MessageBlockType.MAIN_TEXT,
          content: pendingTextParts.join('\n\n').trim(),
          createdAt,
          updatedAt: createdAt,
          status: MessageBlockStatus.SUCCESS
        }
        blocks.push(mainTextBlock)
        pendingTextParts = []
      }
    }

    for (const block of contentBlocks) {
      if (block.type === 'text' && block.text) {
        // Accumulate consecutive text blocks
        pendingTextParts.push(block.text)
      } else if (block.type === 'thinking' && block.thinking) {
        // Flush any pending text BEFORE the thinking block
        flushText()
        // Create ThinkingMessageBlock
        const thinkingBlock: ThinkingMessageBlock = {
          id: uuid(),
          messageId,
          type: MessageBlockType.THINKING,
          content: block.thinking,
          thinking_millsec: 0, // Not available in export, default to 0
          createdAt,
          updatedAt: createdAt,
          status: MessageBlockStatus.SUCCESS
        }
        blocks.push(thinkingBlock)
      } else if (block.type === 'tool_use') {
        // DEBUG: Log tool_use block details for artifact extraction
        logger.debug(`Processing tool_use block: name=${block.name}`, {
          displayContentType: block.display_content?.type,
          hasJsonBlock: !!block.display_content?.json_block,
          hasDirectCode: !!block.display_content?.code,
          hasInputFileText: !!(block.input as Record<string, unknown>)?.file_text
        })

        // Try to extract artifact/file content from multiple sources
        // Each source is tried in order until we find code
        let artifactCode: string | undefined
        let artifactLanguage: string | undefined
        let artifactFilename: string | undefined

        // Source 1: Direct code field in display_content
        if (block.display_content?.code) {
          artifactCode = block.display_content.code
          artifactLanguage = block.display_content.language
          artifactFilename = block.display_content.filename
        }

        // Source 2: json_block in display_content (stringified JSON with code)
        if (!artifactCode && block.display_content?.type === 'json_block' && block.display_content.json_block) {
          try {
            const parsed = JSON.parse(block.display_content.json_block)
            if (parsed.code) {
              artifactCode = parsed.code
              artifactLanguage = parsed.language
              artifactFilename = parsed.filename
            }
          } catch {
            // JSON parsing failed, try next source
          }
        }

        // Source 3: input.file_text for filesystem MCP tools (create_file, write_file, etc.)
        if (!artifactCode && block.input && typeof block.input === 'object') {
          const input = block.input as Record<string, unknown>
          if (typeof input.file_text === 'string' && input.file_text) {
            artifactCode = input.file_text
            artifactFilename = typeof input.path === 'string' ? input.path : undefined
            const ext = artifactFilename?.split('.').pop()?.toLowerCase()
            artifactLanguage = this.getLanguageFromExtension(ext)
          }
        }

        // DEBUG: Log extraction result
        logger.debug(`Artifact extraction result: hasCode=${!!artifactCode}, codeLength=${artifactCode?.length || 0}`, {
          language: artifactLanguage,
          filename: artifactFilename
        })

        if (artifactCode) {
          // Flush any pending text BEFORE the code block
          flushText()
          // Render as MAIN_TEXT with markdown code fence (workaround for CODE block rendering bug in Blocks/index.tsx)
          const markdownContent = `\`\`\`${artifactLanguage || 'text'}\n${artifactFilename ? `// ${artifactFilename}\n` : ''}${artifactCode}\n\`\`\``
          const mainTextBlock: MainTextMessageBlock = {
            id: uuid(),
            messageId,
            type: MessageBlockType.MAIN_TEXT,
            content: markdownContent,
            createdAt,
            updatedAt: createdAt,
            status: MessageBlockStatus.SUCCESS
          }
          blocks.push(mainTextBlock)
        } else if (block.name) {
          // Flush any pending text BEFORE the tool block
          flushText()
          // MCP/Tool use without artifact - create ToolMessageBlock
          const toolBlock: ToolMessageBlock = {
            id: uuid(),
            messageId,
            type: MessageBlockType.TOOL,
            toolId: block.name,
            toolName: block.name,
            arguments: block.input,
            createdAt,
            updatedAt: createdAt,
            status: MessageBlockStatus.SUCCESS
          }
          blocks.push(toolBlock)
        }
      }
      // Skip 'tool_result' blocks (handled as part of tool flow)
    }

    // Flush any remaining text at the end
    flushText()

    return blocks
  }

  /**
   * Map model string to Model object, preserving the exact model identifier
   */
  private mapModelToModelObject(modelString: string | null): Model | undefined {
    if (!modelString) {
      // Default fallback when no model is specified
      const fallbackModelId = 'claude-3-opus-20240229'
      return {
        id: fallbackModelId,
        provider: 'anthropic',
        name: this.getModelDisplayName(fallbackModelId),
        group: this.getModelGroup(fallbackModelId)
      }
    }

    return {
      id: modelString,
      provider: 'anthropic',
      name: this.getModelDisplayName(modelString),
      group: this.getModelGroup(modelString)
    }
  }

  public getAssistantModelLabel(modelString: string | null): string {
    if (!modelString) {
      return i18n.t('import.model.unknown', { defaultValue: 'Unknown Model' })
    }

    const displayName = this.getModelDisplayName(modelString)
    return displayName === 'Claude' ? modelString : displayName
  }

  /**
   * Extract display name from model string
   */
  private getModelDisplayName(modelId: string): string {
    const parsed = this.parseClaudeModelId(modelId)
    if (parsed.family && parsed.version) {
      const family = this.capitalize(parsed.family)
      if (parsed.ordering === 'version-first') {
        return `Claude ${parsed.version} ${family}`
      }
      return `Claude ${family} ${parsed.version}`
    }

    // Extract base name for common Claude models
    const lowerModelId = modelId.toLowerCase()
    if (lowerModelId.includes('opus')) return 'Claude Opus'
    if (lowerModelId.includes('sonnet')) return 'Claude Sonnet'
    if (lowerModelId.includes('haiku')) return 'Claude Haiku'
    return 'Claude'
  }

  /**
   * Extract model group from model string
   */
  private getModelGroup(modelId: string): string {
    const parsed = this.parseClaudeModelId(modelId)
    if (parsed.version) {
      return `claude-${parsed.version}`
    }

    // Extract version group (claude-3, claude-3.5, etc.)
    const match = modelId.match(/claude-(\d+(?:\.\d+)?)/i)
    if (match) {
      return `claude-${match[1]}`
    }
    return 'claude'
  }

  private parseClaudeModelId(modelId: string): {
    family?: 'opus' | 'sonnet' | 'haiku'
    version?: string
    ordering?: 'version-first' | 'family-first'
  } {
    const normalized = modelId.toLowerCase().trim()
    const withoutPrefix = normalized.replace(/^anthropic[/.]/, '')
    // Strip trailing date suffix (8-digit date like 20250514) before parsing
    // This handles new model IDs like "claude-sonnet-4-20250514" → extracts just "4"
    const base = withoutPrefix
      .split('@')[0]
      .split(':')[0]
      .replace(/-\d{8}$/, '')

    const versionFirst = base.match(/^claude-(\d+(?:[.-]\d+)?)-(opus|sonnet|haiku)/)
    if (versionFirst) {
      return {
        version: this.normalizeClaudeVersion(versionFirst[1]),
        family: versionFirst[2] as 'opus' | 'sonnet' | 'haiku',
        ordering: 'version-first'
      }
    }

    const familyFirst = base.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[.-]\d+)?)/)
    if (familyFirst) {
      return {
        version: this.normalizeClaudeVersion(familyFirst[2]),
        family: familyFirst[1] as 'opus' | 'sonnet' | 'haiku',
        ordering: 'family-first'
      }
    }

    return {}
  }

  private normalizeClaudeVersion(version: string): string {
    return version.replace('-', '.')
  }

  private capitalize(value: string): string {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
  }

  /**
   * Map file extension to language identifier for syntax highlighting
   */
  private getLanguageFromExtension(ext?: string): string {
    if (!ext) return 'text'
    const extMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      jsx: 'javascript',
      py: 'python',
      rb: 'ruby',
      rs: 'rust',
      go: 'go',
      java: 'java',
      kt: 'kotlin',
      swift: 'swift',
      c: 'c',
      cpp: 'cpp',
      h: 'c',
      hpp: 'cpp',
      cs: 'csharp',
      php: 'php',
      sh: 'bash',
      bash: 'bash',
      zsh: 'bash',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      xml: 'xml',
      html: 'html',
      css: 'css',
      scss: 'scss',
      less: 'less',
      sql: 'sql',
      md: 'markdown',
      markdown: 'markdown',
      txt: 'text',
      toml: 'toml',
      ini: 'ini',
      cfg: 'ini',
      dockerfile: 'dockerfile'
    }
    return extMap[ext] || ext
  }

  /**
   * Create Message and MessageBlocks from Claude message
   * Returns multiple blocks for thinking, code artifacts, tool use, and main text
   */
  private createMessageAndBlocks(
    claudeMessage: ClaudeMessage,
    topicId: string,
    assistantId: string,
    conversationModel: string | null
  ): { message: Message; blocks: MessageBlock[] } | null {
    const messageId = uuid()
    const role = this.mapRole(claudeMessage.sender)
    const createdAt = claudeMessage.created_at || new Date().toISOString()

    // Process all content blocks and create typed MessageBlocks
    const blocks = this.processContentBlocks(claudeMessage.content, messageId, createdAt)

    // Skip messages with no blocks
    if (blocks.length === 0) {
      return null
    }

    // Create message with references to all block IDs
    const message: Message = {
      id: messageId,
      role,
      assistantId,
      topicId,
      createdAt,
      updatedAt: createdAt,
      status: role === 'user' ? UserMessageStatus.SUCCESS : AssistantMessageStatus.SUCCESS,
      blocks: blocks.map((b) => b.id),
      // Set model for assistant messages - preserve the actual model used
      ...(role === 'assistant' && {
        model: this.mapModelToModelObject(conversationModel)
      })
    }

    return { message, blocks }
  }

  /**
   * Convert Claude conversation to Cherry Studio Topics
   * Only imports the current/main branch (identified by current_leaf_message_uuid)
   * This avoids creating thousands of topics from abandoned edit/regeneration branches
   */
  private convertConversationToTopics(
    conversation: ClaudeConversation,
    assistantId: string,
    importAllBranches = false
  ): Array<{ topic: Topic; messages: Message[]; blocks: MessageBlock[] }> {
    const results: Array<{ topic: Topic; messages: Message[]; blocks: MessageBlock[] }> = []

    // Get branches to import
    let branches: ClaudeMessage[][]
    if (importAllBranches) {
      // Import ALL branches (edit history, regenerations, etc.)
      branches = this.extractAllBranches(conversation.chat_messages, conversation.current_leaf_message_uuid)
    } else {
      // Only import the current/main branch (default)
      const currentBranch = this.extractCurrentBranch(
        conversation.chat_messages,
        conversation.current_leaf_message_uuid
      )
      branches = currentBranch.length > 0 ? [currentBranch] : []
    }

    if (branches.length === 0) {
      logger.warn(`No messages found in conversation "${conversation.name}"`)
      return results
    }

    // Process each branch as a separate topic
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
      const branch = branches[branchIndex]
      const topicId = uuid()
      const messages: Message[] = []
      const blocks: MessageBlock[] = []

      // Convert each message in the branch
      for (const claudeMessage of branch) {
        const result = this.createMessageAndBlocks(claudeMessage, topicId, assistantId, conversation.model)
        if (result) {
          messages.push(result.message)
          blocks.push(...result.blocks)
        }
      }

      // Skip if no valid messages
      if (messages.length === 0) {
        continue
      }

      // Use conversation name as topic name (with branch suffix for non-main branches)
      const baseName = conversation.name || i18n.t('import.claude.untitled_conversation')
      const topicName =
        branchIndex === 0
          ? baseName
          : i18n.t('import.claude.branch_name', {
              name: baseName,
              index: branchIndex + 1,
              defaultValue: `${baseName} (branch ${branchIndex + 1})`
            })

      // Create topic
      const topic: Topic = {
        id: topicId,
        assistantId,
        name: topicName,
        createdAt: conversation.created_at || new Date().toISOString(),
        updatedAt: conversation.updated_at || new Date().toISOString(),
        messages,
        isNameManuallyEdited: true
      }

      results.push({ topic, messages, blocks })
    }

    return results
  }

  /**
   * Extract only the current/main branch from the conversation
   * Uses current_leaf_message_uuid to find the active branch
   */
  private extractCurrentBranch(messages: ClaudeMessage[], currentLeafUuid?: string): ClaudeMessage[] {
    if (messages.length === 0) {
      return []
    }

    // Build message lookup map
    const messageMap = new Map<string, ClaudeMessage>()
    for (const msg of messages) {
      messageMap.set(msg.uuid, msg)
    }

    // If we have the current leaf UUID, trace from it to root
    if (currentLeafUuid && messageMap.has(currentLeafUuid)) {
      return this.traceToRoot(messageMap, currentLeafUuid)
    }

    // Fallback: find the first leaf node (message with no children)
    const leafNodes = this.findAllLeafNodes(messages)
    if (leafNodes.length > 0) {
      return this.traceToRoot(messageMap, leafNodes[0].uuid)
    }

    // Last resort: return all messages in order (linear conversation)
    return [...messages].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
      return aTime - bTime
    })
  }
}
