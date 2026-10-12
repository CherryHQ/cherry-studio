# Sandbox package

Independent `@cherrystudio/sandbox` package. The public macOS backend uses
`@microsoft/mxc-sdk@1.0.0`; the CLI and application callers share `SandboxManager`.
Node and Python guests can call registered host methods and receive host requests
through JSON-RPC 2.0 with Content-Length framing over standard input/output.

The 2026-10-12 acceptance decision prioritizes working sandbox execution and
bidirectional RPC. MXC's filesystem alias, local socket and process-group cleanup
semantics are accepted demo limitations, not startup blockers. There is no
unsandboxed fallback. Other platforms and Electron distribution remain future work.

See [current architecture](../../docs/sandbox/architecture.md) for process boundaries,
module responsibilities, RPC flow, and implemented versus deferred capabilities.

## Run

Requires Node 24+ and macOS 15+. The npm SDK includes its native library; normal
package builds do not require Rust or a self-written native supervisor.

```sh
pnpm install
pnpm --filter @cherrystudio/sandbox build
pnpm --filter @cherrystudio/sandbox demo
pnpm --filter @cherrystudio/sandbox demo:rpc
pnpm --filter @cherrystudio/sandbox demo:rpc --python
```

Both RPC demos compute `20 → host double(20) → guest add(1) → { value: 41 }`.
The Python example requires Xcode command-line tools' Python interpreter; its
location is resolved on the host, before sandbox launch. It implements the wire
format directly and does not install a Python SDK. These examples grant read access
to their runtime/dependency folders explicitly; adapt those grants for your target.

```text
CLI / caller → SandboxManager → MxcBackend → MXC SDK → Seatbelt target
                   ↕ stdio JSON-RPC ↔ guest
```

## CLI

```sh
pnpm --filter @cherrystudio/sandbox lab probe -- /usr/bin/true
pnpm --filter @cherrystudio/sandbox lab run -- /usr/bin/printf '%s\n' 'hello sandbox'
pnpm --filter @cherrystudio/sandbox lab run --read /absolute/directory -- /bin/cat /absolute/directory/file
```

`--read`, `--write`, `--deny-read`, `--deny-write` are repeatable. `--cwd` defaults
to `/` and does not grant access. `--timeout-ms` defaults to 10000. Paths must exist.
The public API takes an executable and argv; the adapter quotes each POSIX argument
before passing MXC its command string. The host environment is not inherited.

CLI `probe` returns the effective policy and limitations. `run` forwards streams
through the same public instance, reports completion on stderr, and returns the
command exit code. Limits return 124; unavailable/setup/I/O failures return 125;
interruption returns 128+signal. Use `node packages/sandbox/dist/src/cli/lab.js`
from the repository root to observe exact codes without pnpm's error wrapper.

## Host API and RPC

`new SandboxManager()` needs no supervisor path. Use `environmentId: native`,
`runtimeProfileId: mxc-command-v1`, and `network: { mode: deny }`.
The manager owns instances, cancellation, startup/lifetime deadlines and bounded
I/O. Start returns an instance with `ready`, `completion`, `stop` and `snapshot`.
`dispose()` stops all owned instances.

- `channel: none`: raw stdin/stdout/stderr; no RPC binding permitted.
- `channel: stdio`: requires a synchronous `configure(peer)` and asynchronous
  `authorize({ instanceId, ownerId, method, params })`. Identity comes from the
  host. RPC owns stdin/stdout, so those raw fields are null; stderr remains available.
- `peer.handle(name, handler)` registers an explicit method. `peer.request(name,
  objectParams, { timeoutMs?, signal? })` sends a request. Handlers validate their
  business inputs and results. Unknown methods and rejected authorization return
  JSON-RPC errors. Requests before instance readiness are rejected.
- The Node guest imports `createRpcPeer` from `@cherrystudio/sandbox/rpc` with its
  stdin/stdout streams. The peer uses `vscode-jsonrpc`, not a second protocol engine.

See [rpcHost.mjs](./examples/rpcHost.mjs), [rpcGuest.mjs](./examples/rpcGuest.mjs)
and [rpcGuest.py](./examples/rpcGuest.py) for runnable examples. Standard output is
reserved for protocol frames in RPC mode; use stderr for guest diagnostics.

This is a demo subset of the [API draft](../../docs/sandbox/api.md): request/handler
support, a five-second default request timeout, cancellation, disconnect settlement,
32 pending requests/active handlers, and a 32 KiB outbound parameter limit. Backend
output is cumulatively bounded (1 MiB by default). Dedicated channels, notifications,
version handshakes, schema-bound method types, and the draft's complete per-frame
validation/quotas are not implemented. The Python example handles one nested
callback at a time; it is an interoperability example, not a general guest SDK.

## Accepted backend semantics

- Directory grants are path-based. Existing hard links in a grant can access an
  outside object, including one denied under its original name.
- Writable directory grants allow Unix socket access there. Network deny blocks
  IP connectivity; it does not promise denial of every local service.
- Completion reports `tree: unverified` after MXC has stopped the target and
  released SDK ownership. Detached descendants may survive. `cleanup: complete`
  refers to adapter/SDK resource handling, not proof that the whole tree is gone.
  `tree: unknown` still indicates an operational stop failure and remains owned
  for a retry. CLI success does not require a stronger tree guarantee.
- Unsupported process/memory quotas, mount remapping, dedicated channels and
  network modes are rejected instead of being silently reported as enforced.
- `denyWrite` maps to MXC readonly paths and must lie within existing read/write
  grants. `denyRead` maps to fully denied paths (including writes).

These differences are disclosed in `policyPreview.limitations` / ready's effective
policy. They do not prevent `probe: ready` under the accepted demo scope. Backend
loading or launch failures still refuse execution; they never run an ordinary child
as a fallback.

## Tests

```sh
pnpm --filter @cherrystudio/sandbox test
pnpm --filter @cherrystudio/sandbox test:acceptance
pnpm --filter @cherrystudio/sandbox typecheck
```

Regression tests cover CLI/API consistency, literal argv, refusal of unsupported
requests, Node/Python callbacks, host authorization, RPC timeout and disconnect.
The black-box CLI acceptance suite compiles a small C fixture and verifies allowed
reads, writes visible to an existing host descriptor, and denied outside reads
with a positive control. It requires macOS and Xcode command-line tools; unavailable
backends fail acceptance explicitly, never pass by skipping target execution.

The self-written Seatbelt backend, supervisor, build script and their dedicated
tests have been removed. MXC is the only backend implementation in this package.

The [backend research](../../docs/sandbox/backend-options.md) preserves earlier
security findings. Its former stronger gates are historical research targets, not
blocking conditions for this MXC demo. No Windows/Linux or packaged Electron
acceptance is claimed by the macOS results.
