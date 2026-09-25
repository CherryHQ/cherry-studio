import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import type { DbOrTx } from '@data/db/types'

import type { UarHostAdmissionSnapshot, UarHostAdmissionState } from './UarHostToolAdmission'

const STORE_KEY = 'uarToolAdmission:lifecycle'
const STORE_VERSION = 1
const MAX_RECORDS = 500
const PROCESS_EPOCH = randomUUID()

type StoredAdmission = UarHostAdmissionSnapshot & { processEpoch: string }
type StoredDocument = { version: 1; records: StoredAdmission[] }

const terminalStates = new Set<UarHostAdmissionState>([
  'succeeded',
  'failed',
  'denied',
  'cancelled',
  'invalidated',
  'interrupted',
  'outcome-unknown'
])
const admissionStates = new Set<UarHostAdmissionState>([
  'prepared',
  'awaiting-human',
  'awaiting-ack',
  'authorized',
  'claimed',
  ...terminalStates
])

class UarApprovalLifecycleStore {
  persist(snapshot: UarHostAdmissionSnapshot): void {
    application.get('DbService').withWriteTx((tx) => {
      const document = this.readDocument(tx.select({ value: appStateTable.value }).from(appStateTable).where(eq(appStateTable.key, STORE_KEY)).get()?.value)
      const records = this.reconcile(document.records)
      const index = records.findIndex((entry) => entry.admissionId === snapshot.admissionId)
      const next: StoredAdmission = { ...snapshot, processEpoch: PROCESS_EPOCH }
      if (index >= 0) records[index] = next
      else records.push(next)
      records.sort((left, right) => right.updatedAt - left.updatedAt)
      records.length = Math.min(records.length, MAX_RECORDS)
      this.write(tx, { version: STORE_VERSION, records })
    })
  }

  snapshot(sessionId?: string): UarHostAdmissionSnapshot[] {
    return application.get('DbService').withWriteTx((tx) => {
      const current = this.readDocument(tx.select({ value: appStateTable.value }).from(appStateTable).where(eq(appStateTable.key, STORE_KEY)).get()?.value)
      const records = this.reconcile(current.records)
      if (records.some((entry, index) => entry !== current.records[index])) {
        this.write(tx, { version: STORE_VERSION, records })
      }
      return records
        .filter((entry) => !sessionId || entry.sessionId === sessionId)
        .map(({ processEpoch: _processEpoch, ...entry }) => entry)
    })
  }

  private reconcile(records: StoredAdmission[]): StoredAdmission[] {
    const now = Date.now()
    return records.map((entry) => {
      if (entry.processEpoch === PROCESS_EPOCH || terminalStates.has(entry.state)) return entry
      return {
        ...entry,
        state: entry.state === 'claimed' ? 'outcome-unknown' : 'interrupted',
        updatedAt: now,
        processEpoch: PROCESS_EPOCH
      }
    })
  }

  private readDocument(value: unknown): StoredDocument {
    if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.records)) {
      return { version: STORE_VERSION, records: [] }
    }
    return {
      version: STORE_VERSION,
      records: value.records.filter(isStoredAdmission)
    }
  }

  private write(tx: DbOrTx, value: StoredDocument): void {
    const now = Date.now()
    tx.insert(appStateTable)
      .values({
        key: STORE_KEY,
        value,
        description: 'Sanitized UAR host tool-admission lifecycle evidence',
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: appStateTable.key,
        set: { value, description: 'Sanitized UAR host tool-admission lifecycle evidence', updatedAt: now }
      })
      .run()
  }
}

function isStoredAdmission(value: unknown): value is StoredAdmission {
  if (!isRecord(value) || !isRecord(value.actionDisplay)) return false
  return (
    typeof value.processEpoch === 'string' &&
    typeof value.admissionId === 'string' &&
    typeof value.invocationId === 'string' &&
    typeof value.rootRunId === 'string' &&
    typeof value.executingRunId === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.ownerId === 'string' &&
    typeof value.workspace === 'string' &&
    typeof value.hostEpoch === 'string' &&
    typeof value.toolName === 'string' &&
    admissionStates.has(value.state as UarHostAdmissionState) &&
    ['auto', 'ask', 'deny'].includes(String(value.hostDisposition)) &&
    typeof value.updatedAt === 'number'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export const uarApprovalLifecycleStore = new UarApprovalLifecycleStore()
