import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

export async function openCherryCloudAccountPortal(): Promise<void> {
  const apiOrigin = await ipcApi.request('cherry_cloud.api_origin.get')
  const usesDevAccount = new URL(apiOrigin).hostname !== 'cloud.cherryai.com'
  return openExternalWebsite(
    usesDevAccount ? 'https://cloud-dev.cherryai.com/account/plans' : 'https://cloud.cherryai.com/account/plans'
  )
}
