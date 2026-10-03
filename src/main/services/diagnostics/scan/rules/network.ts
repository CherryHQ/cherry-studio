import type { ScanRule } from '../types'

/** Connectivity failures: refused/reset connections, DNS, TLS, timeouts. */
export const networkRules: readonly ScanRule[] = [
  {
    id: 'network-connection-failed',
    domain: 'network',
    attribution: 'user-fixable',
    devMessage:
      'A TCP connection to a remote service failed (refused/reset/closed); the endpoint is down or a proxy/firewall is interfering.',
    anchors: [/ERR_CONNECTION_(?:REFUSED|CLOSED|RESET|TIMED_OUT)|ECONNREFUSED|ECONNRESET|socket hang up/i]
  },
  {
    id: 'network-offline-dns',
    domain: 'network',
    attribution: 'user-fixable',
    devMessage: 'The machine appears offline or DNS resolution failed; check network connectivity and proxy settings.',
    anchors: [/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ENETUNREACH/i]
  },
  {
    id: 'network-tls-certificate',
    domain: 'network',
    attribution: 'user-fixable',
    devMessage:
      'TLS certificate verification failed; a corporate proxy or self-signed certificate is intercepting HTTPS traffic.',
    anchors: [/ERR_CERT_[A-Z_]+|SSL_ERROR_[A-Z_]+|self.?signed certificate|unable to verify the first certificate/i]
  },
  {
    id: 'network-fetch-timeout',
    domain: 'network',
    attribution: 'transient',
    devMessage: 'A network request timed out or failed without a specific cause; usually transient or proxy-related.',
    anchors: [
      /\bETIMEDOUT\b|ERR_TIMED_OUT|HeadersTimeoutError|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|fetch failed/i
    ],
    // Case-insensitive in lockstep with the sibling network rules: a veto that stopped matching
    // the token its sibling anchors on would silently drop the record from both.
    // An HTTP status means the request reached the server, so it is not a timeout — this rule
    // only claims failures "without a specific cause".
    exclude: [
      /ECONNREFUSED|ECONNRESET|ERR_CERT_|ENOTFOUND|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_/i,
      /fetch failed[^\n]{0,20}HTTP \d{3}/i
    ]
  }
]
