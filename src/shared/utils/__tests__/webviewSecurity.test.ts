import { describe, expect, it } from 'vitest'

import { getWebviewPartition, WEBVIEW_SECURITY_PARTITIONS, WebviewSecurityProfile } from '../webviewSecurity'

describe('webview security profiles', () => {
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
