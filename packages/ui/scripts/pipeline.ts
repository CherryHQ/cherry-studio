/**
 * Icon Pipeline — orchestrates the full icon generation workflow
 *
 * Steps:
 *   1. Vectorize  — convert PNG/JPG to SVG (skipped if no raster files or --skip-vectorize)
 *   2. Validate   — check SVG quality (exits on errors)
 *   3. Normalize  — normalize SVG viewBox dimensions to 32x32
 *   4. Generate   — create color React components from SVGs
 *   5. Mono       — create mono React components + compound exports
 *
 * Usage:
 *   tsx scripts/pipeline.ts --dir=providers
 *   tsx scripts/pipeline.ts --dir=models --skip-vectorize
 *   tsx scripts/pipeline.ts --dir=providers --force
 */
import { spawn } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

type SourceDir = 'providers' | 'models'

interface PipelineArgs {
  dir: SourceDir
  skipVectorize: boolean
  force: boolean
}

interface StepResult {
  name: string
  command: string
  status: 'success' | 'skipped' | 'failed'
  durationMs: number
  exitCode?: number
}

function parseArgs(): PipelineArgs {
  const args = process.argv.slice(2)
  let dir: SourceDir | undefined
  let skipVectorize = false
  let force = false

  for (const arg of args) {
    if (arg.startsWith('--dir=')) {
      const value = arg.split('=')[1]
      if (value === 'providers' || value === 'models') {
        dir = value
      } else {
        console.error(`Invalid --dir value: ${value}. Use "providers" or "models".`)
        process.exit(1)
      }
    } else if (arg === '--skip-vectorize') {
      skipVectorize = true
    } else if (arg === '--force') {
      force = true
    }
  }

  if (!dir) {
    console.error('Usage: tsx scripts/pipeline.ts --dir=providers|models [--skip-vectorize] [--force]')
    process.exit(1)
  }

  return { dir, skipVectorize, force }
}

/**
 * Check if a directory contains any raster files (PNG/JPG/JPEG).
 */
async function hasRasterFiles(dir: string): Promise<boolean> {
  const rasterExts = new Set(['.png', '.jpg', '.jpeg'])
  try {
    const entries = await fs.readdir(dir)
    return entries.some((f) => rasterExts.has(path.extname(f).toLowerCase()))
  } catch {
    return false
  }
}

/**
 * Run a command as a child process, streaming stdout/stderr.
 * Returns the exit code.
 */
function runStep(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false
    })

    child.on('error', reject)
    child.on('close', (code) => resolve(code ?? 1))
  })
}

async function main() {
  const { dir, skipVectorize, force } = parseArgs()
  const uiRoot = path.join(__dirname, '..')
  const iconsDir = path.join(uiRoot, 'icons', dir)

  console.log(`\n========================================`)
  console.log(`  Icon Pipeline: ${dir}`)
  console.log(`========================================\n`)

  const results: StepResult[] = []

  const steps: Array<{
    name: string
    args: string[]
    skip?: () => Promise<boolean> | boolean
    skipReason?: string
  }> = [
    {
      name: 'Vectorize',
      args: ['scripts/vectorize-logo.ts', `--dir=${dir}`],
      skip: async () => skipVectorize || !(await hasRasterFiles(iconsDir)),
      skipReason: skipVectorize ? '--skip-vectorize flag' : 'no raster files found'
    },
    {
      name: 'Validate',
      args: ['scripts/validate-svgs.ts', `--dir=${dir}`]
    },
    {
      name: 'Normalize',
      args: ['scripts/normalize-viewbox.ts', `--dir=${dir}`]
    },
    {
      name: 'Generate',
      args: ['scripts/generate-icons.ts', `--type=${dir}`, ...(force ? ['--force'] : [])]
    },
    {
      name: 'Mono',
      args: ['scripts/generate-mono-icons.ts', `--type=${dir}`]
    }
  ]

  const pipelineStart = Date.now()

  for (const step of steps) {
    const shouldSkip = step.skip ? await step.skip() : false

    if (shouldSkip) {
      const reason = step.skipReason || 'condition not met'
      console.log(`[${step.name}] Skipped (${reason})\n`)
      results.push({
        name: step.name,
        command: `tsx ${step.args.join(' ')}`,
        status: 'skipped',
        durationMs: 0
      })
      continue
    }

    const cmd = `tsx ${step.args.join(' ')}`
    console.log(`[${step.name}] Running: ${cmd}`)
    console.log('─'.repeat(50))

    const stepStart = Date.now()
    try {
      const exitCode = await runStep('tsx', step.args, uiRoot)
      const durationMs = Date.now() - stepStart

      if (exitCode !== 0) {
        console.log(`\n[${step.name}] Failed with exit code ${exitCode} (${durationMs}ms)\n`)
        results.push({ name: step.name, command: cmd, status: 'failed', durationMs, exitCode })
        break
      }

      console.log(`\n[${step.name}] Done (${durationMs}ms)\n`)
      results.push({ name: step.name, command: cmd, status: 'success', durationMs })
    } catch (error) {
      const durationMs = Date.now() - stepStart
      console.error(`\n[${step.name}] Error: ${error}\n`)
      results.push({ name: step.name, command: cmd, status: 'failed', durationMs, exitCode: 1 })
      break
    }
  }

  const totalMs = Date.now() - pipelineStart

  // Summary
  console.log('\n========================================')
  console.log('  Summary')
  console.log('========================================\n')

  const nameWidth = Math.max(...results.map((r) => r.name.length), 4)

  console.log(`  ${'Step'.padEnd(nameWidth)}  Status    Duration`)
  console.log(`  ${'─'.repeat(nameWidth)}  ────────  ────────`)

  for (const r of results) {
    const statusIcon = r.status === 'success' ? 'OK' : r.status === 'skipped' ? 'SKIP' : 'FAIL'
    const duration = r.status === 'skipped' ? '-' : `${r.durationMs}ms`
    console.log(`  ${r.name.padEnd(nameWidth)}  ${statusIcon.padEnd(8)}  ${duration}`)
  }

  console.log(`\n  Total: ${totalMs}ms`)

  const failed = results.some((r) => r.status === 'failed')
  if (failed) {
    console.log('\n  Pipeline failed. Fix the errors above and re-run.\n')
    process.exit(1)
  }

  console.log('\n  Pipeline completed successfully.\n')
}

main()
