import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getToolCacheInfo, getToolTargets } from '../release/prepare-tools'
import { getReleaseTargets } from '../release/targets'

const workflowRoot = path.resolve(import.meta.dirname, '../../.github/workflows')

describe('release tool preparation', () => {
  it('prepares all six declared targets while preserving Windows architecture order', () => {
    expect(getToolTargets('windows', 'all')).toEqual([
      { platform: 'win32', arch: 'x64' },
      { platform: 'win32', arch: 'arm64' }
    ])
    const targets = getReleaseTargets('all').flatMap(({ platform, arch }) => getToolTargets(platform, arch))
    expect(targets.map((target) => `${target.platform}-${target.arch}`).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
      'win32-arm64',
      'win32-x64'
    ])
  })

  it('separates target caches and excludes partial transfer data from the saved path', () => {
    const root = path.join(os.tmpdir(), 'runner tools with spaces')
    const info = getToolCacheInfo('windows', 'all', root)
    expect(path.relative(root, info.path)).not.toMatch(/^\.\./)
    expect(path.relative(info.root, info.path)).toBe('complete')
    const targets = getReleaseTargets('all').map(({ platform, arch }) => getToolCacheInfo(platform, arch, root))
    expect(new Set(targets.map((target) => target.key)).size).toBe(5)
    expect(new Set(targets.map((target) => target.path)).size).toBe(5)
  })

  it.each([
    ['linux', 'all'],
    ['other', 'x64']
  ])('rejects unsupported %s-%s targets', (platform, arch) => {
    expect(() => getToolTargets(platform, arch)).toThrow('Unsupported tool target')
  })

  for (const [file, jobName] of [
    ['release.yml', 'release'],
    ['preview-release.yml', 'build']
  ]) {
    const workflow = parse(fs.readFileSync(path.join(workflowRoot, file), 'utf8'))
    const job =
      file === 'release.yml'
        ? parse(fs.readFileSync(path.join(workflowRoot, 'release-target.yml'), 'utf8')).jobs.package
        : workflow.jobs[jobName]
    const restore = job.steps.find((step: { id?: string }) => step.id === 'tool-assets')
    const prepare = job.steps.find((step: { name?: string }) => step.name === 'Prepare bundled tools')
    const save = job.steps.find((step: { name?: string }) => step.name === 'Save bundled tool assets')

    it(`${file} saves verified tools before packaging and only through the permitted writer`, () => {
      for (const { platform } of getReleaseTargets('all')) {
        for (const cacheHit of ['true', 'false']) {
          let writers = 0
          let readers = 0
          for (const edition of ['global', 'cn']) {
            const matrix = { target: { platform }, edition }
            const steps = { toolAssets: { outputs: { 'cache-hit': cacheHit } } }
            const inputs = { target: JSON.stringify(matrix.target), edition }
            const enabled = (condition: string | undefined) =>
              condition === undefined ||
              Function(
                'matrix',
                'steps',
                'inputs',
                'fromJSON',
                `return (${condition.replaceAll('steps.tool-assets', 'steps.toolAssets').replaceAll('outputs.cache-hit', "outputs['cache-hit']")})`
              )(matrix, steps, inputs, JSON.parse)
            if (enabled(restore.if)) readers += 1
            if (enabled(save.if)) writers += 1
          }
          const local = file === 'release.yml' && platform === 'windows'
          expect(readers).toBe(local ? 0 : 2)
          expect(writers).toBe(local || cacheHit === 'true' ? 0 : 1)
        }
      }
      expect(job.steps.indexOf(prepare)).toBeLessThan(job.steps.indexOf(save))
      for (const step of job.steps.filter((step: { name?: string }) =>
        /^Build (Windows|Mac|Linux)$/.test(step.name ?? '')
      )) {
        expect(job.steps.indexOf(save)).toBeLessThan(job.steps.indexOf(step))
        expect(step.env.CHERRY_BINARY_CACHE).toBe(prepare.env.CHERRY_BINARY_CACHE)
      }
      expect(save.with.path).toBe(restore.with.path)
      expect(save.with.key).toBe('${{ steps.tool-assets.outputs.cache-primary-key }}')
      expect(workflow.jobs[jobName].needs).not.toContain('tools')
    })

    it(`${file} rejects an old application source before bundle or packaging work`, () => {
      const parent = workflow.jobs[file === 'release.yml' ? 'prepare' : 'resolve']
      const preflight = parent.steps.find((step: { run?: string }) => step.run?.includes('PACKAGING_DOWNLOAD_VERSION'))
      const sourcePath = file === 'release.yml' ? 'release-source' : 'preview-source'
      const check = preflight.run.split('\n').find((line: string) => line.includes('PACKAGING_DOWNLOAD_VERSION'))
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-interface-'))
      try {
        fs.mkdirSync(path.join(directory, sourcePath, 'scripts'), { recursive: true })
        fs.writeFileSync(path.join(directory, sourcePath, 'scripts/download-binaries.js'), 'module.exports = {}')
        const result = spawnSync('bash', ['-c', check], { cwd: directory, encoding: 'utf8' })
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('does not support packaging tool assets v1')
      } finally {
        fs.rmSync(directory, { recursive: true, force: true })
      }
    })
  }
})
