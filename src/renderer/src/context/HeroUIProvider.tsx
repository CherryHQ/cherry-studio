import { HeroUIProvider } from '@heroui/react'
import { useSettings } from '@renderer/hooks/useSettings'

const AppHeroUIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useSettings()
  return (
    <HeroUIProvider className="flex h-full w-full flex-1" locale={language}>
      {children}
    </HeroUIProvider>
  )
}

export { AppHeroUIProvider as HeroUIProvider }
