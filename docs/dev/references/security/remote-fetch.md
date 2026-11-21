---
description: SSRF-safe rules for main-process fetches of untrusted URLs, with DNS pinning and private-address rejection
sources:
  - src/main/utils/remoteFetch.ts
  - src/main/utils/remoteUrlSafety.ts
---

# Remote Fetch Safety

Main-process direct URL fetches can receive renderer, assistant, or provider-controlled input. A literal URL check is not enough for these paths: an attacker-controlled hostname can resolve to a public address during preflight and then rebind to a private address when the network stack opens the connection.

## Direct Fetch Rule

Direct main-process fetches of untrusted HTTP(S) URLs must:

- reject non-HTTP(S) schemes and embedded credentials;
- reject localhost, private, carrier-grade NAT, link-local, multicast, broadcast, reserved, and
  unspecified literal IP targets, including the IPv4 address embedded in a NAT64 target;
- resolve hostname DNS results before opening the request;
- reject the request if no resolved address is usable;
- bind the actual connection to a prevalidated address while preserving the original `Host` header and TLS SNI;
- reject redirects by default;
- bound the response body before buffering it in the main process.

Two destinations look private but are not, and must stay allowed: `198.18.0.0/15`, where Clash/mihomo
TUN and Surge Enhanced Mode place the fake IPs they hand out for every domain, and the NAT64
well-known prefix, which is how IPv6-only networks address IPv4. Blocking them breaks every fetch for
proxy and IPv6-only users. Both exceptions are scoped to those exact prefixes — the rest of
`reserved`, and carrier-grade NAT (`100.64.0.0/10`, where Tailscale puts tailnet devices), stay
blocked.

## The `app.fetch.allow_private_network` Preference

`fetchRemoteText` reads this preference and passes it to `resolveRemoteFetchUrl` as
`allowPrivateNetwork`. When on — the default — both the literal and the DNS private-address
rejections are skipped, so `@cherry/fetch`, `web_fetch`, web search extraction, and citation previews
can reach `localhost`, a LAN NAS, or a proxy-only host. Every other rule above still applies: scheme
and credential validation, connection pinning, redirect limits, and the response size bound.

Turning it off restores the full guard.

`sanitizeRemoteUrl` takes the same flag as its third argument. Pass it wherever the literal guard
runs as a precheck in front of `fetchRemoteText` — citation preview does — otherwise the precheck
rejects a target the pinned fetch would have accepted, and the preference silently does nothing on
that path. Callers that guard a `net.fetch` of a provider-configured endpoint keep the default and
rely on `configuredApiHost` instead.

The preference governs what this app may connect to, never what may leave it. A guard in front of a
third-party service — the web-search Jina fetch fallback is the only one — always passes
`allowPrivateNetwork: false`, whatever the preference says. Such a guard is also weaker than a
pinned fetch: `resolveRemoteFetchUrl` returns the first non-blocked DNS answer because its caller
pins the connection to it, but a disclosure guard drops that address and sends the hostname. So a
hostname with both a public and a private answer passes, and under Clash/Surge fake-IP mode every
hostname resolves into `198.18.0.0/15` and passes. Both are accepted rather than closed: rejecting
the second would break the fallback for every fake-IP user. Literal private IPs and `localhost` are
rejected on every setup.

## Why Not `net.fetch`

Electron `net.fetch` uses Chromium's network stack and follows the app/session proxy configuration, but it does not expose a per-request DNS `lookup` hook. A preflight DNS check followed by `net.fetch(originalUrl)` is therefore still vulnerable to a DNS time-of-check/time-of-use gap.

For untrusted fetches, Cherry Studio uses a Node HTTP(S) request path that pins the connection to a validated DNS answer. Do not add a caller-specific `net.fetch` fallback, because that would reopen the DNS time-of-check/time-of-use gap.

The default helper path does not opt into Chromium session proxy routing. Citation previews still degrade to empty preview content on proxy-only networks while keeping the citation title and link usable. Callers needing app-proxy routing may explicitly set `respectAppProxy: true`, as blacklist subscriptions do.

## Bounded App-Proxy Fetches

With `respectAppProxy: true`, `ProxyService.getRemoteFetchProxy()` waits for the applied app policy. Custom mode uses the existing ordered bypass matcher; system mode asks Chromium to resolve the URL, including PAC routes. Proxy configuration or route-resolution errors reject the fetch rather than falling back to a direct request.

The helper validates and resolves the destination locally before opening any connection. HTTP(S) proxies receive a CONNECT request for that validated IP, including for plain HTTP destinations. SOCKS proxies also receive the IP, not the original hostname. The origin `Host`, TLS SNI and certificate identity remain tied to the original URL. A private address is rejected unless the existing private-network preference permits it. Every redirect repeats validation and route selection.

The internal `REMOTE_FETCH_OWNS_ROUTE` symbol prevents the global Node proxy wrapper from replacing this per-request agent or an explicitly bypassed direct route. The timeout covers route lookup and proxy handshakes as well as the response. Each request owns and destroys its proxy agent.

Compatibility limits are deliberate: the destination must resolve locally, HTTP proxies must allow CONNECT to the destination port, and only the first PAC candidate is used. A failed proxy never triggers an implicit direct fallback, even if PAC lists `DIRECT` later. Existing credentials are reused only for the matching configured proxy endpoint. Proxy authentication is sent on the tunnel handshake, not as an origin header.

## Which helper to use

- `fetchRemoteText(url, options)` is the full bounded-fetch boundary: URL validation, DNS resolution, address pinning, timeout, redirect policy, and response-size limit. `respectAppProxy: true` opts into the pinned app-proxy path above.
- `sanitizeRemoteUrl(url, configuredApiHost?)` is only a literal URL guard. It is useful when no network request is opened at that point or when validating a user-configured provider origin, including an explicitly matching loopback/private provider endpoint. It does not close DNS rebinding by itself and must not be followed by an unpinned direct fetch of attacker-controlled input.

## Redirects

Redirects are rejected by default. Callers may opt into a strict hop limit; every followed hop repeats URL validation, DNS resolution, private-address rejection, and pinned connection setup before opening the next request. Cross-origin redirects drop `Authorization`, `Cookie`, and `Proxy-Authorization` headers before the next hop.
