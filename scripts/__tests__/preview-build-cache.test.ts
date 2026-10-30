import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/preview-release.yml', 'utf8'))
const steps = workflow.jobs.build.steps
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'preview-cache-'))
  roots.push(root)
  return root
}

describe('incremental preview builds', () => {
  it.each([
    [false, true, true, false],
    [true, false, true, false],
    [true, true, false, false],
    [true, true, true, true]
  ])('selects a supported build only when opted in (%s, %s, %s)', (requested, script, runner, enabled) => {
    const root = fixture()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: script ? { 'build:release': 'node runner' } : {} })
    )
    if (runner) {
      mkdirSync(join(root, 'scripts/release'), { recursive: true })
      writeFileSync(join(root, 'scripts/release/build-app.js'), '')
    }
    const output = join(root, 'output')
    const step = steps.find((step: { id?: string }) => step.id === 'build-contract')
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], {
      cwd: root,
      env: { ...process.env, INCREMENTAL: String(requested), GITHUB_OUTPUT: output },
      encoding: 'utf8'
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(output, 'utf8').trim()).toBe(`enabled=${enabled}`)
  })

  for (const [name, platform] of [
    ['Linux', 'linux'],
    ['Mac', 'mac'],
    ['Windows', 'win']
  ]) {
    it.each([
      ['global', false],
      ['cn', false],
      ['global', true],
      ['cn', true]
    ])(
      `packages ${name} %s with caching %s without publishing or exposing cache credentials to packaging`,
      (edition, enabled) => {
        const root = fixture()
        const bin = join(root, 'bin')
        mkdirSync(bin)
        writeFileSync(join(bin, 'sudo'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
        writeFileSync(
          join(bin, 'pnpm'),
          `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('commands.jsonl', JSON.stringify({args, edition: process.env.CHERRY_EDITION,
  cacheKey: process.env.CHERRY_BUILD_CACHE_KEY || '', token: process.env.SENTRY_AUTH_TOKEN || ''}) + '\\n');
if (args[0] === 'build:release' && process.env.FAIL_COMPILATION === '1') process.exit(1);
`,
          { mode: 0o755 }
        )
        const step = steps.find((step: { name?: string }) => step.name === `Build ${name}`)
        const script = step.run.replace(
          /\$\{\{ matrix.edition == 'cn' && '([^']*)' \|\| '([^']*)' \}\}/g,
          (_match: string, cn: string, global: string) => (edition === 'cn' ? cn : global)
        )
        const run = (fail = false) =>
          spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
            cwd: root,
            env: {
              ...process.env,
              PATH: `${bin}${delimiter}${process.env.PATH}`,
              CHERRY_EDITION: String(edition),
              PREVIEW_INCREMENTAL: String(enabled),
              CHERRY_BUILD_CACHE_KEY: enabled ? 'test-cache-key' : '',
              SENTRY_AUTH_TOKEN: 'test-token',
              FAIL_COMPILATION: fail ? '1' : '0'
            },
            encoding: 'utf8'
          })
        const result = run()
        expect(result.status, result.stderr).toBe(0)
        const commands = readFileSync(join(root, 'commands.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        if (enabled) {
          expect(commands).toEqual([
            { args: ['build:release'], edition, cacheKey: 'test-cache-key', token: 'test-token' },
            {
              args: [
                'exec',
                'electron-builder',
                `--${platform}`,
                '--x64',
                '--arm64',
                ...(edition === 'cn' ? ['--config', 'electron-builder.cn.config.cjs'] : []),
                '--publish',
                'never'
              ],
              edition,
              cacheKey: '',
              token: ''
            }
          ])
          rmSync(join(root, 'commands.jsonl'))
          expect(run(true).status).not.toBe(0)
          const failedCommands = readFileSync(join(root, 'commands.jsonl'), 'utf8')
          expect(failedCommands).not.toContain('electron-builder')
        } else {
          expect(commands).toEqual([
            {
              args: [`build:${platform}${edition === 'cn' ? ':cn' : ''}`, '--publish', 'never'],
              edition,
              cacheKey: '',
              token: 'test-token'
            }
          ])
        }
      }
    )
  }

  it('keeps validation, opt-in credentials, isolated caches and timing reports outside installer uploads', () => {
    expect(workflow.on.workflow_dispatch.inputs.incremental.default).toBe(false)
    const validation = steps.find((step: { name?: string }) => step.name === 'Validate incremental preview types')
    expect(validation.if).toBe("steps.build-contract.outputs.enabled == 'true'")
    expect(validation.run).toBe('pnpm typecheck')
    expect(steps.indexOf(validation)).toBeLessThan(
      steps.findIndex((step: { name?: string }) => step.name === 'Build Linux')
    )
    expect(workflow.jobs.build.env).toMatchObject({
      CHERRY_EDITION: '${{ matrix.edition }}',
      RELEASE_SHA: '${{ needs.resolve.outputs.source_sha }}',
      ENCRYPTED_CACHE_ENABLED: "${{ inputs.incremental && secrets.RELEASE_BUILD_CACHE_KEY != '' }}"
    })
    expect(workflow.jobs.build.env).not.toHaveProperty('CHERRY_BUILD_CACHE_KEY')
    const cacheSteps = steps.filter((step: { uses?: string }) =>
      /actions\/cache\/(restore|save)@/.test(step.uses ?? '')
    )
    expect(cacheSteps).toHaveLength(4)
    for (const step of cacheSteps) {
      expect(step.if).toContain("steps.build-contract.outputs.enabled == 'true'")
      expect(step['continue-on-error']).toBe(true)
      expect(step.with.key).toMatch(/^preview-(release-build|js-encrypted)-v1-/)
      expect(step.with.key).toContain('${{ runner.os }}-${{ runner.arch }}-${{ matrix.edition }}')
      if (step.with.path.endsWith('-encrypted')) expect(step.if).toContain("env.ENCRYPTED_CACHE_ENABLED == 'true'")
      const counterpart = cacheSteps.find(
        (other: { with: { path: string }; uses: string }) =>
          other.with.path === step.with.path && other.uses !== step.uses
      )
      expect(counterpart.with.key).toBe(step.with.key)
    }
    for (const step of steps.filter((step: { name?: string }) => step.name?.startsWith('Build '))) {
      expect(step.env.CHERRY_BUILD_CACHE_KEY).toBe(
        "${{ steps.build-contract.outputs.enabled == 'true' && secrets.RELEASE_BUILD_CACHE_KEY || '' }}"
      )
    }
    const timings = steps.find((step: { name?: string }) => step.name === 'Upload preview build timings')
    expect(timings.if).toBe("always() && steps.build-contract.outputs.enabled == 'true'")
    expect(timings.with.path).toBe('.cache/release-build-metrics/')
  })
})
