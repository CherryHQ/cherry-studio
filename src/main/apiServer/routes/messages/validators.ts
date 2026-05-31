import { z } from 'zod'

// Schema for message content blocks
const ContentBlockSchema = z.object({
  type: z.enum(['text', 'image', 'image_url']),
  text: z.string().optional(),
  image_url: z
    .object({
      url: z.string()
    })
    .optional()
})

// Schema for creating a message
export const CreateMessageSchema = z.object({
  model: z.string().min(1, 'Model is required'),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.union([z.string(), z.array(ContentBlockSchema)])
      })
    )
    .min(1, 'At least one message is required'),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().positive().optional(),
  stream: z.boolean().optional(),
  tools: z
    .array(
      z.object({
        type: z.literal('function'),
        function: z.object({
          name: z.string(),
          description: z.string().optional(),
          parameters: z.record(z.unknown()).optional()
        })
      })
    )
    .optional()
})

// Schema for listing messages
export const ListMessagesSchema = z.object({
  topicId: z.string().min(1, 'Topic ID is required'),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional()
})

// Schema for getting a single message
export const GetMessageSchema = z.object({
  messageId: z.string().min(1, 'Message ID is required')
})

// Schema for updating a message
export const UpdateMessageSchema = z.object({
  messageId: z.string().min(1, 'Message ID is required'),
  content: z.string().optional(),
  model: z.string().optional()
})

// Schema for deleting a message
export const DeleteMessageSchema = z.object({
  messageId: z.string().min(1, 'Message ID is required')
})

// Schema for searching messages
export const SearchMessagesSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  topicId: z.string().optional(),
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional()
})
