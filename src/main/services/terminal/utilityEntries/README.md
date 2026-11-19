# Terminal Host runtime

Child-safe modules own the conversation's processes, bounded capture, operation receipts, and VT state. They import neither the Main application container nor lifecycle services. `terminalHostEntry.ts` is the production entry; tests import the kernel and backend directly.

`ManagedProcess` launches the native scope helper under either pipe stdio or node-pty. A scope starts only after its UUID-checked `ready` frame and Host acknowledgement. PTY input uses the patched public `writeAsync()` API so pending writes remain bounded and write failures remain observable. Stop targets the live private scope connection, never a remembered PID or node-pty's PID-based kill method.

Command exit and helper exit are separate facts. Only a scope-empty event followed by helper/stdio closure confirms cleanup. A failed or timed-out close retains the connection and resource for safe retry. Observation cancellation does not close resources.

Terminal-generated replies coalesce in a bounded 64 KiB buffer and drain through the same two PTY write slots as user input. A burst of capability queries waits for capacity instead of closing the terminal. Replies are produced by the Host even when no view is attached.
