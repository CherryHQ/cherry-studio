import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Provider } from '@renderer/types'
import { FileTypes } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { MessageBlockType } from '@renderer/types/newMessage'
import { AwsBedrockAPIClient } from '../AwsBedrockAPIClient'

// Mock modules
vi.mock('@renderer/utils/messageUtils/find', () => ({
  findImageBlocks: vi.fn(),
  findFileBlocks: vi.fn()
}))

vi.mock('@renderer/utils/aws-bedrock-utils', () => ({
  convertBase64ImageToAwsBedrockFormat: vi.fn()
}))

// Mock window.api
Object.defineProperty(window, 'api', {
  value: {
    file: {
      read: vi.fn(),
      base64Image: vi.fn()
    }
  },
  writable: true
})

import { findFileBlocks, findImageBlocks } from '@renderer/utils/messageUtils/find'
import { convertBase64ImageToAwsBedrockFormat } from '@renderer/utils/aws-bedrock-utils'

describe('AwsBedrockAPIClient', () => {
  let client: AwsBedrockAPIClient
  let mockProvider: Provider

  beforeEach(() => {
    mockProvider = {
      id: 'aws-bedrock',
      name: 'AWS Bedrock',
      apiHost: 'bedrock.amazonaws.com',
      isSystem: false
    }
    client = new AwsBedrockAPIClient(mockProvider)
    
    // Reset all mocks
    vi.clearAllMocks()
  })

  describe('convertMessageToSdkParam', () => {
    it('should process file content and include it in message parts', async () => {
      // Mock message with file blocks
      const mockMessage: Message = {
        id: 'test-message',
        role: 'user',
        topicId: 'test-topic',
        blocks: ['block1']
      }

      // Mock file blocks
      const mockFileBlocks = [
        {
          id: 'file-block-1',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-1',
            ext: '.txt',
            origin_name: 'test-document.txt',
            type: FileTypes.TEXT,
            size: 1024
          }
        }
      ]

      // Mock file content
      const mockFileContent = 'This is the content of the test document.\nIt has multiple lines.\nWith important information.'

      // Set up mocks
      vi.mocked(findFileBlocks).mockReturnValue(mockFileBlocks as any)
      vi.mocked(findImageBlocks).mockReturnValue([])
      vi.mocked(window.api.file.read).mockResolvedValue(mockFileContent)

      // Mock getMessageContent method
      vi.spyOn(client as any, 'getMessageContent').mockResolvedValue('Hello, please analyze this document.')

      // Call the method
      const result = await client.convertMessageToSdkParam(mockMessage)

      // Verify the result
      expect(result.role).toBe('user')
      expect(result.content).toHaveLength(2) // text content + file content
      
      // Check text content
      expect(result.content[0]).toEqual({
        text: 'Hello, please analyze this document.'
      })

      // Check file content
      expect(result.content[1]).toEqual({
        text: 'file: test-document.txt\n\nThis is the content of the test document.\nIt has multiple lines.\nWith important information.'
      })

      // Verify file was read correctly
      expect(window.api.file.read).toHaveBeenCalledWith('test-file-1.txt', true)
    })

    it('should handle multiple files with different types', async () => {
      const mockMessage: Message = {
        id: 'test-message',
        role: 'user',
        topicId: 'test-topic',
        blocks: ['block1', 'block2']
      }

      const mockFileBlocks = [
        {
          id: 'file-block-1',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-1',
            ext: '.txt',
            origin_name: 'notes.txt',
            type: FileTypes.TEXT,
            size: 512
          }
        },
        {
          id: 'file-block-2',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-2',
            ext: '.md',
            origin_name: 'readme.md',
            type: FileTypes.DOCUMENT,
            size: 1024
          }
        },
        {
          id: 'file-block-3',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-3',
            ext: '.jpg',
            origin_name: 'image.jpg',
            type: FileTypes.IMAGE,
            size: 2048
          }
        }
      ]

      vi.mocked(findFileBlocks).mockReturnValue(mockFileBlocks as any)
      vi.mocked(findImageBlocks).mockReturnValue([])
      
      // Mock file reading for text files only
      vi.mocked(window.api.file.read)
        .mockResolvedValueOnce('Content of notes.txt')
        .mockResolvedValueOnce('# README\nThis is markdown content')

      vi.spyOn(client as any, 'getMessageContent').mockResolvedValue('Process these files.')

      const result = await client.convertMessageToSdkParam(mockMessage)

      expect(result.content).toHaveLength(3) // text + 2 text files (image file ignored)
      
      expect(result.content[1]).toEqual({
        text: 'file: notes.txt\n\nContent of notes.txt'
      })
      
      expect(result.content[2]).toEqual({
        text: 'file: readme.md\n\n# README\nThis is markdown content'
      })

      // Should only read TEXT and DOCUMENT files
      expect(window.api.file.read).toHaveBeenCalledTimes(2)
      expect(window.api.file.read).toHaveBeenCalledWith('test-file-1.txt', true)
      expect(window.api.file.read).toHaveBeenCalledWith('test-file-2.md', true)
    })

    it('should handle file reading errors gracefully', async () => {
      const mockMessage: Message = {
        id: 'test-message',
        role: 'user',
        topicId: 'test-topic',
        blocks: ['block1']
      }

      const mockFileBlocks = [
        {
          id: 'file-block-1',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-1',
            ext: '.txt',
            origin_name: 'broken-file.txt',
            type: FileTypes.TEXT,
            size: 1024
          }
        }
      ]

      vi.mocked(findFileBlocks).mockReturnValue(mockFileBlocks as any)
      vi.mocked(findImageBlocks).mockReturnValue([])
      vi.mocked(window.api.file.read).mockRejectedValue(new Error('File not found'))
      vi.spyOn(client as any, 'getMessageContent').mockResolvedValue('Test message')

      const result = await client.convertMessageToSdkParam(mockMessage)

      expect(result.content).toHaveLength(2)
      expect(result.content[1]).toEqual({
        text: '[File: broken-file.txt - Failed to read content]'
      })
    })

    it('should skip empty file content', async () => {
      const mockMessage: Message = {
        id: 'test-message',
        role: 'user',
        topicId: 'test-topic',
        blocks: ['block1']
      }

      const mockFileBlocks = [
        {
          id: 'file-block-1',
          type: MessageBlockType.FILE,
          file: {
            id: 'test-file-1',
            ext: '.txt',
            origin_name: 'empty-file.txt',
            type: FileTypes.TEXT,
            size: 0
          }
        }
      ]

      vi.mocked(findFileBlocks).mockReturnValue(mockFileBlocks as any)
      vi.mocked(findImageBlocks).mockReturnValue([])
      vi.mocked(window.api.file.read).mockResolvedValue('   \n  \t  ') // whitespace only
      vi.spyOn(client as any, 'getMessageContent').mockResolvedValue('Test message')

      const result = await client.convertMessageToSdkParam(mockMessage)

      // Should only have the main text content, empty file content is skipped
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        text: 'Test message'
      })
    })

    it('should work when no files are present', async () => {
      const mockMessage: Message = {
        id: 'test-message',
        role: 'user',
        topicId: 'test-topic',
        blocks: []
      }

      vi.mocked(findFileBlocks).mockReturnValue([])
      vi.mocked(findImageBlocks).mockReturnValue([])
      vi.spyOn(client as any, 'getMessageContent').mockResolvedValue('Simple text message')

      const result = await client.convertMessageToSdkParam(mockMessage)

      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        text: 'Simple text message'
      })
      expect(window.api.file.read).not.toHaveBeenCalled()
    })
  })
})