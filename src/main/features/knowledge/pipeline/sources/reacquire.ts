import type { IndexableKnowledgeItem } from '../../items'
import { copyFileIntoKnowledgeBaseAt, writeFileIntoKnowledgeBaseAt } from '../../pathStorage'
import { buildNoteSnapshotFile } from './noteSnapshot'
import { fetchKnowledgeWebPage } from './url'
import { buildUrlSnapshotFile } from './urlSnapshot'

/** Overwrites the item's already-pinned `raw/` path; runs under the base mutation lock. */
export type KnowledgeReacquireWrite = (signal: AbortSignal) => Promise<void>

/**
 * Fetches/validates the new content OUTSIDE the base mutation lock and hands back the write to run
 * under it. Returning the write as a closure keeps each source's payload private to its own branch.
 */
export type KnowledgeReacquireProducer = (signal: AbortSignal) => Promise<KnowledgeReacquireWrite>

/**
 * Resolve how a leaf item re-acquires its source on reindex, or null when there is nothing to
 * re-acquire. Reindex means *re-acquire from the real source, then rebuild*: a file re-copies the
 * user's original, a url re-fetches the page, and a note rewrites its snapshot from `data.content`
 * (a note's source is inline in the DB; its `raw/*.md` file is a derived export). The two phases are
 * split so the slow half stays off the base lock, mirroring the first-index snapshot capture in
 * `indexDocumentsJobHandler`.
 *
 * The item keeps its identity: every write targets the existing `relativePath` rather than reserving
 * a new name, or each refresh would mint a `name_2.md` twin. A url/note that never captured a
 * snapshot returns null and is left to that first-index capture path.
 */
export function resolveKnowledgeReacquireProducer(item: IndexableKnowledgeItem): KnowledgeReacquireProducer | null {
  const { baseId } = item

  if (item.type === 'file') {
    const { source, relativePath } = item.data
    return async () => async (signal) => {
      await copyFileIntoKnowledgeBaseAt(baseId, source, relativePath, { overwrite: true, signal })
    }
  }

  if (item.type === 'url') {
    const { url, relativePath } = item.data
    if (!relativePath) {
      return null
    }
    return async (signal) => {
      const page = await fetchKnowledgeWebPage(url, signal)
      if (!page.markdown) {
        throw new Error(`Knowledge URL returned empty markdown: ${url}`)
      }
      const { fileText } = buildUrlSnapshotFile(url, page.markdown, new Date().toISOString(), page.title)
      return async () => {
        await writeFileIntoKnowledgeBaseAt(baseId, relativePath, fileText, { overwrite: true })
      }
    }
  }

  const { source, content, relativePath } = item.data
  if (!relativePath) {
    return null
  }
  return async () => {
    // No network step — but still reject empty/whitespace-only content before the lock, like the
    // first-index guard: an empty note would otherwise leave a frontmatter-only snapshot behind.
    if (content.trim() === '') {
      throw new Error(`Knowledge note has empty content: ${source}`)
    }
    const { fileText } = buildNoteSnapshotFile(source, content, new Date().toISOString())
    return async () => {
      await writeFileIntoKnowledgeBaseAt(baseId, relativePath, fileText, { overwrite: true })
    }
  }
}
