import { randomUUID } from 'node:crypto'

import { protocol } from 'electron'

import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

import { CHERRY_MEDIA_SCHEME, MEDIA_KINDS, type MediaEntry, type MediaKind } from './types'

const logger = loggerService.withContext('MediaProtocolService')

/**
 * Serves in-memory binary media to renderer processes over `cherry-media://`.
 *
 * Callers pair every `store()` with a `remove()` — nothing reclaims entries
 * automatically, by design. A single full-screen capture is tens of MB, so one
 * missed `remove()` pins real memory; the guard against that is a test asserting
 * the store is empty once a session ends, not a timer guessing how long a
 * session should have lasted.
 *
 * NOT to be merged into `services/protocol/ProtocolService` — that one registers
 * the app as an OS handler for `cherrystudio://` deep links (external → app),
 * whereas this one answers in-process renderer requests for our own bytes. The
 * scheme registration also has to happen before `app.whenReady()`, which that
 * service's phase cannot express.
 */
@Injectable('MediaProtocolService')
@ServicePhase(Phase.WhenReady)
export class MediaProtocolService extends BaseService {
  private stores = new Map<MediaKind, Map<string, MediaEntry>>()

  protected async onInit(): Promise<void> {
    // `protocol.handle` requires an app-ready process, hence Phase.WhenReady.
    protocol.handle(CHERRY_MEDIA_SCHEME, (request) => this.handleRequest(request))
    this.registerDisposable(() => protocol.unhandle(CHERRY_MEDIA_SCHEME))
    this.registerDisposable(() => this.stores.clear())
    logger.info('Media protocol handler registered', { scheme: CHERRY_MEDIA_SCHEME })
  }

  /**
   * Store a buffer and return its id. The caller owns the entry's lifetime and
   * must pair this with `remove()` — nothing reclaims it automatically.
   */
  store(kind: MediaKind, data: Buffer, mimeType: string): string {
    const id = randomUUID()
    let kindStore = this.stores.get(kind)
    if (!kindStore) {
      kindStore = new Map()
      this.stores.set(kind, kindStore)
    }
    kindStore.set(id, { data, mimeType })
    return id
  }

  /** Remove an entry. Returns whether it existed. */
  remove(kind: MediaKind, id: string): boolean {
    return this.stores.get(kind)?.delete(id) ?? false
  }

  /** Build the URL a renderer loads to read a stored entry. */
  getUrl(kind: MediaKind, id: string): string {
    return `${CHERRY_MEDIA_SCHEME}://${kind}/${id}`
  }

  private handleRequest(request: Request): Response {
    const url = new URL(request.url)
    const kind = url.hostname

    if (!MEDIA_KINDS.has(kind)) {
      return new Response('Unknown media kind', { status: 400 })
    }

    // pathname is "/{id}" — strip the leading slash
    const id = url.pathname.slice(1)
    if (!id) {
      return new Response('Missing media id', { status: 400 })
    }

    const entry = this.stores.get(kind as MediaKind)?.get(id)
    if (!entry) {
      return new Response('Not found', { status: 404 })
    }

    return new Response(new Uint8Array(entry.data), {
      headers: { 'Content-Type': entry.mimeType }
    })
  }
}
