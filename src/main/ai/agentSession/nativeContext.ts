import { lstatSync, readdirSync } from 'node:fs'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import { application } from '@application'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'

export function loadPiSession(backendId: string, nativeId: string, cwd?: string): SessionManager {
  if (contexts.backend(backendId).locator.kind !== 'pi') throw new Error('Backend is not Pi')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nativeId)) throw new Error('Invalid Pi session identity')
  const directory = application.getPath('feature.agents.pi.sessions')
  const files = readdirSync(directory).filter((file) => file.endsWith(`_${nativeId}.jsonl`))
  if (files.length !== 1) throw new Error('Pi session is missing or ambiguous')
  const file = application.getPath('feature.agents.pi.sessions', files[0])
  if (!lstatSync(file).isFile()) throw new Error('Pi session must be a regular file')
  return SessionManager.openExisting(file, nativeId, cwd)
}
