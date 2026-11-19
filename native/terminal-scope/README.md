# Terminal process scope

One small native supervisor belongs to each pipe or PTY resource; one Node utility TerminalHost still belongs to each conversation. The supervisor holds the OS identity through cleanup, separate from the command's exit status. Its private loopback connection is owned by the Host, not a terminal view.

The command does not execute until the Host acknowledges `ready` with `S`. `T` requests graceful termination and `K` requests force termination. Socket EOF also begins cleanup. JSON-line events carry the scope UUID, readiness, actual root exit evidence, and scope-empty confirmation. Command stdout/stderr remain on their original handles. The control socket is not inherited by the command.

On POSIX the supervisor pins the root PID with `waitid(WNOWAIT)` and its own session identity until cleanup. Signals target the pinned root's process group. Separate job-control groups are not killed by stored PIDs: the supervisor checks the whole session and retains an unconfirmed scope while members remain. In a PTY the shell receives the foreground group before execution, so interactive job control remains available.

On Windows the supervisor creates a non-breakaway Job Object with kill-on-close, creates the root suspended, assigns it to the Job, then waits for `S` before resuming. `TerminateJobObject` and Job accounting use the retained handle. Root exit never substitutes for zero active Job processes.

The helper is a cleanup mechanism for trusted local execution, not a sandbox. It cannot contain processes deliberately launched through an external daemon or OS service. Its presence and process/memory cost must be included in platform concurrency measurements.

`build.cjs` emits the target helper under `resources/binaries/<platform>-<arch>/terminal-scope[.exe]`. Development and utility builds prepare the host target; packaging prepares the requested target. No compiler is needed at application runtime.

Packaging also calls `prepareNodePty.cjs`. macOS and Windows use the pinned package's target prebuilds. Linux builds the N-API addon in a Debian Bullseye Node container, checks its ELF architecture, and ships it under the target prebuild directory. Linux packaging requires Docker and target-architecture container support. Host build directories are excluded so a cross-target package cannot prefer a host addon. Linux runtime and release-artifact compatibility still need verification.

The node-pty patch adds `writeAsync()` with success/error callbacks for completed native writes, rejects queued writes on disposal, and fixes prebuilt `spawn-helper` executable permissions during installation. It changes both source and shipped JavaScript. The public void `write()` API remains available.
