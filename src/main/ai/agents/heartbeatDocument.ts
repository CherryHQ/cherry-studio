import path from 'node:path'
import { buffer } from 'node:stream/consumers'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { atomicWriteIfUnchanged, hashContent, openReadableFileSnapshot } from '@main/utils/file'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { HeartbeatDocument } from '@shared/ipc/schemas/ai'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { agentDataDirectoryPath, assertAgentStoragePath, ensureAgentStorageDirectory } from './agentDataDirectory'
import { ensureHeartbeatFile } from './heartbeat'

async function heartbeatPath(agentId: string) {
  const agent = agentService.getAgent(agentId)
  if (!agent || !AGENT_RUNTIME_CAPABILITIES[agent.type]?.heartbeat) {
    throw new Error(`Heartbeat unavailable for agent: ${agentId}`)
  }
  const root = application.getPath('feature.agents.data')
  const directory = agentDataDirectoryPath(root, agentId)
  await ensureAgentStorageDirectory(root, directory)
  await ensureHeartbeatFile(directory)
  const target = AbsoluteFilePathSchema.parse(path.join(directory, 'heartbeat.md'))
  await assertAgentStoragePath(root, target)
  return target
}

export async function readHeartbeatDocument(agentId: string): Promise<HeartbeatDocument> {
  const target = await heartbeatPath(agentId)
  const snapshot = await openReadableFileSnapshot(target)
  try {
    const bytes = await buffer(snapshot.createReadStream())
    return {
      content: bytes.toString('utf8'),
      version: { mtime: snapshot.modifiedAt, size: snapshot.size },
      contentHash: hashContent(bytes)
    }
  } finally {
    await snapshot.close()
  }
}

export async function writeHeartbeatDocument(agentId: string, document: HeartbeatDocument): Promise<HeartbeatDocument> {
  const target = await heartbeatPath(agentId)
  const version = await atomicWriteIfUnchanged(target, document.content, document.version, document.contentHash)
  return { content: document.content, version, contentHash: hashContent(document.content) }
}
