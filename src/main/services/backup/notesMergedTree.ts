// Build the merged Notes tree for a dir-swap restore (t5). The merged tree is the union of
// the live tree (local-only preserved) and the backup tree (backup-only added), with
// same-path conflicts resolved local-first (local content kept, backup content dropped +
// disclosed). The result is a complete leaf tree that the promotion step swaps in atomically
// (old live → aside, merged → live), so a full restore replaces the Notes tree while keeping
// every local-only note and surfacing every dropped conflict.
//
// The backup payload (admission-unpacked at `backupTreeDir`) is never mutated — the merged
// tree is written to a sibling `mergedDir`. Conflicts are reported as disclosure entries so
// the restore summary can tell the user which backup notes were kept-as-local.
//
// Live-tree preservation is WHOLE-TREE, not .md-only: the Notes root may live in an arbitrary
// user folder (blueprint §3.6 :419) that co-locates non-markdown attachments (images, PDFs,
// .canvas, …). The backup itself only carries .md bodies (collectNotesMarkdown), so the backup
// overlay applies only to declared .md paths — but the live copy must carry EVERY file so the
// atomic dir swap does not silently delete the user's non-markdown co-located files. Only the
// .md leaves are ever overlaid by backup; a non-.md file at a backup-declared path is left as
// the live original (backup never staged it). The treeHash still digests .md leaves only (that
// is the backup's content contract; non-.md files are pass-through local data).
//
// Synchronous: planResources runs inline (no await) so the plan + journal are written in one
// synchronous block before the merge write tx opens.
import { copyFileSync, type Dirent, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { computeNotesTreeHashSync } from '@data/db/restore/notesTreeHash'

/** A regular file's leaf is markdown iff its name ends in .md (case-insensitive). */
const isMarkdownName = (name: string): boolean => name.toLowerCase().endsWith('.md')

export interface MergedNoteConflict {
  readonly relPath: string
  readonly reason: 'same_path_different_content'
}

export interface MergedNotesTree {
  /** Absolute path to the merged tree root (the staging tree to swap in). */
  readonly mergedDir: string
  /** Ordered leaf hash of the merged tree (journal descriptor.treeHash). */
  readonly treeHash: string
  /** Same-path conflicts where the local content was kept and the backup one dropped. */
  readonly conflicts: readonly MergedNoteConflict[]
}

/**
 * Materialize the merged Notes tree (synchronous).
 *
 * @param backupTreeDir admission-unpacked backup notes tree (workDir/notes)
 * @param liveNotesRoot  the host's resolved Notes root (may not yet exist)
 * @param mergedDir      sibling output dir (created; must not overlap backupTreeDir/live)
 * @param backupRelPaths the manifest's declared backup note relPaths (scope guard)
 */
export function buildMergedNotesTreeSync(
  backupTreeDir: string,
  liveNotesRoot: string,
  mergedDir: string,
  backupRelPaths: readonly string[]
): MergedNotesTree {
  mkdirSync(mergedDir, { recursive: true })
  const conflicts: MergedNoteConflict[] = []

  // 1. Copy the live tree WHOLE (all regular files, not just .md). The Notes root may be an
  //    arbitrary user folder co-locating non-markdown attachments (blueprint §3.6 :419) — a
  //    .md-only copy would make the atomic dir swap silently delete them. Fresh install (no
  //    live root) → no-op.
  copyLiveTreeSync(liveNotesRoot, mergedDir)

  // 2. Overlay each declared backup note (.md only — collectNotesMarkdown stages .md bodies).
  //    Same-path conflicts are local-first; a non-.md file squatting a declared backup path is
  //    left as the live original (backup never staged it).
  for (const relPath of backupRelPaths) {
    if (relPath.split(/[/\\]/).includes('..')) continue // containment guard (planner also checks)
    const backupPath = join(backupTreeDir, relPath)
    const mergedPath = join(mergedDir, relPath)
    if (!isFileSync(backupPath)) continue
    if (isDirectorySync(mergedPath)) {
      // Type clash: the live tree has a DIRECTORY at this relPath (e.g. a folder literally named
      // 'foo.md') while the backup declares a .md FILE here. copyFileSync onto a directory throws
      // EISDIR and aborts the whole restore with a misleading generic error. Treat it as a
      // local-first conflict (keep the live dir, drop the backup note) and disclose it instead.
      conflicts.push({ relPath, reason: 'same_path_different_content' })
      continue
    }
    if (isFileSync(mergedPath)) {
      // Conflict: an existing file already occupies this relPath. Keep local, drop backup only
      // when the content differs. (A non-.md local file at a .md backup path stays as-is.)
      if (isMarkdownName(relPath) && !sameContentSync(backupPath, mergedPath)) {
        conflicts.push({ relPath, reason: 'same_path_different_content' })
      }
      continue
    }
    // backup-only: copy into the merged tree.
    mkdirSync(dirname(mergedPath), { recursive: true })
    copyFileSync(backupPath, mergedPath)
  }

  return { mergedDir, treeHash: computeNotesTreeHashSync(mergedDir), conflicts }
}

/**
 * Recursively copy the WHOLE live tree (every regular file, not just .md) into the merged dir.
 * The Notes root may be an arbitrary user folder that co-locates non-markdown attachments
 * (blueprint §3.6 :419); a .md-only copy would make the atomic dir swap silently delete them.
 * Symlinks are skipped (never followed out of the root). The backup overlay step handles .md
 * update separately — this pass is pure local-data preservation.
 */
function copyLiveTreeSync(liveRoot: string, mergedDir: string): void {
  let liveExists: boolean
  try {
    liveExists = statSync(liveRoot).isDirectory()
  } catch {
    return // live root absent — fresh install, nothing local to preserve
  }
  if (!liveExists) return
  const walk = (dirPath: string, relPrefix: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const childRel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name
      const childAbs = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        walk(childAbs, childRel)
      } else if (entry.isFile()) {
        // Copy EVERY regular file (.md + non-.md attachments alike) so the dir swap preserves
        // local data the backup does not carry. The treeHash digests .md leaves only.
        const dest = join(mergedDir, childRel)
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(childAbs, dest)
      }
    }
  }
  walk(liveRoot, '')
}

function isFileSync(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function isDirectorySync(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function sameContentSync(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b))
}
