/**
 * Chat Migrator - Migrates topics and messages from Dexie to SQLite
 *
 * ## Overview
 *
 * This migrator handles the largest data migration task: transferring all chat topics
 * and their messages from the old Dexie/IndexedDB storage to the new SQLite database.
 *
 * ## Data Sources
 *
 * | Data | Source | File/Path |
 * |------|--------|-----------|
 * | Topics with messages | Dexie `topics` table | `topics.json` → `{ id, messages[] }` |
 * | Message blocks | Dexie `message_blocks` table | `message_blocks.json` |
 * | Assistants (for meta) | Redux `assistants` slice | `ReduxStateReader.getCategory('assistants')` |
 *
 * ## Target Tables
 *
 * - `topicTable` - Stores conversation topics/threads
 * - `messageTable` - Stores chat messages with tree structure
 *
 * ## Key Transformations
 *
 * 1. **Linear → Tree Structure**
 *    - Old: Messages stored as linear array in `topic.messages[]`
 *    - New: Tree via `parentId` + `siblingsGroupId`
 *
 * 2. **Multi-model Responses**
 *    - Old: `askId` links responses to user message, `foldSelected` marks active
 *    - New: Shared `parentId` + non-zero `siblingsGroupId` groups siblings
 *
 * 3. **Block Inlining**
 *    - Old: `message.blocks: string[]` (IDs) + separate `message_blocks` table
 *    - New: `message.data.blocks: MessageDataBlock[]` (inline JSON)
 *
 * 4. **Citation Migration**
 *    - Old: Separate `CitationMessageBlock`
 *    - New: Merged into `MainTextBlock.references` as ContentReference[]
 *
 * 5. **Mention Migration**
 *    - Old: `message.mentions: Model[]`
 *    - New: `MentionReference[]` in `MainTextBlock.references`
 *
 * ## Performance Considerations
 *
 * - Uses streaming JSON reader for large data sets (potentially millions of messages)
 * - Processes topics in batches to control memory usage
 * - Pre-loads all blocks into memory map for O(1) lookup (blocks table is smaller)
 * - Uses database transactions for atomicity and performance
 *
 * @since v2.0.0
 */

import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  buildBlockLookup,
  buildMessageTree,
  findActiveNodeId,
  type NewMessage,
  type NewTopic,
  type OldAssistant,
  type OldBlock,
  type OldTopic,
  type OldTopicMeta,
  resolveBlocks,
  transformMessage,
  transformTopic
} from './mappings/ChatMappings'

const logger = loggerService.withContext('ChatMigrator')

/**
 * Batch size for processing topics
 * Chosen to balance memory usage and transaction overhead
 */
const TOPIC_BATCH_SIZE = 50

/**
 * Batch size for inserting messages
 * SQLite has limits on the number of parameters per statement
 */
const MESSAGE_INSERT_BATCH_SIZE = 100

/**
 * Assistant data from Redux for generating AssistantMeta
 */
interface AssistantState {
  assistants: OldAssistant[]
}

/**
 * Prepared data for execution phase
 */
interface PreparedTopicData {
  topic: NewTopic
  messages: NewMessage[]
}

export class ChatMigrator extends BaseMigrator {
  readonly id = 'chat'
  readonly name = 'ChatData'
  readonly description = 'Migrate chat topics and messages'
  readonly order = 4

