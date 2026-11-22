# Terminal Host runtime

Child-safe modules own the conversation's processes, bounded capture, operation receipts, and VT state. They import neither the Main application container nor lifecycle services. `terminalHostEntry.ts` is the production entry; tests import the kernel and backend directly.

`ManagedProcess` launches the native scope helper under either pipe stdio or node-pty. A scope starts only after its UUID-checked `ready` frame and Host acknowledgement. PTY input uses the patched public `writeAsync()` API so pending writes remain bounded and write failures remain observable. Stop targets the live private scope connection, never a remembered PID or node-pty's PID-based kill method.

Command exit and helper exit are separate facts. Only a scope-empty event followed by helper/stdio closure confirms cleanup. A failed or timed-out close retains the connection and resource for safe retry. Observation cancellation does not close resources.

`ShellIntegration` consumes bounded, chunk-safe, nonce-tagged private OSC frames from the Bash/zsh/PowerShell integrations. Prompt facts and command completion come from those frames, not output silence or process liveness. Invalid frames leave shell state unknown. The Bash script preserves prompt hooks and owns its DEBUG trap; custom shell integrations that replace these hooks can make command facts unavailable.

The Host owns one Ghostty core per PTY. View snapshots temporarily select their independent scroll position, then restore the core to the live bottom. Key, paste, mouse and wheel input is encoded against current terminal modes. Geometry epochs reject input captured before resize or alternate-screen changes. Views never write terminal-generated replies.

Terminal-generated replies coalesce in a bounded 64 KiB buffer and drain through the same two PTY write slots as user input. A burst of capability queries waits for capacity instead of closing the terminal. Replies are produced by the Host even when no view is attached.

`TerminalBlockIndex` owns per-PTY metadata and tracked anchors, not a transcript. `TerminalSearch` owns per-view query state under the Host's scheduler. Neither is a lifecycle service or another process. Main supplies only authorized view identities; native handles stay inside the Host. Frames freeze cells, block summaries, search projection and row mapping under one baseline. Renderer layout spans are accepted only for their native revision and geometry epoch.

The real shell integration fixture includes optional PowerShell coverage when `CHERRY_TEST_PWSH` supplies an absolute executable path. Its isolated home covers native failures, cmdlet failures, multiline Unicode metadata, duplicate Run again, interactive input and dirty-editor rejection alongside Bash/zsh.
