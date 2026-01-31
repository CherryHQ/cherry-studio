import { ExternalLink } from 'lucide-react'
import type { FC, PropsWithChildren, ReactNode } from 'react'
import React from 'react'

interface ProcessorSettingsLayoutContextValue {
  title: ReactNode
  officialUrl?: string
}

const ProcessorSettingsLayoutContext = React.createContext<ProcessorSettingsLayoutContextValue | null>(null)

const useProcessorSettingsLayoutContext = () => {
  const context = React.use(ProcessorSettingsLayoutContext)
  if (!context) {
    throw new Error('ProcessorSettingsLayout components must be used within ProcessorSettingsLayout.Root')
  }
  return context
}

interface ProcessorSettingsLayoutRootProps extends PropsWithChildren {
  title: ReactNode
  officialUrl?: string
}

const ProcessorSettingsLayoutRoot: FC<ProcessorSettingsLayoutRootProps> = ({ title, officialUrl, children }) => (
  <ProcessorSettingsLayoutContext value={{ title, officialUrl }}>
    <div className="flex w-full flex-col gap-1">{children}</div>
  </ProcessorSettingsLayoutContext>
)

const ProcessorSettingsLayoutHeader: FC = () => {
  const { title, officialUrl } = useProcessorSettingsLayoutContext()

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-2">
        {title}
        {officialUrl && (
          <ExternalLink
            size={14}
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => window.open(officialUrl, '_blank')}
          />
        )}
      </div>
      <div className="border-border border-b" />
    </>
  )
}

const ProcessorSettingsLayoutContent: FC<PropsWithChildren> = ({ children }) => <>{children}</>

const ProcessorSettingsLayout = {
  Root: ProcessorSettingsLayoutRoot,
  Header: ProcessorSettingsLayoutHeader,
  Content: ProcessorSettingsLayoutContent
}

export default ProcessorSettingsLayout
