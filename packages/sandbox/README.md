# Sandbox package

Independent `@cherrystudio/sandbox` package. The public macOS and Windows backends use
`@microsoft/mxc-sdk@1.0.1`; the CLI and application callers share `SandboxManager`.
Node and Python guests can call registered host methods and receive host requests
through JSON-RPC 2.0 with Content-Length framing over standard input/output.

The 2026-10-12 acceptance decision prioritizes working sandbox execution and
bidirectional RPC. MXC's filesystem alias, local socket and process-group cleanup
semantics are accepted demo limitations, not startup blockers. There is no
unsandboxed fallback. Windows uses MXC ProcessContainer; Linux remains future work.
Windows explicit deny overrides are rejected
because MXC 1.0.0 did not enforce them in native tests.

See [current architecture](../../docs/sandbox/architecture.md) for process boundaries,
module responsibilities, RPC flow, and implemented versus deferred capabilities.

## Run

Requires the repository's Node 24.21+ (24.x) and macOS 15+ or Windows 11.
MXC officially supports Windows 11 24H2+; the local 23H2 test host is experimental
and is identified as such in the probe. The npm SDK includes its native library; normal
package builds do not require Rust or a self-written native supervisor.

```sh
pnpm install
pnpm --filter @cherrystudio/sandbox build
pnpm --filter @cherrystudio/sandbox demo
pnpm --filter @cherrystudio/sandbox demo:rpc
pnpm --filter @cherrystudio/sandbox demo:rpc --python
```

Both RPC demos compute `20 → host double(20) → guest add(1) → { value: 41 }`.
The Python example uses Xcode command-line tools on macOS or `python.exe` on
Windows. Set `SANDBOX_PYTHON` to an explicit interpreter path if needed. Its
location is resolved on the host, before sandbox launch. It implements the wire
format directly and does not install a Python SDK. These examples grant read access
to their runtime/dependency folders explicitly; adapt those grants for your target.
RPC examples stage guest files and `vscode-jsonrpc` in a temporary directory,
avoiding broad grants to the checkout and pnpm store. Windows Node guests use
`--preserve-symlinks --preserve-symlinks-main`: default Node realpath traversal
needs metadata access to ancestors outside the grants. This is an example runtime
configuration, not an implicit change to commands passed to the API or CLI.

Tier 3 AppContainer/DACL host preparation is a legacy experimental path. Cherry
does not maintain it or run it in CI; native acceptance targets Windows 11 with
BaseContainer. The retained setup command below documents the earlier 23H2
experiment and is not a prerequisite for the supported CI path:

```powershell
pnpm --filter @cherrystudio/sandbox setup:windows
$env:SANDBOX_PYTHON = 'C:\path\to\python.exe'
pnpm --filter @cherrystudio/sandbox demo:rpc --python
```

