import { randomUUID } from 'node:crypto'
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc'
import { loggerService } from '@logger'
import { resolveWorkspaceFile } from '@main/ai/channels'
import { listAgentSessionAttachments } from '@main/ai/messages/agentSessionAttachments'
import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { isAbortError } from '@main/utils/error'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  TO_MARKDOWN_DESCRIPTION,
  TO_MARKDOWN_TOOL_NAME,
  toMarkdownInputSchema,
  toMarkdownOutputSchema
} from '@shared/ai/builtinTools'
import * as z from 'zod'

export interface CherryDocumentContext {
  agentDataPath: string
  sessionId: string
  workspacePath: string
}

const logger = loggerService.withContext('McpServer:CherryDocumentTools')
const OUTPUT_MAX_AGE_MS = 24 * 60 * 60 * 1000

type AnydocModule = {
  formatFromExtension: typeof formatFromExtension
  toMarkdownBytes: typeof toMarkdownBytes
}

let anydocModulePromise: Promise<AnydocModule> | undefined

function loadAnydocModule(): Promise<AnydocModule> {
  return (anydocModulePromise ??= import('@firecrawl/anydoc'))
}

function toMcpInputSchema(schema: z.ZodType): Tool['inputSchema'] {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  delete json.$schema
  return json as Tool['inputSchema']
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })
  }
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error)
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

async function resolveSessionAttachment(
  context: CherryDocumentContext,
  sourcePath: string
): Promise<FileAttachment | undefined> {
  let requestedPath: string
  try {
    requestedPath = await realpath(path.resolve(context.workspacePath, sourcePath))
  } catch {
    return undefined
  }

  const fileManager = application.get('FileManager')
  for (const attachment of listAgentSessionAttachments(context.sessionId)) {
    let physicalPath: string
    try {
      physicalPath = await realpath(fileManager.getPhysicalPath(attachment.fileEntryId))
    } catch {
      continue
    }
    if (physicalPath !== requestedPath) continue

    const metadata = await fileManager.getMetadata(attachment.fileEntryId)
    if (metadata.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${metadata.size} bytes): ${sourcePath}`)
    }

    const result = await fileManager.read(attachment.fileEntryId, { encoding: 'base64' })
    const size = Buffer.byteLength(result.content, 'base64')
    if (size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_SIZE_BYTES} byte limit (${size} bytes): ${sourcePath}`)
    }
    return {
      filename: attachment.displayName,
      data: result.content,
      media_type: result.mime,
      size
    }
  }

  return undefined
}

async function resolveDocumentSource(context: CherryDocumentContext, sourcePath: string): Promise<FileAttachment> {
  try {
    return await resolveWorkspaceFile(context.workspacePath, sourcePath)
  } catch (workspaceError) {
    const attachment = await resolveSessionAttachment(context, sourcePath)
    if (attachment) return attachment
    throw workspaceError
  }
}

async function cleanupStaleOutputs(directory: string): Promise<void> {
  const cutoff = Date.now() - OUTPUT_MAX_AGE_MS
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.md')) return
      const outputPath = path.join(directory, entry.name)
      if ((await stat(outputPath)).mtimeMs < cutoff) {
        await rm(outputPath, { force: true })
      }
    })
  )
}

export class CherryDocumentTools {
  constructor(private readonly context: CherryDocumentContext) {}

  tools(): Tool[] {
    return [
      {
        name: TO_MARKDOWN_TOOL_NAME,
        description: TO_MARKDOWN_DESCRIPTION,
        inputSchema: toMcpInputSchema(toMarkdownInputSchema)
      }
    ]
  }

  handles(toolName: string): boolean {
    return toolName === TO_MARKDOWN_TOOL_NAME
  }

  async call(args: unknown, signal: AbortSignal): Promise<CallToolResult> {
    try {
      const { path: sourcePath } = toMarkdownInputSchema.parse(args)
      const source = await resolveDocumentSource(this.context, sourcePath)
      throwIfAborted(signal)

      const anydoc = await loadAnydocModule()
      const format = anydoc.formatFromExtension(path.extname(source.filename)) ?? undefined
      const markdown = (await anydoc.toMarkdownBytes(Buffer.from(source.data, 'base64'), format)).trim()
      if (!markdown) throw new Error('Document conversion produced no text')
      throwIfAborted(signal)

      const outputDirectory = path.join(this.context.agentDataPath, 'tmp', 'to-markdown')
      await mkdir(outputDirectory, { recursive: true })
      await cleanupStaleOutputs(outputDirectory).catch((error) => {
        logger.warn('Failed to clean stale document conversion outputs', error as Error)
      })

      const outputPath = path.join(outputDirectory, `${randomUUID()}.md`)
      await writeFile(outputPath, markdown, { encoding: 'utf-8', flag: 'wx' })
      const output = toMarkdownOutputSchema.parse({ path: outputPath, chars: markdown.length })
      return { content: [{ type: 'text', text: JSON.stringify(output) }] }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) throw error
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('cherry-tools document conversion failed', normalizedError)
      return errorResult(normalizedError)
    }
  }
}
