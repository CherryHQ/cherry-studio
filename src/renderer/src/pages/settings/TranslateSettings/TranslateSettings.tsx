import SvgSpinners180Ring from '@renderer/components/Icons/SvgSpinners180Ring'
import { useTheme } from '@renderer/context/ThemeProvider'
import CustomLanguageSettings from '@renderer/pages/settings/TranslateSettings/CustomLanguageSettings'
import { getAllCustomLanguages } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
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
        <SettingGroup theme={theme} style={{ flex: 1 }}>
          <Suspense fallback={<CustomLanguagesSettingsFallback />}>
            <CustomLanguageSettings dataPromise={dataPromise} />
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
        height: 250,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
      <SvgSpinners180Ring />
    </div>
  )
}

export default TranslateSettings
