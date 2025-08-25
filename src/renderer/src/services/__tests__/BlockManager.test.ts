import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('BlockManager', () => {
  const mockDependencies = {
    dispatch: vi.fn(),
    getState: vi.fn(),
    saveUpdatedBlockToDB: vi.fn(),
    saveUpdatesToDB: vi.fn(),
    assistantMsgId: 'test-assistant-msg-id',
    topicId: 'test-topic-id',
    throttledBlockUpdate: vi.fn(),
    cancelThrottledBlockUpdate: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with provided dependencies', () => {
      const blockManager = new BlockManager(mockDependencies)

      expect(blockManager.activeBlockInfo).toBeNull()
      expect(blockManager.lastBlockType).toBeNull()
    })
  })

  describe('getters', () => {
    it('should return correct initial values', () => {
      const blockManager = new BlockManager(mockDependencies)

      expect(blockManager.activeBlockInfo).toBeNull()
      expect(blockManager.lastBlockType).toBeNull()
      expect(blockManager.hasInitialPlaceholder).toBeFalsy()
      expect(blockManager.initialPlaceholderBlockId).toBeNull()
    })

    it('should return correct values when active block info is set', () => {
      const blockManager = new BlockManager(mockDependencies)
      blockManager.activeBlockInfo = { id: 'test-block-id', type: MessageBlockType.UNKNOWN }

      expect(blockManager.activeBlockInfo).toEqual({ id: 'test-block-id', type: MessageBlockType.UNKNOWN })
      expect(blockManager.hasInitialPlaceholder).toBeTruthy()
      expect(blockManager.initialPlaceholderBlockId).toBe('test-block-id')
    })
  })

  describe('setters', () => {
    it('should correctly set activeBlockInfo', () => {
      const blockManager = new BlockManager(mockDependencies)
      const activeBlockInfo = { id: 'test-block-id', type: MessageBlockType.MAIN_TEXT }

      blockManager.activeBlockInfo = activeBlockInfo

      expect(blockManager.activeBlockInfo).toEqual(activeBlockInfo)
    })

    it('should correctly set lastBlockType', () => {
      const blockManager = new BlockManager(mockDependencies)

      blockManager.lastBlockType = MessageBlockType.MAIN_TEXT

      expect(blockManager.lastBlockType).toBe(MessageBlockType.MAIN_TEXT)
    })
  })

  describe('cleanup', () => {
    it('should cancel throttled update and clear active block info when active block exists', () => {
      const blockManager = new BlockManager(mockDependencies)
      const activeBlockInfo = { id: 'test-block-id', type: MessageBlockType.MAIN_TEXT }

      blockManager.activeBlockInfo = activeBlockInfo

      blockManager.cleanup()

      expect(mockDependencies.cancelThrottledBlockUpdate).toHaveBeenCalledWith('test-block-id')
      expect(blockManager.activeBlockInfo).toBeNull()
      expect(blockManager.lastBlockType).toBeNull()
    })

    it('should not call cancelThrottledBlockUpdate when no active block exists', () => {
      const blockManager = new BlockManager(mockDependencies)

      blockManager.cleanup()

      expect(mockDependencies.cancelThrottledBlockUpdate).not.toHaveBeenCalled()
      expect(blockManager.activeBlockInfo).toBeNull()
      expect(blockManager.lastBlockType).toBeNull()
    })
  })

  describe('reset', () => {
    it('should call cleanup method', () => {
      const blockManager = new BlockManager(mockDependencies)
      const cleanupSpy = vi.spyOn(blockManager, 'cleanup')

      blockManager.reset()

      expect(cleanupSpy).toHaveBeenCalled()
    })
  })

  describe('smartBlockUpdate', () => {
    it('should immediately update block when block type changes', () => {
      const blockManager = new BlockManager(mockDependencies)
      blockManager.lastBlockType = MessageBlockType.MAIN_TEXT
      const blockId = 'test-block-id'
      const changes = { content: 'updated content' }
      const blockType = MessageBlockType.IMAGE

      blockManager.smartBlockUpdate(blockId, changes, blockType)

      expect(mockDependencies.dispatch).toHaveBeenCalled()
      expect(mockDependencies.saveUpdatedBlockToDB).toHaveBeenCalled()
      expect(mockDependencies.throttledBlockUpdate).not.toHaveBeenCalled()
      expect(blockManager.lastBlockType).toBe(blockType)
    })

    it('should immediately update block when isComplete is true', () => {
      const blockManager = new BlockManager(mockDependencies)
      const blockId = 'test-block-id'
      const changes = { content: 'completed content' }
      const blockType = MessageBlockType.MAIN_TEXT

      blockManager.smartBlockUpdate(blockId, changes, blockType, true)

      expect(mockDependencies.dispatch).toHaveBeenCalled()
      expect(mockDependencies.saveUpdatedBlockToDB).toHaveBeenCalled()
      expect(mockDependencies.throttledBlockUpdate).not.toHaveBeenCalled()
      expect(blockManager.lastBlockType).toBe(blockType)
      expect(blockManager.activeBlockInfo).toBeNull()
    })

    it('should throttle update when block type is same and not complete', () => {
      const blockManager = new BlockManager(mockDependencies)
      blockManager.lastBlockType = MessageBlockType.MAIN_TEXT
      const blockId = 'test-block-id'
      const changes = { content: 'throttled content' }
      const blockType = MessageBlockType.MAIN_TEXT

      blockManager.smartBlockUpdate(blockId, changes, blockType)

      expect(mockDependencies.throttledBlockUpdate).toHaveBeenCalledWith(blockId, changes)
      expect(mockDependencies.dispatch).not.toHaveBeenCalled()
      expect(mockDependencies.saveUpdatedBlockToDB).not.toHaveBeenCalled()
    })
  })

  describe('handleBlockTransition', () => {
    it('should dispatch appropriate actions and save updates', async () => {
      const blockManager = new BlockManager(mockDependencies)
      const newBlock: any = {
        id: 'new-block-id',
        messageId: 'test-message-id',
        type: MessageBlockType.MAIN_TEXT,
        content: 'test content',
        status: MessageBlockStatus.STREAMING,
        createdAt: new Date().toISOString()
      }
      const newBlockType = MessageBlockType.MAIN_TEXT

      // Mock getState to return a message
      mockDependencies.getState.mockReturnValue({
        messages: {
          entities: {
            'test-assistant-msg-id': {
              blocks: ['new-block-id']
            }
          }
        }
      })

      await blockManager.handleBlockTransition(newBlock, newBlockType)

      expect(mockDependencies.dispatch).toHaveBeenCalledTimes(3)
      expect(mockDependencies.saveUpdatesToDB).toHaveBeenCalled()
      expect(blockManager.lastBlockType).toBe(newBlockType)
    })
  })
})
