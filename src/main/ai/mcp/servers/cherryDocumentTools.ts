import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc'
import { loggerService } from '@logger'
import { resolveLocalFile, resolveWorkspaceFile } from '@main/ai/channels'
import { listAgentSessionAttachments } from '@main/ai/messages/agentSessionAttachments'
import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { isAbortError } from '@main/utils/error'
import { isSameOrInside, realpath } from '@main/utils/file'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  TO_MARKDOWN_DESCRIPTION,
  TO_MARKDOWN_TOOL_NAME,
  toMarkdownInputSchema,
  toMarkdownOutputSchema
} from '@shared/ai/builtinTools'
import { AbsoluteFilePathSchema } from '@shared/types/file'
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

/**
 * Trusted roots for an out-of-workspace source: the agent data directory (documents the agent
 * produced or downloaded there — already an approval-free root for the SDK file tools) and the
 * exact managed files attached to this session, not the shared `Data/Files` directory holding them.
 */
async function isAuthorizedOutsideWorkspace(context: CherryDocumentContext, requestedPath: string): Promise<boolean> {
  const agentDataRoot = await realpath(AbsoluteFilePathSchema.parse(context.agentDataPath)).catch(() => null)
  if (agentDataRoot && isSameOrInside(requestedPath, agentDataRoot)) return true

  const fileManager = application.get('FileManager')
  for (const attachment of listAgentSessionAttachments(context.sessionId)) {
    const physicalPath = await realpath(fileManager.getPhysicalPath(attachment.fileEntryId)).catch(() => null)
    if (physicalPath === requestedPath) return true
  }
  return false
}

/**
 * Resolve the source document, confined to the session workspace plus the trusted roots above.
 * Anything else keeps the workspace guard's rejection — this tool is auto-approved, so an
 * unauthorized path must fail here rather than reach the converter.
 */
async function resolveDocumentSource(context: CherryDocumentContext, sourcePath: string): Promise<FileAttachment> {
  try {
    return await resolveWorkspaceFile(context.workspacePath, sourcePath)
  } catch (workspaceError) {
    const requestedPath = await realpath(
      AbsoluteFilePathSchema.parse(path.resolve(context.workspacePath, sourcePath))
    ).catch(() => null)
    if (requestedPath && (await isAuthorizedOutsideWorkspace(context, requestedPath))) {
      return resolveLocalFile(context.workspacePath, sourcePath)
    }
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
