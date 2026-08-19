/** Map a Git change scope to documentation frontmatter source prefixes. */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { collectChangeScope } from './change-scope.mjs'

function normalize(value) {
  return value.replaceAll('\\', '/').replace(/\/$/u, '')
}

export function findAffectedDocs(index, changedPaths) {
  if (index?.version !== 1 || !Array.isArray(index.documents))
    throw new Error('docs/sources-index.json has an unsupported schema')
  const changed = [...new Set(changedPaths.map(normalize))].sort()
  return index.documents
    .map((document) => {
      if (typeof document.path !== 'string' || !Array.isArray(document.sources))
        throw new Error('docs/sources-index.json is malformed')
      const sources = document.sources.map(normalize)
      const matchedPaths = changed.filter((file) =>
        sources.some((source) => file === source || file.startsWith(`${source}/`))
      )
      return { document: document.path, sources: document.sources, matchedPaths }
    })
    .filter((document) => document.matchedPaths.length > 0)
    .sort((left, right) => left.document.localeCompare(right.document))
}

export function runAffectedDocs(args, cwd = process.cwd()) {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    strict: true,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      json: { type: 'boolean', default: false }
    }
  })
  if (!values.base) throw new Error('missing required --base <ref>')
  const scope = collectChangeScope({ base: values.base, head: values.head }, cwd)
  const paths = Object.values(scope.paths).flat()
  const indexPath = join(scope.repositoryRoot, 'docs/sources-index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const affected = findAffectedDocs(index, paths)
  if (values.json) return `${JSON.stringify({ scope: scope.resolved, documents: affected }, null, 2)}\n`
  if (!affected.length) return 'No documentation source prefixes matched the change scope.\n'
  return `${affected.map((item) => `${item.document}\n  ${item.matchedPaths.join('\n  ')}`).join('\n')}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(runAffectedDocs(process.argv.slice(2)))
  } catch (error) {
    process.stderr.write(`docs:affected: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
