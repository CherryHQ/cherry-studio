import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

// The account portal is served by the same origin as the Cherry Cloud API in every environment.
export async function openCherryCloudAccountPortal(): Promise<void> {
  const apiOrigin = new URL(await ipcApi.request('cherry_cloud.api_origin.get')).origin
  return openExternalWebsite(`${apiOrigin}/account/plans`)
}
