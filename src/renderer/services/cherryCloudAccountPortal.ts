import { openExternalWebsite } from './website'

export function openCherryCloudAccountPortal(): Promise<void> {
  const configured = import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  const usesDevAccount =
    import.meta.env.DEV || new URL(configured || 'https://cloud.cherryai.com').hostname === 'cloud-dev.cherryai.com'
  return openExternalWebsite(
    usesDevAccount ? 'https://cloud-dev.cherryai.com/account/plans' : 'https://cloud.cherryai.com/account/plans'
  )
}
