import { application } from '@application'

import { createRelocationHistoryReader, type RuntimeWorkspaceRelocation } from '../workspaceRelocation'
import { resolveResumeTokenSessionFile } from './piSessionFile'

export const piWorkspaceRelocation: RuntimeWorkspaceRelocation = {
  ownsArtifact: () => false,
  async prepare({ history }) {
    const readEntries = createRelocationHistoryReader(application.getPath('feature.agents.data'))
    const unflushedPiSessions = new Set<string>()
    for (const [sessionId, rows] of Map.groupBy(history, (row) => row.sessionId)) {
      // Manual /compact bypasses Pi's prompt persistence; an empty failure never creates history.
      if (
        rows.some((row) => row.role === 'user') &&
        rows.every(
          (row) =>
            row.runtime === 'pi' &&
            !row.checkpoint &&
            !row.nativeSessionId &&
            (!row.resumeToken || row.resumeToken === sessionId) &&
            (row.role === 'user'
              ? /^\/compact(?:\s|$)/.test(row.userText?.trim() ?? '')
              : row.role === 'assistant' && (row.status === 'error' || row.status === 'paused'))
        )
      ) {
        unflushedPiSessions.add(sessionId)
      }
    }
    for (const row of history) {
      const checkpoint = row.checkpoint
      if ((checkpoint?.runtime ?? row.runtime) !== 'pi') continue
      const id = checkpoint?.runtimeSessionId ?? row.resumeToken
      if (typeof id !== 'string') continue
      const file = resolveResumeTokenSessionFile(id, application.getPath('feature.agents.pi.sessions'))
      if (!file && unflushedPiSessions.has(row.sessionId)) continue
      if (!file) throw new Error('Pi history missing')
      const entries = await readEntries(file)
      if (entries[0]?.type !== 'session' || entries[0]?.id !== id) throw new Error('Pi history corrupt')
      if (checkpoint?.leafId && !entries.some((entry) => entry.id === checkpoint.leafId))
        throw new Error('Pi checkpoint history missing')
    }
    return []
  }
}
