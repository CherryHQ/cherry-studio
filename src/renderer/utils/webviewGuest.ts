import { WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

export function getGuestAuthorizationKey(securityProfile: WebviewSecurityProfile, initialUrl: string): string {
  if (securityProfile === WebviewSecurityProfile.AgentBrowser) return securityProfile
  if (securityProfile === WebviewSecurityProfile.AgentHtmlArtifact) return `${securityProfile}:${initialUrl}`
  if (initialUrl === 'about:blank') return `${securityProfile}:${initialUrl}`

  try {
    const url = new URL(initialUrl)
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost'
    return `${securityProfile}:${url.origin}`
  } catch {
    return `${securityProfile}:${initialUrl}`
  }
}
