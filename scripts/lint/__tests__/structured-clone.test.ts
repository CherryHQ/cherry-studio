import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const binary = join(dirname(require.resolve('oxlint/package.json')), 'bin/oxlint')
const config = fileURLToPath(new URL('../../../.oxlintrc.json', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'cherry-structured-clone-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function lint(source: string, filename = 'probe.ts') {
  const file = join(directory, filename)
  writeFileSync(file, source)
  const result = spawnSync(
    process.execPath,
    [binary, '--config', config, '--format', 'json', '--deny-warnings', file],
    {
      encoding: 'utf8'
    }
  )
  if (result.error) throw result.error
  return { status: result.status, ...JSON.parse(result.stdout) }
}

describe('structuredClone restrictions in the repository lint gate', () => {
  it.each(['structuredClone({})', 'structuredClone'])('rejects direct access: %s', (expression) => {
    const result = lint(`export const copy = ${expression}`)
    expect(result.status).toBe(1)
    expect(result.diagnostics).toMatchObject([{ code: 'eslint(no-restricted-globals)', severity: 'error' }])
  })

  it.each(['globalThis', 'window', 'self', 'global'])(
    'rejects qualified calls, aliases and destructuring through %s',
    (object) => {
      const result = lint(
        [
          `export const direct = ${object}.structuredClone({})`,
          `export const optional = ${object}?.structuredClone?.({})`,
          `export const computed = ${object}['structuredClone']({})`,
          `export const alias = ${object}.structuredClone`,
          `export const { structuredClone: destructured } = ${object}`
        ].join('\n')
      )
      expect(result.status).toBe(1)
      expect(result.diagnostics).toHaveLength(5)
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'eslint(no-restricted-properties)', severity: 'error' })
        ])
      )
    }
  )

  it('also rejects unannotated test fixtures', () => {
    expect(lint('export const fixture = structuredClone({})', 'probe.test.ts').status).toBe(1)
  })

  it('allows a justified exception without exempting the next call', () => {
    const result = lint(
      [
        '// oxlint-disable-next-line no-restricted-globals -- Isolate the small test fixture from mutation.',
        'export const allowed = structuredClone({})',
        'export const rejected = structuredClone({})'
      ].join('\n')
    )
    expect(result.status).toBe(1)
    expect(result.diagnostics).toMatchObject([
      { code: 'eslint(no-restricted-globals)', labels: [{ span: { line: 3 } }] }
    ])
    expect(
      lint(
        '// oxlint-disable-next-line no-restricted-properties -- Isolate the small test fixture from mutation.\nexport const copy = globalThis.structuredClone({})'
      ).status
    ).toBe(0)
  })

  it('allows local functions and unrelated methods with the same name', () => {
    expect(
      lint(
        'function structuredClone(value: string) { return value }\nconst local = { structuredClone }; export const value = local.structuredClone("text")'
      ).status
    ).toBe(0)
  })
})
