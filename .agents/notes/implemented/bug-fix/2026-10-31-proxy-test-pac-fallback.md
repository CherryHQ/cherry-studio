# Agent Note: Proxy test PAC fallback reporting

Status: implemented

English | [中文](2026-10-31-proxy-test-pac-fallback.zh.md)

## Problem

Electron's `resolveProxy()` returns PAC candidates, not the transport ultimately used by a request. With `PROXY 127.0.0.1:1; DIRECT`, a failed proxy can fall back to a successful direct connection. Reporting that success as proxy use falsely certifies the proxy. Chromium may also reorder subsequent candidate lists to begin with `DIRECT`.

## Decision

The diagnostic reports `fallback` when the resolved candidate list contains both `DIRECT` and another candidate, regardless of order. The localized result describes automatic proxy/direct fallback routing. Success means the fixed destination was reached; it does not confirm which candidate carried the request. Direct-only and proxy-only results retain their existing labels.

## Alternatives considered

- Checking only the first candidate misses fallback during the request and Chromium's reordered candidate lists.
- Resolving again after the request still returns candidates rather than proof of the transport used.
- Capturing Chromium network logs would add recording lifecycle and sensitive-data handling to a small diagnostic; the result can instead state its uncertainty explicitly.

## Consequences

Mixed candidate lists intentionally retain routing uncertainty, even when the proxy works. Certifying the actual transport would require additional network instrumentation.

## Verification

- Regression — The ProxyService tests cover both mixed-candidate orders, whitespace/case normalization, multiple proxies with direct fallback, direct-only PAC, and proxy-only lists. The renderer test checks the fallback-specific description. Real Electron verification injects PAC configuration only into the isolated diagnostic session and exercises an unreachable proxy followed by direct fallback; it does not claim to validate OS-specific PAC discovery.
