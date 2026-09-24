import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const script = path.resolve(import.meta.dirname, '../release/sync-gitcode.sh')

describe('GitCode sync recovery', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gitcode-sync-'))
    mkdirSync(path.join(root, 'bin'))
    mkdirSync(path.join(root, 'release-assets'))
    for (const name of ['Global.exe', 'CN.exe', 'latest.yml', 'latest-cn.yml', 'release-history.json'])
      writeFileSync(path.join(root, 'release-assets', name), name)
    writeFileSync(path.join(root, 'release_body.txt'), 'English\n中文')
    const executable = (name: string, body: string) =>
      writeFileSync(path.join(root, 'bin', name), `#!${process.execPath}\n${body}`, { mode: 0o755 })
    executable(
      'gh',
      `process.stdout.write(process.argv.includes('view') ? JSON.stringify({name: 'v2.1.2', isDraft: process.env.DRAFT === 'true', isPrerelease: process.env.PRE === 'true'}) : 'v2.1.2')`
    )
    executable('sleep', '')
    executable(
      'curl',
      `
      const fs = require('node:fs')
      const args = process.argv.slice(2)
      const url = args.at(-1)
      const method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET'
      const data = args.includes('--data-binary') ? args[args.indexOf('--data-binary') + 1] : null
      const payload = data && data.includes('payload.json') ? JSON.parse(fs.readFileSync(data.slice(1), 'utf8')) : null
      fs.appendFileSync('requests.jsonl', JSON.stringify({url, method, data, payload}) + '\\n')
      if (url.includes('/tags/')) {
        fs.writeFileSync(args[args.indexOf('-o') + 1], '{}')
        process.stdout.write(process.env.LOOKUP_STATUS || '404')
      } else if (url.includes('/upload_url?')) {
        process.stdout.write(JSON.stringify({url: 'https://upload.test/' + url.split('file_name=')[1], headers: {'Content-Type': 'application/octet-stream'}}))
      } else if (method === 'PUT' && process.env.FAIL_UPLOAD === 'true') {
        process.exit(22)
      } else if (method === 'PUT' && process.env.RETRY_UPLOAD === 'true' && !fs.existsSync('failed-once')) {
        fs.writeFileSync('failed-once', '1')
        process.exit(22)
      } else process.stdout.write('{}')
    `
    )
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function run(env: Record<string, string> = {}) {
    return spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${path.join(root, 'bin')}:${process.env.PATH}`,
        TAG: 'v2.1.2',
        GH_REPO: 'CherryHQ/cherry-studio',
        GITCODE_OWNER: 'owner',
        GITCODE_REPO: 'repo',
        GITCODE_TOKEN: 'test-token',
        ...env
      }
    })
  }
  function requests() {
    return readFileSync(path.join(root, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }

  it('dry-runs the complete payload without making any GitCode request', () => {
    const result = run({ DRY_RUN: 'true', GITCODE_TOKEN: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('CN.exe')
    expect(result.stdout).toContain('latest-cn.yml')
    expect(result.stdout).toContain('中文')
    expect(existsSync(path.join(root, 'requests.jsonl'))).toBe(false)
  })

  it.each(['404', '200'])(
    'creates or resumes a release after lookup HTTP %s and uploads packages before manifests',
    (status) => {
      const result = run({ LOOKUP_STATUS: status, RETRY_UPLOAD: 'true' })
      expect(result.status, result.stderr).toBe(0)
      const calls = requests()
      const mutation = calls.find((call) => ['POST', 'PATCH'].includes(call.method))
      expect(mutation.method).toBe(status === '404' ? 'POST' : 'PATCH')
      expect(mutation.payload.release_status).toBe('latest')
      const uploads = calls.filter((call) => call.method === 'PUT').map((call) => path.basename(call.data))
      expect(uploads).toEqual(['CN.exe', 'CN.exe', 'Global.exe', 'latest-cn.yml', 'latest.yml', 'release-history.json'])
    }
  )

  it('keeps prereleases from becoming latest', () => {
    const result = run({ PRE: 'true' })
    expect(result.status, result.stderr).toBe(0)
    expect(requests().find((call) => call.method === 'POST').payload.release_status).toBe('pre')
  })

  it('stops on lookup errors and never mistakes an authentication failure for a missing release', () => {
    expect(run({ LOOKUP_STATUS: '403' }).status).not.toBe(0)
    expect(requests().map((call) => call.method)).toEqual(['GET'])
  })

  it('stops after three upload failures without uploading update pointers', () => {
    expect(run({ FAIL_UPLOAD: 'true' }).status).not.toBe(0)
    const uploads = requests().filter((call) => call.method === 'PUT')
    expect(uploads).toHaveLength(3)
    expect(uploads.every((call) => call.data.endsWith('.exe'))).toBe(true)
  })

  it('rejects drafts before contacting GitCode', () => {
    expect(run({ DRAFT: 'true' }).status).not.toBe(0)
    expect(existsSync(path.join(root, 'requests.jsonl'))).toBe(false)
  })
})

it('gates mirroring on publication and keeps CN files out of the GitHub upload directory', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))
  const sync = workflow.jobs['sync-to-gitcode']
  expect(sync.needs).toContain('publish')
  expect(sync.if).toContain("needs.publish.result == 'success'")
  expect(sync.if).toContain("inputs.mode == 'sync-only'")
  expect(workflow.jobs.notify.if).toContain("!(inputs.mode == 'sync-only' && inputs.dry_run)")
  expect(workflow.jobs.release['runs-on']).toContain('windows-signing')
  const windows = workflow.jobs.release.steps.find((step: { name: string }) => step.name === 'Build Windows')
  expect(windows.env.WIN_SIGN).toBe(true)
  const finalize = workflow.jobs['finalize-build']
  const upload = finalize.steps.find((step: { name: string }) => step.name === 'Create or update draft release')
  expect(upload.with.artifacts).toBe('github-release-artifacts/*')
  const archive = finalize.steps.find(
    (step: { name: string }) => step.name === 'Preserve complete dual-edition archive'
  )
  expect(archive.with['retention-days']).toBe(90)
  expect(sync.steps.some((step: { run?: string }) => /pnpm .*build:win/.test(step.run ?? ''))).toBe(false)
})

describe('CN installer download summary', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))

  it('uploads one original installer per architecture without including Global or recovery archives', () => {
    const steps = workflow.jobs.release.steps.filter((step: { name: string }) =>
      /^Upload CN .* installer$/.test(step.name)
    )
    expect(steps).toHaveLength(2)
    for (const [index, arch] of ['x64', 'arm64'].entries()) {
      const step = steps[index]
      expect(step.if).toBe("matrix.edition == 'cn'")
      expect(step.with.archive).toBe(false)
      expect(step.with.overwrite).toBe(true)
      expect(step.with['retention-days']).toBe(7)
      expect(step.with.path.trim().split('\n')).toEqual([
        `dist/Cherry-Studio-CN-*-${arch}-setup.exe`,
        `dist/Cherry-Studio-CN-*-${arch}.dmg`,
        `dist/Cherry-Studio-CN-*-${arch}.AppImage`
      ])
    }
    expect(workflow.jobs.downloads.if).toBe("always() && needs.prepare.result == 'success'")
    expect(workflow.jobs.downloads.needs).toEqual(['prepare', 'release'])
  })

  it('links only retained CN installers for this version, including partial and prerelease builds', async () => {
    const artifacts = [
      { id: 1, name: 'Cherry-Studio-CN-2.2.0-rc.1-win-x64-setup.exe' },
      { id: 2, name: 'Cherry-Studio-CN-2.2.0-rc.1-mac-arm64.dmg' },
      { id: 3, name: 'Cherry-Studio-CN-2.2.0-rc.1-linux-arm64.AppImage' },
      { id: 4, name: 'Cherry-Studio-2.2.0-rc.1-win-x64-setup.exe' },
      { id: 5, name: 'Cherry-Studio-CN-2.2.0-rc.1-win-x64-portable.exe' },
      { id: 6, name: 'Cherry-Studio-CN-2.2.0-win-x64-setup.exe' },
      { id: 7, name: 'release-bundle-v2.2.0-rc.1' },
      { id: 8, name: 'Cherry-Studio-CN-2.2.0-rc.1-win-arm64-setup.exe', expired: true }
    ].map((artifact) => ({ size_in_bytes: 1048576, expired: false, ...artifact }))
    let output = ''
    const summary = {
      addRaw: (text: string) => {
        output += text
        return summary
      },
      write: async () => {}
    }
    const sandbox = {
      github: { paginate: async () => artifacts, rest: { actions: { listWorkflowRunArtifacts: {} } } },
      context: { repo: { owner: 'CherryHQ', repo: 'cherry-studio' }, runId: 123, serverUrl: 'https://github.com' },
      process: { env: { RELEASE_TAG: 'v2.2.0-rc.1' } },
      core: { summary }
    }
    const code = `(async () => { ${workflow.jobs.downloads.steps[0].with.script} })()`
    await runInNewContext(code, sandbox)
    for (const id of [1, 2, 3])
      expect(output).toContain(`https://github.com/CherryHQ/cherry-studio/actions/runs/123/artifacts/${id}`)
    for (const id of [4, 5, 6, 7, 8]) expect(output).not.toContain(`/artifacts/${id}`)
    expect(output).toContain('retained for 7 days')
    expect(output).toContain('| Windows | x64 | 2.2.0-rc.1 | 1.0 MiB |')
    expect(output).toContain('| macOS | arm64 |')
    expect(output).toContain('| Linux | arm64 |')
    artifacts.length = 0
    output = ''
    await runInNewContext(code, sandbox)
    expect(output).toContain('No CN installers are available')
    expect(output).not.toContain('[Download]')
  })
})

