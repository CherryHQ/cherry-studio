# Remote Fetch Safety

Main-process direct URL fetches can receive renderer, assistant, or provider-controlled input. A literal URL check is not enough for these paths: an attacker-controlled hostname can resolve to a public address during preflight and then rebind to a private address when the network stack opens the connection.

## Direct Fetch Rule

Direct main-process fetches of untrusted HTTP(S) URLs must:

- reject non-HTTP(S) schemes and embedded credentials;
- reject localhost, private, link-local, multicast, broadcast, and unspecified literal IP targets,
  including the IPv4 address embedded in a NAT64 target;
- resolve hostname DNS results before opening the request;
- reject the request if no resolved address is usable;
- bind the actual connection to a prevalidated address while preserving the original `Host` header and TLS SNI;
- reject redirects by default;
- bound the response body before buffering it in the main process.

Reachable-but-unusual destinations are not private addresses and must stay allowed: proxy fake-IP
ranges (`198.18.0.0/15`, used by Clash/mihomo TUN and Surge Enhanced Mode), carrier-grade NAT
(`100.64.0.0/10`), and the NAT64 well-known prefix. Blocking them breaks every fetch for proxy and
IPv6-only users without denying access to any internal service.

## Why Not `net.fetch`

Electron `net.fetch` uses Chromium's network stack and follows the app/session proxy configuration, but it does not expose a per-request DNS `lookup` hook. A preflight DNS check followed by `net.fetch(originalUrl)` is therefore still vulnerable to a DNS time-of-check/time-of-use gap.

For direct untrusted fetches, Cherry Studio uses a Node HTTP(S) request path that pins the connection to a validated public DNS answer. This intentionally prioritizes SSRF protection over full Chromium session proxy compatibility for these direct-provider requests. Proxy-compatible fetching can be added later only if the connection guard remains enforced for the address that is actually used.

Callers migrating from `net.fetch` must treat this as a user-visible compatibility change: `fetchRemoteText` does not inherit Chromium session proxy settings. Do not add a caller-specific `net.fetch` fallback, because that would reopen the DNS time-of-check/time-of-use gap. Citation previews intentionally degrade to empty preview content on proxy-only networks while keeping the citation title and link usable.

## Redirects

Redirects are rejected by default. Callers may opt into a strict hop limit; every followed hop repeats URL validation, DNS resolution, private-address rejection, and pinned connection setup before opening the next request.
