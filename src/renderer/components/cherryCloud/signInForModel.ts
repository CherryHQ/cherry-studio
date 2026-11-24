import { dataApiService } from '@data/DataApiService'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { getCherryCloudSignInErrorMessage } from '@renderer/utils/cherryCloudSignIn'
import type { Model, UniqueModelId } from '@shared/data/types/model'

/** Signs in from a locked row, then returns its model once this picker may use it, so the click can finish. */
export async function signInForModel(modelId: UniqueModelId, agent: boolean): Promise<Model | undefined> {
  try {
    const { outcome } = await ipcApi.request('cherry_cloud.login.start')
    if (outcome !== 'signed-in') return undefined
    const { availableModelIds } = await ipcApi.request('cherry_cloud.models.sync')
    if (!availableModelIds[agent ? 'agent' : 'general'].includes(modelId)) return undefined
    return (await dataApiService.get(`/models/${modelId}`)) ?? undefined
  } catch (error) {
    toast.error(getCherryCloudSignInErrorMessage(error, i18n.t))
    return undefined
  }
}
