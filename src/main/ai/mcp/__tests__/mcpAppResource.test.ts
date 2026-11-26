import { describe, expect, it } from 'vitest'

import { prepareMcpAppResource } from '../mcpAppResource'

const uri = 'ui://test/board'
const resource = {
  name: 'Board',
  uri,
  text: '<main>Board</main>',
  mimeType: 'text/html;profile=mcp-app',
  serverId: 'test',
  serverName: 'Test'
}

describe('prepareMcpAppResource', () => {
  it('keeps script sources and direct network destinations separate', () => {
    const prepared = prepareMcpAppResource(
      [
        {
          ...resource,
          _meta: {
            ui: {
              csp: {
                resourceDomains: ['https://static.example.com'],
                connectDomains: ['https://api.example.com'],
                frameDomains: ['https://frame.example.com']
              }
            }
          }
        }
      ],
      uri
    )

    expect(prepared.csp.split('; ')).toEqual(
      expect.arrayContaining([
        "script-src 'unsafe-inline' https://static.example.com",
        'connect-src https://api.example.com',
        "frame-src 'none'",
        "form-action 'none'"
      ])
    )
    expect(prepared.origins).toEqual(['https://static.example.com', 'https://api.example.com'])
  })

  it('does not load a legacy MIME type, the wrong URI, or ambiguous resources', () => {
    expect(() => prepareMcpAppResource([{ ...resource, mimeType: 'text/html+skybridge' }], uri)).toThrow()
    expect(() => prepareMcpAppResource([resource], 'ui://test/other')).toThrow()
    expect(() => prepareMcpAppResource([resource, resource], uri)).toThrow()
  })

  it('rejects wildcard and non-HTTPS network declarations', () => {
    for (const origin of [
      'https://*.example.com',
      'http://example.com',
      'https://127.0.0.1',
      'https://a.example.com/path'
    ]) {
      expect(() =>
        prepareMcpAppResource([{ ...resource, _meta: { ui: { csp: { connectDomains: [origin] } } } }], uri)
      ).toThrow()
    }
  })
})
