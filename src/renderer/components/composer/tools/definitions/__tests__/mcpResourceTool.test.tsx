import type { McpResource } from '@shared/types/mcp'
import { describe, expect, it } from 'vitest'

import { mcpResourceToComposerToken } from '../../../variants/shared/composerTokens'
import { isTextLikeMcpResource } from '../mcpResourceTool'

describe('isTextLikeMcpResource', () => {
  it('treats text-ish and unlabeled resources as inlinable', () => {
    expect(isTextLikeMcpResource('text/markdown')).toBe(true)
    expect(isTextLikeMcpResource('application/json')).toBe(true)
    // Servers routinely omit mimeType for text resources.
    expect(isTextLikeMcpResource(undefined)).toBe(true)
  })

  it('keeps binary resources out of the inline path', () => {
    expect(isTextLikeMcpResource('image/png')).toBe(false)
    expect(isTextLikeMcpResource('application/pdf')).toBe(false)
    expect(isTextLikeMcpResource('application/octet-stream')).toBe(false)
  })
})

describe('mcpResourceToComposerToken', () => {
  it('carries the uri the read tool needs, and names the tool', () => {
    const resource: McpResource = {
      serverId: 's1',
      serverName: 'Files',
      uri: 'file:///report.pdf',
      name: 'Report',
      mimeType: 'application/pdf'
    }

    const token = mcpResourceToComposerToken(resource)

    expect(token.kind).toBe('reference')
    expect(token.label).toBe('Report')
    expect(token.promptText).toContain('file:///report.pdf')
    expect(token.promptText).toContain('mcp_resource_read')
    expect(token.id).toBe('mcp-resource:file:///report.pdf')
  })

  it('falls back to the uri when the server publishes no name', () => {
    const token = mcpResourceToComposerToken({ serverId: 's1', serverName: 'Files', uri: 'x://a', name: '' })
    expect(token.label).toBe('x://a')
  })
})
