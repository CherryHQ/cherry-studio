import { readFile, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { UploadChunk } from '@cherrystudio/remote-protocol'
import {
  agentUploadLimits,
  type AgentUploadMetadata,
  type AgentUploadReference,
  type AgentUploadResume
} from '@cherrystudio/remote-protocol/agent'
import { RemoteRpcError } from '@cherrystudio/remote-transport'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { loggerService } from '@logger'
import { FileIntakeError, type FileIntakeOwner } from '@main/services/file'
import { FileEntryIdSchema } from '@shared/data/types/file'
import type { CherryMessagePart } from '@shared/data/types/message'
import { withCherryMeta } from '@shared/data/types/uiParts'

const logger = loggerService.withContext('RemoteUploads')
export type UploadOwner = { deviceId: string; grantId: string; peerIdentity: string }

export class RemoteUploads {
  private migration?: Promise<void>
  private sweeping = false
  private authorized(owner: UploadOwner): boolean {
    return Boolean(
      apiGatewayPairedDeviceService
        .getRemoteAuthorization(owner.deviceId, owner.peerIdentity)
        ?.grants.some((grant) => grant.domain === 'agent' && grant.grantId === owner.grantId)
    )
  }
  scope(owner: UploadOwner): FileIntakeOwner {
    return {
      ownerId: JSON.stringify(['remote-agent', owner.deviceId, owner.grantId, owner.peerIdentity]),
      quotaKey: owner.deviceId
    }
  }
  private parseOwner(ownerId: string): UploadOwner | undefined {
    try {
      const [kind, deviceId, grantId, peerIdentity] = JSON.parse(ownerId)
      if (kind === 'remote-agent' && [deviceId, grantId, peerIdentity].every((value) => typeof value === 'string'))
        return { deviceId, grantId, peerIdentity }
    } catch {
      /* Other file intake owners are not remote devices. */
    }
    return undefined
  }
  private async migrate(): Promise<void> {
    return (this.migration ??= (async () => {
      const root = application.getPath('feature.remote_access.uploads')
      let directories: string[]
      try {
        directories = await readdir(root)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      for (const name of directories) {
        if (!/^[a-f0-9]{64}$/.test(name)) continue
        const directory = path.join(root, name)
        let value
        try {
          value = JSON.parse(await readFile(path.join(directory, 'state.json'), 'utf8'))
        } catch (error) {
          if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          logger.warn('Skipping unreadable legacy upload checkpoint', { name })
          continue
        }
        const { deviceId, grantId, peerIdentity, ...record } = value
        const owner =
          typeof record.ownerId === 'string' ? this.parseOwner(record.ownerId) : { deviceId, grantId, peerIdentity }
        if (!owner || !this.authorized(owner)) {
          await rm(directory, { recursive: true, force: true })
          continue
        }
        await application.get('FileIntakeService').adoptLegacy(this.scope(owner), directory, record)
      }
    })().catch((error) => {
      this.migration = undefined
      throw error
    }))
  }
  private async run<T>(owner: UploadOwner, work: (scope: FileIntakeOwner) => Promise<T>): Promise<T> {
    if (!this.authorized(owner)) throw new RemoteRpcError('GRANT_REVOKED', 'Upload authorization expired')
    await this.migrate()
    if (!this.authorized(owner)) throw new RemoteRpcError('GRANT_REVOKED', 'Upload authorization expired')
    try {
      return await work(this.scope(owner))
    } catch (error) {
      if (error instanceof FileIntakeError)
        throw new RemoteRpcError(error.code === 'UNAVAILABLE' ? 'INTERNAL' : error.code, error.message)
      throw error
    }
  }
  prepare(owner: UploadOwner, input: AgentUploadMetadata) {
    return this.run(owner, (scope) => application.get('FileIntakeService').prepare(scope, input))
  }
  get(owner: UploadOwner, id: string) {
    return this.run(owner, (scope) => application.get('FileIntakeService').get(scope, id))
  }
  resume(owner: UploadOwner, input: AgentUploadResume) {
    return this.run(owner, (scope) => application.get('FileIntakeService').resume(scope, input))
  }
  write(owner: UploadOwner, input: UploadChunk) {
    return this.run(owner, (scope) => application.get('FileIntakeService').write(scope, input))
  }
  complete(owner: UploadOwner, input: { uploadId: string; writerEpoch: string }) {
    return this.run(owner, (scope) => application.get('FileIntakeService').complete(scope, input))
  }
  cancel(owner: UploadOwner, id: string) {
    return this.run(owner, (scope) => application.get('FileIntakeService').cancel(scope, id))
  }
  withFiles<T>(
    owner: UploadOwner,
    refs: AgentUploadReference[],
    run: (parts: CherryMessagePart[]) => Promise<T>
  ): Promise<T> {
    if (!this.authorized(owner))
      return Promise.reject(new RemoteRpcError('GRANT_REVOKED', 'Upload authorization expired'))
    if (!refs.length) return run([])
    return this.run(owner, (scope) =>
      application.get('FileIntakeService').withEntries(scope, refs, async (entries) => {
        if (!this.authorized(owner)) throw new RemoteRpcError('GRANT_REVOKED', 'Upload authorization expired')
        if (entries.reduce((sum, entry) => sum + entry.byteLength, 0) > agentUploadLimits.messageBytes)
          throw new RemoteRpcError('RESOURCE_EXHAUSTED', 'Attachments exceed the message limit')
        const manager = application.get('FileManager')
        return run(
          entries.map((entry) =>
            withCherryMeta(
              {
                type: 'file',
                mediaType: entry.mediaType,
                filename: entry.filename,
                url: manager.getUrl(FileEntryIdSchema.parse(entry.entryId))
              },
              { fileEntryId: entry.entryId, remoteAttachment: { sha256: entry.sha256, byteLength: entry.byteLength } }
            )
          )
        )
      })
    )
  }
  sweep(): void {
    if (this.sweeping) return
    this.sweeping = true
    void (async () => {
      await this.migrate()
      const intake = application.get('FileIntakeService')
      const owners = new Map((await intake.owners()).map((owner) => [owner.ownerId, owner]))
      for (const ownerId of application.get('AttachmentPresenceService').owners())
        if (!owners.has(ownerId)) owners.set(ownerId, { ownerId, quotaKey: '' })
      for (const scope of owners.values()) {
        const owner = this.parseOwner(scope.ownerId)
        if (owner && !this.authorized(owner)) {
          application.get('AttachmentPresenceService').cancelOwner(scope)
          await intake.cancelOwner(scope)
        }
      }
    })()
      .catch((error) => logger.warn('Remote upload cleanup deferred', error))
      .finally(() => {
        this.sweeping = false
      })
  }
  async dispose(): Promise<void> {
    await this.migration
  }
}
