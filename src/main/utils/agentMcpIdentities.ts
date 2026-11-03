/**
 * The Cherry-owned agent MCP server identities. Which of them a session mounts is the runtime's
 * call. Both sides of the main-process split consume it — the AI policy registry and the data
 * layer reserving these keys when it mirrors the runtime's server-key allocation — so it lives
 * in `utils/`, the foundation both may depend down on (main-process.md §3); the tool-approval
 * registry re-exports it as the policy-side consumer.
 */
export const CHERRY_MCP_SERVER = {
  CHERRY_TOOLS: 'cherry-tools',
  BROWSER: 'browser',
  COMPUTER: 'computer',
  AUTOMATION: 'automation',
  AGENT_MEMORY: 'agent-memory',
  SKILLS: 'skills',
  MCP_MANAGER: 'mcp-manager',
  ASSISTANT: 'assistant',
  ASSISTANT_FILES: 'assistant-files',
  DOCTOR: 'doctor'
} as const
