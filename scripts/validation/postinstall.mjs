import { execSync } from 'node:child_process'

if (process.env.VALIDATION_SKIP_WORKSPACE_BUILD !== 'true') {
  execSync(
    'pnpm run build:agent-runtimes && pnpm --filter @cherrystudio/remote-protocol build && pnpm --filter @cherrystudio/remote-transport build && pnpm --filter @cherrystudio/system-speech build',
    { stdio: 'inherit' }
  )
}
