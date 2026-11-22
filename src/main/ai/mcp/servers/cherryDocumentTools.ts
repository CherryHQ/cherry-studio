import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc'
import type { McpServer } from '@modelcontextprotocol/server'

import { application } from '@application'
import { loggerService } from '@logger'
import { resolveLocalFile, resolveWorkspaceFile } from '@main/ai/channels'
import { listAgentSessionAttachments } from '@main/ai/messages/agentSessionAttachments'
import { isWinArm64 } from '@main/core/platform'
import { t } from '@main/i18n'
import type { FileAttachment } from '@main/utils/downloadAsBase64'
import { isSameOrInside, realpath } from '@main/utils/file'
import { inspectPdfText, isScannedPdfError } from '@main/utils/pdfText'
import {
  TO_MARKDOWN_DESCRIPTION,
  TO_MARKDOWN_TOOL_NAME,
  toMarkdownInputSchema,
  toMarkdownOutputSchema
} from '@shared/ai/builtinTools'
import { AbsoluteFilePathSchema } from '@shared/types/file'

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

async function convertWithAnydoc(bytes: Buffer, extension: string): Promise<string | null> {
  const pdf = extension === '.pdf'
  if (pdf && (await inspectPdfText(bytes)).hasTextlessPages) return null

  if (isWinArm64) throw new Error(t('agent.tools.to_markdown.unsupported_windows_arm64'))

  const anydoc = await loadAnydocModule()
  try {
    return await anydoc.toMarkdownBytes(bytes, anydoc.formatFromExtension(extension) ?? undefined)
  } catch (error) {
    if (pdf && isScannedPdfError(error)) return null
    throw error
  }
}

async function processScannedPdf(source: FileAttachment, bytes: Buffer, signal: AbortSignal): Promise<string> {
  const service = application.get('FileProcessingService')
  signal.throwIfAborted()
  const stagingDirectory = await mkdtemp(application.getPath('feature.file_processing.temp', 'agent-pdf-'))
  try {
    const inputPath = AbsoluteFilePathSchema.parse(path.join(stagingDirectory, path.basename(source.filename)))
    const outputPath = AbsoluteFilePathSchema.parse(path.join(stagingDirectory, 'converted.md'))
    await writeFile(inputPath, bytes, { flag: 'wx', mode: 0o600, signal })
    const { task, done } = await service.startTask(
      {
        feature: 'document_to_markdown',
        file: { kind: 'path', path: inputPath },
        output: { kind: 'path', path: outputPath }
      },
      signal
    )
    const cancel = () => {
      void service
        .cancelTask(task.id)
        .catch((error) => logger.warn('Failed to cancel Agent document processing', error))
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try {
      const result = await done
      signal.throwIfAborted()
      if (result.status !== 'completed') throw new Error(result.error)
      return await readFile(outputPath, { encoding: 'utf-8', signal })
    } finally {
      signal.removeEventListener('abort', cancel)
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
  }
}

export function registerDocumentTools(server: McpServer, context: CherryDocumentContext): void {
  server.registerTool(
    TO_MARKDOWN_TOOL_NAME,
    { description: TO_MARKDOWN_DESCRIPTION, inputSchema: toMarkdownInputSchema },
    async ({ path: sourcePath }, ctx) => {
      const signal = ctx.mcpReq.signal
      const source = await resolveDocumentSource(context, sourcePath)
      signal.throwIfAborted()

      const bytes = Buffer.from(source.data, 'base64')
      const converted = await convertWithAnydoc(bytes, path.extname(source.filename).toLowerCase())
      const markdown = (converted ?? (await processScannedPdf(source, bytes, signal))).trim()
      if (!markdown) throw new Error('Document conversion produced no text')
      signal.throwIfAborted()

      const outputDirectory = path.join(context.agentDataPath, 'tmp', 'to-markdown')
      await mkdir(outputDirectory, { recursive: true })
      await cleanupStaleOutputs(outputDirectory).catch((error) => {
        logger.warn('Failed to clean stale document conversion outputs', error as Error)
      })

      const outputPath = path.join(outputDirectory, `${randomUUID()}.md`)
      await writeFile(outputPath, markdown, { encoding: 'utf-8', flag: 'wx', signal })
      const output = toMarkdownOutputSchema.parse({ path: outputPath, chars: markdown.length })
      return { content: [{ type: 'text', text: JSON.stringify(output) }] }
    }
  )
}
