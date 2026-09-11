import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
  DSH_RUNTIME_ENTRY_NAMES,
  type DshRuntimeEntrySpecifier,
  resolveBundledDshRuntimeEntry
} from '@cherrystudio/dsh-bridge'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
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
    const lock = parse(readFileSync(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8')) as {
      packages: Record<string, unknown>
      snapshots: Record<string, { dependencies?: Record<string, string> }>
    }
    const clients = Object.entries(lock.snapshots).filter(([key]) => key.startsWith('@deepseek-ai/dsh-sdk-client@'))
    expect(clients.length).toBeGreaterThan(0)
    for (const [, snapshot] of clients) expect(snapshot.dependencies).not.toHaveProperty('@deepseek-ai/dsh')
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh@'))).toBe(false)
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh-web-frontend@'))).toBe(false)
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
      'node_modules/@deepseek-ai/node-addon-landlock-run*/**'
    ]

    expect(config.asarUnpack).toEqual(expect.arrayContaining(requiredPatterns))
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**',
      'node_modules/@deepseek-ai/dsh-win32-process/**'
    ])
  })

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

  it('installs Landlock platform executables as direct optional dependencies', () => {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>
    }

    expect(manifest.optionalDependencies).toMatchObject({
      '@deepseek-ai/node-addon-landlock-run-linux-arm64': '0.1.1',
      '@deepseek-ai/node-addon-landlock-run-linux-x64': '0.1.1'
    })
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
