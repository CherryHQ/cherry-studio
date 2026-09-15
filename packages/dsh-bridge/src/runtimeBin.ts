import { boot, FAIL_LOUD_RELEASE_TIMEOUT_MS, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const name = 'cherry-dsh-runtime'
const configPath = process.env.CHERRY_DSH_CONFIG
if (!configPath) throw new Error('A Cherry DSH composition path is required')

let booting: ReturnType<typeof boot> | null = null
let exiting = false

async function release(): Promise<void> {
  const ctx = await booting?.catch(() => undefined)
  await ctx?.fiber.dispose()
}

async function disposeAndExit(code: number): Promise<void> {
  if (exiting) return
  exiting = true
  const timeout = setTimeout(() => process.exit(code), FAIL_LOUD_RELEASE_TIMEOUT_MS)
  try {
    await release()
  } finally {
    clearTimeout(timeout)
    process.exit(code)
  }
}

installFailLoud(name, process, release)
process.stdin.on('end', () => void disposeAndExit(0))
process.on('SIGTERM', () => void disposeAndExit(0))
process.on('SIGINT', () => void disposeAndExit(130))

booting = boot(name, resolveConfigPath(configPath, undefined))
await booting
process.stdin.resume()
