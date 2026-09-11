import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { resolveSentryBuildSettings } from '../../electron.vite.config'

const projectRoot = path.join(import.meta.dirname, '..', '..')
const workflowFiles = ['release.yml', 'nightly-build.yml', 'preview-release.yml', 'sync-to-gitcode.yml']

function collectSentryBuildEnvironments(value: unknown, output: Array<Record<string, string>> = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectSentryBuildEnvironments(item, output)
    return output
  }

  if (typeof value !== 'object' || value === null) return output

  const record = value as Record<string, unknown>
  if (typeof record.env === 'object' && record.env !== null) {
    const env = record.env as Record<string, string>
    if (env.MAIN_VITE_SENTRY_DSN) output.push(env)
  }
  for (const child of Object.values(record)) collectSentryBuildEnvironments(child, output)
  return output
}

describe('Sentry production build', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('fails a production Sentry build when source-map upload credentials are incomplete', () => {
    expect(() =>
      resolveSentryBuildSettings({
        NODE_ENV: 'production',
        MAIN_VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
        SENTRY_SOURCE_MAP_UPLOAD: 'true'
      })
    ).toThrow('Sentry production builds require: SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT')
  })

  it('does not require upload credentials for the utility-process build used by development', () => {
    expect(
      resolveSentryBuildSettings({
        NODE_ENV: 'production',
        MAIN_VITE_SENTRY_DSN: 'https://public@example.ingest.sentry.io/1'
      })
    ).toEqual({ enabled: true, sourceMapUploadEnabled: false })
  })

  it('generates hidden source maps for every Electron bundle when upload is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MAIN_VITE_SENTRY_DSN', 'https://public@example.ingest.sentry.io/1')
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

  it('provides source-map credentials to every workflow step that enables Sentry', () => {
    const environments = workflowFiles.flatMap((filename) => {
      const workflow = parse(readFileSync(path.join(projectRoot, '.github/workflows', filename), 'utf8'))
      return collectSentryBuildEnvironments(workflow)
    })

    expect(environments).toHaveLength(10)
    for (const env of environments) {
      expect(env).toMatchObject({
        SENTRY_AUTH_TOKEN: '${{ secrets.SENTRY_AUTH_TOKEN }}',
        SENTRY_ORG: '${{ secrets.SENTRY_ORG }}',
        SENTRY_PROJECT: '${{ secrets.SENTRY_PROJECT }}'
      })
    }
  })
})
