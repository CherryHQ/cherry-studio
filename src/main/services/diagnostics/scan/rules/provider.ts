import { SCAN_LEVELS, type ScanRule } from '../types'

/** Model-provider API failures: credentials, quota, throttling, endpoints, request shape. */
export const providerCredentialExposedRule: ScanRule = {
  id: 'provider-credential-exposed',
  domain: 'provider',
  attribution: 'app-bug',
  devMessage:
    'A credential-shaped value appears in an application log; rotate it and review the log contents before sharing the bundle.',
  levels: SCAN_LEVELS,
  anchors: [
    // `[\s"']*` is one merged run on purpose: two adjacent `\s*` runs around an
    // optional quote backtrack quadratically on `key` + spaces without a separator.
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{36,}\b|\bBearer\s+[A-Za-z0-9_.~+/=-]{20,}|-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY-----|(?:api[_-]?keys?|authorization|access[_-]?token|client[_-]?secret|secret[_-]?key)[\s"']*[:=]\s*["']?(?:Bearer\s+)?[A-Za-z0-9_~+/.=-]{20,}/i
  ]
}

export const providerRules: readonly ScanRule[] = [
  providerCredentialExposedRule,
  {
    id: 'provider-auth-rejected',
    domain: 'provider',
    attribution: 'user-fixable',
    devMessage:
      'A provider rejected the request as unauthenticated or forbidden (401/403); the API key is missing, invalid, or lacks access to the requested model.',
    // The status number needs status-ish context: a bare `401` also matches token counts
    // (`"outputTokens":401`) and timestamp milliseconds, whose neighbours satisfy the tail.
    anchors: [
      /(?:(?:status(?:Code)?["\s:]{0,4}|\bHTTP[ /]?)40[13]\b|unauthorized|forbidden)[\s\S]*(?:api|key|token|auth|provider|model|request)|invalid.{0,3}api.{0,3}key|incorrect api key|authentication fail|invalid token/i
    ]
  },
  {
    id: 'provider-payment-required',
    domain: 'provider',
    attribution: 'user-fixable',
    devMessage: 'A provider rejected the request over billing (402): the account is out of balance, quota, or credits.',
    anchors: [
      /(?:status(?:Code)?["\s:]{0,4}|\bHTTP[ /]?)402\b|payment required|insufficient (?:balance|quota|credits?)|余额不足/i
    ]
  },
  {
    id: 'provider-rate-limited',
    domain: 'provider',
    attribution: 'transient',
    devMessage: 'A provider throttled the request (429); retrying after a delay or rotating keys usually resolves it.',
    // No bare `too many requests`: real throttles always carry 429 or "rate limit" too, while the
    // bare phrase only ever arrived quoted inside an upstream site's abuse-block prose.
    anchors: [/(?:status(?:Code)?["\s:]{0,4}|\bHTTP[ /]?)429\b|rate.?limit(?:ed|s)?\b/i],
    exclude: [/rate.?limits? (?:raised|increased)/i]
  },
  {
    id: 'provider-model-not-found',
    domain: 'provider',
    attribution: 'user-fixable',
    devMessage:
      'The configured model id does not exist on the provider (404 / NOT_FOUND); the model list is stale or the id belongs to a different endpoint.',
    // Anchored on a *specific* model id: a bare 404 near the word "model" also fires on
    // `/models` route errors, "listing models Not Found", and modelscope.cn download URLs.
    anchors: [
      /model[_\s-]?not[_\s-]?found|\bmodel with id\b[\s\S]{0,80}not (?:found|exist)|\bmodel\b[\s\S]{0,60}does not exist|no such model/i
    ]
  },
  {
    id: 'provider-unsupported-params',
    domain: 'provider',
    attribution: 'app-bug',
    devMessage:
      'The app sent a parameter this provider does not accept (e.g. reasoning_effort, max_tokens, store, strict); the provider compatibility layer needs a fix.',
    anchors: [
      /UnsupportedParamsError|(?:unsupported|unrecognized|unknown|invalid) (?:parameter|argument|request argument|value)[\s\S]{0,80}(?:reasoning_effort|max_tokens|store|strict|response_format)/i
    ]
  },
  {
    id: 'provider-bad-request',
    domain: 'provider',
    attribution: 'user-fixable',
    devMessage:
      'A provider rejected the request as malformed (400 / invalid_request_error) without a more specific known cause; check endpoint type, model choice, and request contents.',
    anchors: [
      /(?:status(?:Code)?["\s:]{0,4}|\bHTTP[ /]?)400\b[\s\S]{0,120}(?:request|provider|model|api|invalid)|invalid_request_error|BadRequestError/i
    ],
    // `DataApiError` is our own layer refusing an operation, not a provider rejecting a request —
    // and its name satisfies the `api` neighbour the bare 400 is paired with.
    exclude: [
      /UnsupportedParamsError|reasoning_effort|max_tokens|response_format|\btool_use\b|No tool output found/i,
      /DataApiError/
    ]
  }
]
