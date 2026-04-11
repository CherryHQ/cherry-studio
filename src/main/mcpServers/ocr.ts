import { stat } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { ocrService } from '@main/services/ocr/OcrService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ImageFileMetadata } from '@types'
import { BuiltinOcrProviderIds } from '@types'

const logger = loggerService.withContext('MCPServer:OCR')

const OCR_TOOL: Tool = {
  name: 'ocr',
  description:
    'Extract text from an image file using OCR. Use this when you need to read text content from images (screenshots, photos of documents, diagrams with text, etc.). Accepts a file path to an image and returns the extracted text.',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Absolute path to the image file to extract text from (supports JPEG, PNG, WebP, TIFF, BMP, GIF)'
      }
    },
    required: ['file_path']
  }
}

/**
 * Resolve the OCR provider to use: prefer 'system' (native macOS Vision /
 * Windows OCR), fall back to 'tesseract' on Linux where 'system' is not
 * registered.
 */
function resolveProviderId(): string {
  const providers = ocrService.listProviderIds()
  if (providers.includes(BuiltinOcrProviderIds.system)) {
    return BuiltinOcrProviderIds.system
  }
  if (providers.includes(BuiltinOcrProviderIds.tesseract)) {
    return BuiltinOcrProviderIds.tesseract
  }
  return providers[0] ?? ''
}

class OcrMcpServer {
  public mcpServer: McpServer

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'ocr',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [OCR_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        if (toolName !== 'ocr') {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
        return await this.extract(args)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async extract(args: Record<string, string | undefined>) {
    const filePath = args.file_path
    if (!filePath) {
      throw new McpError(ErrorCode.InvalidParams, "'file_path' is required")
    }

    const providerId = resolveProviderId()
    if (!providerId) {
      throw new McpError(ErrorCode.InternalError, 'No OCR providers are registered')
    }

    logger.info('Running OCR extraction', { filePath, providerId })

    const fileStat = await stat(filePath)
    const parsed = path.parse(filePath)
    const fileMetadata: ImageFileMetadata = {
      id: filePath,
      name: parsed.base,
      origin_name: parsed.base,
      path: filePath,
      size: fileStat.size,
      ext: parsed.ext,
      type: 'image',
      created_at: fileStat.birthtime.toISOString(),
      count: 1
    }

    const result = await ocrService.ocr(fileMetadata, { id: providerId, name: providerId, capabilities: {} })

    if (!result.text || result.text.trim().length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No text was detected in the image.' }]
      }
    }

    logger.info('OCR extraction complete', { filePath, providerId, textLength: result.text.length })
    return {
      content: [{ type: 'text' as const, text: result.text }]
    }
  }
}

export default OcrMcpServer
