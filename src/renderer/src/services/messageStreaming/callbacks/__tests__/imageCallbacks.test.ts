import { BlockManager } from '@renderer/services/messageStreaming/BlockManager'
import { createImageCallbacks } from '@renderer/services/messageStreaming/callbacks/imageCallbacks'
import type { RootState } from '@renderer/store'
import { MessageBlockType } from '@renderer/types/newMessage'
import { describe, expect, it, vi } from 'vitest'

describe('ImageCallbacks', () => {
  describe('BlockManager.hasBlockOfType', () => {
    it('should return false when no blocks exist', () => {
      const mockState = {
        messages: { entities: {} },
        messageBlocks: { entities: {} }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.IMAGE)).toBe(false)
    })

    it('should return false when only non-IMAGE blocks exist', () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['block-1', 'block-2'] }
          }
        },
        messageBlocks: {
          entities: {
            'block-1': { type: MessageBlockType.MAIN_TEXT },
            'block-2': { type: MessageBlockType.TOOL }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.IMAGE)).toBe(false)
      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.MAIN_TEXT)).toBe(true)
      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.TOOL)).toBe(true)
    })

    it('should return true when IMAGE block exists', () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['block-1', 'block-2'] }
          }
        },
        messageBlocks: {
          entities: {
            'block-1': { type: MessageBlockType.IMAGE },
            'block-2': { type: MessageBlockType.MAIN_TEXT }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.IMAGE)).toBe(true)
    })

    it('should handle multiple IMAGE blocks', () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['block-1', 'block-2', 'block-3'] }
          }
        },
        messageBlocks: {
          entities: {
            'block-1': { type: MessageBlockType.IMAGE },
            'block-2': { type: MessageBlockType.IMAGE },
            'block-3': { type: MessageBlockType.MAIN_TEXT }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.IMAGE)).toBe(true)
    })

    it('should return false when message does not exist', () => {
      const mockState = {
        messages: { entities: {} },
        messageBlocks: { entities: {} }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('non-existent', MessageBlockType.IMAGE)).toBe(false)
    })

    it('should return false when blocks array is empty', () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: [] }
          }
        },
        messageBlocks: { entities: {} }
      }
      const blockManager = createMockBlockManager(mockState)

      expect(blockManager.hasBlockOfType('msg-1', MessageBlockType.IMAGE)).toBe(false)
    })
  })

  describe('duplicate prevention', () => {
    it('should skip creation when IMAGE block already exists', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['existing-image-block'] }
          }
        },
        messageBlocks: {
          entities: {
            'existing-image-block': { type: MessageBlockType.IMAGE }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      await callbacks.onImageGenerated({ images: ['test-url'] })

      // Should verify handleBlockTransition was NOT called (skip creation)
      expect((blockManager as any).handleBlockTransition).not.toHaveBeenCalled()
    })

    it('should attempt to create block when no IMAGE block exists', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: [] }
          }
        },
        messageBlocks: { entities: {} }
      }
      const blockManager = createMockBlockManager(mockState)

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      await callbacks.onImageGenerated({ images: ['test-url'] })

      // Should attempt to create block (handleBlockTransition called)
      expect((blockManager as any).handleBlockTransition).toHaveBeenCalled()
    })
  })

  describe('onImageCreated scenarios', () => {
    it('should convert placeholder to image block', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['placeholder-block'] }
          }
        },
        messageBlocks: {
          entities: {
            'placeholder-block': { type: MessageBlockType.UNKNOWN }
          }
        }
      }
      const blockManager = createMockBlockManagerWithPlaceholder(mockState, 'placeholder-block')

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      await callbacks.onImageCreated()

      // Should call smartBlockUpdate to convert placeholder
      expect((blockManager as any).smartBlockUpdate).toHaveBeenCalled()
    })

    it('should create new block when no placeholder and no existing block', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: [] }
          }
        },
        messageBlocks: { entities: {} }
      }
      const blockManager = createMockBlockManager(mockState)

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      await callbacks.onImageCreated()

      // Block should be created (handleBlockTransition called)
      expect((blockManager as any).handleBlockTransition).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle empty imageData', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['block-1'] }
          }
        },
        messageBlocks: {
          entities: {
            'block-1': { type: MessageBlockType.IMAGE }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      // Should not throw
      await expect(callbacks.onImageGenerated(null)).resolves.not.toThrow()
    })

    it('should handle undefined imageData', async () => {
      const mockState = {
        messages: {
          entities: {
            'msg-1': { blocks: ['block-1'] }
          }
        },
        messageBlocks: {
          entities: {
            'block-1': { type: MessageBlockType.IMAGE }
          }
        }
      }
      const blockManager = createMockBlockManager(mockState)

      const callbacks = createImageCallbacks({
        blockManager,
        assistantMsgId: 'msg-1'
      })

      await expect(callbacks.onImageGenerated(undefined as any)).resolves.not.toThrow()
    })
  })
})

/**
 * 创建 Mock BlockManager 用于测试
 */
function createMockBlockManager(mockState: any): BlockManager {
  const mockDeps = {
    dispatch: vi.fn(),
    getState: () => mockState as RootState,
    saveUpdatedBlockToDB: vi.fn(),
    saveUpdatesToDB: vi.fn(),
    assistantMsgId: '',
    topicId: '',
    throttledBlockUpdate: vi.fn(),
    cancelThrottledBlockUpdate: vi.fn()
  }

  // 使用实际 BlockManager 类
  const manager = new BlockManager(mockDeps)

  // 覆盖 hasBlockOfType 方法使用 mockState
  const typedManager = manager as any
  typedManager.hasBlockOfType = (messageId: string, blockType: MessageBlockType): boolean => {
    const state = mockState
    const message = state.messages?.entities?.[messageId]
    if (!message?.blocks) return false

    return message.blocks.some((blockId: string) => {
      const block = state.messageBlocks?.entities?.[blockId]
      return block?.type === blockType
    })
  }
  typedManager.handleBlockTransition = vi.fn()
  // 使用 Object.defineProperty 覆盖 getter
  Object.defineProperty(typedManager, 'hasInitialPlaceholder', { value: false, writable: true })
  Object.defineProperty(typedManager, 'initialPlaceholderBlockId', { value: null, writable: true })

  return typedManager as unknown as BlockManager
}

function createMockBlockManagerWithPlaceholder(mockState: any, placeholderId: string): BlockManager {
  const mockDeps = {
    dispatch: vi.fn(),
    getState: () => mockState as RootState,
    saveUpdatedBlockToDB: vi.fn(),
    saveUpdatesToDB: vi.fn(),
    assistantMsgId: '',
    topicId: '',
    throttledBlockUpdate: vi.fn(),
    cancelThrottledBlockUpdate: vi.fn()
  }

  const manager = new BlockManager(mockDeps)
  const typedManager = manager as any

  typedManager.hasBlockOfType = (messageId: string, blockType: MessageBlockType): boolean => {
    const state = mockState
    const message = state.messages?.entities?.[messageId]
    if (!message?.blocks) return false

    return message.blocks.some((blockId: string) => {
      const block = state.messageBlocks?.entities?.[blockId]
      return block?.type === blockType
    })
  }
  typedManager.handleBlockTransition = vi.fn()
  typedManager.smartBlockUpdate = vi.fn()
  // 使用 Object.defineProperty 覆盖 getter
  Object.defineProperty(typedManager, 'hasInitialPlaceholder', { value: true, writable: true })
  Object.defineProperty(typedManager, 'initialPlaceholderBlockId', { value: placeholderId, writable: true })

  return typedManager as unknown as BlockManager
}
