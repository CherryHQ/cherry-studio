export const WebviewSecurityProfile = {
  MiniApp: 'mini-app',
  AgentBrowser: 'agent-browser',
  AgentDevPreview: 'agent-dev-preview',
  AgentHtmlArtifact: 'agent-html-artifact',
  HtmlArtifactPreview: 'html-artifact-preview'
} as const

export type WebviewSecurityProfile = (typeof WebviewSecurityProfile)[keyof typeof WebviewSecurityProfile]

export const WEBVIEW_SECURITY_PARTITIONS = {
  [WebviewSecurityProfile.AgentBrowser]: 'persist:agent-browser',
  [WebviewSecurityProfile.MiniApp]: 'persist:webview',
  [WebviewSecurityProfile.AgentDevPreview]: 'agent-dev-preview',
  [WebviewSecurityProfile.AgentHtmlArtifact]: 'agent-html-artifact',
  [WebviewSecurityProfile.HtmlArtifactPreview]: 'html-artifact-preview'
} as const satisfies Record<WebviewSecurityProfile, string>

export type WebviewSecurityPartition = (typeof WEBVIEW_SECURITY_PARTITIONS)[WebviewSecurityProfile]

export function getWebviewPartition(profile: WebviewSecurityProfile): WebviewSecurityPartition {
  return WEBVIEW_SECURITY_PARTITIONS[profile]
}

export function getWebviewSecurityProfile(partition: string): WebviewSecurityProfile | undefined {
  return (
    Object.entries(WEBVIEW_SECURITY_PARTITIONS) as Array<[WebviewSecurityProfile, WebviewSecurityPartition]>
  ).find(([, candidate]) => candidate === partition)?.[0]
}

export function hasMatchingWebviewSession(
  preferences: { partition?: string; session?: unknown },
  declaredPartition: string | undefined
): boolean {
  // Electron merges renderer preferences before will-attach-webview and
  // gives an explicit Session precedence over the merged partition.
  return preferences.session === undefined && preferences.partition === declaredPartition
}