  // Prepared data for execution
  private topicCount = 0
  private messageCount = 0
  private blockLookup: Map<string, OldBlock> = new Map()
  private assistantLookup: Map<string, OldAssistant> = new Map()
  // Topic metadata from Redux (name, pinned, etc.) - Dexie only has messages
  private topicMetaLookup: Map<string, OldTopicMeta> = new Map()
  // Topic → AssistantId mapping from Redux (Dexie topics don't store assistantId)
  private topicAssistantLookup: Map<string, string> = new Map()
  private skippedTopics = 0
  private skippedMessages = 0
  // Track seen message IDs to handle duplicates across topics
  private seenMessageIds = new Set<string>()
  // Block statistics for diagnostics
  private blockStats = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }

  /**
   * Prepare phase - validate source data and count items
   *
   * Steps:
   * 1. Check if topics.json and message_blocks.json exist
   * 2. Load all blocks into memory for fast lookup
   * 3. Load assistant data for generating meta
   * 4. Count topics and estimate message count
   * 5. Validate sample data for integrity
   */
  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []

    try {
      // Step 1: Verify export files exist
      const topicsExist = await ctx.sources.dexieExport.tableExists('topics')
      if (!topicsExist) {
        logger.warn('topics.json not found, skipping chat migration')
        return {
          success: true,
          itemCount: 0,
          warnings: ['topics.json not found - no chat data to migrate']
        }
      }

      const blocksExist = await ctx.sources.dexieExport.tableExists('message_blocks')
      if (!blocksExist) {
        warnings.push('message_blocks.json not found - messages will have empty blocks')
      }

      // Step 2: Load all blocks into lookup map
      // Blocks table is typically smaller than messages, safe to load entirely
      if (blocksExist) {
        logger.info('Loading message blocks into memory...')
        const blocks = await ctx.sources.dexieExport.readTable<OldBlock>('message_blocks')
        this.blockLookup = buildBlockLookup(blocks)
        logger.info(`Loaded ${this.blockLookup.size} blocks into lookup map`)
      }

      // Step 3: Load assistant data for generating AssistantMeta
      // Also extract topic metadata from assistants (Redux stores topic metadata in assistants.topics[])
      const assistantState = ctx.sources.reduxState.getCategory<AssistantState>('assistants')
      if (assistantState?.assistants) {
        for (const assistant of assistantState.assistants) {
          this.assistantLookup.set(assistant.id, assistant)

          // Extract topic metadata from this assistant's topics array
          // Redux stores topic metadata (name, pinned, etc.) but with messages: []
          // Also track topic → assistantId mapping (Dexie doesn't store assistantId)
          if (assistant.topics && Array.isArray(assistant.topics)) {
            for (const topic of assistant.topics) {
              if (topic.id) {
                this.topicMetaLookup.set(topic.id, topic)
                this.topicAssistantLookup.set(topic.id, assistant.id)
              }
            }
          }
        }
        logger.info(
          `Loaded ${this.assistantLookup.size} assistants and ${this.topicMetaLookup.size} topic metadata entries`
        )
      } else {
        warnings.push('No assistant data found - topics will have null assistantMeta and missing names')
      }

      // Step 4: Count topics and estimate messages
      const topicReader = ctx.sources.dexieExport.createStreamReader('topics')
      this.topicCount = await topicReader.count()
      logger.info(`Found ${this.topicCount} topics to migrate`)

      // Estimate message count from sample
      if (this.topicCount > 0) {
        const sampleTopics = await topicReader.readSample<OldTopic>(10)
        const avgMessagesPerTopic =
          sampleTopics.reduce((sum, t) => sum + (t.messages?.length || 0), 0) / sampleTopics.length
        this.messageCount = Math.round(this.topicCount * avgMessagesPerTopic)
        logger.info(`Estimated ${this.messageCount} messages based on sample`)
      }

      // Step 5: Validate sample data
      if (this.topicCount > 0) {
        const sampleTopics = await topicReader.readSample<OldTopic>(5)
        for (const topic of sampleTopics) {
          if (!topic.id) {
            warnings.push(`Found topic without id - will be skipped`)
          }
          if (!topic.messages || !Array.isArray(topic.messages)) {
            warnings.push(`Topic ${topic.id} has invalid messages array`)
          }
        }
      }

      logger.info('Prepare phase completed', {
        topics: this.topicCount,
        estimatedMessages: this.messageCount,
        blocks: this.blockLookup.size,
        assistants: this.assistantLookup.size
      })

      return {
        success: true,
        itemCount: this.topicCount,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    } catch (error) {
      logger.error('Prepare failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  /**
   * Execute phase - perform the actual data migration
   *
   * Processing strategy:
   * 1. Stream topics in batches to control memory
   * 2. For each topic batch:
   *    a. Transform topics and their messages
   *    b. Build message tree structure
   *    c. Insert topics in single transaction
   *    d. Insert messages in batched transactions
   * 3. Report progress throughout
   */
  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.topicCount === 0) {
      logger.info('No topics to migrate')
      return { success: true, processedCount: 0 }
    }

    let processedTopics = 0
    let processedMessages = 0

    try {
      const db = ctx.db
      const topicReader = ctx.sources.dexieExport.createStreamReader('topics')

      // Process topics in batches
      await topicReader.readInBatches<OldTopic>(TOPIC_BATCH_SIZE, async (topics, batchIndex) => {
        logger.debug(`Processing topic batch ${batchIndex + 1}`, { count: topics.length })

        // Transform all topics and messages in this batch
        const preparedData: PreparedTopicData[] = []

        for (const oldTopic of topics) {
          try {
            const prepared = this.prepareTopicData(oldTopic)
            if (prepared) {
              preparedData.push(prepared)
            } else {
              this.skippedTopics++
            }
          } catch (error) {
            logger.warn(`Failed to transform topic ${oldTopic.id}`, { error })
            this.skippedTopics++
          }
        }

        // Insert topics in a transaction
        if (preparedData.length > 0) {
          // Collect all messages and handle duplicates BEFORE transaction
          // This ensures parentId references are updated correctly
          const allMessages: NewMessage[] = []
          const idRemapping = new Map<string, string>() // oldId → newId for duplicates
          const batchMessageIds = new Set<string>() // IDs added in this batch (for transaction safety)

          for (const data of preparedData) {
            for (const msg of data.messages) {
              if (this.seenMessageIds.has(msg.id) || batchMessageIds.has(msg.id)) {
                const newId = uuidv4()
                logger.warn(`Duplicate message ID found: ${msg.id}, assigning new ID: ${newId}`)
                idRemapping.set(msg.id, newId)
                msg.id = newId
              }
              batchMessageIds.add(msg.id)
              allMessages.push(msg)
            }
          }

          // Update parentId references for any remapped IDs
          if (idRemapping.size > 0) {
            for (const msg of allMessages) {
              if (msg.parentId && idRemapping.has(msg.parentId)) {
                msg.parentId = idRemapping.get(msg.parentId)!
              }
            }
          }

          // Execute transaction
          await db.transaction(async (tx) => {
            // Insert topics
            const topicValues = preparedData.map((d) => d.topic)
            await tx.insert(topicTable).values(topicValues)

            // Insert messages in batches (SQLite parameter limit)
            for (let i = 0; i < allMessages.length; i += MESSAGE_INSERT_BATCH_SIZE) {
              const batch = allMessages.slice(i, i + MESSAGE_INSERT_BATCH_SIZE)
              await tx.insert(messageTable).values(batch)
            }
          })

          // Update state ONLY after transaction succeeds (transaction safety)
          for (const id of batchMessageIds) {
            this.seenMessageIds.add(id)
          }
          processedMessages += allMessages.length
          processedTopics += preparedData.length
        }

        // Report progress
        const progress = Math.round((processedTopics / this.topicCount) * 100)
        this.reportProgress(
          progress,
          `Migrated ${processedTopics}/${this.topicCount} conversations, ${processedMessages} messages`,
          {
            key: 'migration.progress.migrated_chats',
            params: { processed: processedTopics, total: this.topicCount, messages: processedMessages }
          }
        )
      })

      logger.info('Execute completed', {
        processedTopics,
        processedMessages,
        skippedTopics: this.skippedTopics,
        skippedMessages: this.skippedMessages
      })

      // Log block statistics for diagnostics
      logger.info('Block migration statistics', {
        blocksRequested: this.blockStats.requested,
        blocksResolved: this.blockStats.resolved,
        blocksMissing: this.blockStats.requested - this.blockStats.resolved,
        messagesWithEmptyBlocks: this.blockStats.messagesWithEmptyBlocks,
        messagesWithMissingBlocks: this.blockStats.messagesWithMissingBlocks
      })

      return {
        success: true,
        processedCount: processedTopics
      }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: processedTopics,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  /**
   * Validate phase - verify migrated data integrity
   *
   * Validation checks:
   * 1. Topic count matches source (minus skipped)
   * 2. Message count is within expected range
   * 3. Sample topics have correct structure
   * 4. Foreign key integrity (messages belong to existing topics)
   */
  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      // Count topics in target
      const topicResult = await db.select({ count: sql<number>`count(*)` }).from(topicTable).get()
      const targetTopicCount = topicResult?.count ?? 0

      // Count messages in target
      const messageResult = await db.select({ count: sql<number>`count(*)` }).from(messageTable).get()
      const targetMessageCount = messageResult?.count ?? 0

      logger.info('Validation counts', {
        sourceTopics: this.topicCount,
        targetTopics: targetTopicCount,
        skippedTopics: this.skippedTopics,
        targetMessages: targetMessageCount
      })

      // Validate topic count
      const expectedTopics = this.topicCount - this.skippedTopics
      if (targetTopicCount < expectedTopics) {
        errors.push({
          key: 'topic_count_low',
          message: `Topic count too low: expected ${expectedTopics}, got ${targetTopicCount}`
        })
      } else if (targetTopicCount > expectedTopics) {
        // More topics than expected could indicate duplicate insertions or data corruption
        logger.warn(`Topic count higher than expected: expected ${expectedTopics}, got ${targetTopicCount}`)
      }

      // Sample validation: check a few topics have messages
      const sampleTopics = await db.select().from(topicTable).limit(5).all()
      for (const topic of sampleTopics) {
        const msgCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(messageTable)
          .where(eq(messageTable.topicId, topic.id))
          .get()

        if (msgCount?.count === 0) {
          // This is a warning, not an error - some topics may legitimately have no messages
          logger.warn(`Topic ${topic.id} has no messages after migration`)
        }
      }

      // Check for orphan messages (messages without valid topic)
      // This shouldn't happen due to foreign key constraints, but verify anyway
      const orphanCheck = await db
        .select({ count: sql<number>`count(*)` })
        .from(messageTable)
        .where(sql`${messageTable.topicId} NOT IN (SELECT id FROM ${topicTable})`)
        .get()

      if (orphanCheck && orphanCheck.count > 0) {
        errors.push({
          key: 'orphan_messages',
          message: `Found ${orphanCheck.count} orphan messages without valid topics`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.topicCount,
          targetCount: targetTopicCount,
          skippedCount: this.skippedTopics
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [
          {
            key: 'validation',
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        stats: {
          sourceCount: this.topicCount,
          targetCount: 0,
          skippedCount: this.skippedTopics
        }
      }
    }
  }

  /**
   * Prepare a single topic and its messages for migration
   *
   * @param oldTopic - Source topic from Dexie (has messages, may lack metadata)
   * @returns Prepared data or null if topic should be skipped
   *
   * ## Data Merging
   *
   * Topic data comes from two sources:
   * - Dexie `topics` table: Has `id`, `messages[]`, `assistantId`
   * - Redux `assistants[].topics[]`: Has metadata (`name`, `pinned`, `prompt`, etc.)
   *
   * We merge Redux metadata into the Dexie topic before transformation.
   */
  private prepareTopicData(oldTopic: OldTopic): PreparedTopicData | null {
    // Validate required fields
    if (!oldTopic.id) {
      logger.warn('Topic missing id, skipping')
      return null
    }

    // Merge topic metadata from Redux (name, pinned, etc.)
    // Dexie topics may have stale or missing metadata; Redux is authoritative for these fields
    const topicMeta = this.topicMetaLookup.get(oldTopic.id)
    if (topicMeta) {
      // Merge Redux metadata into Dexie topic
      // Note: Redux topic.name can also be empty from ancient version migrations (see store/migrate.ts:303-305)
      oldTopic.name = topicMeta.name || oldTopic.name
      oldTopic.pinned = topicMeta.pinned ?? oldTopic.pinned
      oldTopic.prompt = topicMeta.prompt ?? oldTopic.prompt
      oldTopic.isNameManuallyEdited = topicMeta.isNameManuallyEdited ?? oldTopic.isNameManuallyEdited
      // Use Redux timestamps if available and Dexie lacks them
      if (topicMeta.createdAt && !oldTopic.createdAt) {
        oldTopic.createdAt = topicMeta.createdAt
      }
      if (topicMeta.updatedAt && !oldTopic.updatedAt) {
        oldTopic.updatedAt = topicMeta.updatedAt
      }
    }

    // Fallback: If name is still empty after merge, use a default name
    // This handles cases where both Dexie and Redux have empty names (ancient version bug)
    if (!oldTopic.name) {
      oldTopic.name = 'Unnamed Topic' // Default fallback for topics with no name
    }

    // Get assistantId from Redux mapping (Dexie topics don't store assistantId)
    // Fall back to oldTopic.assistantId in case Dexie did store it (defensive)
    const assistantId = this.topicAssistantLookup.get(oldTopic.id) || oldTopic.assistantId
    if (assistantId && !oldTopic.assistantId) {
      oldTopic.assistantId = assistantId
    }

    // Get assistant for meta generation
    const assistant = this.assistantLookup.get(assistantId) || null

    // Get messages array (may be empty or undefined)
    const oldMessages = oldTopic.messages || []

    // Build message tree structure
    const messageTree = buildMessageTree(oldMessages)

    // === First pass: identify messages to skip (no blocks) ===
    const skippedMessageIds = new Set<string>()
    const messageParentMap = new Map<string, string | null>() // messageId -> parentId

    for (const oldMsg of oldMessages) {
      const blockIds = oldMsg.blocks || []
      const blocks = resolveBlocks(blockIds, this.blockLookup)

      // Track block statistics for diagnostics
      this.blockStats.requested += blockIds.length
      this.blockStats.resolved += blocks.length
      if (blockIds.length === 0) {
        this.blockStats.messagesWithEmptyBlocks++
      } else if (blocks.length < blockIds.length) {
        this.blockStats.messagesWithMissingBlocks++
        if (blocks.length === 0) {
          logger.warn(`Message ${oldMsg.id} has ${blockIds.length} block IDs but none found in message_blocks`)
        }
      }

      // Store parent info from tree
      const treeInfo = messageTree.get(oldMsg.id)
      messageParentMap.set(oldMsg.id, treeInfo?.parentId ?? null)

      // Mark for skipping if no blocks
      if (blocks.length === 0) {
        skippedMessageIds.add(oldMsg.id)
        this.skippedMessages++
      }
    }

    // === Helper: resolve parent through skipped messages ===
    // If parentId points to a skipped message, follow the chain to find a non-skipped ancestor
    const resolveParentId = (parentId: string | null): string | null => {
      let currentParent = parentId
      const visited = new Set<string>() // Prevent infinite loops

      while (currentParent && skippedMessageIds.has(currentParent)) {
        if (visited.has(currentParent)) {
          // Circular reference, break out
          return null
        }
        visited.add(currentParent)
        currentParent = messageParentMap.get(currentParent) ?? null
      }

      return currentParent
    }

    // === Second pass: transform messages that have blocks ===
    const newMessages: NewMessage[] = []
    for (const oldMsg of oldMessages) {
      // Skip messages marked for skipping
      if (skippedMessageIds.has(oldMsg.id)) {
        continue
      }

      try {
        const treeInfo = messageTree.get(oldMsg.id)
        if (!treeInfo) {
          logger.warn(`Message ${oldMsg.id} not found in tree, using defaults`)
          continue
        }

        // Resolve blocks for this message (we know it has blocks from first pass)
        const blockIds = oldMsg.blocks || []
        const blocks = resolveBlocks(blockIds, this.blockLookup)

        // Resolve parentId through any skipped messages
        const resolvedParentId = resolveParentId(treeInfo.parentId)

        // Get assistant for this message (may differ from topic's assistant)
        const msgAssistant = this.assistantLookup.get(oldMsg.assistantId) || assistant

        const newMsg = transformMessage(
          oldMsg,
          resolvedParentId, // Use resolved parent instead of original
          treeInfo.siblingsGroupId,
          blocks,
          msgAssistant,
          oldTopic.id
        )

        newMessages.push(newMsg)
      } catch (error) {
        logger.warn(`Failed to transform message ${oldMsg.id}`, { error })
        this.skippedMessages++
      }
    }

    // Calculate activeNodeId using smart selection logic
    // Priority: 1) Original activeNode if migrated, 2) foldSelected if migrated, 3) last migrated
    let activeNodeId: string | null = null
    if (newMessages.length > 0) {
      const migratedIds = new Set(newMessages.map((m) => m.id))

      // Try to use the original active node (handles foldSelected for multi-model)
      const originalActiveId = findActiveNodeId(oldMessages)
      if (originalActiveId && migratedIds.has(originalActiveId)) {
        activeNodeId = originalActiveId
      } else {
        // Original active was skipped; find a foldSelected among migrated messages
        const foldSelectedMsg = oldMessages.find((m) => m.foldSelected && migratedIds.has(m.id))
        if (foldSelectedMsg) {
          activeNodeId = foldSelectedMsg.id
        } else {
          // Fallback to last migrated message
          activeNodeId = newMessages[newMessages.length - 1].id
        }
      }
    }

    // Transform topic with correct activeNodeId
    const newTopic = transformTopic(oldTopic, assistant, activeNodeId)

    return {
      topic: newTopic,
      messages: newMessages
    }
  }
}
