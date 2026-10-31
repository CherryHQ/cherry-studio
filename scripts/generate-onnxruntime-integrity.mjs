/**
 * Offline ONNX Runtime integrity table generator. From the repository root:
 * curl --fail --location https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.25.1.tgz --output /tmp/ort-1.25.1.tgz
 * node --import tsx scripts/generate-onnxruntime-integrity.mjs --tarball /tmp/ort-1.25.1.tgz > src/main/ai/localModel/catalog/onnxRuntimeIntegrity.json
 * node --import tsx scripts/generate-onnxruntime-integrity.mjs --check src/main/ai/localModel/catalog/onnxRuntimeIntegrity.json --tarball /tmp/ort-1.25.1.tgz
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

import { t as listTar } from 'tar'
import { tsImport } from 'tsx/esm/api'

const { values } = parseArgs({ options: { tarball: { type: 'string' }, check: { type: 'string' } } })
if (!values.tarball) throw new Error('Usage: --tarball <archive.tgz> [--check <committed.json>]')
const catalog = await tsImport('../src/main/ai/localModel/catalog/catalog.ts', {
  parentURL: import.meta.url,
  tsconfig: new URL('../tsconfig.node.json', import.meta.url).pathname
})
const artifact = (catalog.SHARED_ARTIFACTS ?? catalog.default.SHARED_ARTIFACTS)['onnxruntime-node']
const hash = createHash('sha256')
for await (const chunk of createReadStream(values.tarball)) hash.update(chunk)
const tarballSha256 = hash.digest('hex')
for (const platform of Object.values(artifact.platforms)) {
  if (platform.tarballSha256 !== tarballSha256)
    throw new Error(`Tarball SHA-256 mismatch: expected ${platform.tarballSha256}, received ${tarballSha256}`)
}
const platforms = {}
const members = new Map()
for (const [key, platform] of Object.entries(artifact.platforms)) {
  const files = {}
  platforms[key] = { files }
  for (const filename of [platform.entryFile, ...platform.supportFiles]) {
    const member = platform.tarballPrefix + filename
    if (members.has(member)) throw new Error(`Duplicate catalog member: ${member}`)
    members.set(member, { files, filename, count: 0 })
  }
}
const pending = []
await listTar.asyncFile(
  {
    file: values.tarball,
    onReadEntry(entry) {
      const member = members.get(entry.path)
      if (!member) {
        entry.resume()
        return
      }
      member.count++
      if (member.count !== 1 || entry.type !== 'File') throw new Error(`Expected one regular file: ${entry.path}`)
      pending.push(
        new Promise((resolve, reject) => {
          const digest = createHash('sha256')
          let sizeBytes = 0
          entry.on('data', (chunk) => {
            sizeBytes += chunk.length
            digest.update(chunk)
          })
          entry.on('error', reject)
          entry.on('end', () => {
            member.files[member.filename] = { sizeBytes, sha256: digest.digest('hex') }
            resolve()
          })
        })
      )
    }
  },
  []
)
await Promise.all(pending)
for (const [name, member] of members) if (member.count !== 1) throw new Error(`Missing archive member: ${name}`)
function sorted(value) {
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])])
  )
}
const result = { artifact: artifact.id, version: artifact.version, tarballSha256, platforms }
if (values.check) {
  const committed = JSON.parse(await readFile(values.check, 'utf8'))
  const differences = []
  function compare(expected, actual, path = '') {
    if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
      for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)]))
        compare(expected[key], actual[key], path ? `${path}.${key}` : key)
    } else if (expected !== actual)
      differences.push(`${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
  compare(sorted(result), sorted(committed))
  if (differences.length) throw new Error(`Integrity table differs:\n${differences.join('\n')}`)
  process.stderr.write('ONNX Runtime integrity table matches the catalog and tarball.\n')
} else process.stdout.write(`${JSON.stringify(sorted(result), null, 2)}\n`)
