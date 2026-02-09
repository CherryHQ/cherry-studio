import type { FC, PropsWithChildren, ReactNode } from 'react'
import React from 'react'

interface ScenarioSectionContextValue {
  title: ReactNode
  description: ReactNode
}

const ScenarioSectionContext = React.createContext<ScenarioSectionContextValue | null>(null)

const useScenarioSectionContext = () => {
  const context = React.use(ScenarioSectionContext)
  if (!context) {
    throw new Error('ScenarioSection components must be used within ScenarioSection.Root')
  }
  return context
}

interface ScenarioSectionRootProps extends PropsWithChildren {
  title: ReactNode
  description: ReactNode
}

const ScenarioSectionRoot: FC<ScenarioSectionRootProps> = ({ title, description, children }) => (
  <ScenarioSectionContext value={{ title, description }}>
    <div className="flex flex-col gap-2 px-4 py-2">{children}</div>
  </ScenarioSectionContext>
)

const ScenarioSectionTitle: FC = () => {
  const { title } = useScenarioSectionContext()
  return <div className="font-medium text-sm">{title}</div>
}

const ScenarioSectionDescription: FC = () => {
  const { description } = useScenarioSectionContext()
  return <p className="mb-2 text-muted-foreground text-xs">{description}</p>
}

const ScenarioSectionDivider: FC = () => <div className="border-border border-b" />

const ScenarioSectionRow: FC<PropsWithChildren> = ({ children }) => (
  <div className="mt-2 flex flex-row items-center justify-between">{children}</div>
)

const ScenarioSection = {
  Root: ScenarioSectionRoot,
  Title: ScenarioSectionTitle,
  Description: ScenarioSectionDescription,
  Divider: ScenarioSectionDivider,
  Row: ScenarioSectionRow
}

export default ScenarioSection
