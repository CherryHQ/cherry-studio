import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../..')
const outputRoot = path.join(repoRoot, 'local', 'funasr-validation')
const appDir = path.join(outputRoot, 'app')
const timeoutMs = 10 * 60_000

interface Arguments {
  input: string
  userData: string
  offline: boolean
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  build(path.join(repoRoot, 'electron.vite.entries.config.ts'))
  build(path.join(__dirname, 'electron.vite.config.ts'))
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'funasr-validation', version: '0.0.0', main: 'out/main/index.js' }, null, 2)}\n`
  )

  const result = await runElectron(args)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function build(configPath: string): void {
  const electronVite = path.join(repoRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  const result = spawnSync(process.execPath, [electronVite, 'build', '--config', configPath, '--mode', 'production'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', FUNASR_VALIDATION_APP_DIR: appDir }
  })
  if (result.status !== 0) throw new Error(`Build failed for ${path.basename(configPath)}`)
}

function runElectron(args: Arguments): Promise<Record<string, unknown>> {
  const electronPath = require('electron') as string
  const appArguments = [
    appDir,
    '--input',
    args.input,
    '--user-data',
    args.userData,
    '--repo-root',
    repoRoot,
    ...(args.offline ? ['--offline'] : [])
  ]
  const executable = args.offline ? '/usr/bin/sandbox-exec' : electronPath
  const childArguments = args.offline
    ? [
        '-p',
        '(version 1) (allow default) (deny network*)',
        electronPath,
        '--no-sandbox',
        '--disable-gpu',
        ...appArguments
      ]
    : appArguments
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS

  return new Promise((resolve, reject) => {
    const child = spawn(executable, childArguments, { cwd: repoRoot, env: environment })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('FunASR validation timed out'))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Electron exited with code ${String(code)}`))
        return
      }
      try {
        const records = Buffer.concat(stdout)
          .toString('utf8')
          .split(/\r?\n/)
          .filter((line) => line.startsWith('{'))
          .map((line) => JSON.parse(line) as Record<string, unknown>)
        const metadata = records.at(-1)
        if (!metadata || metadata.transcriptNonEmpty !== true) throw new Error('Invalid validation result')
        resolve(metadata)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function parseArguments(argv: string[]): Arguments {
  const tokens = argv[0] === '--' ? argv.slice(1) : argv
  const values = new Map<string, string | true>()
  for (let index = 0; index < tokens.length; index += 1) {
    const name = tokens[index]
    if (!name?.startsWith('--') || values.has(name)) throw new Error('Invalid validation arguments')
    if (name === '--offline') {
      values.set(name, true)
      continue
    }
    const value = tokens[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
    values.set(name, value)
    index += 1
  }
  for (const name of values.keys()) {
    if (!['--input', '--user-data', '--offline'].includes(name)) throw new Error(`Unknown argument ${name}`)
  }
  const input = values.get('--input')
  const userData = values.get('--user-data')
  if (typeof input !== 'string' || typeof userData !== 'string') {
    throw new Error('Expected --input <wav> and --user-data <Cherry userData>')
  }
  return { input: path.resolve(input), userData: path.resolve(userData), offline: values.get('--offline') === true }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
