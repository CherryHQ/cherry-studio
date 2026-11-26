import { createContext, type ReactNode } from 'react'

import type { ProjectionLayoutReader, ProjectionPartReader } from '@renderer/types/message'

import { ProjectionPartContext } from './useProjectionPart'

export const ProjectionLayoutContext = createContext<ProjectionLayoutReader | undefined>(undefined)

export function ProjectionReaderProvider({
  reader,
  children
}: {
  reader: ProjectionPartReader & ProjectionLayoutReader
  children: ReactNode
}) {
  return (
    <ProjectionLayoutContext value={reader}>
      <ProjectionPartContext value={reader}>{children}</ProjectionPartContext>
    </ProjectionLayoutContext>
  )
}
