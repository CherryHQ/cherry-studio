import { openExternalWebsite } from './website'

export function openCherryCloudAccountPortal(): Promise<void> {
  const configured = import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  const usesDevAccount =
    import.meta.env.DEV || new URL(configured || 'https://cloud.cherryai.com').hostname === 'cloud-dev.cherryai.com'
  return openExternalWebsite(
    usesDevAccount ? 'https://accounts-dev.cherryai.com/account/plans' : 'https://accounts.cherryai.com/account/plans'
  )
}
