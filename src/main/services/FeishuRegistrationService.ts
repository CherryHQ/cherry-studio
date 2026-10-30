import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { CredentialSummary } from '@shared/types/credential'

import { CredentialStoreError } from './credential'
import { registrationBegin, registrationPoll, type FeishuRegistrationDomain } from './feishuAppRegistration'

type ApplicationSummary = Extract<CredentialSummary, { kind: 'application' }>
type RegistrationInput = {
  requestId: string
  domain: FeishuRegistrationDomain
  purpose: 'channel' | 'knowledge'
  applicationCredentialId?: string
  userScopes?: readonly string[]
}
type Session = {
  owner: string
  input: RegistrationInput
  controller: AbortController
  dispose: () => void
  begun?: Awaited<ReturnType<typeof registrationBegin>>
  selected?: { summary: ApplicationSummary; appSecret: string }
  completion?: Promise<ApplicationSummary>
  claimed: boolean
}

@Injectable('FeishuRegistrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CredentialStoreService', 'FeishuCredentialMigrationService', 'WindowManager'])
export class FeishuRegistrationService extends BaseService {
  private readonly sessions = new Map<string, Session>()
  private readonly inFlight = new Set<Promise<unknown>>()
  private accepting = false

  protected onInit(): void {
    this.accepting = true
  }

  protected async onStop(): Promise<void> {
    this.accepting = false
    for (const [id, session] of this.sessions) this.cancel(session.owner, id)
    await Promise.allSettled([...this.inFlight])
  }

  async beginWindow(owner: string | null, input: RegistrationInput) {
    const window = owner ? application.get('WindowManager').getWindow(owner) : undefined
    if (!owner || !window || window.isDestroyed()) throw new CredentialStoreError('invalid')
    const close = () => this.cancel(owner, input.requestId)
    window.once('closed', close)
    try {
      return await this.begin(owner, input, () => window.removeListener('closed', close))
    } catch (error) {
      window.removeListener('closed', close)
      throw error
    }
  }

  async beginAgent(agentId: string, input: RegistrationInput) {
    return this.begin(`agent:${agentId}`, input, () => {})
  }

  private async begin(owner: string, input: RegistrationInput, disposeOwner: () => void) {
    if (!this.accepting) throw new CredentialStoreError('stopped')
    if (this.sessions.has(input.requestId)) throw new CredentialStoreError('conflict')
    if (input.purpose === 'knowledge' && input.domain !== 'feishu') throw new CredentialStoreError('invalid')
    if (this.sessions.size >= 20) throw new CredentialStoreError('conflict')
    const controller = new AbortController()
    const session: Session = {
      owner,
      input,
      controller,
      dispose: disposeOwner,
      claimed: false
    }
    this.sessions.set(input.requestId, session)
    try {
      const result = await this.track(this.start(session))
      session.begun = result
      this.assertCurrent(session)
      return {
        registrationSessionId: input.requestId,
        verificationUri: result.verificationUri,
        expiresAt: new Date(Date.now() + result.expiresIn * 1000).toISOString()
      }
    } catch (error) {
      this.cancel(owner, input.requestId)
      throw error
    }
  }

  private async start(session: Session) {
    const { input, controller } = session
    const store = application.get('CredentialStoreService')
    if (input.applicationCredentialId) {
      const read = await store.read(input.applicationCredentialId)
      if (read.status !== 'ok' || read.record.kind !== 'application' || read.record.payload.domain !== input.domain)
        throw new CredentialStoreError('invalid')
      const summary = (await store.listSummaries()).find(
        (entry): entry is ApplicationSummary =>
          entry.status === 'available' && entry.kind === 'application' && entry.id === input.applicationCredentialId
      )
      if (!summary) throw new CredentialStoreError('missing')
      session.selected = { summary, appSecret: read.record.payload.appSecret }
    }
    this.assertCurrent(session)
    const knowledge = input.purpose === 'knowledge'
    const result = await registrationBegin(input.domain, {
      signal: controller.signal,
      verification: {
        source: knowledge ? 'cherry-knowledge' : 'cherry-channel',
        ...(session.selected && { appId: session.selected.summary.appId }),
        ...(knowledge && {
          addons: { userScopes: [...(input.userScopes ?? [])] }
        })
      }
    })
    this.assertCurrent(session)
    const timer = setTimeout(() => this.cancel(session.owner, input.requestId), result.expiresIn * 1000)
    timer.unref()
    const disposeOwner = session.dispose
    session.dispose = () => {
      clearTimeout(timer)
      disposeOwner()
    }
    return result
  }

