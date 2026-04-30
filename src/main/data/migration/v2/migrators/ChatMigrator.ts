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
 * 5. **Mentions Dropped**
 *    - Old: `message.mentions: Model[]`
 *    - New: Not migrated — derivable from sibling responses' modelId + siblingsGroupId
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
import { pinTable } from '@data/db/schemas/pin'
import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysByScope, assignOrderKeysInSequence } from '../utils/orderKey'
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
import { resolveModelReference } from './transformers/ModelTransformers'

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
 * Assistant data from Redux for assistant lookup
 */
interface AssistantState {
  assistants: OldAssistant[]
}

/**
 * Prepared data for execution phase. `pinned` carries the legacy `pinned`
 * flag from the source so the migrator can emit a corresponding `pin` row
 * (the polymorphic pin table replaces the old per-topic isPinned column).
 */
interface PreparedTopicData {
  topic: NewTopic
  messages: NewMessage[]
  pinned: boolean
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
  private orphanedAssistantTopics = 0
  // Valid assistant IDs from AssistantMigrator (for FK validation)
  private validAssistantIds: Set<string> | null = null
  // Valid model IDs from ProviderModelMigrator/SQLite for FK validation
  private validModelIds: Set<string> | null = null
  // Block statistics for diagnostics
  private blockStats = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }
  // Count of messages promoted to root because no migrated ancestor was found
  private promotedToRootCount = 0
  // Buffered transformed topics across all streamed batches. Inserted in a
  // post-stream pass once orderKey can be assigned globally per groupId.
  private stagedTopics: PreparedTopicData[] = []

  override reset(): void {
    this.topicCount = 0
    this.messageCount = 0
    this.blockLookup = new Map()
    this.assistantLookup = new Map()
    this.topicMetaLookup = new Map()
    this.topicAssistantLookup = new Map()
    this.skippedTopics = 0
    this.skippedMessages = 0
    this.orphanedAssistantTopics = 0
    this.blockStats = { requested: 0, resolved: 0, messagesWithMissingBlocks: 0, messagesWithEmptyBlocks: 0 }
    this.promotedToRootCount = 0
    this.validAssistantIds = null
    this.validModelIds = null
    this.stagedTopics = []
  }

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

  private sanitizeMessageModelReferences(messages: NewMessage[]): number {
    let droppedModelRefs = 0

    for (const message of messages) {
      const resolution = resolveModelReference(message.modelId ?? null, this.validModelIds)
      if (resolution.kind === 'resolved') {
        message.modelId = resolution.modelId
        continue
      }

      if (resolution.kind === 'dangling') {
        droppedModelRefs += 1
        logger.warn(`Dropping dangling message model ref: message=${message.id}, model=${resolution.modelId}`)
      }

      message.modelId = null
    }

    return droppedModelRefs
  }

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

      // Step 3: Load assistant data for model lookup
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
        warnings.push('No assistant data found - topics will have null assistantId and missing names')
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
      const topicReader = ctx.sources.dexieExport.createStreamReader('topics')

      // Load valid assistant IDs for FK validation (set by AssistantMigrator)
      this.validAssistantIds = (ctx.sharedData.get('assistantIds') as Set<string>) ?? null
      if (!this.validAssistantIds) {
        throw new Error('validAssistantIds not set in sharedData. AssistantMigrator must run before ChatMigrator.')
      }
      this.validModelIds = ctx.db?.select
        ? new Set((await ctx.db.select({ id: userModelTable.id }).from(userModelTable)).map((row) => row.id))
        : null

      // Buffer all topics first; orderKey is stamped post-stream because per-batch
      // keys would collide across batches sharing a `groupId` partition.
      await topicReader.readInBatches<OldTopic>(TOPIC_BATCH_SIZE, async (topics, batchIndex) => {
        logger.debug(`Processing topic batch ${batchIndex + 1}`, { count: topics.length })

        for (const oldTopic of topics) {
          try {
            const prepared = this.prepareTopicData(oldTopic)
            if (prepared) {
              this.stagedTopics.push(prepared)
            } else {
              this.skippedTopics++
            }
          } catch (error) {
            logger.error('Failed to transform topic', error as Error, {
              topicId: oldTopic.id,
              batchIndex,
              messageCount: oldTopic.messages?.length ?? 0,
              assistantId: oldTopic.assistantId
            })
            this.skippedTopics++
          }
        }

        // 0..50% during stream; insertStagedTopics covers 50..100%.
        const progress = Math.round((this.stagedTopics.length / this.topicCount) * 50)
        this.reportProgress(progress, `Prepared ${this.stagedTopics.length}/${this.topicCount} conversations`, {
          key: 'migration.progress.prepared_chats',
          params: { processed: this.stagedTopics.length, total: this.topicCount }
        })
      })

      const insertResult = await this.insertStagedTopics(ctx)
      processedTopics = insertResult.topicsInserted
      processedMessages = insertResult.messagesInserted
      const pinsInserted = insertResult.pinsInserted

      logger.info('Execute completed', {
        processedTopics,
        processedMessages,
        pinsInserted,
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

      const expectedPins = this.stagedTopics.filter((d) => d.pinned).length
      if (expectedPins > 0) {
        const pinResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(pinTable)
          .where(eq(pinTable.entityType, 'topic'))
          .get()
        const targetPinCount = pinResult?.count ?? 0
        if (targetPinCount < expectedPins) {
          errors.push({
            key: 'pin_count_low',
            message: `Pin row count too low: expected ${expectedPins}, got ${targetPinCount}`
          })
        }
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

      // Check for dangling parentId references (parentId points to non-existent message)
      const danglingParentCheck = await db
        .select({ count: sql<number>`count(*)` })
        .from(messageTable)
        .where(
          sql`${messageTable.parentId} IS NOT NULL AND ${messageTable.parentId} NOT IN (SELECT id FROM ${messageTable})`
        )
        .get()

      if (danglingParentCheck && danglingParentCheck.count > 0) {
        errors.push({
          key: 'dangling_parent_ids',
          message: `Found ${danglingParentCheck.count} messages with dangling parentId`
        })
      }

      // Check for multi-root topics (topics with more than one root message)
      const multiRootCheck = await db
        .select({ count: sql<number>`count(*)` })
        .from(sql`(SELECT topic_id FROM ${messageTable} WHERE parent_id IS NULL GROUP BY topic_id HAVING count(*) > 1)`)
        .get()

      if (multiRootCheck && multiRootCheck.count > 0) {
        logger.warn(`Found ${multiRootCheck.count} topics with multiple root messages (multi-root forest)`)
        errors.push({
          key: 'multi_root_topics',
          message: `Found ${multiRootCheck.count} topics with multiple root messages`
        })
      }

      const diagnostics = {
        skippedMessages: this.skippedMessages,
        orphanedAssistantTopics: this.orphanedAssistantTopics,
        messagesWithMissingBlocks: this.blockStats.messagesWithMissingBlocks,
        messagesWithEmptyBlocks: this.blockStats.messagesWithEmptyBlocks,
        promotedToRootCount: this.promotedToRootCount
      }
      logger.info('Validation diagnostics', diagnostics)

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.topicCount,
          targetCount: targetTopicCount,
          skippedCount: this.skippedTopics
        },
        diagnostics
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
      logger.error('Topic missing id, skipping', new Error('missing topic id'), {
        messageCount: oldTopic.messages?.length ?? 0,
        assistantId: oldTopic.assistantId
      })
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
    let resolvedAssistantId = this.topicAssistantLookup.get(oldTopic.id) || oldTopic.assistantId || ''

    // Validate assistantId FK — clear if orphaned (transformTopic coerces '' to null via || null)
    if (resolvedAssistantId && this.validAssistantIds && !this.validAssistantIds.has(resolvedAssistantId)) {
      logger.warn(`Topic ${oldTopic.id}: assistant ${resolvedAssistantId} not found in assistant table, clearing`)
      resolvedAssistantId = ''
      this.orphanedAssistantTopics++
    }

    // Write resolved value back for transformTopic consumption (avoids mutating original beyond this point)
    oldTopic.assistantId = resolvedAssistantId

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

        const newMsg = transformMessage(
          oldMsg,
          resolvedParentId, // Use resolved parent instead of original
          treeInfo.siblingsGroupId,
          blocks,
          oldTopic.id
        )

        newMessages.push(newMsg)
      } catch (error) {
        logger.warn(`Failed to transform message ${oldMsg.id}`, { error })
        this.skippedMessages++
      }
    }

    // Fix dangling parentIds from second-pass skips (transform failure).
    // resolveParentId only handles first-pass skips; if a message passed the first
    // pass (had blocks) but failed transform, its children still reference it.
    // Walk the ancestor chain to find the nearest migrated parent.
    const migratedMessageIds = new Set(newMessages.map((m) => m.id))
    for (const msg of newMessages) {
      if (msg.parentId && !migratedMessageIds.has(msg.parentId)) {
        let ancestor = messageParentMap.get(msg.parentId) ?? null
        const visited = new Set<string>([msg.parentId])
        while (ancestor && !migratedMessageIds.has(ancestor)) {
          if (visited.has(ancestor)) break
          visited.add(ancestor)
          ancestor = messageParentMap.get(ancestor) ?? null
        }
        if (ancestor) {
          logger.warn(`Resolved dangling parentId for message ${msg.id}: ${msg.parentId} → ${ancestor}`)
        } else {
          logger.warn(
            `No migrated ancestor found for message ${msg.id} (original parentId: ${msg.parentId}), setting as root`
          )
          this.promotedToRootCount++
        }
        msg.parentId = ancestor
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
    const newTopic = transformTopic(oldTopic, activeNodeId)

    return {
      topic: newTopic,
      messages: newMessages,
      pinned: oldTopic.pinned ?? false
    }
  }

  /**
   * Post-stream insert pass: stamp orderKey, insert topics+messages with
   * FK toggling, emit pin rows for legacy `pinned: true` topics.
   */
  private async insertStagedTopics(
    ctx: MigrationContext
  ): Promise<{ topicsInserted: number; messagesInserted: number; pinsInserted: number }> {
    const db = ctx.db

    // Sort by updatedAt DESC so the stamped orderKey matches the default
    // unpinned list sort — otherwise drag-mode would see arbitrary order.
    const sortedTopics = [...this.stagedTopics]
      .sort((a, b) => b.topic.updatedAt - a.topic.updatedAt)
      .map((d) => d.topic)
    const stampedTopics = assignOrderKeysByScope(sortedTopics, (t) => t.groupId)
    const orderKeyById = new Map(stampedTopics.map((t) => [t.id, t.orderKey]))
    for (const data of this.stagedTopics) {
      const orderKey = orderKeyById.get(data.topic.id)
      if (!orderKey) {
        throw new Error(`orderKey lookup miss for topic id=${data.topic.id}`)
      }
      data.topic.orderKey = orderKey
    }

    let topicsInserted = 0
    let messagesInserted = 0
    const seenMessageIds = new Set<string>()
    const total = this.stagedTopics.length || 1

    for (let start = 0; start < this.stagedTopics.length; start += TOPIC_BATCH_SIZE) {
      const batch = this.stagedTopics.slice(start, start + TOPIC_BATCH_SIZE)

      // Dedupe message ids within the batch and against prior batches; remap
      // children's parentIds to keep the tree intact after the rename.
      const batchMessages: NewMessage[] = []
      const idRemap = new Map<string, string>()
      const batchIds = new Set<string>()
      for (const data of batch) {
        for (const msg of data.messages) {
          if (seenMessageIds.has(msg.id) || batchIds.has(msg.id)) {
            const newId = uuidv4()
            logger.warn(`Duplicate message ID found: ${msg.id}, assigning new ID: ${newId}`)
            idRemap.set(msg.id, newId)
            msg.id = newId
          }
          batchIds.add(msg.id)
          batchMessages.push(msg)
        }
      }
      if (idRemap.size > 0) {
        for (const msg of batchMessages) {
          if (msg.parentId && idRemap.has(msg.parentId)) {
            msg.parentId = idRemap.get(msg.parentId)!
          }
        }
      }
      const droppedRefs = this.sanitizeMessageModelReferences(batchMessages)
      if (droppedRefs > 0) logger.info(`Filtered ${droppedRefs} dangling message model references`)

      await db.run(sql`PRAGMA foreign_keys = OFF`)
      // Bare finally would let a PRAGMA-reset failure (closed conn, writer-lock)
      // overwrite the original tx error. Capture, reset, then rethrow the tx one.
      let txErr: unknown
      try {
        await db.transaction(async (tx) => {
          await tx.insert(topicTable).values(batch.map((d) => d.topic))
          for (let i = 0; i < batchMessages.length; i += MESSAGE_INSERT_BATCH_SIZE) {
            await tx.insert(messageTable).values(batchMessages.slice(i, i + MESSAGE_INSERT_BATCH_SIZE))
          }
        })
      } catch (e) {
        txErr = e
      }
      try {
        await db.run(sql`PRAGMA foreign_keys = ON`)
      } catch (resetErr) {
        logger.error('FK pragma reset failed', resetErr as Error, { hadTxError: txErr !== undefined })
      }
      if (txErr) throw txErr

      for (const id of batchIds) seenMessageIds.add(id)
      topicsInserted += batch.length
      messagesInserted += batchMessages.length

      const progress = 50 + Math.round((topicsInserted / total) * 50)
      this.reportProgress(
        progress,
        `Migrated ${topicsInserted}/${this.stagedTopics.length} conversations, ${messagesInserted} messages`,
        {
          key: 'migration.progress.migrated_chats',
          params: { processed: topicsInserted, total: this.stagedTopics.length, messages: messagesInserted }
        }
      )
    }

    // ON CONFLICT DO NOTHING so a retry doesn't trip the (entity_type, entity_id) UNIQUE.
    const pinned = this.stagedTopics.filter((d) => d.pinned)
    let pinsInserted = 0
    if (pinned.length > 0) {
      const sorted = [...pinned].sort((a, b) => b.topic.updatedAt - a.topic.updatedAt)
      const now = Date.now()
      const pinRows = assignOrderKeysInSequence(
        sorted.map((d) => ({
          id: uuidv4(),
          entityType: 'topic',
          entityId: d.topic.id,
          createdAt: now,
          updatedAt: now
        }))
      )
      try {
        // Counter assigned only on commit so the catch reports 0 on rollback.
        const inserted = await db.transaction(async (tx) => {
          let count = 0
          for (let i = 0; i < pinRows.length; i += MESSAGE_INSERT_BATCH_SIZE) {
            const batch = pinRows.slice(i, i + MESSAGE_INSERT_BATCH_SIZE)
            const result = await tx.insert(pinTable).values(batch).onConflictDoNothing().returning({ id: pinTable.id })
            count += result.length
          }
          return count
        })
        pinsInserted = inserted
      } catch (error) {
        logger.error('Pin row emission failed (transaction rolled back)', error as Error, {
          pinsExpected: pinRows.length
        })
        throw error
      }
    }

    return { topicsInserted, messagesInserted, pinsInserted }
  }
}
