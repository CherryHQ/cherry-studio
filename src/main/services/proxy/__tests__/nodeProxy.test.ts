import { describe, expect, it } from 'vitest'

import { CHERRY_NODE_PROXY_BYPASS_RULES_ENV, CHERRY_NODE_PROXY_RULES_ENV, getProxyEnvironment } from '../nodeProxy'

describe('getProxyEnvironment', () => {
  it('forwards the complete native child-process proxy whitelist', () => {
    const proxyValues = {
      [CHERRY_NODE_PROXY_RULES_ENV]: 'socks5://cherry.example:1080',
      [CHERRY_NODE_PROXY_BYPASS_RULES_ENV]: '<local>',
      HTTP_PROXY: 'http://upper-http.example:8080',
      HTTPS_PROXY: 'https://upper-https.example:8443',
      http_proxy: 'http://lower-http.example:8080',
      https_proxy: 'https://lower-https.example:8443',
      ALL_PROXY: 'socks5://upper-all.example:1080',
      all_proxy: 'socks5://lower-all.example:1080',
      SOCKS_PROXY: 'socks5://upper-socks.example:1080',
      socks_proxy: 'socks5://lower-socks.example:1080',
      NO_PROXY: 'localhost,.upper.example',
      no_proxy: 'localhost,.lower.example',
      grpc_proxy: 'http://grpc.example:8080'
    }

    expect(
      getProxyEnvironment({
        ...proxyValues,
        SHOULD_NOT_BE_FORWARDED: 'secret'
      })
    ).toEqual(proxyValues)
  })

  it('drops empty and whitespace-only proxy values', () => {
    expect(
      getProxyEnvironment({
        HTTP_PROXY: '  ',
        ALL_PROXY: '',
        grpc_proxy: '\t',
        NO_PROXY: 'localhost'
      })
    ).toEqual({ NO_PROXY: 'localhost' })
  })
})
