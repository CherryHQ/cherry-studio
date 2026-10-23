/**
 * The Cherry-owned agent MCP server identities. Which of them a session mounts is the runtime's
 * call. Every consumer is main-process (the policy registry, and the data layer reserving these
 * keys when it mirrors the runtime's server-key allocation), so the declaration lives in main —
 * the tool-approval registry re-exports it as the policy-side consumer.
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
