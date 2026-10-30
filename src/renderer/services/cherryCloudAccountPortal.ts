import { ipcApi } from '@renderer/ipc'

import { openExternalWebsite } from './website'

// Cherry Cloud web pages are served by the same origin as its API in every environment.
async function openCherryCloudPage(path: string): Promise<void> {
  const apiOrigin = new URL(await ipcApi.request('cherry_cloud.api_origin.get')).origin
  return openExternalWebsite(`${apiOrigin}${path}`)
}

export function openCherryCloudAccountPortal(): Promise<void> {
  return openCherryCloudPage('/account/plans')
}

/** Placeholder path until the web team provides the subscription FAQ page. */
export function openCherryCloudFaq(): Promise<void> {
  return openCherryCloudPage('/account/faq')
}
