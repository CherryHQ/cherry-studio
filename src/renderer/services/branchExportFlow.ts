/**
 * Branch-export orchestration for topic export handlers.
 *
 * Gatekeeper in front of every topic-level export: topics without branches
 * short-circuit to the legacy pipeline (zero behavior change), branched topics
 * ask the user for a scope (trunk / appendix / files) and get a pre-rendered
 * artifact. Resolves null when the user cancels the dialog.
 */

import { dataApiService } from '@data/DataApiService'
import BranchExportModePopup from '@renderer/components/BranchExportModePopup'
import type { ExportArtifact, TopicExportOptions } from '@renderer/services/topicTreeExport'
import { type BranchExportMode, fetchTopicExportTree, renderTopicExport } from '@renderer/services/topicTreeExport'
import type { ExportTreeResponse, TreeResponse } from '@shared/data/types/message'

export interface TopicExportRequest {
  topicId: string
  /** Whether the calling target can receive a file set; disables the file mode when false */
  supportsFileSet: boolean
  /** Mirrors the legacy per-target reasoning options */
  exportReasoning?: boolean
  /** Variant fold style override (Word pipeline uses blockquote) */
  variantStyle?: TopicExportOptions['variantStyle']
}

export type PreparedTopicExport =
  | { path: 'legacy' }
  | { path: 'tree'; mode: BranchExportMode; artifact: ExportArtifact; tree: ExportTreeResponse }

/**
 * Whether a light tree response contains any message outside the active path.
 * Sibling-group members count too — they fold as variants on branch-aware
 * exports, so their presence should also trigger the scope dialog.
 */
function countOffPathMessages(tree: TreeResponse): { offPath: number; total: number } {
  const parentById = new Map<string, string>()
  for (const node of tree.nodes) {
    parentById.set(node.id, node.parentId)
  }
  for (const group of tree.siblingsGroups) {
    for (const node of group.nodes) {
      parentById.set(node.id, group.parentId)
    }
  }

  const activePath = new Set<string>()
  let cursor: string | undefined = tree.activeNodeId ?? undefined
  while (cursor) {
    activePath.add(cursor)
    cursor = parentById.get(cursor)
  }

  let offPath = 0
  for (const id of parentById.keys()) {
    if (!activePath.has(id)) {
      offPath += 1
    }
  }
  return { offPath, total: parentById.size }
}

export async function prepareTopicExport(request: TopicExportRequest): Promise<PreparedTopicExport | null> {
  const lightTree = (await dataApiService.get(`/topics/${request.topicId}/tree`, {
    query: { depth: -1 }
  })) as TreeResponse
  const { offPath, total } = countOffPathMessages(lightTree)
  if (offPath === 0) {
    return { path: 'legacy' }
  }

  const mode = await BranchExportModePopup.show({
    branchCount: offPath,
    messageCount: total,
    supportsFileSet: request.supportsFileSet
  })
  if (!mode) {
    return null
  }

  const tree = await fetchTopicExportTree(request.topicId)
  const artifact = await renderTopicExport(tree, mode, {
    exportReasoning: request.exportReasoning,
    variantStyle: request.variantStyle
  })
  // Tree rides along so block-building targets (Notion) don't refetch it
  return { path: 'tree', mode, artifact, tree }
}
