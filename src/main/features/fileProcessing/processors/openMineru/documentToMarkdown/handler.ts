import { t } from '@main/i18n'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import type { FileInfo } from '@shared/types/file'

import { getApiKey, getRequiredApiHost, getRequiredCapability } from '../../../utils/provider'
import type { FileProcessingCapabilityHandler, PreparedRemoteJob } from '../../types'
import { parseLegacyDocument } from '../legacyClient'
import { probeOpenMineru } from '../protocol'
import { OpenMineruRemoteStateSchema } from '../schemas'
import type { OpenMineruConnection } from '../types'
import { downloadV1Markdown, getV1ParseJob, startV1Parse } from '../v1Client'

export const openMineruDocumentToMarkdownHandler: FileProcessingCapabilityHandler<
  'document_to_markdown',
  OpenMineruConnection
> = {
  mode: 'auto',
  async prepare(file, config, signal, context) {
    signal?.throwIfAborted()
    const apiHost = resolveApiHost(config)
    if (context?.remoteState !== undefined) {
      validateRemoteState(context.remoteState, apiHost)
      return prepareV1Job(file, { apiHost })
    }

    const connection = { apiHost, apiKey: getApiKey(config, 'open-mineru') }
    const probe = await probeOpenMineru(connection, signal)
    if (probe.kind === 'http-error') {
      throw new Error(t('file_processing.errors.open_mineru_request_failed', { status: probe.status }))
    }
    if (probe.kind === 'unreachable') throw new Error(t('file_processing.errors.open_mineru_unreachable'))
    if (probe.kind !== 'supported') throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
    if (probe.protocol === 'v1') return prepareV1Job(file, connection)

    return {
      mode: 'background',
      async execute(executionContext) {
        executionContext.reportProgress(10)
        const response = await parseLegacyDocument({ ...connection, file, signal: executionContext.signal })
        executionContext.reportProgress(80)
        return { kind: 'response-zip', response }
      }
    }
  }
}

function prepareV1Job(
  file: FileInfo,
  connection: OpenMineruConnection
): PreparedRemoteJob<'document_to_markdown', OpenMineruConnection> {
  return {
    mode: 'remote-poll',
    async startRemote(signal) {
      return {
        providerTaskId: await startV1Parse(connection, file, signal),
        status: 'pending',
        progress: 0,
        remoteContext: connection
      }
    },
    async pollRemote(job, signal) {
      const result = await getV1ParseJob(job.remoteContext, job.providerTaskId, signal)
      if (result.status === 'queued' || result.status === 'running') {
        return { status: result.status === 'queued' ? 'pending' : 'processing', progress: 0 }
      }
      if (result.status !== 'completed' || result.files[0].status !== 'completed') {
        return {
          status: 'failed',
          error: t('file_processing.errors.open_mineru_task_failed', { status: result.status })
        }
      }
      const fileId = result.files[0].output_files?.markdown?.file_id
      if (!fileId) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
      return {
        status: 'completed',
        output: { kind: 'markdown', markdownContent: await downloadV1Markdown(job.remoteContext, fileId, signal) }
      }
    },
    toPersistable(remoteContext, providerTaskId) {
      return { protocol: 'v1', apiHost: remoteContext.apiHost, providerTaskId }
    },
    rehydrate(persisted, config) {
      const apiHost = resolveApiHost(config)
      const state = validateRemoteState(persisted, apiHost)
      return {
        providerTaskId: state.providerTaskId,
        remoteContext: { apiHost, apiKey: getApiKey(config, 'open-mineru') }
      }
    }
  }
}

function validateRemoteState(value: unknown, apiHost: string) {
  const result = OpenMineruRemoteStateSchema.safeParse(value)
  if (!result.success) throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  if (result.data.apiHost !== apiHost) throw new Error(t('file_processing.errors.open_mineru_endpoint_changed'))
  return result.data
}

function resolveApiHost(config: FileProcessorMerged): string {
  const capability = getRequiredCapability(config, 'document_to_markdown', 'open-mineru')
  try {
    const url = new URL(getRequiredApiHost(capability))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid API host')
    }
    return url.href.replace(/\/+$/, '')
  } catch {
    throw new Error(t('file_processing.errors.open_mineru_invalid_response'))
  }
}
