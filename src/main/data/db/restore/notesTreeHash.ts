// Notes tree hash — ordered digest over leaf .md files under a root. Used by the dir-swap
// promotion step to verify the staged merged tree matches the descriptor before the atomic
// swap, so a tampered/corrupt staging tree cannot replace the live Notes tree.
//
// Algorithm: collect leaf .md files (recursive, symlinks skipped), sha256 each file's bytes,
// combine per-leaf as sha256(prev + '\n' + relPath + '\0' + contentHash) in POSIX relPath
// sorted order. Prefixed 'sha256-merkle-v1:' so the algorithm can evolve without breaking
// the journal schema. An empty / no-.md tree yields a fixed constant (the seed hash folded
// over zero leaves).
import { createHash } from 'node:crypto'
import { type Dirent, readdirSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { relative } from 'node:path'

const VERSION_PREFIX = 'sha256-merkle-v1:'
// Initial accumulator: sha256 of the empty seed. An empty tree folds zero leaves over this,
// yielding a fixed non-empty constant (not the bare prefix) so a missing treeHash is detectable.
const SEED_HASH = createHash('sha256').update('').digest('hex')

interface LeafEntry {
  readonly relPath: string
  readonly fullPath: string
}

/** Compute the tree hash (async). Stages that can await prefer this. */
export async function computeNotesTreeHash(root: string): Promise<string> {
  const leaves = await collectMdLeavesAsync(root)
  // readFileSync is fine here — note bodies are small and the promotion path uses the sync
  // variant anyway; both share the same fold so their results are byte-identical.
  return foldHashLeaves(leaves, (full) => readFileSync(full))
}

/** Compute the tree hash synchronously. The promotion step runs inline (no await). */
export function computeNotesTreeHashSync(root: string): string {
  const leaves = collectMdLeavesSync(root)
  return foldHashLeaves(leaves, (full) => readFileSync(full))
}

function foldHashLeaves(leaves: readonly LeafEntry[], readBytes: (fullPath: string) => Buffer): string {
  const sorted = [...leaves].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  let acc = SEED_HASH
  for (const leaf of sorted) {
    const contentHash = createHash('sha256').update(readBytes(leaf.fullPath)).digest('hex')
    acc = createHash('sha256').update(`${acc}\n${leaf.relPath}\0${contentHash}`).digest('hex')
  }
  return VERSION_PREFIX + acc
}

async function collectMdLeavesAsync(root: string): Promise<LeafEntry[]> {
  const out: LeafEntry[] = []
  const walk = async (dirPath: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childPath = `${dirPath}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(childPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const rel = relative(root, childPath).split(/[\\/]/).join('/')
        out.push({ relPath: rel, fullPath: childPath })
      }
    }
  }
  await walk(root)
  return out
}

function collectMdLeavesSync(root: string): LeafEntry[] {
  const out: LeafEntry[] = []
  const walk = (dirPath: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childPath = `${dirPath}/${entry.name}`
      if (entry.isDirectory()) {
        walk(childPath)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const rel = relative(root, childPath).split(/[\\/]/).join('/')
        out.push({ relPath: rel, fullPath: childPath })
      }
    }
  }
  walk(root)
  return out
}
