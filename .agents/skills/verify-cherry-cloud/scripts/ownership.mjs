import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const printer = ts.createPrinter({ removeComments: true })
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : /\.[cm]?tsx?$/.test(entry.name) ? [path] : []
  })
}
function code(file) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  return printer.printFile(source)
}
const selectorFiles = files(join(root, 'src/renderer/components/ModelSelector'))
assert.ok(selectorFiles.length > 0, 'missing generic selector')
for (const file of selectorFiles) {
  assert.doesNotMatch(
    code(file),
    /CherryCloud|cherryCloud|cherry_cloud|CHERRY_CLOUD|isCherryAiGroup|selector_locked_row|settings\.subscription/,
    `${file}: Cloud policy leaked into the generic selector`
  )
}
assert.doesNotMatch(
  code(join(root, 'src/main/services/AnalyticsService.ts')),
  /cloud-api|CHERRY_CLOUD|CherryCloud|cherryCloud/,
  'generic analytics owns Cloud policy'
)
for (const file of files(join(root, 'src'))) {
  assert.doesNotMatch(
    code(file),
    /cherry_cloud\.(account_plans\.get|account_refreshed)/,
    `${file}: obsolete independent refresh path remains`
  )
}
for (const file of files(join(root, 'packages/agent-runtime-claude-code/src'))) {
  assert.doesNotMatch(
    code(file),
    /["']@(?:main|renderer|application|logger)(?:\/|["'])/,
    `${file}: portable native adapter imports product code`
  )
}
process.stdout.write(
  `Ownership boundaries pass for ${selectorFiles.length} generic selector files, analytics, refresh callers and the native adapter.\n`
)