The setup script invokes the packaged MXC host-prep tool. It adds non-inheriting
metadata permissions at the system-drive root and prepares `\Device\Null`.
Null-device preparation must be repeated after each reboot. Probe reports
`setup-required` with administrator requirements when preparation is missing;
starting refuses execution until setup succeeds. No automatic elevation or
startup task is installed. See the [official host preparation guide](https://github.com/microsoft/mxc/blob/v1.0.0/docs/backends/process-container/host-prep.md).

Windows streams require Node 24.21+ (24.x) or 26.8+. This checkout uses Electron
44.9.3 with Node 24.22.0. Older embedded runtimes fail closed at probe/start.

## Application diagnostics

Open **Settings → About & Feedback → Sandbox diagnostics** to probe or run JavaScript
with the bundled Electron executable in Node mode. `SandboxService` owns the manager
through the application lifecycle. The typed `sandbox.probe`, `sandbox.run` and
`sandbox.stop` IPC routes expose a fixed policy: no network, an isolated temporary
write directory, runtime-file read grants, 30 seconds maximum and 64 KiB output.
The renderer cannot choose an executable, environment, owner or filesystem grants.
Only one run per managed window is allowed; stop affects that window's run.
Window destruction and application shutdown cancel active runs. Completed cleanup
removes temporary files; uncertain cleanup retains the directory and logs its path.
Source is staged as a CommonJS file inside the per-run workspace, keeping accepted
32,768-character scripts out of the Windows command line. The file follows workspace
cleanup: uncertain cleanup retains it with the workspace. Memory/process quotas are
not enforced by this adapter.

The package builds during installation. Rebuild it after editing sandbox source:
`pnpm --filter @cherrystudio/sandbox build`. Windows packaging unpacks the MXC SDK
and Koffi; the service supplies MXC's supported `MXC_FFI_DIR` override for native
loading outside ASAR. Python RPC remains available through the package examples;
the application diagnostics entry executes JavaScript only.

Electron 44.7 validates its installation directory ACL. A development checkout
inheriting package-specific AppContainer entries may need `ALL APPLICATION PACKAGES`
read/execute on **the Electron runtime directory**, as directed by Electron's fatal
startup diagnostic. This is separate from MXC host preparation, and the app does not
change installation ACLs automatically.

```text
CLI / caller → SandboxManager → MxcBackend → MXC SDK → Seatbelt / ProcessContainer target
                   ↕ stdio JSON-RPC ↔ guest
```

## CLI

```sh
pnpm --filter @cherrystudio/sandbox lab probe -- /usr/bin/true
pnpm --filter @cherrystudio/sandbox lab run -- /usr/bin/printf '%s\n' 'hello sandbox'
pnpm --filter @cherrystudio/sandbox lab run --read /absolute/directory -- /bin/cat /absolute/directory/file
```

`--read`, `--write`, `--deny-read`, `--deny-write` are repeatable. `--cwd` defaults
to the current drive root (`/` on macOS) and does not grant access. `--timeout-ms`
defaults to 10000. Paths must exist. Windows accepts local drive paths and rejects
UNC/device paths and alternate data streams. The public API takes an executable
and argv; the adapter uses POSIX quoting on macOS and Windows CRT quoting on
Windows, without a Windows command shell. The host environment is not inherited;
Windows supplies `SYSTEMROOT` and `LOCALAPPDATA` (cwd), overridable by explicit env.

```powershell
$node = (Get-Command node.exe).Source
pnpm --filter @cherrystudio/sandbox lab probe -- $node -e 'process.exit(0)'
pnpm --filter @cherrystudio/sandbox lab run -- $node -e 'process.stdout.write("hello sandbox")'
```

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
`dispose()` stops all owned instances. After target exit, stdout/stderr collection
continues through EOF and queue consumption, bounded by the smaller of
`ioDrainTimeoutMs` and `cleanupTimeoutMs`; SDK streams are disposed afterward.
When termination cannot be confirmed, bounded output cleanup still ends collection
with `OUTPUT_TRUNCATED`; the unresolved instance remains owned for a stop retry.
Early closure, output-budget drops, or drain deadline expiry produce
`OUTPUT_TRUNCATED`, even when no output remains buffered.

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

- On macOS, directory grants are path-based. Existing hard links in a grant can access an
  outside object, including one denied under its original name.
- On macOS, writable directory grants allow Unix socket access there. Network deny blocks
  IP connectivity; it does not promise denial of every local service.
- Completion reports `tree: unverified` after MXC has stopped the target and
  released SDK ownership. Detached descendants may survive. `cleanup: complete`
  refers to adapter/SDK resource handling, not proof that the whole tree is gone.
  `tree: unknown` still indicates an operational stop failure and remains owned
  for a retry. CLI success does not require a stronger tree guarantee.
- Unsupported process/memory quotas, mount remapping, dedicated channels and
  network modes are rejected instead of being silently reported as enforced.
- On macOS, `denyWrite` maps to MXC readonly paths and must lie within existing
  read/write grants. `denyRead` maps to fully denied paths (including writes).
- On Windows, all explicit `denyRead` / `denyWrite` overrides are rejected with
  `POLICY_UNSUPPORTED`. A native SDK reproduction read a denied file and wrote a
  readonly child under a writable parent. Use separate read-only and writable
  grants; do not rely on exceptions within writable grants until MXC is fixed.
- Windows AppContainer/DACL temporarily edits grant ACLs; stop releases SDK
  ownership and restores grant entries. System resources available to AppContainers
  remain accessible. Win32k calls are enabled for runtime DLL initialization;
  clipboard access and input injection are requested denied. UI isolation has not
  been independently tested; 23H2 lacks the newer Job input-injection limit.
  The Windows Job stopped a detached descendant in the local test, but the public
  completion still reports `tree: unverified`, not a general certification.

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
The black-box CLI acceptance suite uses a small C fixture on macOS and Node on
Windows. It verifies allowed
reads, writes visible to an existing host descriptor, and denied outside reads
with a positive control, denied writes, and refusal of unsupported Windows deny
overrides. Windows tests also cover loopback refusal against a reachable listener,
granted file access, host ACL preservation or restoration, and special-path
rejection. BaseContainer grants do not require host ACL mutations. Detached
descendant termination is outside the required demo acceptance contract;
`tree: unverified` remains unchanged. Subprocess launch and detached descendant
cleanup have not passed acceptance on the hosted BaseContainer runner.
macOS requires Xcode command-line tools. Windows CI uses GitHub's hosted
`windows-11-arm` runner and checks the actual BaseContainer tier before running
CLI, Node/Python RPC and boundary tests. Windows Server CI runs only the sandbox
contract tests and performs no host preparation. A failed native job blocks the
required CI gate; ARM64 results do not establish x64 acceptance.
Unavailable backends fail acceptance explicitly, never pass by skipping execution.

The self-written Seatbelt backend, supervisor, build script and their dedicated
tests have been removed. MXC is the only backend implementation in this package.

The [backend research](../../docs/sandbox/backend-options.md) preserves earlier
security findings. Its former stronger gates are historical research targets, not
blocking conditions for this MXC demo. Local Windows results are from Windows 11
23H2 x64, Node 24.21.0 and Python 3.13.1. Windows 24H2+, ARM64, Linux and packaged
Electron acceptance have not been performed on this host.
