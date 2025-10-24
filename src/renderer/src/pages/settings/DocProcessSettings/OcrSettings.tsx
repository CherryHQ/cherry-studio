import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrImageProvider } from '@renderer/hooks/ocr/useOcrImageProvider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '..'
import OcrImageSettings from './OcrImageSettings'
import OcrProviderSettings from './OcrProviderSettings'

// const TabSchema = z.enum(['image'])
// type Tab = z.infer<typeof TabSchema>
// const isValidTab = (value: string): value is Tab => TabSchema.safeParse(value).success
// type TabItem = {
//   name: string
//   value: Tab
//   icon: ReactNode
//   content: ReactNode
// }

const OcrSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { imageProvider: provider, updateConfig } = useOcrImageProvider()
  // const [activeTab, setActiveTab] = useState<Tab>('image')
  // const provider = useMemo(() => {
  //   switch (activeTab) {
  //     case 'image':
  //       return imageProvider
  //     default:
  //       return undefined
  //   }
  // }, [imageProvider, activeTab])

  // const tabs = [
  //   {
  //     name: t('settings.tool.ocr.image.title'),
  //     value: 'image',
  //     icon: <PictureOutlined />,
  //     content: <OcrImageSettings />
  //   }
  // ] satisfies TabItem[]

  // const handleTabChange = useCallback((value: string) => {
  //   if (isValidTab(value)) {
  //     setActiveTab(value)
  //   } else {
  //     window.toast.error('Unexpected behavior: Not a valid tab.')
  //   }
  // }, [])

  return (
    <ErrorBoundary>
      <SettingGroup theme={themeMode}>
        <SettingTitle>{t('settings.tool.ocr.title')}</SettingTitle>
        <SettingDivider />
        {/* <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            {tabs.map((tab) => {
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="cursor-pointer">
                  <div className={cn('flex items-center gap-1', tab.value === activeTab && 'text-primary')}>
                    {tab.icon}
                    {tab.name}
                  </div>
                </TabsTrigger>
              )
            })}
          </TabsList>
          {tabs.map((tab) => {
            return (
              <TabsContent key={tab.value} value={tab.value} className="pl-1">
                {tab.content}
              </TabsContent>
            )
          })}
        </Tabs> */}

        {/* Since only image is supported for now, we just don't use tabs component,
            but keep code of tabs. */}
        <OcrImageSettings />
      </SettingGroup>

      <ErrorBoundary>
        <OcrProviderSettings provider={provider} updateConfig={updateConfig} />
      </ErrorBoundary>
    </ErrorBoundary>
  )
}
export default OcrSettings
