import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dirname, '..')
const nativePath = join(packageRoot, 'native')

if (process.platform !== 'darwin') {
  throw new Error('The Apple system speech helper can only be built on macOS')
}

const speechSwiftTriple =
  process.arch === 'arm64' ? 'arm64-apple-macosx13.0' : process.arch === 'x64' ? 'x86_64-apple-macosx13.0' : undefined

if (!speechSwiftTriple) {
  throw new Error(`Unsupported macOS architecture: ${process.arch}`)
}

const buildArguments = ['swift', 'build', '--package-path', nativePath, '-c', 'release', '--triple', speechSwiftTriple]

const build = spawnSync('xcrun', buildArguments, { stdio: 'inherit' })
if (build.status !== 0) {
  throw new Error(`Swift helper build failed with exit code ${build.status ?? 'unknown'}`)
}

const binPathResult = spawnSync('xcrun', [...buildArguments, '--show-bin-path'], { encoding: 'utf8' })
if (binPathResult.status !== 0) {
  throw new Error(binPathResult.stderr || 'Could not resolve the Swift helper output path')
}

const source = join(binPathResult.stdout.trim(), 'cherry-system-speech')
const destination = join(packageRoot, 'dist', 'native', `darwin-${process.arch}`, 'cherry-system-speech')
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
await chmod(destination, 0o755)
process.stdout.write(`${destination}\n`)
