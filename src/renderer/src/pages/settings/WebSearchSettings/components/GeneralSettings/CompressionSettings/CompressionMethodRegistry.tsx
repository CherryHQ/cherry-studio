import type { WebSearchCompressionMethod } from '@shared/data/preference/preferenceTypes'
import type { ReactNode } from 'react'
import { lazy, Suspense } from 'react'

const CutoffSettings = lazy(() => import('./CutoffSettings'))
const RagSettings = lazy(() => import('./RagSettings'))

type CompressionRenderer = () => ReactNode

const registry: Record<WebSearchCompressionMethod, CompressionRenderer | null> = {
  none: null,
  cutoff: () => <CutoffSettings />,
  rag: () => <RagSettings />
}

export function getCompressionRenderer(method: WebSearchCompressionMethod): ReactNode {
  const renderer = registry[method]
  if (!renderer) return null

  return <Suspense fallback={<div className="p-4">Loading...</div>}>{renderer()}</Suspense>
}

export function registerCompressionMethod(method: WebSearchCompressionMethod, renderer: CompressionRenderer): void {
  registry[method] = renderer
}
