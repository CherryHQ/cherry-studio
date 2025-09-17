import { CherryUIProvider } from '@cherrystudio/ui'
import { useSettings } from '@renderer/hooks/useSettings'

const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useSettings()
  return (
    <CherryUIProvider className="flex h-full w-full flex-1" locale={language}>
      {children}
    </CherryUIProvider>
  )
}

export { UIProvider }
