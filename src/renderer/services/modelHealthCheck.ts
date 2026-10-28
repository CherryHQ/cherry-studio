import { ipcApi } from '@renderer/ipc'
import type { SerializedError } from '@renderer/types/error'
import { providerErrorText } from '@renderer/utils/error'
import type { UniqueModelId } from '@shared/data/types/model'

export function healthCheckErrorToDisplayString(error: SerializedError | string | undefined | null): string {
  if (error == null) return ''
  if (typeof error === 'string') return error.trim()

  const message = providerErrorText(error).trim()
  if (message) return message
  return error.name?.trim() ?? ''
}

export async function checkDoctorAgentModel(uniqueModelId: UniqueModelId): Promise<{ latency: number }> {
  return await ipcApi.request('diagnostics.doctor.agent.check_model', { modelId: uniqueModelId })
}
