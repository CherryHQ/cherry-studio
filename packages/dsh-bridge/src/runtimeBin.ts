import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'

const name = 'cherry-dsh-runtime'
const configPath = process.env.CHERRY_DSH_CONFIG
if (!configPath) throw new Error('A Cherry DSH composition path is required')

installFailLoud(name)
const ctx = await boot(name, resolveConfigPath(configPath, undefined))
let exiting = false

async function disposeAndExit(code: number): Promise<void> {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

process.stdin.on('end', () => void disposeAndExit(0))
process.on('SIGTERM', () => void disposeAndExit(0))
process.on('SIGINT', () => void disposeAndExit(130))
