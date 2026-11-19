# Agent terminal adapters

`TerminalTools` binds Pi and Pi Durable native call identities to one stable product conversation. Native child contexts receive separate revision-fenced leases in the same conversation Host. Runtime close releases those leases; it does not stop session-retained work. Claude Code and ACP are outside this adapter.

Native Bash/PowerShell calls remain fresh pipe processes with their exact executable, argv, cwd and full environment. Bash background start or promotion returns a typed running receipt for that same execution. A completed result waits for actual process exit and drained output. The original deadline survives promotion; cancellation of the old wait cannot stop the promoted task.

Persistent terminals use `terminal_open`, `terminal_send`, `terminal_read`, `terminal_list`, `terminal_signal` and `terminal_close`. Commands require a verified prompt revision; stdin requires an expected active command and program revision. Yielding cancels only the wait. `terminal_signal` sends terminal Ctrl-C to the expected foreground program without closing the shell. Busy or unknown state refuses new command submission. `shell_task_list`, `shell_task_read` and `shell_task_stop` address retained pipe executions.

Tool permission declarations live in `src/shared/ai/piBuiltinTools.ts`; approval facts are collected before execution. Host checks remain authoritative after an approval wait. A connection-local invocation index joins duplicate native calls and refuses conflicting identities. Main and Host maintain their own bounded operation receipts; none of these layers automatically replays a command after loss.

`ShellOutput` preserves stdout/stderr UTF-8 boundaries and the native Durable tool's full-output diagnostic file while bounding its in-memory prefix. Paths come from the central registry. See the [process owner](../../../services/terminal/README.md) for cleanup, quotas and view ownership.
