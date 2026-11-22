import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { HostSettingsSnapshot, ModelFacts } from '../core/hostFacts'
import type { HostPorts, Settings } from '../ports/host'

/** C3–C6, C14: each setting read once for one decision. */
export const settingsSnapshot = (settings: Settings, thread: ThreadId): HostSettingsSnapshot => ({
  goalDefaults: settings.goalDefaults(),
  autonomy: settings.autonomy(),
  permissionMode: settings.permissionMode(thread),
  attendance: settings.attendance(thread),
  maxBackground: settings.maxBackground(),
  offloadThreshold: settings.offloadThreshold()
})

/** C7, C8: the conversation's model facts; candidates only for a model the call names. */
export async function modelFacts(host: HostPorts, thread: ThreadId, query: string | undefined): Promise<ModelFacts> {
  const [candidates, { parentModelKey, defaultChildModelKey, supportsTools }] = await Promise.all([
    query ? host.models.find(query, thread) : [],
    host.models.current(thread)
  ])
  return { candidates, parentModelKey, defaultChildModelKey, supportsTools }
}
