/**
 * DB-only reconciliation for single-file entity-image slots.
 *
 * Provider and mini-app logos, plus assistant and agent avatars, each own at
 * most one uploaded image. The association row is the source of truth for the
 * file id. Logo owners retain their alternative logo key; avatar owners retain
 * their mutually exclusive emoji representation.
 */

import { application } from '@application'
import {
  agentAvatarFileRefTable,
  assistantAvatarFileRefTable,
  miniAppLogoFileRefTable,
  providerLogoFileRefTable
} from '@data/db/schemas/fileRelations'
import type { DbOrTx, DbType } from '@data/db/types'
import type { FileEntryId } from '@shared/data/types/file'
import { agentAvatarRef, assistantAvatarRef, miniAppLogoRef, providerLogoRef } from '@shared/data/types/file'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

export type LogoBindInput = { kind: 'key'; key: string } | { kind: 'file'; fileId: FileEntryId } | { kind: 'default' }

export type SingleFileRefSourceType =
  | typeof providerLogoRef.sourceType
  | typeof miniAppLogoRef.sourceType
  | typeof assistantAvatarRef.sourceType
  | typeof agentAvatarRef.sourceType

export interface SingleFileRefSlot {
  sourceType: SingleFileRefSourceType
  sourceId: string
}

export interface LogoColumns {
  logoKey: string | null
}

export function getSingleFileRefId(slot: SingleFileRefSlot): FileEntryId | null {
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

export function clearSingleFileRefTx(tx: DbOrTx, slot: SingleFileRefSlot): void {
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

export function insertSingleFileRefTx(tx: Pick<DbType, 'insert'>, slot: SingleFileRefSlot, fileId: FileEntryId): void {
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

export function setSingleFileRefTx(tx: DbOrTx, slot: SingleFileRefSlot, fileId: FileEntryId): void {
  clearSingleFileRefTx(tx, slot)
  insertSingleFileRefTx(tx, slot, fileId)
}

export function reconcileLogoSlotTx(
  tx: DbOrTx,
  slot: SingleFileRefSlot,
  input: LogoBindInput | undefined
): LogoColumns | null {
  if (input === undefined) return null

  if (input.kind === 'file') {
    setSingleFileRefTx(tx, slot, input.fileId)
    return { logoKey: null }
  }

  clearSingleFileRefTx(tx, slot)
  return { logoKey: input.kind === 'key' ? input.key : null }
}
