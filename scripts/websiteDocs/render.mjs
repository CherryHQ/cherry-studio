import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, watch } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { fetchRevision, git, overlayContent, repositories, sha } from './content.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const renderer = path.join(root, '.context/website-docs-renderer')
const source = path.join(root, 'docs/website')

export function runPnpm(args, { cwd = renderer, stdio = 'inherit', background = false } = {}) {
  // Reuse pnpm's entry point instead of launching a Windows .cmd shim through a shell.
  const executable = process.env.npm_execpath
  if (!executable) throw new Error('Run website documentation commands through pnpm')
  const isScript = /\.[cm]?js$/.test(executable)
  const command = isScript ? process.execPath : executable
  const commandArgs = isScript ? [executable, ...args] : args
  if (background) return spawn(command, commandArgs, { cwd, stdio })
  return execFileSync(command, commandArgs, { cwd, stdio })
}

export function assertIsolatedCheckout(directory) {
  const toplevel = git(directory, ['rev-parse', '--show-toplevel']).toString().trim()
  // Git emits forward slashes on Windows; compare the actual filesystem paths.
  if (realpathSync(toplevel) !== realpathSync(directory))
    throw new Error('Renderer directory is not an isolated checkout')
}

function generate() {
  overlayContent(source, path.join(renderer, 'docs-site'))
  runPnpm(['docs:generate'])
  const report = JSON.parse(readFileSync(path.join(renderer, 'docs-site/generated/report.json'), 'utf8'))
  if (report.issues.length) throw new Error(`Documentation generation reported ${report.issues.length} issues`)
}

export function prepareRenderer(install = true) {
  const config = JSON.parse(readFileSync(path.join(root, 'scripts/websiteDocs/config.json'), 'utf8'))
  const revision = sha(config.websiteRevision)
  mkdirSync(renderer, { recursive: true })
  if (!existsSync(path.join(renderer, '.git'))) git(renderer, ['init', '--quiet'])
  assertIsolatedCheckout(renderer)
  fetchRevision(renderer, `https://github.com/${repositories.website}.git`, revision)
  git(renderer, ['checkout', '--quiet', '--force', '--detach', revision])
  overlayContent(source, path.join(renderer, 'docs-site'))
  if (install) runPnpm(['install', '--frozen-lockfile'])
  return renderer
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { 'no-install': { type: 'boolean', default: false } }
    })
    const mode = positionals[0] ?? 'check'
    if (positionals.length > 1 || !['check', 'build', 'dev'].includes(mode)) throw new Error('Use check, build, or dev')
    prepareRenderer(!values['no-install'])
    generate()
    if (mode === 'dev') {
      const child = runPnpm(['exec', 'next', 'dev', '--port', '3001'], {
        cwd: path.join(renderer, 'docs-site'),
        background: true
      })
      let timer
      const watcher = watch(source, { recursive: true }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          try {
            generate()
          } catch (error) {
            process.stderr.write(`${error.message}\n`)
          }
        }, 250)
      })
      const cleanup = () => {
        watcher.close()
        clearTimeout(timer)
      }
      child.on('error', (error) => {
        cleanup()
        process.stderr.write(`${error.message}\n`)
        process.exitCode = 1
      })
      child.on('exit', (code) => {
        cleanup()
        process.exitCode = code ?? 1
      })
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => {
          cleanup()
          child.kill(signal)
        })
    } else {
      runPnpm(['docs:lint'])
      if (mode === 'build') {
        runPnpm(['docs:build'])
        for (const locale of ['zh-cn', 'en']) {
          if (!existsSync(path.join(renderer, 'docs-site/out', locale, 'index.html')))
            throw new Error(`Missing exported documentation: ${locale}`)
        }
      }
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
