import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { application } from '@application'
import { isWinArm64 } from '@main/core/platform'
import { getFileExt } from '@main/utils/legacyFile'
import { inspectPdfText } from '@main/utils/pdfText'
import { FileProcessorIdSchema } from '@shared/data/presets/fileProcessing'
import {
  evaluateKnowledgeFilePreflight,
  KNOWLEDGE_FORMATS,
  type KnowledgeFilePreflight
} from '@shared/data/presets/knowledgeFormats'

export async function preflightKnowledgeFile(
  path: string,
  fileProcessorId?: string | null
): Promise<KnowledgeFilePreflight> {
  const extension = getFileExt(path).toLowerCase()
  const format = KNOWLEDGE_FORMATS.find((item) => item.extensions.some((ext) => ext === extension))
  let input: Parameters<typeof evaluateKnowledgeFilePreflight>[0] = { path, processor: format?.reader ?? '' }
  const initial = evaluateKnowledgeFilePreflight(input)
  if (initial.reason === 'unsupported_format') return initial
  try {
    const info = await stat(path)
    if (!info.isFile()) return initial
    input.size = info.size
  } catch {
    return initial
  }
  if (format?.reader === 'anydoc' && isWinArm64 && !['.doc', '.docx', '.epub'].includes(extension)) {
    return evaluateKnowledgeFilePreflight({ ...input, parserAvailable: false })
  }
  if (extension !== '.pdf') return evaluateKnowledgeFilePreflight(input)
  if (fileProcessorId) {
    input.processor = fileProcessorId
    try {
      const config = application
        .get('FileProcessingService')
        .getDocumentPreflightConfig(FileProcessorIdSchema.parse(fileProcessorId))
      input = {
        ...input,
        maxInputBytes: config.maxInputBytes,
        maxInputPages: config.maxInputPages,
        processorConfigured: true
      }
    } catch {
      return evaluateKnowledgeFilePreflight({ ...input, processorConfigured: false })
    }
  }
  const beforeRead = evaluateKnowledgeFilePreflight(input)
  if (beforeRead.reason !== 'ok') return beforeRead
  try {
    const pdf = await inspectPdfText(await readFile(path), 30_000)
    return evaluateKnowledgeFilePreflight({ ...input, ...pdf })
  } catch {
    return { ...beforeRead, reason: 'unreadable_file' }
  }
}

export async function preflightKnowledgePaths(
  paths: string[],
  fileProcessorId?: string | null
): Promise<KnowledgeFilePreflight[]> {
  const results: KnowledgeFilePreflight[] = []
  async function inspect(path: string): Promise<void> {
    let info
    try {
      info = await stat(path)
    } catch {
      results.push({ path, processor: '', reason: 'unreadable_file' })
      return
    }
    if (!info.isDirectory()) {
      results.push(await preflightKnowledgeFile(path, fileProcessorId))
      return
    }
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
      const child = join(path, entry.name)
      if (entry.isDirectory()) await inspect(child)
      else if (entry.isFile()) results.push(await preflightKnowledgeFile(child, fileProcessorId))
    }
  }
  for (const path of paths) await inspect(path)
  return results
}
