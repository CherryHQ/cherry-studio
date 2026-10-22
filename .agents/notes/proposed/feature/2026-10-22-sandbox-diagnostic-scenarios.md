# Agent Note: Sandbox diagnostic scenarios

Status: proposed

English | [中文](2026-10-22-sandbox-diagnostic-scenarios.zh.md)

## Problem

The sandbox work in [PR #21006](https://github.com/CherryHQ/cherry-studio/pull/21006) provides a shared MXC-backed manager, bidirectional RPC and an Electron JavaScript console. Editable scripts alone cannot prepare independent file grants, register trusted host callbacks, coordinate instances or configure an enforced network allowlist. A failed connection is also insufficient evidence that a destination was blocked.

The requested UI must exercise file permissions, bidirectional RPC, instance management and network access through the same package that application callers use. This is a proposed extension to that work; it does not claim those scenarios already exist or that the foundation PR has merged.

## Proposal

### UI and result contract

Keep the existing About → Sandbox diagnostics entry and editable JavaScript console. Add four scenario groups with individual Run actions, Run all and Stop. Run all executes groups sequentially; the instance group owns its deliberate concurrent pair. Show each case's expected result, actual evidence and status: pending, running, passed, failed, unsupported, cancelled or inconclusive. Clear previous results when starting a new run. Do not turn an unavailable backend, timeout, empty response or skipped case into a pass.

Use a typed `sandbox.diagnose` command accepting only a fixed group identifier. Main supplies paths, executables, owner identity, callback methods, network policy and budgets. Renderer cannot supply a filesystem grant, arbitrary proxy endpoint, owner ID or host method. A group returns structured case results and bounded technical evidence; labels and status descriptions are translated in the renderer. Run all composes these commands in the UI without introducing a background job system. The existing `sandbox.stop` cancels the current owned group as well as a script run.

Allow at most one active script or diagnostic group per window, sharing the existing four-active-window budget. The instance group owns at most two sandbox roots; do not change the public UI into an unrestricted process launcher. Group execution, startup, RPC, local listener operations and cleanup all have finite deadlines. A group budget is at most 30 seconds; shutdown has a separate bounded cleanup period and cannot turn incomplete cleanup into success.

### Scenarios

| Group | Required cases | Evidence |
| --- | --- | --- |
| File permissions | Read/write inside an authorized workspace; read but reject writes in a read-only sibling; reject reads and writes in an ungranted sibling; reject a path-prefix sibling | Host-created fixtures with known contents, successful positive control, permission-specific failure, host verification that denied files remain unchanged; allowed writes visible through an existing host descriptor |
| Bidirectional RPC | Host → guest → host callback → guest result; unauthorized callback; two concurrent requests completing out of order; cancellation and recovery | Result 41 for the existing compute/double example, zero unauthorized host side effects, correctly correlated replies, cooperative cancellation observed, later request succeeds |
| Instance management | Start A and B with separate workspaces; exchange requests while both run; stop A and continue using B; stop all owned instances | Distinct IDs, A cannot read B's private fixture, A reaches terminal completion while B still answers, final owned roots exit and resources settle |
| Network | Allowlisted HTTP and HTTPS-through-CONNECT requests; unlisted hostname or port; HTTP redirect to an unlisted target; direct socket bypass; access after proxy loss | Two reachable host-owned targets, exact response markers, proxy decisions and destination request counts, no unexpected destination receives traffic, bounded failure after proxy closure |

File fixtures live only under an application-owned temporary root obtained through the path registry. Grant each child directory separately, never their common parent. Preserve direct access semantics; do not replace user grants with copies. Do not test against user documents or secrets. Existing hard-link limitations and `tree: unverified` remain explicit; neither is promoted to a stronger guarantee by these scenarios.

RPC uses the existing `createRpcPeer` and `vscode-jsonrpc` on both sides. Bundle a fixed guest entry with its protocol dependency as a build artifact staged into the run workspace; do not copy a development `node_modules`, depend on a global Python install or implement another framing engine. Register only diagnostic methods in Main, authorize using host-bound owner/instance identity, and drain stderr independently of the RPC channel.

The instance scenario uses the existing `SandboxManager` for both roots. Partial startup failure stops every successfully started sibling. Stop A must not dispose B's manager. Terminal root completion and adapter cleanup are reported separately from the unverified whole-process-tree claim.

### Network ownership and platform support

Implement the existing `network.mode: proxy` / exact `host + port` targets contract in the sandbox package rather than issuing a separate raw MXC request from diagnostics. The package owns an instance-scoped loopback proxy, supplies its endpoint to MXC, applies the destination allowlist and keeps direct egress denied. Start the proxy before the target, keep it bound while stopping the target, then release its listeners and connections. On proxy failure, revoke forwarding and stop the owned target; incomplete termination retains ownership for retry. Do not fall back to unrestricted networking or rely only on environment variables for confinement.

Use a maintained HTTP/CONNECT proxy implementation with explicit authorization hooks; select and verify its capabilities before adding a dependency. Match normalized exact host and port, including CONNECT authority, before forwarding. No wildcard domains or arbitrary TCP/UDP forwarding. Canonicalize DNS names, case, trailing dots, IDNA and IP literals consistently. Test alternate spellings and missing ports. Do not equate an IP address with an allowed hostname, or grant every service sharing that IP. Reauthorize every new proxy request; a redirect destination does not inherit the original grant. Discard caller-controlled proxy settings that could widen access.

The first UI fixture uses loopback targets and reserved test hostnames resolved by the fixture, avoiding public internet, external DNS and credentials. HTTPS uses a fixture certificate trusted only by the diagnostic client; never disable global TLS validation. The localhost exception is limited to fixture targets, not a blanket private-network permission for arbitrary hostnames. The general proxy path must define and test DNS resolution and private-address handling so a public name cannot silently rebind to an ungranted local service.

MXC's installed SDK exposes `network.runtimeConfig.networkProxy`, but schema availability is not proof of platform enforcement. Verify the installed SDK/native combination with actual traffic. On macOS, use deny-default egress and keep general host-loopback access denied. On Windows, gate the complete proxy policy on the supported BaseContainer host and its request-aware probe; do not assume the macOS mapping is portable or introduce Tier 3 setup. Until a platform passes allowed-access and bypass-denial checks, report the network group as unsupported with the reason. Linux remains unsupported by the current adapter. Never mark a platform's network acceptance complete based on another platform.

### Cleanup and delivery

Main owns diagnostic targets and fixture files. The sandbox package owns sandbox roots, RPC transports and its allowlist proxies. Stop, window destruction, partial setup failure and application shutdown all use the same ownership chain. Stop accepting proxy traffic before disposing its connections; retain files and report cleanup failure if a sandbox root may still access them. Repeated Stop is safe. Verify that ports and fixture resources are released before allowing another run to claim success.

Implement after exact-head Spec approval, using the sandbox foundation from PR #21006 as a prerequisite. Deliver package proxy support and fixed guest build support before Main's scenario runner and the UI results. Keep the existing uncommitted script-example work separate from this documentation-only Spec. No plugin architecture, Durable API, WSL, arbitrary host browsing or whole-process-tree containment is introduced.

## Alternatives considered

- Add more editable snippets only: insufficient for trusted callbacks, independent grants, simultaneous instances and proxy ownership.
- Exercise raw MXC calls directly from the UI harness: would validate a different launch and cleanup path from the application's package.
- Set HTTP_PROXY while allowing all egress: a raw socket could bypass the allowlist.
- Use public websites and treat connection failure as rejection: DNS, internet availability and remote outages cannot establish isolation.

## Acceptance criteria

- AC1 — The real Electron diagnostic UI runs each of the four groups and Run all, displays per-case outcomes and actual evidence, permits cancellation, and does not label unsupported, inconclusive or skipped work as passed. (verification: renderer + Electron)
- AC2 — Host-created file fixtures prove granted reads/writes, read-only protection, ungranted and path-prefix-sibling denial, unchanged denied files and immediate visibility of allowed writes. (verification: unit + Electron)
- AC3 — Real sandbox RPC returns 41 through a host callback, denies an unauthorized callback without side effects, correlates out-of-order responses and remains usable after cancellation. (verification: unit + Electron)
- AC4 — A and B run concurrently with separate grants; stopping A leaves B usable; Stop and partial startup failure settle all owned roots without claiming whole-tree termination. (verification: unit + Electron)
- AC5 — Proxy mode through the public manager permits the authorized HTTP/CONNECT targets and rejects unlisted hosts/ports, redirect destinations and direct bypass, with reachable positive controls and destination-side evidence. (verification: unit + Electron)
- AC6 — Proxy loss, cancellation, window destruction and shutdown stop owned targets, release or explicitly retain owned resources on incomplete cleanup, and allow a subsequent clean run without leaked listeners. (verification: unit + Electron)
- AC7 — Only fixed diagnostic group identifiers cross IPC; Main binds caller identity and enforces per-window, concurrency, duration and output budgets; UI cannot widen host capabilities. (verification: unit + renderer)
- AC8 — The UI and documentation state the actual platform/backend, policy and limitations; Windows native proxy acceptance uses supported Windows 11, and unsupported modes refuse execution without fallback. (verification: Electron + docs gate)

## Risks

- MXC's proxy capabilities differ by native build and Windows isolation tier. An upstream capability gap may block network acceptance on that platform; it must remain visible rather than be hidden by a looser policy.
- Proxy parsing, CONNECT, hostname normalization, DNS rebinding and private-network access form a new security boundary. Library reuse does not replace policy tests or native bypass tests.
- Electron guest bundling and native-library packaging may differ between development and installed artifacts. Development verification must not be reported as packaged acceptance.
- Cooperative RPC cancellation cannot forcibly interrupt an uncooperative handler, and current root cleanup cannot prove detached descendant termination.
