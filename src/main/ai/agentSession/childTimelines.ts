import type { AgentSessionContextRow } from '@data/db/schemas/agentSessionContext'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { ProjectionSubscriptions } from '@main/ai/messages/ProjectionSubscriptions'
import type { AgentChildUpdate, AgentChildView } from '@shared/ai/agentChildProjection'
import type { ProjectionNotification } from '@shared/ai/messageProjection'

import { readChildPage } from './childArchive'

interface ChildWriter {
  snapshot(): AgentChildView
  subscribe(listener: (update: AgentChildUpdate) => void): () => void
  getToolResult(partId: string, callId: string): { found: true; output: unknown } | undefined
}

class ChildTimelines {
  private readonly writers = new Map<string, ChildWriter>()
  private readonly changed = new Set<(context: AgentSessionContextRow) => void>()
  readonly subscriptions = new ProjectionSubscriptions<ProjectionNotification>()

  publish(context: AgentSessionContextRow, writer: ChildWriter): () => void {
    this.writers.set(context.sessionId, writer)
    for (const listener of this.changed) listener(context)
    return () => {
      if (this.writers.get(context.sessionId) !== writer) return
      this.writers.delete(context.sessionId)
      for (const listener of this.changed) listener(context)
    }
  }

  toolResult(sessionId: string, partId: string, callId: string) {
    return this.writers.get(sessionId)?.getToolResult(partId, callId)
  }

  source(owner: string, call: string) {
    let context: ReturnType<typeof contexts.childArchive>
    const locate = () => (context ??= contexts.childArchive(owner, call))
    return {
      snapshot: () => {
        const archive = locate()
        return archive ? (this.writers.get(archive.sessionId)?.snapshot() ?? readChildPage(archive)) : null
      },
      subscribe: (listener: (update: AgentChildUpdate | { kind: 'source-changed' }) => void) => {
        let stop: (() => void) | undefined
        const changed = (next: AgentSessionContextRow) => {
          if (next.spawnToolCallId !== call) return
          if (locate()?.id !== next.id) return
          stop?.()
          stop = this.writers.get(next.sessionId)?.subscribe(listener)
          listener({ kind: 'source-changed' })
        }
        const archive = locate()
        stop = archive && this.writers.get(archive.sessionId)?.subscribe(listener)
        this.changed.add(changed)
        return () => {
          this.changed.delete(changed)
          stop?.()
        }
      }
    }
  }

  attach(
    sender: Electron.WebContents,
    owner: string,
    call: string,
    id: string,
    send: (update: ProjectionNotification) => void
  ) {
    return this.subscriptions.attach(sender, id, () => this.source(owner, call), send)
  }
}

export const childTimelines = new ChildTimelines()
