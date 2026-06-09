/**
 * Write/read symmetry contract tests (#15740).
 *
 * Contract: after ANY write attempt through a data service write method —
 * accepted or rejected — every row present in the table must parse through
 * the service's strict read path. Two failure shapes violate it:
 *
 * - the write accepts garbage silently (the bad row persists and strict
 *   point reads now throw), or
 * - the write throws only on its post-insert read-back (the bad row is
 *   already committed — rejected-but-persisted).
 *
 * The corpus is a curated adversarial set, not a property search: each case
 * is either a valid baseline (must be accepted) or a single-invariant
 * violation (must be cleanly rejected). Structural invariants are expected
 * to be stopped by the DB CHECK layer; business invariants by the service's
 * own DO-level guards — services must hold the contract for direct
 * main-process callers that never pass through DataApi handler DTO parsing.
 *
 * Scope: the 4 strict-parse services (the release-gate set agreed in
 * #15740) — FileEntryService, FileRefService, KnowledgeBaseService,
 * KnowledgeItemService.
 */

import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { CreateFileEntryRow } from '@data/services/FileEntryService'
import { fileEntryService } from '@data/services/FileEntryService'
import type { CreateFileRefRow } from '@data/services/FileRefService'
import { fileRefService } from '@data/services/FileRefService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import type { CanonicalExternalPath, FileEntryId } from '@shared/data/types/file'
import type { KnowledgeItemFileRefRole } from '@shared/data/types/file/ref'
import { KNOWLEDGE_NOTE_CONTENT_MAX } from '@shared/data/types/knowledge'
import { createUniqueModelId } from '@shared/data/types/model'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

/** True iff the write attempt threw (no judgement on error type — the
 *  contract only distinguishes accepted from rejected). */
async function rejected(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write()
    return false
  } catch {
    return true
  }
}

type ContractCase = {
  label: string
  accepted: boolean
  write: () => Promise<unknown>
}

