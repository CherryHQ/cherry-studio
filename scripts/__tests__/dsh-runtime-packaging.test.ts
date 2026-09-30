import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse, parseAllDocuments } from 'yaml'

import {
  DSH_RUNTIME_ENTRY_NAMES,
  type DshRuntimeEntrySpecifier,
  resolveBundledDshRuntimeEntry
} from '@cherrystudio/dsh-bridge'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
  it('migrates a 0.1.2 session with the bundled worker and remaps its fork checkpoints', () => {
    const require = createRequire(path.join(projectRoot, 'packages/dsh-bridge/package.json'))
    const persistence = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-session-persistence-jsonl')).href
    const fork = pathToFileURL(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/fork')).href
    const script = `
      import assert from 'node:assert/strict';
      import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
      import { tmpdir } from 'node:os';
      import { join } from 'node:path';
      import { zstdCompressSync } from 'node:zlib';
      import { Context } from ${JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)};
      import Persistence from ${JSON.stringify(persistence)};
      import { forkSession } from ${JSON.stringify(fork)};
      const root = await mkdtemp(join(tmpdir(), 'cherry-dsh-upgrade-'));
      const ctx = new Context();
      const child = new Context();
      try {
        const directory = join(root, 'source', '--legacy-project--', 'legacy-upgrade');
        await mkdir(directory, { recursive: true });
        const text = await readFile(${JSON.stringify(path.join(import.meta.dirname, 'fixtures/dsh-session-v0.jsonl'))}, 'utf8');
        const cut = text.indexOf('\\n') + 1;
        const original = Buffer.concat([zstdCompressSync(text.slice(0, cut)), zstdCompressSync(text.slice(cut))]);
        const source = join(directory, 'session.jsonl.zstd');
        await writeFile(source, original);
        await ctx.plugin(Persistence, { root: join(root, 'source') });
        const writer = await ctx.sessionPersistence.open('legacy-upgrade', 'write');
        const { events } = await writer.read();
        assert.equal(writer.header.version, 4);
        assert(events.some(event => event.type === 'assistant/message' && event.data.message.content[0].text === 'The legacy answer is preserved.'));
        const boundary = events.find(event => event.type === 'turn/end').seq;
        assert.notEqual(boundary, 9);
        await writer.close();
        assert.deepEqual(await readFile(source), original);
        const result = await forkSession({ sourceRoot: join(root, 'source'), targetRoot: join(root, 'child'), sourceSessionId: 'legacy-upgrade', targetSessionId: 'child', targetCwd: '/child/project', boundary: 9, formatVersion: 0, checkpoints: [{ boundary: 9, formatVersion: 0 }] });
        assert.deepEqual(result.checkpoints, [{ boundary, formatVersion: 4 }]);
        await assert.rejects(forkSession({ sourceRoot: join(root, 'source'), targetRoot: join(root, 'invalid'), sourceSessionId: 'legacy-upgrade', targetSessionId: 'invalid', targetCwd: '/child/project', boundary: 8, formatVersion: 0, checkpoints: [] }), /history_changed/);
        await child.plugin(Persistence, { root: join(root, 'child') });
        const reader = await child.sessionPersistence.open('child', 'read');
        const copied = (await reader.read()).events;
        assert.deepEqual(copied.slice(0, boundary + 1), events.slice(0, boundary + 1));
        assert.equal(copied.at(-1).type, 'session/end-seed');
        await reader.close();
      } finally {
        await Promise.all([ctx.fiber.dispose(), child.fiber.dispose()]);
        await rm(root, { recursive: true, force: true });
      }
    `
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 30_000 })
    ).not.toThrow()
  })

  it('includes the Windows ACL diagnostic assets despite the general documentation exclusion', () => {
    const require = createRequire(import.meta.url)
    const builderRequire = createRequire(require.resolve('electron-builder'))
    const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as { files: string[] }
    const filter = new FileMatcher(projectRoot, projectRoot, (value: string) => value, config.files).createFilter()
    const bridgeRequire = createRequire(path.join(projectRoot, 'packages/dsh-bridge/package.json'))
    const packageRoot = path.dirname(bridgeRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json'))
    const assets = readdirSync(path.join(packageRoot, 'assets'), { recursive: true }) as string[]
    expect(assets.some((file) => file.endsWith('SKILL.md'))).toBe(true)
    for (const file of assets) {
      const stat = statSync(path.join(packageRoot, 'assets', file))
      if (!stat.isFile()) continue
      const packagedPath = path.join(projectRoot, 'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets', file)
      expect(filter(packagedPath, stat), file).toBe(true)
    }
  })

  it.skipIf(process.platform === 'win32')('loads the session file lock through unpacked native dependencies', () => {
    const entry = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-session-persistence-jsonl')).href
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    const script = `
      import { registerHooks } from 'node:module';
      import { fileURLToPath } from 'node:url';
      import { matchesGlob, sep } from 'node:path';
      import assert from 'node:assert/strict';
      const patterns = ${JSON.stringify(config.asarUnpack)}.filter(pattern => !pattern.startsWith('!'));
      let loadedNative = false;
      registerHooks({ resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        if (result.url.startsWith('file:')) {
          const filename = fileURLToPath(result.url).split(sep).join('/');
          const packagePath = filename.slice(filename.lastIndexOf('/node_modules/') + 1);
          assert(patterns.some(pattern => matchesGlob(packagePath, pattern)), 'Not unpacked: ' + packagePath);
          if (filename.endsWith('.node')) loadedNative = true;
        }
        return result;
      }});
      const { tryLockExclusive } = await import(import.meta.resolve('@deepseek-ai/node-addon-system/flock', ${JSON.stringify(entry)}));
      await assert.rejects(tryLockExclusive(-1), { code: 'EBADF' });
      assert(loadedNative, 'Session locking did not load its native library');
    `
    expect(() =>
      execFileSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e', script], {
        timeout: 30_000
      })
    ).not.toThrow()
  })

  it('unpacks only the JS bundles and native runtime packages', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    const requiredPatterns = [
      'node_modules/@cherrystudio/dsh-bridge/dist/runtime/**',
      'node_modules/sharp/**',
      'node_modules/node-pty/**',
      'node_modules/koffi/**',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**',
      'node_modules/@deepseek-ai/dsh-win32-process/**',
      'node_modules/@deepseek-ai/dsh-lazy-require/**',
      'node_modules/@deepseek-ai/dsh-subprocess/**',
      'node_modules/@deepseek-ai/dsh-skill/**',
      'node_modules/@deepseek-ai/dsh-scope/**',
      'node_modules/@deepseek-ai/dsh-util-values/**',
      'node_modules/@deepseek-ai/node-addon-system*/**',
      'node_modules/yaml/**'
    ]

    expect(config.asarUnpack).toEqual(expect.arrayContaining(requiredPatterns))
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**',
      'node_modules/@deepseek-ai/dsh-win32-process/**',
      'node_modules/@deepseek-ai/dsh-lazy-require/**',
      'node_modules/@deepseek-ai/dsh-subprocess/**',
      'node_modules/@deepseek-ai/dsh-skill/**',
      'node_modules/@deepseek-ai/dsh-scope/**',
      'node_modules/@deepseek-ai/dsh-util-values/**'
    ])
  })

  it('builds every DSH subprocess entry into a bounded bundle directory', () => {
    for (const specifier of Object.keys(DSH_RUNTIME_ENTRY_NAMES) as DshRuntimeEntrySpecifier[]) {
      expect(existsSync(resolveBundledDshRuntimeEntry(specifier)), specifier).toBe(true)
    }

    const runtimeDirectory = path.dirname(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/bin'))
    const fileCount = readdirSync(runtimeDirectory, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile()
    ).length
    expect(fileCount).toBeLessThan(200)
  })

  it('does not collect the unused SDK umbrella into the production dependency graph', () => {
    // pnpm 12 writes a multi-document lockfile: package-manager deps first, the dependency graph last.
    const documents = parseAllDocuments(readFileSync(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8'))
    const lock = documents[documents.length - 1].toJS() as {
      packages: Record<string, unknown>
      snapshots: Record<string, { dependencies?: Record<string, string> }>
    }
    const clients = Object.entries(lock.snapshots).filter(([key]) => key.startsWith('@deepseek-ai/dsh-sdk-client@'))
    expect(clients.length).toBeGreaterThan(0)
    for (const [, snapshot] of clients) expect(snapshot.dependencies).not.toHaveProperty('@deepseek-ai/dsh')
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh@'))).toBe(false)
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh-web-frontend@'))).toBe(false)
  })

  it.each(['@deepseek-ai/dsh-lazy-require', '@deepseek-ai/dsh-subprocess/control', '@deepseek-ai/dsh-skill', 'yaml'])(
    'loads the Windows ACL dependency %s using only unpacked files',
    (specifier) => {
      const entry = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sandbox-local')).href
      const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
        asarUnpack: string[]
      }
      const script = `
        import { registerHooks } from 'node:module';
        import { fileURLToPath } from 'node:url';
        import { matchesGlob, sep } from 'node:path';
        import assert from 'node:assert/strict';
        const patterns = ${JSON.stringify(config.asarUnpack)}.filter(pattern => !pattern.startsWith('!'));
        registerHooks({ resolve(specifier, context, nextResolve) {
          const result = nextResolve(specifier, context);
          if (result.url.startsWith('file:')) {
            const filename = fileURLToPath(result.url).split(sep).join('/');
            const packagePath = filename.slice(filename.lastIndexOf('/node_modules/') + 1);
            assert(patterns.some(pattern => matchesGlob(packagePath, pattern)), 'Not unpacked: ' + packagePath);
          }
          return result;
        }});
        const runner = import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner', ${JSON.stringify(entry)});
        await import(import.meta.resolve(${JSON.stringify(specifier)}, runner));
      `
      expect(() =>
        execFileSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e', script], {
          timeout: 30_000
        })
      ).not.toThrow()
    }
  )

  it.each(['darwin', 'linux'])('loads the %s sandbox without resolving Windows-only packages', (platform) => {
    const entry = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sandbox-local')).href
    const script = `
      import { registerHooks } from 'node:module';
      import assert from 'node:assert/strict';
      Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });
      registerHooks({ resolve(specifier, context, nextResolve) {
        assert(!specifier.startsWith('@deepseek-ai/dsh-sandbox-windows-acl'));
        assert(!specifier.startsWith('@deepseek-ai/dsh-win32-process'));
        return nextResolve(specifier, context);
      }});
      const sandbox = await import(${JSON.stringify(entry)});
      assert.equal(typeof sandbox.LocalSandboxProvider, 'function');
    `
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 30_000 })
    ).not.toThrow()
  })

  it('fails closed on Windows when the ACL package is missing', () => {
    const entry = pathToFileURL(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sandbox-local')).href
    const script = `
      import { registerHooks } from 'node:module';
      import assert from 'node:assert/strict';
      Object.defineProperty(process, 'platform', { value: 'win32' });
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === '@deepseek-ai/dsh-sandbox-windows-acl') {
          throw Object.assign(new Error('Missing Windows sandbox'), { code: 'ERR_MODULE_NOT_FOUND' });
        }
        return nextResolve(specifier, context);
      }});
      await assert.rejects(import(${JSON.stringify(entry)}), { code: 'ERR_MODULE_NOT_FOUND' });
    `
    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { timeout: 30_000 })
    ).not.toThrow()
  })

  it.skipIf(process.platform !== 'win32')('loads the Windows sandbox using only unpacked dependencies', () => {
    const entry = resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sandbox-local')
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    const script = `
      import { registerHooks } from 'node:module';
      import { fileURLToPath } from 'node:url';
      import { matchesGlob, sep } from 'node:path';
      import { existsSync } from 'node:fs';
      import assert from 'node:assert/strict';
      const patterns = ${JSON.stringify(config.asarUnpack)}.filter(pattern => !pattern.startsWith('!'));
      const runtimeRoot = ${JSON.stringify(path.dirname(entry) + path.sep)};
      let loadedWin32 = false;
      registerHooks({ resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        if (specifier === '@deepseek-ai/dsh-win32-process') loadedWin32 = true;
        if (result.url.startsWith('file:')) {
          const filename = fileURLToPath(result.url);
          if (!filename.startsWith(runtimeRoot)) {
            const normalized = filename.split(sep).join('/');
            const packagePath = normalized.slice(normalized.lastIndexOf('/node_modules/') + 1);
            assert(patterns.some(pattern => matchesGlob(packagePath, pattern)), 'Not unpacked: ' + packagePath);
          }
        }
        return result;
      }});
      const sandbox = await import(${JSON.stringify(pathToFileURL(entry).href)});
      assert.equal(typeof sandbox.LocalSandboxProvider, 'function');
      assert(loadedWin32, 'Windows sandbox did not load its process library');
      const runner = import.meta.resolve('@deepseek-ai/dsh-sandbox-windows-acl/runner', ${JSON.stringify(pathToFileURL(entry).href)});
      assert(existsSync(fileURLToPath(runner)), 'Windows ACL runner is missing');
    `
    expect(() =>
      execFileSync(process.execPath, ['--experimental-import-meta-resolve', '--input-type=module', '-e', script], {
        timeout: 30_000
      })
    ).not.toThrow()
  })
})
