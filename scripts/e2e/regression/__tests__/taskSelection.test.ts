import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { caseGrep, parseTaskSelection, resolveWorkflowTasks, selectCases } from '../cases'

describe('combined regression tasks', () => {
  it('isolates provider setup, prompt polishing and browser recovery from their broader modules', () => {
    expect(
      selectCases(parseTaskSelection('custom-provider-chat,polish-prompts,browser-recovery')).map(({ id }) => id)
    ).toEqual(['M-02', 'MP-16', 'MP-125'])
  })

  it('limits the added settings smoke to its existing test file', () => {
    const workflow = parse(readFileSync('.github/workflows/e2e-regression-test.yml', 'utf8'))
    const step = workflow.jobs.test.steps.find((step: { name: string }) => step.name === 'Run standalone smoke suite')
    const root = mkdtempSync(join(tmpdir(), 'cherry-smoke-selection-'))
    try {
      const cli = join(root, 'node_modules', '@playwright', 'test')
      mkdirSync(cli, { recursive: true })
      writeFileSync(join(cli, 'cli.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
      for (const scope of ['settings-search', 'all']) {
        const args = JSON.parse(
          execFileSync('bash', ['-e', '-c', step.run], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, GITHUB_WORKSPACE: root, RUN_DIR: root, SMOKE_SCOPE: scope }
          })
        ) as string[]
        expect(args.filter((arg) => arg.endsWith('.test.ts'))).toEqual(
          scope === 'settings-search' ? ['tests/e2e/smoke/settingsSearchKeepOpen.test.ts'] : []
        )
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes overlapping selections once in manifest order', () => {
    const selection = parseTaskSelection(' notes-smoke, startup-smoke ,notes-smoke ')
    expect(selectCases(selection).map(({ id }) => id)).toEqual(['S-01', 'N-01'])
    expect(selectCases(selection, 'basicFeatures').map(({ id }) => id)).toEqual(['N-01'])
    const grep = new RegExp(caseGrep(selection)!)
    expect(grep.test('[S-01] Application startup smoke test')).toBe(true)
    expect(grep.test('[N-01] Create and save a note')).toBe(true)
    expect(grep.test('[N-010] Different scenario')).toBe(false)
    expect(grep.test('[MP-11] Notes and export')).toBe(false)
  })

  it.each(['', 'notes,', 'unknown', 'notes,unknown', 'all,notes'])(
    'rejects invalid selection %j before allocating desktop runners',
    (value) => expect(() => parseTaskSelection(value)).toThrow()
  )

  it('uses selected modules and scopes additional smoke', () => {
    expect(resolveWorkflowTasks({ task: 'notes,browser', settings_search_smoke: true })).toEqual({
      task: 'notes,browser',
      prepare_mcp: 'false',
      smoke: 'settings-search'
    })
  })

  it('prepares Everything when it is part of a combined selection', () => {
    expect(resolveWorkflowTasks({ task: 'chat-core,mcp-skills' })).toEqual({
      task: 'chat-core,mcp-skills',
      prepare_mcp: 'true',
      smoke: 'none'
    })
  })

  it('preserves scheduled full runs and legacy focused tasks', () => {
    expect(resolveWorkflowTasks({})).toEqual({ task: 'all', prepare_mcp: 'true', smoke: 'all' })
    expect(resolveWorkflowTasks({ task: 'notes-smoke' })).toEqual({
      task: 'notes-smoke',
      prepare_mcp: 'false',
      smoke: 'none'
    })
  })
})
