const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { z } = require('zod')

const bundleSchema = z.object({
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
  edition: z.enum(['global', 'cn']),
  version: z.string().min(1),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
})

function inventory(directory) {
  const entries = []
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) walk(name)
      else if (entry.isFile()) {
        entries.push([
          name,
          createHash('sha256')
            .update(fs.readFileSync(path.join(directory, name)))
            .digest('hex')
        ])
      } else throw new Error(`Unsupported bundle entry: ${name}`)
    }
  }
  walk('')
  for (const part of ['main', 'preload', 'renderer', 'utility-process']) {
    if (!entries.some(([name]) => name.startsWith(`${part}/`))) throw new Error(`Missing bundle output: ${part}`)
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
}

function writeBundle({ directory, manifestPath, sourceSha, edition, version }) {
  const manifest = bundleSchema.parse({ sourceSha, edition, version, files: inventory(directory) })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

function verifyBundle({ directory, manifestPath, sourceSha, edition, version }) {
  const manifest = bundleSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  for (const [key, value] of Object.entries({ sourceSha, edition, version })) {
    if (manifest[key] !== value) throw new Error(`Release bundle ${key} mismatch`)
  }
  const files = inventory(directory)
  if (Object.keys(files).length !== Object.keys(manifest.files).length) throw new Error('Release bundle file mismatch')
  for (const [name, hash] of Object.entries(files)) {
    if (manifest.files[name] !== hash) throw new Error(`Release bundle checksum mismatch: ${name}`)
  }
}

function main() {
  const [command, edition] = process.argv.slice(2)
  if (!['build', 'verify'].includes(command) || !['global', 'cn'].includes(edition)) {
    throw new Error('Usage: node scripts/release/js-bundle.js <build|verify> <global|cn>')
  }
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (process.env.RELEASE_SHA && process.env.RELEASE_SHA !== sourceSha) throw new Error('Release source SHA mismatch')
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const options = { directory: 'out', manifestPath: 'release-bundle.json', sourceSha, edition, version }
  if (command === 'build') {
    fs.rmSync('out', { recursive: true, force: true })
    fs.rmSync(options.manifestPath, { force: true })
    const env = { ...process.env, CHERRY_EDITION: edition, CHERRY_RELEASE_JS_ONLY: 'true' }
    for (const args of [
      ['exec', 'electron-vite', 'build'],
      ['run', 'build:utility-process']
    ]) {
      execFileSync('pnpm', args, { env, stdio: 'inherit', shell: process.platform === 'win32' })
    }
    writeBundle(options)
  } else verifyBundle(options)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { writeBundle, verifyBundle }
