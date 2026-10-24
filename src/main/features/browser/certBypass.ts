import type { Session } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('BrowserCertificateBypass')

// Chromium net_error_list.h: ERR_CERT_AUTHORITY_INVALID. Electron does not export the constant.
const ERR_CERT_AUTHORITY_INVALID = -202

// 0 accepts the certificate, -2 rejects it, -3 defers to Chromium's own verification result.
const DEFER_TO_CHROMIUM = -3

const appliedSessions = new WeakSet<Session>()

/**
 * Normalize one user-entered allowlist entry to a bare hostname.
 * Accepts `nas.local`, `https://nas.local:5001/admin`, `10.0.0.2`, `[::1]`; ports are
 * dropped (the verify proc never sees one, so an entry covers every port on the host).
 * Wildcards, paths and other patterns are rejected — the list is exact-match by design.
 */
export function normalizeCertificateBypassHost(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (!value || value.startsWith('#')) return null
  if (/^[a-z][a-z\d+.-]*:\/\//.test(value)) {
    try {
      value = new URL(value).hostname
    } catch {
      return null
    }
  }
  const portMatch = value.match(/^(\[[^\]]+\]|[^:[\]]+):\d{1,5}$/)
  if (portMatch) value = portMatch[1]
  if (/^:[0-9a-f:]+$/.test(value)) value = `[${value}]`
  if (value.includes('*') || value.includes('/')) return null
  if (
    !/^\[[0-9a-f:.]+\]$/.test(value) && // bracketed IPv6
    !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && // IPv4
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(value) && // dotted names
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) // single label (intranet host)
  ) {
    return null
  }
  return value
}

/** Parse the raw preference value (string[] or newline/comma separated string) into unique hostnames. */
export function parseCertificateBypassHosts(raw: unknown): string[] {
  const entries = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\n,;]+/) : []
  const hosts = new Set<string>()
  for (const entry of entries) {
    const host = normalizeCertificateBypassHost(String(entry ?? ''))
    if (host) hosts.add(host)
  }
  return [...hosts]
}

/** Exact hostname match; the verify proc provides a punycode hostname, so both sides are normalized. */
export function matchCertificateBypassHost(hostname: string, hosts: string[]): boolean {
  const normalized = normalizeCertificateBypassHost(hostname)
  return normalized !== null && hosts.includes(normalized)
}

function readConfiguredHosts(): unknown {
  return application.get('PreferenceService').get('app.browser.cert_bypass.hosts')
}

/**
 * Let the built-in browser accept self-signed (untrusted CA) certificates for hosts the
 * user explicitly listed in Settings. Only `ERR_CERT_AUTHORITY_INVALID` on a configured
 * host with a chain Chromium does not root is accepted; everything else defers to
 * Chromium's normal verification. Idempotent per session — the proc re-reads the
 * preference on every failed verification, so edits apply without re-wiring.
 */
export function applyBrowserCertificatePolicy(target: Session, getHosts: () => unknown = readConfiguredHosts): void {
  if (appliedSessions.has(target)) return
  appliedSessions.add(target)
  target.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode !== ERR_CERT_AUTHORITY_INVALID) return callback(DEFER_TO_CHROMIUM)
    if (request.isIssuedByKnownRoot) return callback(DEFER_TO_CHROMIUM)
    if (!matchCertificateBypassHost(request.hostname, parseCertificateBypassHosts(getHosts()))) {
      return callback(DEFER_TO_CHROMIUM)
    }
    logger.debug('Accepting self-signed certificate for configured host', { hostname: request.hostname })
    callback(0)
  })
}
