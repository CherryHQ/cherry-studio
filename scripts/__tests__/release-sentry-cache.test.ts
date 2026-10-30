import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'

import { compilationEnvironment, uploadSentryMaps } from '../release/sentry-artifacts'

const execute = promisify(execFile)
const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))))
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})

async function sentryServer() {
  const chunks = new Map<string, Buffer>()
  const releases: string[] = []
  let rejectUpload = false
  const server = createServer(async (request, response) => {
    const parts: Buffer[] = []
    for await (const part of request) parts.push(Buffer.from(part))
    const body = Buffer.concat(parts)
    response.setHeader('Content-Type', 'application/json')
    if (rejectUpload) {
      response.writeHead(403).end(JSON.stringify({ detail: 'Upload forbidden' }))
    } else if (request.url?.endsWith('/chunk-upload/')) {
      response.end(
        JSON.stringify({
          url: `${url}/chunks/`,
          chunkSize: 8388608,
          chunksPerRequest: 64,
          maxRequestSize: 33554432,
          maxFileSize: 2147483648,
          concurrency: 2,
          hashAlgorithm: 'sha1',
          compression: [],
          accept: ['release_files', 'artifact_bundles', 'artifact_bundles_v2']
        })
      )
    } else if (request.url === '/chunks/') {
      const form = await new Response(body, {
        headers: { 'Content-Type': request.headers['content-type']! }
      }).formData()
      for (const file of form.values()) {
        if (typeof file === 'string') continue
        const bytes = Buffer.from(await file.arrayBuffer())
        chunks.set(createHash('sha1').update(bytes).digest('hex'), bytes)
      }
      response.end('{}')
    } else if (request.url?.endsWith('/artifactbundle/assemble/')) {
      const input = JSON.parse(body.toString())
      releases.push(input.version)
      const missingChunks = input.chunks.filter((hash: string) => !chunks.has(hash))
      response.end(JSON.stringify({ state: missingChunks.length ? 'not_found' : 'ok', missingChunks }))
    } else {
      response.writeHead(404).end('{}')
    }
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    chunks,
    releases,
    fail: () => {
      rejectUpload = true
    }
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-sentry-cache-'))
  roots.push(root)
  execFileSync('git', ['init', '-q', root])
  writeFileSync(join(root, '.gitignore'), 'out/\n.cache/\n.context/\nresources/binaries/\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }))
  mkdirSync(join(root, '.context'))
  for (const [script, addon] of [
    ['darwin/build.js', 'selection-panel'],
    ['external-app/build.cjs', 'external-app']
  ]) {
    mkdirSync(join(root, 'native', script, '..'), { recursive: true })
    writeFileSync(
      join(root, 'native', script),
      `const fs = require('node:fs');
      const output = 'resources/binaries/' + process.platform + '-' + process.arch;
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(output + '/${addon}.node', '${addon} fixture');`
    )
  }
  for (const target of ['main', 'preload', 'renderer']) {
    mkdirSync(join(root, 'src', target), { recursive: true })
    writeFileSync(
      join(root, 'src', target, 'entry.js'),
      `exports.value = import.meta.env.${target.toUpperCase()}_VITE_SECRET || 'no-config'`
    )
  }
  const runner = join(root, 'pnpm.cjs')
  writeFileSync(
    runner,
    `
    const fs = require('node:fs'), path = require('node:path');
    if (process.env.CHERRY_BUILD_CACHE_KEY || process.env.SENTRY_AUTH_TOKEN) throw new Error('Build credential leak');
    if (process.argv[3] === 'node') {
      require('node:child_process').execFileSync(process.execPath, process.argv.slice(4), {stdio:'inherit'});
      process.exit(0);
    }
    if (!process.argv.includes('electron-vite')) process.exit(0);
    const target = process.env.CHERRY_BUILD_TARGET || 'utility-process';
    const source = target === 'utility-process' ? 'main' : target;
    fs.appendFileSync('.context/compilations', target + '\\n');
    const { build } = require(${JSON.stringify(require.resolve('vite'))});
    const { buildInputGuard } = require(${JSON.stringify(resolve('scripts/release/buildInputGuard.ts'))});
    build({root:process.cwd(),configFile:false,publicDir:false,logLevel:'silent',
      envPrefix:['VITE_', source.toUpperCase() + '_VITE_'],plugins:[buildInputGuard()],
      build:{outDir:'out/'+target,sourcemap:'hidden',
        lib:{entry:path.resolve('src',source,'entry.js'),formats:['cjs'],fileName:()=>target+'.cjs'}}
    }).catch(()=>process.exit(1));
  `
  )
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/(^|_)VITE_|^SENTRY_|^CHERRY_/.test(key))
  )
  Object.assign(env, {
    npm_execpath: runner,
    CHERRY_BUILD_CACHE: '1',
    CHERRY_BUILD_CACHE_KEY: 'a'.repeat(64),
    SENTRY_SOURCE_MAP_UPLOAD: 'true',
    SENTRY_AUTH_TOKEN: 'test-token',
    SENTRY_ORG: 'test-org',
    SENTRY_PROJECT: 'test-project',
    MAIN_VITE_SECRET: 'first-private-value'
  })
  const run = () =>
    execute(
      process.execPath,
      [
        '-e',
        `require(${JSON.stringify(resolve('scripts/release/build-app.js'))}).buildApplication(process.cwd()).catch(e=>{process.stderr.write(e.message);process.exitCode=1})`
      ],
      { cwd: root, env, maxBuffer: 2 * 1024 * 1024 }
    )
  const compilations = () => readFileSync(join(root, '.context/compilations'), 'utf8').trim().split('\n')
  return { root, env, run, compilations }
}

describe('release cache and Sentry delivery', () => {
  it('prepares host addons on clean builds and restores missing addons even when every JS target hits cache', async () => {
    const { root, env, run, compilations } = fixture()
    env.SENTRY_SOURCE_MAP_UPLOAD = 'false'
    const addons = ['selection-panel', 'external-app'].map((name) =>
      join(root, 'resources/binaries', `${process.platform}-${process.arch}`, `${name}.node`)
    )
    await run()
    for (const [index, name] of ['selection-panel', 'external-app'].entries()) {
      expect(readFileSync(addons[index], 'utf8')).toBe(`${name} fixture`)
      rmSync(addons[index])
    }
    rmSync(join(root, 'out'), { recursive: true })
    const warm = await run()
    for (const target of ['main', 'preload', 'renderer', 'utility-process']) {
      expect(warm.stdout).toContain(`[release-build] ${target}: hit`)
    }
    expect(compilations()).toHaveLength(4)
    for (const [index, name] of ['selection-panel', 'external-app'].entries()) {
      expect(readFileSync(addons[index], 'utf8')).toBe(`${name} fixture`)
    }
    writeFileSync(join(root, 'native/darwin/build.js'), 'process.exit(1)')
    await expect(run()).rejects.toMatchObject({ code: 1 })
    expect(compilations()).toHaveLength(4)
  }, 60_000)

  it('reuses JS/maps across runner image labels, rebuilds changed configuration and fails closed on upload errors', async () => {
    const sentry = await sentryServer()
    const { root, env, run, compilations } = fixture()
    env.SENTRY_URL = sentry.url
    env.ImageVersion = '20261021.0445.8'
    await run()
    expect(compilations()).toEqual(['main', 'preload', 'renderer', 'utility-process'])
    expect(sentry.chunks.size).toBeGreaterThan(0)
    const bundle = await JSZip.loadAsync([...sentry.chunks.values()][0])
    const mapFiles = Object.values(bundle.files).filter((file) => /\.[cm]?js\.map$/.test(file.name))
    expect(mapFiles).toHaveLength(4)
    for (const file of mapFiles) {
      const map = JSON.parse(await file.async('string'))
      const javascript = await bundle.file(file.name.slice(0, -4))!.async('string')
      expect(map.debug_id || map.debugId).toMatch(/^[\da-f-]{36}$/)
      expect(javascript).toContain(`//# debugId=${map.debug_id || map.debugId}`)
    }
    const javascript = readFileSync(join(root, 'out/main/main.cjs'), 'utf8')
    expect(javascript).toContain('first-private-value')
    const deliveries = sentry.releases.length
    rmSync(join(root, 'out'), { recursive: true })
    env.ImageVersion = '20261026.0455.2'
    const warm = await run()
    for (const target of ['main', 'preload', 'renderer', 'utility-process']) {
      expect(warm.stdout).toContain(`[release-build] ${target}: hit`)
    }
    expect(compilations()).toHaveLength(4)
    expect(readFileSync(join(root, 'out/main/main.cjs'), 'utf8')).toBe(javascript)
    expect(sentry.releases.length).toBeGreaterThan(deliveries)
    expect(sentry.releases.every((release) => release === 'fixture@1.2.3')).toBe(true)
    expect(readdirSync(join(root, 'out'), { recursive: true }).some((file) => file.endsWith('.map'))).toBe(false)

    env.MAIN_VITE_SECRET = 'rotated-private-value'
    await run()
    expect(compilations().slice(4)).toEqual(['main', 'utility-process'])
    expect(readFileSync(join(root, 'out/main/main.cjs'), 'utf8')).toContain('rotated-private-value')
    sentry.fail()
    env.SENTRY_ALLOW_FAILURE = 'true'
    await expect(run()).rejects.toMatchObject({ code: 1 })
    expect(readFileSync(join(root, 'out/main/main.cjs.map'), 'utf8')).toContain('debug_id')
    expect(compilations()).toHaveLength(6)
  }, 60_000)

  it('keeps release compilation and upload functional without a cache key', async () => {
    const sentry = await sentryServer()
    const { root, env, run, compilations } = fixture()
    env.SENTRY_URL = sentry.url
    delete env.CHERRY_BUILD_CACHE_KEY
    await run()
    await run()
    expect(compilations()).toHaveLength(8)
    expect(sentry.releases.length).toBeGreaterThan(2)
    expect(() => readdirSync(join(root, '.cache/release-build-encrypted'))).toThrow()
    expect(() => readdirSync(join(root, '.cache/release-build'))).toThrow()
  }, 60_000)

  it('removes cache and upload credentials while retaining actual compilation inputs', () => {
    expect(
      compilationEnvironment({
        CHERRY_BUILD_CACHE_KEY: 'key',
        SENTRY_AUTH_TOKEN: 'token',
        SENTRY_ORG: 'org',
        SENTRY_PROJECT: 'project',
        MAIN_VITE_SECRET: 'client-config',
        PATH: '/bin'
      })
    ).toEqual({ MAIN_VITE_SECRET: 'client-config', PATH: '/bin' })
  })

  it('rejects missing maps and mismatched Debug IDs before uploading or deleting maps', () => {
    const { root, env } = fixture()
    env.SENTRY_URL = 'http://127.0.0.1:9'
    mkdirSync(join(root, 'out/main'), { recursive: true })
    expect(() => uploadSentryMaps(root, ['main'], env)).toThrow('requires JavaScript source maps')
    writeFileSync(join(root, 'out/main/main.cjs'), '//# debugId=wrong-id')
    writeFileSync(join(root, 'out/main/main.cjs.map'), JSON.stringify({ debug_id: 'expected-id' }))
    expect(() => uploadSentryMaps(root, ['main'], env)).toThrow('does not match the JavaScript Debug ID')
    expect(readFileSync(join(root, 'out/main/main.cjs.map'), 'utf8')).toContain('expected-id')
  })
})
