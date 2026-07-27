import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = process.cwd()

describe('Bash Tree-sitter packaging', () => {
  it('pins pure JS/WASM dependencies and disables the Bash grammar native build', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    const workspace = parse(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'))

    expect(packageJson.devDependencies).toMatchObject({
      'web-tree-sitter': '0.26.11',
      'tree-sitter-bash': '0.25.1'
    })
    expect(workspace.allowBuilds['tree-sitter-bash']).toBe(false)
  })

  it('ships only the two runtime WASM files through extraResources', () => {
    const builder = parse(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'))
    const treeSitterResources = builder.extraResources.filter((resource: { to: string }) =>
      resource.to.startsWith('tree-sitter/')
    )

    expect(treeSitterResources).toEqual([
      {
        from: 'node_modules/web-tree-sitter/web-tree-sitter.wasm',
        to: 'tree-sitter/web-tree-sitter.wasm'
      },
      {
        from: 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm',
        to: 'tree-sitter/tree-sitter-bash.wasm'
      }
    ])
  })
})
