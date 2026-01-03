/**
 * @fileoverview BlockManager - Manages block operations during message streaming
 *
 * This module handles the lifecycle and state management of message blocks
 * during the streaming process. It provides methods for:
 * - Smart block updates with throttling support
 * - Block type transitions
 * - Active block tracking
 *
 * ARCHITECTURE NOTE:
 * BlockManager now uses StreamingService for state management instead of Redux dispatch.
 * This is part of the v2 data refactoring to use CacheService + Data API.
 *
 * Key changes from original design:
 * - dispatch/getState replaced with streamingService methods
 * - DB saves removed during streaming (handled by finalize)
 * - Throttling logic preserved, but internal calls changed
 */

import { loggerService } from '@logger'
import type { MessageBlock } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'

import { streamingService } from './StreamingService'

const logger = loggerService.withContext('BlockManager')

/**
 * Information about the currently active block during streaming
 */
interface ActiveBlockInfo {
  id: string
  type: MessageBlockType
}

/**
 * Dependencies required by BlockManager
 *
 * NOTE: Simplified from original design - removed dispatch, getState, and DB save functions
 * since StreamingService now handles state management and persistence.
 */
interface BlockManagerDependencies {
  topicId: string
  assistantMsgId: string
  // Throttling is still controlled externally by messageThunk.ts
  throttledBlockUpdate: (id: string, blockUpdate: any) => void
  cancelThrottledBlockUpdate: (id: string) => void
}

export class BlockManager {
  private deps: BlockManagerDependencies

  // Simplified state management
  private _activeBlockInfo: ActiveBlockInfo | null = null
  private _lastBlockType: MessageBlockType | null = null // Preserved for error handling

  constructor(dependencies: BlockManagerDependencies) {
    this.deps = dependencies
  }

  // Getters
  get activeBlockInfo() {
    return this._activeBlockInfo
  }

  get lastBlockType() {
    return this._lastBlockType
  }

  get hasInitialPlaceholder() {
    return this._activeBlockInfo?.type === MessageBlockType.UNKNOWN
  }

  get initialPlaceholderBlockId() {
    return this.hasInitialPlaceholder ? this._activeBlockInfo?.id || null : null
  }

  // Setters
  set lastBlockType(value: MessageBlockType | null) {
    this._lastBlockType = value
  }

  set activeBlockInfo(value: ActiveBlockInfo | null) {
    this._activeBlockInfo = value
  }

  /**
   * Smart update strategy: automatically decides between throttled and immediate updates
   * based on block type continuity.
   *
   * Behavior:
   * - If block type changes: cancel previous throttle, immediately update via streamingService
   * - If block completes: cancel throttle, immediately update via streamingService
   * - Otherwise: use throttled update (throttler calls streamingService internally)
   *
   * NOTE: DB saves are removed - persistence happens during finalize()
   */
  smartBlockUpdate(
    blockId: string,
    changes: Partial<MessageBlock>,
    blockType: MessageBlockType,
    isComplete: boolean = false
  ) {
    const isBlockTypeChanged = this._lastBlockType !== null && this._lastBlockType !== blockType
    if (isBlockTypeChanged || isComplete) {
      // Cancel throttled update for previous block if type changed
      if (isBlockTypeChanged && this._activeBlockInfo) {
        this.deps.cancelThrottledBlockUpdate(this._activeBlockInfo.id)
      }
      // Cancel throttled update for current block if complete
      if (isComplete) {
        this.deps.cancelThrottledBlockUpdate(blockId)
        this._activeBlockInfo = null // Clear activeBlockInfo when block completes
      } else {
        this._activeBlockInfo = { id: blockId, type: blockType } // Update active block info
      }

      // Immediate update via StreamingService (replaces dispatch + DB save)
      streamingService.updateBlock(blockId, changes)
      this._lastBlockType = blockType
    } else {
      this._activeBlockInfo = { id: blockId, type: blockType } // Update active block info
      // Throttled update (throttler internally calls streamingService.updateBlock)
      this.deps.throttledBlockUpdate(blockId, changes)
    }
  }

  /**
   * Handle block transitions (new block creation during streaming)
   *
   * This method:
   * 1. Updates active block tracking state
   * 2. Adds new block to StreamingService
   * 3. Updates message block references
   *
   * NOTE: DB saves are removed - persistence happens during finalize()
   */
  async handleBlockTransition(newBlock: MessageBlock, newBlockType: MessageBlockType) {
    logger.debug('handleBlockTransition', { newBlock, newBlockType })
    this._lastBlockType = newBlockType
    this._activeBlockInfo = { id: newBlock.id, type: newBlockType } // Set new active block info

    // Add new block to StreamingService (replaces dispatch(upsertOneBlock))
    streamingService.addBlock(this.deps.assistantMsgId, newBlock)

    // Update block reference in message (replaces dispatch(upsertBlockReference))
    streamingService.addBlockReference(this.deps.assistantMsgId, newBlock.id)

    // TEMPORARY: The blockInstruction field was used for UI coordination.
    // TODO: Evaluate if this is still needed with StreamingService approach
    // For now, we update it in the message
    streamingService.updateMessage(this.deps.assistantMsgId, {
      blockInstruction: { id: newBlock.id }
    } as any) // Using 'as any' since blockInstruction may not be in Message type

    logger.debug('Block transition completed', {
      messageId: this.deps.assistantMsgId,
      blockId: newBlock.id,
      blockType: newBlockType
    })
  }
}
