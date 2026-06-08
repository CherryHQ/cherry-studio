import path from 'node:path'

import { application } from '@application'
import type { JobContext } from '@main/core/job/types'
import { toFileInfo } from '@main/services/file/toFileInfo'
import { stat as fsStat } from '@main/utils/file/fs'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorInput, FileProcessorMerged } from '@shared/data/presets/file-processing'
import { type FileHandle, type FileInfo, FileInfoSchema, type FilePath, getFileTypeByExt } from '@shared/file/types'
import mime from 'mime'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import { processorRegistry } from '../processors/registry'
import type {
  FileProcessingCapabilityHandler,
  FileProcessingProcessorCapabilities,
  FileProcessingRemoteContext,
  PreparedBackgroundJob,
  PreparedRemoteJob
} from '../processors/types'
import type { FileProcessingJobPayload } from './shared'

export type FileProcessingJobMode = 'background' | 'remote-poll'

interface PreparedFileProcessingJobBase {
  feature: FileProcessorFeature
  file: FileHandle
  processorId: FileProcessorId
  config: FileProcessorMerged
}

export interface PreparedBackgroundFileProcessingJob extends PreparedFileProcessingJobBase {
  prepared: PreparedBackgroundJob
}

export interface PreparedRemotePollFileProcessingJob extends PreparedFileProcessingJobBase {
  prepared: PreparedRemoteJob<FileProcessorFeature, FileProcessingRemoteContext>
}

type PreparedFileProcessingJobByMode<Mode extends FileProcessingJobMode> = Mode extends 'background'
  ? PreparedBackgroundFileProcessingJob
  : PreparedRemotePollFileProcessingJob

export async function prepareFileProcessingJob(
  ctx: JobContext<FileProcessingJobPayload>,
  expectedMode: 'background'
): Promise<PreparedBackgroundFileProcessingJob>
export async function prepareFileProcessingJob(
  ctx: JobContext<FileProcessingJobPayload>,
  expectedMode: 'remote-poll'
): Promise<PreparedRemotePollFileProcessingJob>
export async function prepareFileProcessingJob(
  ctx: JobContext<FileProcessingJobPayload>,
  expectedMode: FileProcessingJobMode
): Promise<PreparedBackgroundFileProcessingJob | PreparedRemotePollFileProcessingJob> {
  const input = ctx.input
  const { feature, file, processorId } = input
  const config = resolveProcessorConfigByFeature(feature, processorId)
  const handler = getCapabilityHandler(config.id, feature)
  assertModeMatches(handler, expectedMode)
  const fileInfo = await resolveFileProcessingFileInfo(file)
  assertFileTypeSupported(fileInfo, feature, config)

  const prepared = await handler.prepare(fileInfo, config, ctx.signal, {
    ...(input.context?.dataId ? { dataId: input.context.dataId } : {})
  })
  assertModeMatches(prepared, expectedMode)

  return createPreparedFileProcessingJobResult(expectedMode, {
    feature,
    file,
    processorId: config.id,
    config,
    prepared
  })
}

function createPreparedFileProcessingJobResult<Mode extends FileProcessingJobMode>(
  _mode: Mode,
  result: PreparedFileProcessingJobBase & {
    prepared: PreparedFileProcessingJobByMode<Mode>['prepared']
  }
): PreparedFileProcessingJobByMode<Mode> {
  return result as PreparedFileProcessingJobByMode<Mode>
}

/** Look up the capability handler for (processorId, feature). Throws on missing. */
export function getCapabilityHandler<Feature extends FileProcessorFeature>(
  processorId: FileProcessorId,
  feature: Feature
): FileProcessingCapabilityHandler<Feature> {
  const capabilities: FileProcessingProcessorCapabilities = processorRegistry[processorId].capabilities
  const handler = capabilities[feature]

  if (!handler) {
    throw new Error(`File processor ${processorId} does not support ${feature}`)
  }

  return handler
}

/**
 * Guard against handler.mode vs prepared.mode drift. The orchestrator routes
 * by handler.mode at enqueue time; any divergence at execute time means a
 * capability handler was implemented incorrectly.
 */
export function assertModeMatches<ExpectedMode extends FileProcessingJobMode>(
  handler: { mode: FileProcessingJobMode },
  expected: ExpectedMode
): asserts handler is { mode: ExpectedMode } {
  if (handler.mode !== expected) {
    throw new Error(
      `Internal error - Capability handler mode mismatch: handler.mode='${handler.mode}' but job type expects '${expected}'`
    )
  }
}

export function assertFileTypeSupported(
  file: FileInfo,
  feature: FileProcessorFeature,
  config: FileProcessorMerged
): void {
  const presetCapability = config.capabilities.find((item) => item.feature === feature)

  if (!presetCapability) {
    throw new Error(`File processor ${config.id} does not support ${feature}`)
  }

  const inputs: readonly FileProcessorInput[] = presetCapability.inputs
  if (!inputs.includes(file.type as FileProcessorInput)) {
    throw new Error(`File processor ${config.id} ${feature} does not support ${file.type} files`)
  }
}

export async function resolveFileProcessingFileInfo(file: FileHandle): Promise<FileInfo> {
  if (file.kind === 'path') {
    return await resolveFileProcessingPathInfo(file.path)
  }

  const fileManager = application.get('FileManager')
  const metadata = await fileManager.getMetadata(file.entryId)
  if (metadata.kind === 'directory') {
    throw new Error('File processing does not support directories')
  }

  const entry = await fileManager.getById(file.entryId)
  return toFileInfo(entry)
}

/**
 * Path-form sibling of `toFileInfo`: build a live `FileInfo` straight from a raw
 * filesystem path — name/ext via `path.parse`, size/time via `fsStat` —
 * bypassing the entry/FileManager system. That bypass is the whole point of the
 * `{kind:'path'}` handle: no DanglingCache or version-cache side effects.
 *
 * The stat → mime → type → `FileInfoSchema.parse` tail intentionally mirrors
 * `toFileInfo`. It is left inline rather than hoisted into a shared file-service
 * helper to keep this change within the file-processing domain; the only real
 * difference is that path/name/ext come from the raw path instead of FileEntry
 * metadata.
 */
async function resolveFileProcessingPathInfo(filePath: FilePath): Promise<FileInfo> {
  const stats = await fsStat(filePath)
  if (stats.isDirectory) {
    throw new Error('File processing does not support directories')
  }

  const parsed = path.parse(filePath)
  const ext = parsed.ext.length > 0 ? parsed.ext.slice(1) : null
  return FileInfoSchema.parse({
    path: filePath,
    name: parsed.name,
    ext,
    size: stats.size,
    mime: ext ? (mime.getType(ext) ?? 'application/octet-stream') : 'application/octet-stream',
    type: getFileTypeByExt(ext ?? ''),
    createdAt: stats.createdAt || stats.modifiedAt,
    modifiedAt: stats.modifiedAt
  }) as FileInfo
}
