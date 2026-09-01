import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

type OxlintDiagnostic = {
  code: string
  filename: string
  message: string
  severity: string
  labels: Array<{ span: { line: number } }>
}

type OxlintJson = {
  diagnostics: OxlintDiagnostic[]
}

const repoRoot = path.resolve(import.meta.dirname, '../../..')
const fixtureRoot = path.join(repoRoot, 'scripts/lint/__fixtures__')

describe('Cherry Studio Oxlint plugin fixtures', () => {
  it('accepts positive fixtures and snapshots every negative diagnostic', () => {
    const result = spawnSync(
      path.join(repoRoot, 'node_modules/.bin/oxlint'),
      [
        '-c',
        path.join(fixtureRoot, 'fixture.config.ts'),
        '--format',
        'json',
        '--threads=1',
        path.join(fixtureRoot, 'positive'),
        path.join(fixtureRoot, 'negative')
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    )

    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)

    const diagnostics = (JSON.parse(result.stdout) as OxlintJson).diagnostics
      .map((diagnostic) => ({
        file: path.relative(fixtureRoot, path.resolve(repoRoot, diagnostic.filename)),
        line: diagnostic.labels[0]?.span.line,
        rule: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message
      }))
      .sort((left, right) =>
        `${left.file}:${left.line}:${left.rule}`.localeCompare(`${right.file}:${right.line}:${right.rule}`)
      )

    expect(diagnostics.filter((diagnostic) => diagnostic.file.startsWith('positive/'))).toEqual([])
    expect(diagnostics).toMatchSnapshot()
  })
})
