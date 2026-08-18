import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildDshAsarUnpackPatterns, collectDshRuntimePackageNames } from '../before-pack'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
  it('unpacks the root-hoisted dependencies loaded by the external JSON-RPC process', () => {
    const packageNames = collectDshRuntimePackageNames(projectRoot)
    const patterns = buildDshAsarUnpackPatterns(projectRoot)
    const runtimeDependencies = ['diff', 'js-yaml', 'koffi', 'openai', 'partial-json', 'sharp', 'typebox', 'zod']

    for (const packageName of runtimeDependencies) {
      expect(packageNames).toContain(packageName)
      expect(patterns).toContain(`node_modules/${packageName}/**`)
      expect(patterns).toContain(`node_modules/**/node_modules/${packageName}/**`)
    }
  })
})
