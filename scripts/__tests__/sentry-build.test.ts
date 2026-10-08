import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { resolveSentryBuildSettings } from '../../electron.vite.config'

const projectRoot = path.join(import.meta.dirname, '..', '..')
const workflowFiles = ['release.yml', 'nightly-build.yml', 'preview-release.yml', 'sync-to-gitcode.yml']

describe('Sentry production build', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('fails a production Sentry build when source-map upload credentials are incomplete', () => {
    expect(() =>
      resolveSentryBuildSettings({
        NODE_ENV: 'production',
        SENTRY_SOURCE_MAP_UPLOAD: 'true'
      })
    ).toThrow('Sentry production builds require: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT')
  })

  it('does not require upload credentials for ordinary production builds', () => {
    expect(
      resolveSentryBuildSettings({
        NODE_ENV: 'production'
      })
    ).toEqual({ sourceMapUploadEnabled: false })
  })

  it('keeps source-map upload opt-in in ordinary build commands', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

    for (const command of ['build', 'build:cn']) {
      expect(scripts[command]).not.toContain('SENTRY_SOURCE_MAP_UPLOAD')
    }
  })

  it('generates hidden source maps for every Electron bundle when upload is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('SENTRY_SOURCE_MAP_UPLOAD', 'true')
    vi.stubEnv('SENTRY_AUTH_TOKEN', 'test-token')
    vi.stubEnv('SENTRY_ORG', 'test-org')
    vi.stubEnv('SENTRY_PROJECT', 'test-project')
    vi.resetModules()

    const { default: config } = await import('../../electron.vite.config')
    const builds = config as {
      main: { build: { sourcemap: unknown } }
      preload: { build: { sourcemap: unknown } }
      renderer: { build: { sourcemap: unknown } }
    }

    expect(builds.main.build.sourcemap).toBe('hidden')
    expect(builds.preload.build.sourcemap).toBe('hidden')
    expect(builds.renderer.build.sourcemap).toBe('hidden')
  })

  it.each(workflowFiles)('%s provides credentials for steps that enable source-map upload', (filename) => {
    type BuildEnvironment = Record<string, string>
    const workflow = parse(readFileSync(path.join(projectRoot, '.github/workflows', filename), 'utf8')) as {
      env?: BuildEnvironment
      jobs: Record<string, { env?: BuildEnvironment; steps?: Array<{ env?: BuildEnvironment }> }>
    }
    const environments = Object.values(workflow.jobs)
      .flatMap((job) => (job.steps ?? []).map((step) => ({ ...workflow.env, ...job.env, ...step.env })))
      .filter((env) => env.SENTRY_SOURCE_MAP_UPLOAD === 'true')

    expect(environments.length).toBeGreaterThan(0)
    for (const env of environments) {
      expect(env).toMatchObject({
        SENTRY_AUTH_TOKEN: '${{ secrets.SENTRY_AUTH_TOKEN }}',
        SENTRY_ORG: '${{ secrets.SENTRY_ORG }}',
        SENTRY_PROJECT: '${{ secrets.SENTRY_PROJECT }}'
      })
    }
  })
})
