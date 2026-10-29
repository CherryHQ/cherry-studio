import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

async function openCherryCloudPage(path: string): Promise<void> {
  const accountOrigin = new URL(await ipcApi.request('cherry_cloud.account_origin.get')).origin
  return openExternalWebsite(`${accountOrigin}${path}`)
}

export function openCherryCloudAccountPortal(): Promise<void> {
  return openCherryCloudPage('/account/plans')
}

/** Placeholder path until the web team provides the subscription FAQ page. */
export function openCherryCloudFaq(): Promise<void> {
  return openCherryCloudPage('/account/faq')
}
