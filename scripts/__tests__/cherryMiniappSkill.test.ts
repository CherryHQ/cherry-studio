import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

// The skill ships zero-dependency scripts; import them directly by path.
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.agents/skills/cherry-miniapp')
const { validateApp } = await import(path.join(SKILL_DIR, 'scripts/validate.mjs'))
const { packageApp } = await import(path.join(SKILL_DIR, 'scripts/package.mjs'))

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-miniapp-skill-'))
  tempDirs.push(dir)
  return dir
}

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

async function copyTemplate(): Promise<string> {
  const dir = await makeTempDir()
  await fs.cp(path.join(SKILL_DIR, 'assets/template'), dir, { recursive: true })
  return dir
}

describe('cherry-miniapp skill', () => {
  it('is well-formed and listed as public', async () => {
    const skill = await fs.readFile(path.join(SKILL_DIR, 'SKILL.md'), 'utf8')
    expect(skill).toMatch(/^---\nname: cherry-miniapp\ndescription: .+\n---/)
    const publicSkills = await fs.readFile(path.resolve(SKILL_DIR, '../public-skills.txt'), 'utf8')
    expect(publicSkills.split('\n').map((line) => line.trim())).toContain('cherry-miniapp')
  })

  it('ships a cherry.d.ts identical to the docs reference', async () => {
    const [shipped, reference] = await Promise.all([
      fs.readFile(path.join(SKILL_DIR, 'assets/cherry.d.ts'), 'utf8'),
      fs.readFile(path.resolve(SKILL_DIR, '../../../docs/dev/references/mini-app/cherry.d.ts'), 'utf8')
    ])
    expect(shipped).toBe(reference)
  })

  it('validates its own template', async () => {
    const result = await validateApp(path.join(SKILL_DIR, 'assets/template'))
    expect(result).toEqual({ ok: true, issues: [] })
  })

  it('rejects an invalid manifest', async () => {
    const dir = await copyTemplate()
    const manifestPath = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.id = 'CON.example.app'
    manifest.version = 'not-semver'
    delete manifest.description
    await fs.writeFile(manifestPath, JSON.stringify(manifest))

    const result = await validateApp(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toMatch(/id:/)
    expect(result.issues.join('\n')).toMatch(/version: must be valid semver/)
    expect(result.issues.join('\n')).toMatch(/description:/)
  })

  it('rejects an icon whose digest does not match its bytes', async () => {
    const dir = await copyTemplate()
    await fs.writeFile(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const result = await validateApp(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toMatch(/icon\.sha256: does not match/)
  })

  it('rejects assets that reference a development server', async () => {
    const dir = await copyTemplate()
    await fs.writeFile(path.join(dir, 'dev.js'), "fetch('http://localhost:5173/api').then(() => {})")
    const result = await validateApp(dir)
    expect(result.ok).toBe(false)
    expect(result.issues.join('\n')).toMatch(/dev\.js: references a development server/)
  })

  it('rejects network hosts without a network permission and vice versa', async () => {
    const dir = await copyTemplate()
    const manifestPath = path.join(dir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.network = ['api.example.com']
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    expect((await validateApp(dir)).issues.join('\n')).toMatch(/no `network\.\*` permission/)

    manifest.permissions = [...manifest.permissions, 'network.fetch']
    manifest.network = []
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    expect((await validateApp(dir)).issues.join('\n')).toMatch(/no hosts to use it on/)
  })

  it('packages deterministically with a matching SHA-256 and size', async () => {
    const dir = await copyTemplate()
    const first = path.join(await makeTempDir(), 'one.miniapp')
    const second = path.join(await makeTempDir(), 'two.miniapp')

    const a = await packageApp(dir, first)
    const b = await packageApp(dir, second)

    expect(a.sha256).toBe(b.sha256)
    expect(a.sizeBytes).toBe(b.sizeBytes)
    const bytes = await fs.readFile(first)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256)
    expect(bytes.length).toBe(a.sizeBytes)
    expect(a.entries).toBe(3)
    // ZIP local file header magic, and the manifest lands at the archive root.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(bytes.includes(Buffer.from('manifest.json'))).toBe(true)
  })

  it('refuses to package an invalid app', async () => {
    const dir = await copyTemplate()
    await fs.rm(path.join(dir, 'manifest.json'))
    await expect(packageApp(dir, path.join(await makeTempDir(), 'bad.miniapp'))).rejects.toThrow(/Validation failed/)
  })
})
