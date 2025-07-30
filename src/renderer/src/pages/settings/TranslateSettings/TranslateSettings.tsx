import { useTheme } from '@renderer/context/ThemeProvider'
import CustomLanguageTable from '@renderer/pages/settings/TranslateSettings/CustomLanguageTable'
import { getAllCustomLanguages } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Spin } from 'antd'
import { Suspense, useEffect, useState } from 'react'

import { SettingContainer, SettingGroup } from '..'
import TranslateModelSettings from './TranslateModelSettings'
import TranslatePromptSettings from './TranslatePromptSettings'

const TranslateSettings = () => {
  const { theme } = useTheme()

  const [dataPromise, setDataPromise] = useState<Promise<CustomTranslateLanguage[]>>(Promise.resolve([]))

  useEffect(() => {
    setDataPromise(getAllCustomLanguages())
  }, [])

  return (
    <>
      <SettingContainer theme={theme}>
        <TranslateModelSettings />
        <TranslatePromptSettings />
        <SettingGroup theme={theme}>
          <Suspense fallback={<CustomLanguagesSettingsFallback />}>
            <CustomLanguageTable dataPromise={dataPromise} />
          </Suspense>
        </SettingGroup>
      </SettingContainer>
    </>
  )
}

const CustomLanguagesSettingsFallback = () => {
  return (
    <div
      style={{
        width: '100%',
        height: 200,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
      <Spin />
    </div>
  )
}

export default TranslateSettings
