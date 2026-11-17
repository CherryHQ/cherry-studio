import { describe, expect, it } from 'vitest'

import {
  getWebviewPartition,
  getWebviewSecurityProfile,
  WEBVIEW_SECURITY_PARTITIONS,
  WebviewSecurityProfile
} from '../webviewSecurity'

describe('webview security profiles', () => {
  it.each(Object.values(WebviewSecurityProfile))('resolves the owning profile for %s', (profile) => {
    expect(getWebviewSecurityProfile(getWebviewPartition(profile))).toBe(profile)
  })

  it.each(['', 'persist:unknown', 'persist:webview-extra'])('rejects an unknown partition: %s', (partition) => {
    expect(getWebviewSecurityProfile(partition)).toBeUndefined()
  })

  it('gives each profile a distinct centrally owned partition', () => {
    expect(new Set(Object.values(WEBVIEW_SECURITY_PARTITIONS))).toHaveProperty(
      'size',
      Object.values(WebviewSecurityProfile).length
    )
  })

  it('keeps only MiniApps in the existing persistent WebView session', () => {
    expect(getWebviewPartition(WebviewSecurityProfile.MiniApp)).toBe('persist:webview')
    expect(getWebviewPartition(WebviewSecurityProfile.AgentDevPreview)).not.toMatch(/^persist:/)
    expect(getWebviewPartition(WebviewSecurityProfile.AgentHtmlArtifact)).not.toMatch(/^persist:/)
    expect(getWebviewPartition(WebviewSecurityProfile.HtmlArtifactPreview)).not.toMatch(/^persist:/)
  })
})
