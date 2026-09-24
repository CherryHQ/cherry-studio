import path from 'node:path'

import { application } from '@application'
import { stagePortableAgentTranscript } from '@main/ai/runtime/claudeCode'
import { capturePortableKnowledgeIndex, knowledgeBaseIdFromManagedPath } from '@main/features/knowledge'

import type { ResourceRoots } from './adapters'
import type { CaptureOwnerResource, RunOwnerCaptureBoundary } from './stageResources'

export function createOwnerResourceCapture(input: { readonly detachedDbPath: string; readonly roots: ResourceRoots }): {
  readonly captureOwnerResource: CaptureOwnerResource
  readonly runOwnerCaptureBoundary: RunOwnerCaptureBoundary
} {
  const baseIdFor = (sourcePath: string): string => {
    const baseId = knowledgeBaseIdFromManagedPath(input.roots.knowledge, sourcePath)
    if (!baseId) throw new Error('Knowledge resource is outside its owner-managed base root')
    return baseId
  }

  return {
    async captureOwnerResource(context) {
      if (context.requirement.kind === 'agent-transcript') {
        await stagePortableAgentTranscript({
          detachedDbPath: input.detachedDbPath,
          transcriptRoot: input.roots.agentTranscripts,
          agentRuntimeConfigRoot: input.roots.agentRuntimeConfig,
          sourcePath: context.sourcePath,
          stagedPath: context.stagingPath
        })
        return {}
      }
      if (context.requirement.kind !== 'knowledge-base') return {}
      const destination = path.join(context.stagingPath, '.cherry', 'index.sqlite')
      const result = await capturePortableKnowledgeIndex({
        baseId: baseIdFor(context.sourcePath),
        detachedDbPath: input.detachedDbPath,
        destination,
        signal: context.signal
      })
      return result.status === 'ready'
        ? {}
        : {
            degradations: [
              {
                relativePath: '.cherry/index.sqlite',
                reason: 'knowledge-index-rebuild-required' as const
              }
            ]
          }
    },

    async runOwnerCaptureBoundary(context, capture) {
      if (context.requirement.kind !== 'knowledge-base') return capture()
      return application.get('KnowledgeService').withPortableSnapshotBoundary(baseIdFor(context.sourcePath), capture)
    }
  }
}
