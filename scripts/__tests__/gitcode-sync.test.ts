import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

function bashPath(value: string) {
  return process.platform === 'win32'
    ? execFileSync('bash', ['-c', 'cygpath -u "$1"', 'bash', value], { encoding: 'utf8' }).trim()
    : value
}
const script = bashPath(path.resolve(import.meta.dirname, '../release/sync-gitcode.sh'))
const nodeExecutable = bashPath(process.execPath)

describe('GitCode sync recovery', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gitcode-sync-'))
    mkdirSync(path.join(root, 'bin'))
    mkdirSync(path.join(root, 'release-assets'))
    writeFileSync(
      path.join(root, 'release-assets.txt'),
      'cn/windows/CN.exe\nglobal/windows/Global.exe\nglobal/windows/latest.yml\n'
    )
    for (const name of ['Global.exe', 'CN.exe', 'latest.yml', 'latest-cn.yml', 'release-history.json'])
      writeFileSync(path.join(root, 'release-assets', name), name)
    writeFileSync(path.join(root, 'release_body.txt'), 'English\n中文')
    const executable = (name: string, body: string) =>
      writeFileSync(path.join(root, 'bin', name), `#!${nodeExecutable}\n${body}`, { mode: 0o755 })
    executable(
      'gh',
      `process.stdout.write(process.argv.includes('view') ? JSON.stringify({name: 'v2.1.2', isDraft: process.env.DRAFT === 'true', isPrerelease: process.env.PRE === 'true'}) : 'v2.1.2' + (process.env.RUNNER_OS === 'Windows' ? '\\r\\n' : ''))`
    )
    executable('sleep', '')
    executable(
      'python',
      `const fs = require('node:fs')
      const [, command, asset, target] = process.argv.slice(2)
      if (command !== 'get-asset') process.exit(1)
      fs.writeFileSync(target, asset)
      fs.appendFileSync('cos-requests.txt', asset + '\\n')`
    )
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
    const bin = bashPath(path.join(root, 'bin'))
    return spawnSync('bash', ['-c', 'export PATH="$1:$PATH"; exec bash "$2"', 'bash', bin, script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TAG: 'v2.1.2',
        GH_REPO: 'CherryHQ/cherry-studio',
        GITCODE_API_URL: 'https://gitcode.example.invalid/api/v5',
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

  it('uploads clean URLs and preserves latest status with native Windows line endings', () => {
    const jq = spawnSync(
      'bash',
      ['-c', process.platform === 'win32' ? 'cygpath -w "$(command -v jq)"' : 'command -v jq'],
      {
        encoding: 'utf8'
      }
    ).stdout.trim()
    writeFileSync(
      path.join(root, 'bin', 'jq'),
      `#!${nodeExecutable}
      const { execFileSync } = require('node:child_process')
      const fs = require('node:fs')
      const args = process.argv.slice(2)
      const output = execFileSync(${JSON.stringify(jq)}, args.filter(arg => arg !== '--binary'), {
        input: fs.readFileSync(0), encoding: 'utf8'
      })
      process.stdout.write(args.includes('--binary') ? output : output.replace(/\\n/g, '\\r\\n'))
      `,
      { mode: 0o755 }
    )
    const result = run({ RUNNER_OS: 'Windows' })
    expect(result.status, result.stderr).toBe(0)
    expect(requests().find((call) => call.method === 'POST').payload.release_status).toBe('latest')
    const uploads = requests().filter((call) => call.method === 'PUT')
    expect(uploads).toHaveLength(5)
    expect(uploads.every((call) => !/[\r\n]/.test(call.url))).toBe(true)
  })

  it('fetches each COS attachment once and uploads installers before update manifests', () => {
    const result = run({ RELEASE_FROM_COS: 'true', RETRY_UPLOAD: 'true' })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(path.join(root, 'cos-requests.txt'), 'utf8').trim().split('\n')).toEqual([
      'cn/windows/CN.exe',
      'global/windows/Global.exe',
      'global/windows/latest.yml'
    ])
    expect(
      requests()
        .filter((call) => call.method === 'PUT')
        .map((call) => path.basename(call.data))
    ).toEqual(['CN.exe', 'CN.exe', 'Global.exe', 'latest.yml'])
  })

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
  expect(sync['runs-on']).toBe('ubuntu-latest')
  expect(sync.steps.some((step: { run?: string }) => /pnpm .*build:win/.test(step.run ?? ''))).toBe(false)
})

describe('release failure notifications', () => {
  const workflow = parse(readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8'))
  const notify = workflow.jobs.notify
  const stages = ['prepare', 'release', 'finalize-build', 'approve', 'publish', 'sync-to-gitcode']

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
