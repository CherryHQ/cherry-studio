import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import CustomLanguageTable from '@renderer/pages/settings/TranslateSettings/CustomLanguageTable'
import { getAllCustomLanguages } from '@renderer/services/TranslateService'
import { CustomTranslateLanguage } from '@renderer/types'
import { Button, Typography } from 'antd'
import { t } from 'i18next'
import { Plus } from 'lucide-react'
import { startTransition, Suspense, useEffect, useState } from 'react'
import styled from 'styled-components'

import { SettingContainer, SettingGroup } from '..'
import CustomLanguageModal from './CustomLanguageModal'
import TranslateModelSettings from './TranslateModelSettings'
import TranslatePromptSettings from './TranslatePromptSettings'

const TranslateSettings = () => {
  const { theme } = useTheme()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingCustomLanguage, setEditingCustomLanguage] = useState<CustomTranslateLanguage>()
  const [dataPromise, setDataPromise] = useState<Promise<CustomTranslateLanguage[]>>(Promise.resolve([]))

  useEffect(() => {
    setDataPromise(getAllCustomLanguages())
  }, [])

  const onAdd = () => {
    startTransition(() => {
      setEditingCustomLanguage(undefined)
      setIsModalOpen(true)
    })
  }

  const onOK = () => {
    startTransition(() => {
      setIsModalOpen(false)
    })
  }

  return (
    <>
      <SettingContainer theme={theme}>
        <TranslateModelSettings />
        <TranslatePromptSettings />
        <SettingGroup theme={theme}>
          <CustomLanguageSettings>
            <HStack justifyContent="space-between" style={{ padding: '4px 0' }}>
              <Typography.Title level={5}>{t('translate.custom.label')}</Typography.Title>
              <Button type="primary" icon={<Plus size={16} />} onClick={onAdd}>
                {t('common.add')}
              </Button>
            </HStack>
            <Suspense fallback={<span>loading</span>}>
              <CustomLanguageTable dataPromise={dataPromise} />
            </Suspense>
          </CustomLanguageSettings>
        </SettingGroup>
      </SettingContainer>
      <CustomLanguageModal
        isOpen={isModalOpen}
        editingCustomLanguage={editingCustomLanguage}
        onOK={onOK}
        onCancel={() => setIsModalOpen(false)}
      />
    </>
  )
}

const CustomLanguageSettings = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`

export default TranslateSettings
