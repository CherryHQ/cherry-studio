import { application } from '@application'
import type { AgentAttachmentSelection } from '@cherrystudio/remote-protocol/agent'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { FileIntakeError, type FileIntakeOwner } from '@main/services/file'

import type { UploadOwner } from './RemoteUploads'

type Selection = {
  input: AgentAttachmentSelection
  owner: FileIntakeOwner
  auth: UploadOwner
  expiresAt: number
  commandId?: string
}

@Injectable('AttachmentPresenceService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileIntakeService'])
export class AttachmentPresenceService extends BaseService {
  private readonly rows = new Map<string, Selection>()
  private readonly generations = new Map<string, number>()
  private readonly changed = new Set<string>()
  private generation = 0
  private flushTimer?: ReturnType<typeof setTimeout>
  private expiryTimer?: ReturnType<typeof setTimeout>
  connection(): number {
    return ++this.generation
  }
  private key(owner: FileIntakeOwner, selectionId: string): string {
    return JSON.stringify([owner.ownerId, selectionId])
  }
  protected onInit(): void {
    this.registerDisposable(
      application.get('FileIntakeService').onChanged(({ ownerId }) => {
        for (const row of this.rows.values()) if (row.owner.ownerId === ownerId) this.markChanged(row.input.sessionId)
      })
    )
    this.registerDisposable(() => {
      clearTimeout(this.flushTimer)
      clearTimeout(this.expiryTimer)
      this.flushTimer = this.expiryTimer = undefined
    })
  }
  private markChanged(sessionId: string): void {
    this.changed.add(sessionId)
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = undefined
      for (const id of this.changed)
        application.get('IpcApiService').broadcast('ai.agent.attachment_selections.changed', { sessionId: id })
      this.changed.clear()
    }, 100).unref()
  }
  private scheduleExpiry(): void {
    if (this.expiryTimer || this.rows.size === 0) return
    const next = Math.min(...[...this.rows.values()].map((row) => row.expiresAt))
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = undefined
        for (const [key, row] of this.rows)
          if (row.expiresAt <= Date.now()) {
            this.rows.delete(key)
            this.markChanged(row.input.sessionId)
          }
        this.scheduleExpiry()
      },
      Math.max(0, next - Date.now())
    ).unref()
  }
  present(owner: FileIntakeOwner, auth: UploadOwner, generation: number, input: AgentAttachmentSelection) {
    const active = this.generations.get(owner.ownerId) ?? 0
    if (generation < active) return { accepted: false }
    const key = this.key(owner, input.selectionId)
    const previous = this.rows.get(key)
    if (previous && previous.input.sessionId !== input.sessionId) return { accepted: false }
    if (generation === active && previous && BigInt(input.sequence) <= BigInt(previous.input.sequence))
      return { accepted: false }
    this.generations.set(owner.ownerId, generation)
    if (this.rows.size >= 256 && !previous) return { accepted: false }
    this.rows.set(key, {
      input,
      owner,
      auth,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      commandId: previous?.commandId
    })
    this.markChanged(input.sessionId)
    this.scheduleExpiry()
    return { accepted: true }
  }
  submitting(owner: FileIntakeOwner, selectionId: string | undefined, commandId: string): void {
    if (!selectionId) return
    const row = this.rows.get(this.key(owner, selectionId))
    if (row) {
      row.commandId = commandId
      this.markChanged(row.input.sessionId)
    }
  }
  owners(): string[] {
    return [...new Set([...this.rows.values()].map((row) => row.owner.ownerId))]
  }
  cancelOwner(owner: FileIntakeOwner): void {
    for (const [key, row] of this.rows)
      if (row.owner.ownerId === owner.ownerId) {
        this.rows.delete(key)
        this.markChanged(row.input.sessionId)
      }
  }
  async list(sessionId: string): Promise<AgentAttachmentSelection[]> {
    return Promise.all(
      [...this.rows.values()]
        .filter((row) => row.input.sessionId === sessionId && row.expiresAt > Date.now())
        .map(async (row) => {
          const receipt = row.commandId
            ? remoteCommandService.get({ ...row.auth, commandId: row.commandId })
            : undefined
          const messageId =
            receipt?.result && typeof receipt.result === 'object' && 'userMessageId' in receipt.result
              ? String(receipt.result.userMessageId)
              : undefined
          const items = await Promise.all(
            row.input.items.map(async (item) => {
              try {
                return { ...item, upload: await application.get('FileIntakeService').get(row.owner, item.uploadId) }
              } catch (error) {
                if (error instanceof FileIntakeError && error.code === 'NOT_FOUND') return item
                throw error
              }
            })
          )
          return { ...row.input, items, ...(messageId ? { messageId } : {}) }
        })
    )
  }
}
