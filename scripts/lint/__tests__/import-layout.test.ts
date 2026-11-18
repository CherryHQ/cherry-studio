import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const binary = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint')
const config = fileURLToPath(new URL('../../../.oxlintrc.json', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'cherry-import-layout-'))
const blockRule = 'import-layout(no-block-comments-between-imports)'

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function lint(source: string, filename = 'probe.ts') {
  const file = join(directory, filename)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, source)
  const result = spawnSync(process.execPath, [binary, '--config', config, '--format', 'json', file], {
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  return { status: result.status, ...JSON.parse(result.stdout) }
}

describe('import layout in the Oxlint gate', () => {
  it.each(['/* section */', '/** file documentation */', '/* first */\n// second'])(
    'rejects %s between imports',
    (comment) => {
      const result = lint(`import 'a';\n${comment}\nimport 'b';`)
      expect(result.status).toBe(1)
      expect(result.diagnostics).toMatchObject([{ code: blockRule, severity: 'error' }])
      expect(result.diagnostics).toHaveLength(1)
    }
  )

  it.each([
    "/** file documentation */\nimport 'a'; import 'b';",
    "import 'a';\n// explanation\nimport 'b';",
    "import 'a';\n/** exported API */\nexport const value = 1;",
    "import { /* specifier */ value } from 'a'; import 'b'; export { value };",
    "'use client'; import 'a'; export const value = 1;"
  ])('preserves allowed comments and directives: %s', (source) => {
    expect(lint(source).diagnostics).toEqual([])
  })

  it.each(["export { value } from 'a';", 'export const value = 1;', 'export default 1;', 'run();'])(
    'rejects imports after %s',
    (statement) => {
      const result = lint(`${statement}\nimport 'b';`)
      expect(result.status).toBe(1)
      expect(result.diagnostics).toMatchObject([{ code: 'import(first)', severity: 'error' }])
    }
  )

  it('checks type imports', () => {
    const result = lint(
      "import type { A } from 'a';\n/** misplaced */\nimport type { B } from 'b';\nexport type C = A & B;"
    )
    expect(result.diagnostics).toMatchObject([{ code: blockRule }])
  })

  it.each(['probe.test.ts', 'probe.test.tsx', 'probe.spec.ts', '__tests__/probe.ts'])(
    'exempts test import ordering but still checks comments: %s',
    (filename) => {
      expect(lint("setup(); import 'a';", filename).diagnostics).toEqual([])
      expect(lint("setup(); import 'a'; /* misplaced */ import 'b';", filename).diagnostics).toMatchObject([
        { code: blockRule }
      ])
    }
  )
})
