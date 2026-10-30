import { notifyDataApiDataChange } from '@data/dataApiDataChange'

export function notifyExternalKnowledgeSourceChange(
  baseId: string,
  sourceId: string,
  kind: 'membership' | 'projection'
): void {
  notifyDataApiDataChange([
    {
      endpoint: '/knowledge-bases/:id/external-knowledge-sources',
      kind,
      routeParams: { id: baseId },
      entityIds: [sourceId]
    },
    { endpoint: '/external-knowledge-sources/:id', routeParams: { id: sourceId }, entityIds: [sourceId] }
  ])
}

export function notifyExternalKnowledgeSyncContentChange(baseId: string, sourceId: string): void {
  notifyDataApiDataChange([
    {
      endpoint: '/external-knowledge-sources/:id/documents',
      kind: 'membership',
      routeParams: { id: sourceId }
    },
    { endpoint: '/external-knowledge-documents/:id' },
    { endpoint: '/knowledge-bases/:id/items', kind: 'membership', routeParams: { id: baseId } },
    { endpoint: '/knowledge-items/:id' }
  ])
}
