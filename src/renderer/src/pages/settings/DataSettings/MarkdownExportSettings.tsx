import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { RootState, useAppDispatch } from '@renderer/store'
import { setmarkdownExportPath } from '@renderer/store/settings'
import { Button } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelector } from 'react-redux'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const MarkdownExportSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()

  const markdownExportPath = useSelector((state: RootState) => state.settings.markdownExportPath)

  const handleSelectFolder = async () => {
    const path = await window.api.file.selectFolder()
    if (path) {
      dispatch(setmarkdownExportPath(path))
    }
  }

  const handleClearPath = () => {
    dispatch(setmarkdownExportPath(null))
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.markdown_export.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.path')}</SettingRowTitle>
        <HStack alignItems="center" gap="5px" style={{ width: 315 }}>
          <Input
            type="text"
            value={markdownExportPath || ''}
            readOnly
            style={{ width: 250 }}
            placeholder={t('settings.data.markdown_export.path_placeholder')}
            suffix={
              markdownExportPath ? (
                <DeleteOutlined onClick={handleClearPath} style={{ color: 'var(--color-error)', cursor: 'pointer' }} />
              ) : null
            }
          />
          <Button onClick={handleSelectFolder} icon={<FolderOpenOutlined />}>
            {t('settings.data.markdown_export.select')}
          </Button>
        </HStack>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default MarkdownExportSettings
