import type { AcpCliInstaller } from '@cherrystudio/agent-runtime-acp/profile'

import { kiroCli } from './cli'

export const kiroInstaller = {
  executable: kiroCli.executable,
  script(platform) {
    if (platform !== 'darwin' && platform !== 'linux') return undefined
    return {
      manager: 'script',
      command: 'bash',
      args: ['-o', 'pipefail', '-c', 'curl -fsSL https://cli.kiro.dev/install | bash']
    }
  },
  removal: { kind: 'file', identity: /\bkiro-cli\b/i }
} satisfies AcpCliInstaller
