import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

import { openExternalWebsite } from './website'

async function openCherryCloudPage(path: string): Promise<void> {
  const accountOrigin = new URL(await ipcApi.request('cherry_cloud.account_origin.get')).origin
  return openExternalWebsite(`${accountOrigin}${path}`)
}

export function openCherryCloudAccountPortal(): Promise<void> {
  return openCherryCloudPage('/account/plans')
}

// The official website has no test deployment, so every China-edition build links the production FAQ.
const CN_SUBSCRIPTION_FAQ_URL = 'https://cherryai.com.cn/subscription/faq'

/** The global path is a placeholder until the web team provides that edition's subscription FAQ page. */
export function openCherryCloudFaq(): Promise<void> {
  if (getAppEdition() === 'cn') return openExternalWebsite(CN_SUBSCRIPTION_FAQ_URL)
  return openCherryCloudPage('/account/faq')
}