  complete(owner: string | null, id: string): Promise<ApplicationSummary> {
    const session = this.requireSession(owner, id)
    if (!session.begun) throw new CredentialStoreError('invalid')
    session.completion ??= this.track(this.finish(session, session.begun))
    return session.completion
  }

  async authorizeKnowledge<T>(
    owner: string | null,
    id: string,
    authorize: (
      input: { kind: 'saved-application'; applicationCredentialId: string; source: 'custom-app' | 'personal-agent' },
      signal: AbortSignal
    ) => Promise<T>,
    cancelAuthorization: (result: T) => Promise<void>
  ): Promise<T> {
    const session = this.requireSession(owner, id)
    if (session.input.purpose !== 'knowledge' || session.claimed) throw new CredentialStoreError('conflict')
    session.claimed = true
    const app = await this.complete(owner, id)
    this.assertCurrent(session)
    return this.track(
      (async () => {
        const result = await authorize(
          {
            kind: 'saved-application',
            applicationCredentialId: app.id,
            source: 'custom-app'
          },
          session.controller.signal
        )
        try {
          this.assertCurrent(session)
          return result
        } catch (error) {
          await cancelAuthorization(result)
          throw error
        }
      })()
    )
  }

  cancel(owner: string | null, id: string): void {
    const session = this.sessions.get(id)
    if (!session || session.owner !== owner) return
    this.sessions.delete(id)
    session.controller.abort()
    session.dispose()
  }

  private async finish(
    session: Session,
    begun: Awaited<ReturnType<typeof registrationBegin>>
  ): Promise<ApplicationSummary> {
    try {
      this.assertCurrent(session)
      const result = await registrationPoll(session.input.domain, begun.deviceCode, {
        interval: begun.interval,
        expiresIn: begun.expiresIn,
        signal: session.controller.signal
      })
      this.assertCurrent(session)
      const store = application.get('CredentialStoreService')
      if (session.selected) {
        const { summary, appSecret } = session.selected
        if (result.appId !== summary.appId || result.appSecret !== appSecret) throw new CredentialStoreError('conflict')
      }
      const existing =
        session.selected?.summary ??
        (await store.listSummaries()).find(
          (entry): entry is ApplicationSummary =>
            entry.status === 'available' &&
            entry.kind === 'application' &&
            entry.domain === session.input.domain &&
            entry.appId === result.appId
        )
      if (existing) {
        return await store.withReferences([existing.id], ([current]) => {
          this.assertCurrent(session)
          if (current.kind !== 'application' || current.payload.appSecret !== result.appSecret)
            throw new CredentialStoreError('conflict')
          return existing
        })
      }
      const app = await store.create({
        connector: 'feishu',
        kind: 'application',
        label: session.input.purpose === 'knowledge' ? 'Cherry Studio Knowledge' : 'Cherry Studio',
        payload: { domain: session.input.domain, appId: result.appId, appSecret: result.appSecret }
      })
      this.assertCurrent(session)
      if (app.status !== 'available' || app.kind !== 'application') throw new CredentialStoreError('invalid')
      return app
    } catch (error) {
      this.cancel(session.owner, session.input.requestId)
      throw error
    }
  }

  private requireSession(owner: string | null, id: string): Session {
    const session = this.sessions.get(id)
    if (!owner || !session || session.owner !== owner) throw new CredentialStoreError('missing')
    this.assertCurrent(session)
    return session
  }

  private assertCurrent(session: Session): void {
    if (!this.accepting || session.controller.signal.aborted || this.sessions.get(session.input.requestId) !== session)
      throw new CredentialStoreError('stopped')
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise)
    void promise.finally(() => this.inFlight.delete(promise)).catch(() => {})
    return promise
  }
}
