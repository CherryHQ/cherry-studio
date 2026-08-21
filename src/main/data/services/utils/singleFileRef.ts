/** DB operations for roleless single-file FileRef slots. */

import { application } from '@application'
import {
  agentAvatarFileRefTable,
  assistantAvatarFileRefTable,
  miniAppLogoFileRefTable,
  providerLogoFileRefTable
} from '@data/db/schemas/fileRelations'
import type { DbOrTx, DbType } from '@data/db/types'
import type { FileEntryId } from '@shared/data/types/file'
import { agentAvatarRef, assistantAvatarRef, miniAppLogoRef, providerLogoRef } from '@shared/data/types/fileRef'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export type SingleFileRefSourceType =
  | typeof providerLogoRef.sourceType
  | typeof miniAppLogoRef.sourceType
  | typeof assistantAvatarRef.sourceType
  | typeof agentAvatarRef.sourceType

export interface SingleFileRefSlot {
  sourceType: SingleFileRefSourceType
  sourceId: string
}

export function getSingleFileRef(slot: SingleFileRefSlot): FileEntryId | null {
  const db = application.get('DbService').getDb()
  switch (slot.sourceType) {
    case providerLogoRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: providerLogoFileRefTable.fileEntryId })
        .from(providerLogoFileRefTable)
        .where(eq(providerLogoFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
    case miniAppLogoRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: miniAppLogoFileRefTable.fileEntryId })
        .from(miniAppLogoFileRefTable)
        .where(eq(miniAppLogoFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
    case assistantAvatarRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: assistantAvatarFileRefTable.fileEntryId })
        .from(assistantAvatarFileRefTable)
        .where(eq(assistantAvatarFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
    case agentAvatarRef.sourceType: {
      const [row] = db
        .select({ fileEntryId: agentAvatarFileRefTable.fileEntryId })
        .from(agentAvatarFileRefTable)
        .where(eq(agentAvatarFileRefTable.sourceId, slot.sourceId))
        .limit(1)
        .all()
      return (row?.fileEntryId as FileEntryId | undefined) ?? null
    }
  }
}

export function clearSingleFileRef(tx: DbOrTx, slot: SingleFileRefSlot): void {
  switch (slot.sourceType) {
    case providerLogoRef.sourceType:
      tx.delete(providerLogoFileRefTable).where(eq(providerLogoFileRefTable.sourceId, slot.sourceId)).run()
      return
    case miniAppLogoRef.sourceType:
      tx.delete(miniAppLogoFileRefTable).where(eq(miniAppLogoFileRefTable.sourceId, slot.sourceId)).run()
      return
    case assistantAvatarRef.sourceType:
      tx.delete(assistantAvatarFileRefTable).where(eq(assistantAvatarFileRefTable.sourceId, slot.sourceId)).run()
      return
    case agentAvatarRef.sourceType:
      tx.delete(agentAvatarFileRefTable).where(eq(agentAvatarFileRefTable.sourceId, slot.sourceId)).run()
      return
  }
}

export function insertSingleFileRef(tx: Pick<DbType, 'insert'>, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  const now = Date.now()
  const row = { id: uuidv4(), fileEntryId: fileId, sourceId: slot.sourceId, createdAt: now, updatedAt: now }
  switch (slot.sourceType) {
    case providerLogoRef.sourceType:
      tx.insert(providerLogoFileRefTable).values(row).run()
      return
    case miniAppLogoRef.sourceType:
      tx.insert(miniAppLogoFileRefTable).values(row).run()
      return
    case assistantAvatarRef.sourceType:
      tx.insert(assistantAvatarFileRefTable).values(row).run()
      return
    case agentAvatarRef.sourceType:
      tx.insert(agentAvatarFileRefTable).values(row).run()
      return
  }
}

export function setSingleFileRef(tx: DbOrTx, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  clearSingleFileRef(tx, slot)
  insertSingleFileRef(tx, slot, fileId)
}
