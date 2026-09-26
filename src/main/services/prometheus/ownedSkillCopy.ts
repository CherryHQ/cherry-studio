import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const marker = '.the-boss-managed.json'
type Ownership = { owner: 'the-boss'; files: Record<string, string> }
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
async function hashFile(filename: string): Promise<string | null> {
  try {
    return digest(await fs.readFile(filename))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function files(root: string, prefix = ''): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter((entry) => entry.name !== marker)
      .map(async (entry) => {
        const relative = path.join(prefix, entry.name)
        if (entry.isSymbolicLink()) throw new Error('Skill payload must contain regular files, not links')
        return entry.isDirectory() ? files(root, relative) : [relative]
      })
  )
  return nested.flat()
}

/** Update only bytes previously installed by this application. Local edits stay owned by the user. */
export async function copyOwnedSkill(
  source: string,
  destination: string,
  render?: (bytes: Buffer, relative: string, sourceRoot: string) => Buffer
): Promise<boolean> {
  let previous: Ownership = { owner: 'the-boss', files: {} }
  try {
    previous = JSON.parse(await fs.readFile(path.join(destination, marker), 'utf8'))
    if (previous.owner !== 'the-boss') return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      await fs.access(destination)
      return false
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== 'ENOENT') throw missing
    }
  }
  const next: Ownership = { owner: 'the-boss', files: {} }
  const sourceFiles = await files(source)
  for (const relative of sourceFiles) {
    const destinationFile = path.join(destination, relative)
    const actual = await hashFile(destinationFile)
    if (actual !== null && actual !== previous.files[relative]) continue
    const sourceBytes = await fs.readFile(path.join(source, relative))
    const bytes = render ? render(sourceBytes, relative, source) : sourceBytes
    await fs.mkdir(path.dirname(destinationFile), { recursive: true })
    await fs.writeFile(destinationFile, bytes)
    next.files[relative] = digest(bytes)
  }
  for (const [relative, expected] of Object.entries(previous.files)) {
    if (sourceFiles.includes(relative)) continue
    const resolved = path.resolve(destination, relative)
    if (!resolved.startsWith(path.resolve(destination) + path.sep)) continue
    if ((await hashFile(resolved)) === expected) await fs.rm(resolved)
  }
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(path.join(destination, marker), JSON.stringify(next, null, 2) + '\n')
  return true
}

export async function isApplicationOwnedSkill(directory: string): Promise<boolean> {
  try {
    return JSON.parse(await fs.readFile(path.join(directory, marker), 'utf8')).owner === 'the-boss'
  } catch {
    return false
  }
}
