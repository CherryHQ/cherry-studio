import type { CodexProcessHost } from '@cherrystudio/agent-runtime-codex/launcher'
import { isSensitiveKey, redactLiteral, redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

import { spawnLocalAgentStdio } from '../stdioProcess'

export const codexProcessHost: CodexProcessHost = {
  spawnStdio: spawnLocalAgentStdio,
  clientInfo: { name: 'cherry_studio', title: 'Cherry Studio', version: '1' },
  redactDiagnostic(text, env) {
    for (const [key, value] of Object.entries(env)) {
      if (value && isSensitiveKey(key)) text = redactLiteral(text, value)
    }
    return redactSecretTokens(redactSecretText(text))
  }
}
