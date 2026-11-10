/**
 * Main-process defaults for agent task runs. Kept out of the shared layer:
 * no renderer code consumes them, and shared modules are cross-process.
 */

/** Run timeout for an agent task turn (heartbeat and user tasks alike). */
export const DEFAULT_AGENT_TASK_TIMEOUT_MINUTES = 2