describe('intermediate release artifact cleanup', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))
  const cleanup = workflow.jobs['cleanup-artifacts']
  const tag = 'v2.1.2'
  const staged = [
    ...['windows-latest', 'macos-latest', 'ubuntu-latest'].flatMap((platform) =>
      ['global', 'cn'].map((edition) => `release-${tag}-${platform}-${edition}`)
    ),
    `release-${tag}-history`
  ]

  async function clean(names: string[], expired = false, failOnce = false) {
    const artifacts = names.map((name, id) => ({ name, id, expired }))
    const sandbox = {
      github: {
        paginate: async (_endpoint: unknown, input: { run_id: number }) => {
          expect(input.run_id).toBe(123)
          return [...artifacts]
        },
        rest: {
          actions: {
            listWorkflowRunArtifacts: {},
            deleteArtifact: async ({ artifact_id }: { artifact_id: number }) => {
              if (failOnce && artifact_id === 1) {
                failOnce = false
                throw new Error('Temporary API failure')
              }
              const index = artifacts.findIndex((artifact) => artifact.id === artifact_id)
              artifacts.splice(index, 1)
            }
          }
        }
      },
      context: { repo: { owner: 'CherryHQ', repo: 'cherry-studio' }, runId: 123 },
      process: { env: { RELEASE_TAG: tag } }
    }
    const execute = () => runInNewContext(`(async () => { ${cleanup.steps[0].with.script} })()`, sandbox)
    return { artifacts, execute }
  }

  it('runs separately only after successful draft finalization including archive upload', () => {
    expect(cleanup.needs).toEqual(['prepare', 'finalize-build'])
    expect(cleanup.if).toBeUndefined()
    expect(cleanup.permissions.actions).toBe('write')
    expect(workflow.jobs['finalize-build'].steps.at(-1).name).toBe('Preserve complete dual-edition archive')
    expect(workflow.jobs['finalize-build'].steps.at(-1).with['retention-days']).toBe(90)
  })

  it('removes only this version staging files and preserves the archive, CN downloads and other files', async () => {
    const retained = [
      `release-bundle-${tag}`,
      'Cherry-Studio-CN-2.1.2-win-x64-setup.exe',
      'release-v2.1.1-history',
      `release-${tag}-unrelated`
    ]
    const { artifacts, execute } = await clean([...staged, ...retained])
    await execute()
    expect(artifacts.map((artifact) => artifact.name)).toEqual(retained)
    await execute()
    expect(artifacts.map((artifact) => artifact.name)).toEqual(retained)
  })

  it.each(['missing', 'expired'])('keeps all intermediate files when the complete archive is %s', async (state) => {
    const names = state === 'missing' ? staged : [...staged, `release-bundle-${tag}`]
    const { artifacts, execute } = await clean(names, state === 'expired')
    await expect(execute()).rejects.toThrow('keeping intermediate artifacts')
    expect(artifacts.map((artifact) => artifact.name)).toEqual(names)
  })

  it('resumes a partially failed cleanup using only the remaining artifact inventory', async () => {
    const { artifacts, execute } = await clean([...staged, `release-bundle-${tag}`], false, true)
    await expect(execute()).rejects.toThrow('Temporary API failure')
    expect(artifacts.some((artifact) => artifact.name === `release-bundle-${tag}`)).toBe(true)
    await execute()
    expect(artifacts.map((artifact) => artifact.name)).toEqual([`release-bundle-${tag}`])
  })
})

