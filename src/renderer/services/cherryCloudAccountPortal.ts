import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'

import { openExternalWebsite } from './website'

/** Tells the page the visit came from the desktop client, and from which touchpoint and subscription flow. */
type PageAttribution = { entrySource?: string; flowId?: string }

async function openCherryCloudPage(path: string, { entrySource, flowId }: PageAttribution = {}): Promise<void> {
  const url = new URL(path, await ipcApi.request('cherry_cloud.account_origin.get'))
  url.searchParams.set('entry', 'desktop')
  if (entrySource) url.searchParams.set('entry_source', entrySource)
  if (flowId) url.searchParams.set('flow_id', flowId)
  return openExternalWebsite(url.toString())
}

export function openCherryCloudAccountPortal(attribution: PageAttribution = {}): Promise<void> {
  return openCherryCloudPage('/account/plans', attribution)
}

// The official website has no test deployment, so every China-edition build links the production FAQ.
const CN_SUBSCRIPTION_FAQ_URL = 'https://cherryai.com.cn/subscription/faq'

/** The global path is a placeholder until the web team provides that edition's subscription FAQ page. */
export function openCherryCloudFaq(): Promise<void> {
  if (getAppEdition() === 'cn') return openExternalWebsite(CN_SUBSCRIPTION_FAQ_URL)
  return openCherryCloudPage('/account/faq')
}
