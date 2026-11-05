import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

export async function openCherryCloudAccountPortal(): Promise<void> {
  const accountOrigin = new URL(await ipcApi.request('cherry_cloud.account_origin.get')).origin
  return openExternalWebsite(`${accountOrigin}/account/plans`)
}