describe('release failure notifications', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))
  const notify = workflow.jobs.notify
  const stages = ['prepare', 'release', 'finalize-build', 'cleanup-artifacts', 'approve', 'publish', 'sync-to-gitcode']

  it.each(stages)('reports %s failure even when downstream jobs are skipped', (stage) => {
    expect(notify.needs).toContain(stage)
    expect(notify.if).toContain("contains(needs.*.result, 'failure')")
    expect(notify.if).toContain("contains(needs.*.result, 'cancelled')")
    expect(notify.if).toContain("!(inputs.mode == 'sync-only' && inputs.dry_run)")
    for (const result of ['failure', 'cancelled']) {
      const jobs = Object.fromEntries(stages.map((job) => [job, { result: job === stage ? result : 'skipped' }]))
      const prefix = notify.steps[0].run.split("node <<'NODE'")[0]
      const shell = spawnSync('bash', ['-e', '-c', `${prefix}\nprintf '%s\\n%s' "$TITLE" "$DESCRIPTION"`], {
        encoding: 'utf8',
        env: {
          ...process.env,
          JOB_RESULTS: JSON.stringify(jobs),
          TAG_NAME: 'v2.1.2',
          RUN_URL: 'https://example.test/run'
        }
      })
      expect(shell.status, shell.stderr).toBe(0)
      expect(shell.stdout).toContain(`${stage}: ${result}`)
      expect(shell.stdout).not.toContain('skipped')
      expect(shell.stdout).toContain(result === 'failure' ? '失败' : '已取消')
    }
  })
})

describe('trusted release selection', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))
  const selection = workflow.jobs.prepare.steps.find(
    (step: { name: string }) => step.name === 'Validate release selection'
  )

  it.each([
    ['v2.1.2', 'a'.repeat(40), 'a'.repeat(40), true],
    ['v2.1.2', '', 'a'.repeat(40), false],
    ['v2.1.2', 'main', 'a'.repeat(40), false],
    ['v2.1.2', 'a'.repeat(40), 'b'.repeat(40), false],
    ['invalid', 'a'.repeat(40), 'a'.repeat(40), false]
  ])('validates tag %s and selected SHA %s against the live release head', (tag, sha, head, valid) => {
    const result = spawnSync('bash', ['-e', '-c', `gh() { printf '%s' "$LIVE_HEAD"; }\n${selection.run}`], {
      encoding: 'utf8',
      env: { ...process.env, TAG: tag, RELEASE_SHA: sha, LIVE_HEAD: head, RELEASE_BRANCH: `release/${tag}` }
    })
    expect(result.status === 0, result.stderr).toBe(valid)
  })
})