describe('write/read symmetry contract (#15740)', () => {
  const dbh = setupTestDatabase()

  // ─── Strict full-table scans (the contract's postcondition) ───
  // Bulk reads are fault-isolating by design (#15737), so each scan walks
  // ids raw and replays them through the service's STRICT point-read path.

  async function expectAllFileEntriesParse() {
    const rows = await dbh.db.select({ id: fileEntryTable.id }).from(fileEntryTable)
    for (const { id } of rows) {
      await fileEntryService.findById(id)
    }
  }

  async function expectAllFileRefsParse() {
    const rows = await dbh.db.select({ entryId: fileRefTable.fileEntryId }).from(fileRefTable)
    for (const { entryId } of rows) {
      await fileRefService.findByEntryId(entryId)
    }
  }

  async function expectAllKnowledgeBasesParse() {
    const rows = await dbh.db.select({ id: knowledgeBaseTable.id }).from(knowledgeBaseTable)
    for (const { id } of rows) {
      await knowledgeBaseService.getById(id)
    }
  }

  async function expectAllKnowledgeItemsParse() {
    const rows = await dbh.db.select({ id: knowledgeItemTable.id }).from(knowledgeItemTable)
    for (const { id } of rows) {
      await knowledgeItemService.getById(id)
    }
  }

  // ─── Shared seeds ───

  function internalEntry(overrides: Partial<CreateFileEntryRow> = {}): CreateFileEntryRow {
    return { origin: 'internal', name: 'doc', ext: 'md', size: 10, externalPath: null, ...overrides }
  }

  function externalEntry(path: string, overrides: Partial<CreateFileEntryRow> = {}): CreateFileEntryRow {
    return { origin: 'external', name: 'report', ext: 'pdf', size: null, externalPath: path, ...overrides }
  }

  const EMBED_MODEL_ID = createUniqueModelId('openai', 'embed-model')

  /** FK target for knowledge_base.embedding_model_id → user_model.id */
  async function seedEmbeddingModel() {
    const [providerKey, modelKey] = generateOrderKeySequence(2)
    await dbh.db.insert(userProviderTable).values([{ providerId: 'openai', name: 'OpenAI', orderKey: providerKey }])
    await dbh.db.insert(userModelTable).values([
      {
        id: EMBED_MODEL_ID,
        providerId: 'openai',
        modelId: 'embed-model',
        presetModelId: 'embed-model',
        name: 'embed-model',
        isEnabled: true,
        isHidden: false,
        orderKey: modelKey
      }
    ])
  }

  async function seedKnowledgeBase(): Promise<string> {
    await seedEmbeddingModel()
    const base = await knowledgeBaseService.create({
      name: 'Contract Base',
      dimensions: 1536,
      embeddingModelId: EMBED_MODEL_ID
    })
    return base.id
  }

  // ─── FileEntryService ───

  describe('FileEntryService', () => {
    const cases: ContractCase[] = [
      {
        label: 'create: valid internal baseline is accepted',
        accepted: true,
        write: () => fileEntryService.create(internalEntry())
      },
      {
        label: 'create: valid external baseline is accepted',
        accepted: true,
        write: () => fileEntryService.create(externalEntry('/Users/me/sym-base.pdf'))
      },
      {
        label: 'create: name with forward slash is rejected (probe; CHECK backstop)',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ name: 'dir/doc' }))
      },
      {
        label: 'create: name as full Windows path is rejected (probe; CHECK backstop — the #15733 shape)',
        accepted: false,
        write: () => fileEntryService.create(externalEntry('/Users/me/sym-win.pdf', { name: 'C:\\Users\\x\\doc' }))
      },
      {
        label: 'create: all-whitespace name is rejected (probe; CHECK backstop)',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ name: '   ' }))
      },
      {
        label: 'create: name ".." must not persist',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ name: '..' }))
      },
      {
        label: 'create: name longer than 255 chars must not persist',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ name: 'x'.repeat(300) }))
      },
      {
        label: 'create: name with a null byte must not persist',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ name: 'evil\0doc' }))
      },
      {
        label: 'create: ext with a leading dot must not persist',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ ext: '.pdf' }))
      },
      {
        label: 'create: all-whitespace ext must not persist',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ ext: '   ' }))
      },
      {
        label: 'create: relative externalPath must not persist',
        accepted: false,
        write: () => fileEntryService.create(externalEntry('relative/path.txt'))
      },
      {
        label: 'create: negative internal size is rejected (probe; CHECK backstop)',
        accepted: false,
        write: () => fileEntryService.create(internalEntry({ size: -1 }))
      },
      {
        label: 'update: name with separators is rejected pre-SQL (existing guard)',
        accepted: false,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry())
          return fileEntryService.update(entry.id, { name: 'a/b' })
        }
      },
      {
        label: 'update: ext with a leading dot must not persist',
        accepted: false,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry())
          return fileEntryService.update(entry.id, { ext: '.png' })
        }
      },
      {
        label: 'update: clearing ext to null is accepted',
        accepted: true,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry())
          return fileEntryService.update(entry.id, { ext: null })
        }
      },
      {
        label: 'update: negative deletedAt must not persist',
        accepted: false,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry())
          return fileEntryService.update(entry.id, { deletedAt: -1 })
        }
      },
      {
        label: 'update: non-integer deletedAt must not persist',
        accepted: false,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry())
          return fileEntryService.update(entry.id, { deletedAt: 1.5 })
        }
      },
      {
        label: 'update: restoring from trash (deletedAt: null) is accepted — deletedAt is optional on the BO',
        accepted: true,
        write: async () => {
          const entry = await fileEntryService.create(internalEntry({ deletedAt: 1700000000000 }))
          return fileEntryService.update(entry.id, { deletedAt: null })
        }
      },
      {
        label: 'setExternalPathAndName: relative path is rejected pre-SQL (existing guard)',
        accepted: false,
        write: async () => {
          const entry = await fileEntryService.create(externalEntry('/Users/me/sym-move.pdf'))
          return fileEntryService.setExternalPathAndName(entry.id, 'rel/p.pdf' as CanonicalExternalPath, 'p')
        }
      }
    ]

    it.each(cases)('$label', async ({ accepted, write }) => {
      expect(await rejected(write)).toBe(!accepted)
      await expectAllFileEntriesParse()
    })
  })

  // ─── FileRefService ───

  describe('FileRefService', () => {
    async function seedEntryId(): Promise<FileEntryId> {
      const entry = await fileEntryService.create(internalEntry())
      return entry.id
    }

    const cases: ContractCase[] = [
      {
        label: 'create: valid temp_session ref is accepted',
        accepted: true,
        write: async () => {
          const fileEntryId = await seedEntryId()
          return fileRefService.create({ fileEntryId, sourceType: 'temp_session', sourceId: 'sess-1', role: 'pending' })
        }
      },
      {
        label: 'create: unregistered sourceType must not persist',
        accepted: false,
        write: async () => {
          const fileEntryId = await seedEntryId()
          const values = { fileEntryId, sourceType: 'note_legacy', sourceId: 's-1', role: 'pending' }
          return fileRefService.create(values as unknown as CreateFileRefRow)
        }
      },
      {
        label: 'create: role outside the variant enum must not persist',
        accepted: false,
        write: async () => {
          const fileEntryId = await seedEntryId()
          return fileRefService.create({ fileEntryId, sourceType: 'temp_session', sourceId: 's-1', role: 'attachment' })
        }
      },
      {
        label: 'create: empty sourceId must not persist',
        accepted: false,
        write: async () => {
          const fileEntryId = await seedEntryId()
          return fileRefService.create({ fileEntryId, sourceType: 'temp_session', sourceId: '', role: 'pending' })
        }
      },
      {
        label: 'createMany: a bad row in the batch must not persist',
        accepted: false,
        write: async () => {
          const fileEntryId = await seedEntryId()
          return fileRefService.createMany([
            { fileEntryId, sourceType: 'temp_session', sourceId: 'good', role: 'pending' },
            { fileEntryId, sourceType: 'temp_session', sourceId: 'bad', role: 'attachment' }
          ])
        }
      }
    ]

    it.each(cases)('$label', async ({ accepted, write }) => {
      expect(await rejected(write)).toBe(!accepted)
      await expectAllFileRefsParse()
    })
  })

  // ─── KnowledgeBaseService ───

  describe('KnowledgeBaseService', () => {
    const validDto = () => ({
      name: 'Contract Base',
      dimensions: 1536,
      embeddingModelId: EMBED_MODEL_ID
    })

    const cases: ContractCase[] = [
      {
        label: 'create: valid baseline is accepted',
        accepted: true,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create(validDto())
        }
      },
      {
        label: 'create: empty name is rejected (probe; CHECK backstop)',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), name: '' })
        }
      },
      {
        label: 'create: ideographic-space name is rejected (service trim + probe; CHECK backstop)',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), name: '　' })
        }
      },
      {
        label: 'create: threshold outside [0,1] must not persist',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), threshold: 5 })
        }
      },
      {
        label: 'create: non-positive documentCount must not persist',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), documentCount: 0 })
        }
      },
      {
        label: 'create: negative chunk config must not persist',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), chunkSize: -5, chunkOverlap: -10 })
        }
      },
      {
        label: 'create: hybridAlpha outside [0,1] must not persist',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), searchMode: 'hybrid', hybridAlpha: 2 })
        }
      },
      {
        label: 'create: non-positive dimensions is rejected (probe; CHECK backstop)',
        accepted: false,
        write: async () => {
          await seedEmbeddingModel()
          return knowledgeBaseService.create({ ...validDto(), dimensions: 0 })
        }
      },
      {
        label: 'update: empty name is rejected (CHECK)',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeBaseService.update(baseId, { name: '' })
        }
      },
      {
        label: 'update: threshold outside [0,1] must not persist',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeBaseService.update(baseId, { threshold: 5 })
        }
      },
      {
        label: 'update: negative chunk config must not persist',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeBaseService.update(baseId, { chunkSize: -5, chunkOverlap: -10 })
        }
      }
    ]

    it.each(cases)('$label', async ({ accepted, write }) => {
      expect(await rejected(write)).toBe(!accepted)
      await expectAllKnowledgeBasesParse()
    })
  })

  // ─── KnowledgeItemService ───

  describe('KnowledgeItemService', () => {
    const cases: ContractCase[] = [
      {
        label: 'create: valid note item is accepted',
        accepted: true,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeItemService.create(baseId, { type: 'note', data: { source: 'note', content: 'hello' } })
        }
      },
      {
        label: 'create: note with empty source must not persist',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeItemService.create(baseId, { type: 'note', data: { source: '', content: 'hello' } })
        }
      },
      {
        label: 'create: url item with empty url must not persist',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeItemService.create(baseId, { type: 'url', data: { source: 'site', url: '' } })
        }
      },
      {
        label: 'create: note content above the size cap must not persist',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeItemService.create(baseId, {
            type: 'note',
            data: { source: 'big', content: 'x'.repeat(KNOWLEDGE_NOTE_CONTENT_MAX + 1) }
          })
        }
      },
      {
        label: 'create: file item with missing fileEntryId is rejected (existing pre-check)',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          return knowledgeItemService.create(baseId, {
            type: 'file',
            data: { source: 'f', fileEntryId: '019606a0-0000-7000-8000-00000000ffff' as FileEntryId }
          })
        }
      },
      {
        label: 'updateStatus: failed with blank error is rejected (existing guard)',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          const item = await knowledgeItemService.create(baseId, {
            type: 'note',
            data: { source: 'note', content: 'hello' }
          })
          return knowledgeItemService.updateStatus(item.id, 'failed', { error: '   ' })
        }
      },
      {
        // `setSubtreeStatus` has its own hand-written blank-error guard,
        // independent from `updateStatus`'s — pin both parallel paths.
        label: 'setSubtreeStatus: failed with blank error is rejected (existing guard)',
        accepted: false,
        write: async () => {
          const baseId = await seedKnowledgeBase()
          const item = await knowledgeItemService.create(baseId, {
            type: 'note',
            data: { source: 'note', content: 'hello' }
          })
          return knowledgeItemService.setSubtreeStatus(baseId, [item.id], 'failed', { error: '   ' })
        }
      }
    ]

    it.each(cases)('$label', async ({ accepted, write }) => {
      expect(await rejected(write)).toBe(!accepted)
      await expectAllKnowledgeItemsParse()
    })

    it('replaceFileRef: role outside the variant enum must not persist', async () => {
      const baseId = await seedKnowledgeBase()
      const entry = await fileEntryService.create(internalEntry())
      const item = await knowledgeItemService.create(baseId, {
        type: 'note',
        data: { source: 'note', content: 'hello' }
      })
      expect(
        await rejected(() =>
          knowledgeItemService.replaceFileRef(item.id, entry.id, 'garbage' as KnowledgeItemFileRefRole)
        )
      ).toBe(true)
      await expectAllFileRefsParse()
    })
  })
})
