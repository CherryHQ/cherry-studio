import type { SandboxSettings } from '@anthropic-ai/claude-agent-sdk'

import type { SandboxPolicy } from '@main/ai/toolApproval/sandboxPolicy'

/**
 * Translates a resolved sandbox policy into the Claude Agent SDK `sandbox` option. The session's
 * cwd, `additionalDirectories` and temp directory are writable by the SDK's own defaults.
 */
export function toClaudeCodeSandboxSettings(policy: SandboxPolicy): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    // Networked commands run only after an approved escape; `false` would make them fail outright.
    allowUnsandboxedCommands: true,
    network: {
      // Without it, Full Access silently allows unlisted hosts.
      strictAllowlist: true,
      allowedDomains: [...policy.allowedDomains],
      deniedDomains: [...policy.deniedDomains]
    },
    filesystem: { allowWrite: [...policy.writablePaths] }
  }
}
