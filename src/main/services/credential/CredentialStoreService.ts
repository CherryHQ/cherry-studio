import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, unlink } from 'node:fs/promises'

import * as z from 'zod'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { atomicWriteFile } from '@main/utils/file'
import {
  CredentialIdSchema,
  type CredentialSummary,
  ReplaceFeishuApplicationSchema,
  type ReplaceFeishuApplication
} from '@shared/types/credential'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import {
  CredentialRecordSchema,
  CredentialTokenSetSchema,
  FeishuApplicationPayloadSchema,
  type ApplicationCredential,
  type CredentialRecord,
  type CredentialTokenSet,
  type NewCredential
} from './credentialSchemas'
import { CredentialStoreError } from './CredentialStoreError'

type ReadResult = { status: 'ok'; record: CredentialRecord } | { status: 'missing' | 'corrupt' | 'unreadable' }
type CredentialChange = { id: string; kind: CredentialRecord['kind']; operation: 'created' | 'replaced' | 'removed' }
type ExpectedTokens = {
  applicationCredentialId: string
  application: ApplicationCredential['payload']
  refreshToken: string
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new CredentialStoreError('invalid')
  return result.data
}

function sameApplication(left: ApplicationCredential['payload'], right: ApplicationCredential['payload']): boolean {
  return (
    left.domain === right.domain &&
    left.appId === right.appId &&
    left.appSecret === right.appSecret &&
    left.encryptKey === right.encryptKey &&
    left.verificationToken === right.verificationToken
  )
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function summary(record: CredentialRecord): CredentialSummary {
  const common = { id: record.id, status: 'available' as const, connector: record.connector, label: record.label }
  if (record.kind === 'user-authorization') return { ...common, kind: record.kind }
  return {
    ...common,
    kind: record.kind,
    domain: record.payload.domain,
    appId: record.payload.appId,
    hasEncryptKey: Boolean(record.payload.encryptKey),
    hasVerificationToken: Boolean(record.payload.verificationToken)
  }
}

@Injectable('CredentialStoreService')
@ServicePhase(Phase.WhenReady)
export class CredentialStoreService extends BaseService {
  private tail: Promise<void> = Promise.resolve()
  private accepting = false
  private changes = new Emitter<CredentialChange>()
  readonly onDidChange: Event<CredentialChange> = (listener) => this.changes.event(listener)

  protected async onInit(): Promise<void> {
    this.changes = this.registerDisposable(new Emitter<CredentialChange>())
    const directory = application.getPath('feature.credentials')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    if (!(await lstat(directory)).isDirectory()) throw new CredentialStoreError('unreadable')
    if (process.platform !== 'win32') await chmod(directory, 0o700)
    await this.readAll()
    this.accepting = true
  }

  protected async onStop(): Promise<void> {
    this.accepting = false
    await this.tail
  }

  read(id: string): Promise<ReadResult> {
    const checkedId = parse(CredentialIdSchema, id)
    return this.enqueue(() => this.readRecord(checkedId))
  }

  listSummaries(filter: { connector?: 'feishu'; kind?: CredentialRecord['kind'] } = {}): Promise<CredentialSummary[]> {
    return this.enqueue(async () => {
      const entries = await this.readAll()
      return entries.flatMap(({ id, result }) => {
        if (result.status === 'missing') return []
        if (result.status !== 'ok') return [{ id, status: result.status }]
        if (filter.kind && result.record.kind !== filter.kind) return []
        return [summary(result.record)]
      })
    })
  }

  create(input: NewCredential, id: string = randomUUID()): Promise<CredentialSummary> {
    const record = parse(CredentialRecordSchema, { ...input, id })
    return this.enqueue(async () => {
      const current = await this.readRecord(record.id)
      if (current.status === 'ok') throw new CredentialStoreError('conflict')
      if (current.status !== 'missing') throw new CredentialStoreError(current.status)
      if (record.kind === 'application') {
        for (const entry of await this.readAll()) {
          if (entry.result.status === 'missing') continue
          if (entry.result.status !== 'ok') throw new CredentialStoreError(entry.result.status)
          const existing = entry.result.record
          if (
            existing.kind !== 'application' ||
            existing.payload.domain !== record.payload.domain ||
            existing.payload.appId !== record.payload.appId
          )
            continue
          if (!sameApplication(existing.payload, record.payload)) throw new CredentialStoreError('conflict')
          return summary(existing)
        }
      } else {
        const parent = await this.requireRecord(record.payload.applicationCredentialId)
        if (parent.kind !== 'application') throw new CredentialStoreError('invalid')
      }
      await this.writeRecord(record)
      this.changes.fire({ id: record.id, kind: record.kind, operation: 'created' })
      return summary(record)
    })
  }

  replaceApplication(input: ReplaceFeishuApplication): Promise<CredentialSummary> {
    const patch = parse(ReplaceFeishuApplicationSchema, input)
    return this.enqueue(async () => {
      const record = await this.requireRecord(patch.id)
      if (record.kind !== 'application') throw new CredentialStoreError('invalid')
      const payload = { ...record.payload }
      if (patch.appSecret !== undefined) payload.appSecret = patch.appSecret
      if (patch.encryptKey !== undefined) {
        if (patch.encryptKey === null) delete payload.encryptKey
        else payload.encryptKey = patch.encryptKey
      }
      if (patch.verificationToken !== undefined) {
        if (patch.verificationToken === null) delete payload.verificationToken
        else payload.verificationToken = patch.verificationToken
      }
      if (sameApplication(record.payload, payload)) return summary(record)
      const updated = { ...record, payload }
      await this.writeRecord(updated)
      this.changes.fire({ id: record.id, kind: record.kind, operation: 'replaced' })
      return summary(updated)
    })
  }

  rotateTokens(
    id: string,
    expected: ExpectedTokens,
    tokens: CredentialTokenSet
  ): Promise<'updated' | 'stale' | 'missing'> {
    const checkedId = parse(CredentialIdSchema, id)
    const checkedExpected = parse(
      z.strictObject({
        applicationCredentialId: CredentialIdSchema,
        application: FeishuApplicationPayloadSchema,
        refreshToken: z.string().min(1)
      }),
      expected
    )
    const checkedTokens = parse(CredentialTokenSetSchema, tokens)
    return this.enqueue(async () => {
      const result = await this.readRecord(checkedId)
      if (result.status === 'missing') return 'missing'
      if (result.status !== 'ok') throw new CredentialStoreError(result.status)
      const record = result.record
      if (record.kind !== 'user-authorization') throw new CredentialStoreError('invalid')
      if (
        record.payload.applicationCredentialId !== checkedExpected.applicationCredentialId ||
        record.payload.tokens?.refreshToken !== checkedExpected.refreshToken
      )
        return 'stale'
      const parent = await this.requireRecord(record.payload.applicationCredentialId)
      if (parent.kind !== 'application' || !sameApplication(parent.payload, checkedExpected.application)) return 'stale'
      await this.writeRecord({ ...record, payload: { ...record.payload, tokens: checkedTokens } })
      return 'updated'
    })
  }

  withReferences<T>(
    ids: readonly string[],
    commit: (records: readonly CredentialRecord[], tx: DbOrTx) => T extends PromiseLike<unknown> ? never : T
  ): Promise<T> {
    const checkedIds = parse(z.array(CredentialIdSchema), ids)
    return this.enqueue(async () => {
      const records = await Promise.all(checkedIds.map((id) => this.requireRecord(id)))
      return application.get('DbService').withWriteTx((tx) => commit(records, tx))
    })
  }

  remove(id: string, isReferenced: (id: string) => boolean): Promise<'removed' | 'missing'> {
    const checkedId = parse(CredentialIdSchema, id)
    return this.enqueue(async () => {
      const current = await this.readRecord(checkedId)
      if (current.status === 'missing') return 'missing'
      if (current.status !== 'ok') throw new CredentialStoreError(current.status)
      for (const entry of await this.readAll()) {
        if (entry.result.status === 'missing') continue
        if (entry.result.status !== 'ok') throw new CredentialStoreError(entry.result.status)
        const record = entry.result.record
        if (record.kind === 'user-authorization' && record.payload.applicationCredentialId === checkedId)
          throw new CredentialStoreError('in-use')
      }
      if (isReferenced(checkedId)) throw new CredentialStoreError('in-use')
      try {
        await unlink(this.filePath(checkedId))
      } catch (error) {
        if (!isMissing(error)) throw new CredentialStoreError('write-failed')
      }
      this.changes.fire({ id: checkedId, kind: current.record.kind, operation: 'removed' })
      return 'removed'
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new CredentialStoreError('stopped'))
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private filePath(id: string): string {
    return application.getPath('feature.credentials', `${id}.json`)
  }

  private async readRecord(id: string): Promise<ReadResult> {
    let raw: string
    try {
      const file = this.filePath(id)
      if (!(await lstat(file)).isFile()) return { status: 'corrupt' }
      if (process.platform !== 'win32') await chmod(file, 0o600)
      raw = await readFile(file, 'utf8')
    } catch (error) {
      return { status: isMissing(error) ? 'missing' : 'unreadable' }
    }
    try {
      const parsed = CredentialRecordSchema.safeParse(JSON.parse(raw))
      if (!parsed.success || parsed.data.id !== id) return { status: 'corrupt' }
      return { status: 'ok', record: parsed.data }
    } catch {
      return { status: 'corrupt' }
    }
  }

  private async requireRecord(id: string): Promise<CredentialRecord> {
    const result = await this.readRecord(id)
    if (result.status !== 'ok') throw new CredentialStoreError(result.status)
    return result.record
  }

  private async readAll(): Promise<Array<{ id: string; result: ReadResult }>> {
    let names: string[]
    try {
      names = await readdir(application.getPath('feature.credentials'))
    } catch {
      throw new CredentialStoreError('unreadable')
    }
    const entries: Array<{ id: string; result: ReadResult }> = []
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      if (!CredentialIdSchema.safeParse(id).success) throw new CredentialStoreError('corrupt')
      entries.push({ id, result: await this.readRecord(id) })
    }
    return entries
  }

  private async writeRecord(record: CredentialRecord): Promise<void> {
    try {
      await atomicWriteFile(AbsoluteFilePathSchema.parse(this.filePath(record.id)), `${JSON.stringify(record)}\n`, {
        mode: 0o600
      })
    } catch {
      throw new CredentialStoreError('write-failed')
    }
  }
}
