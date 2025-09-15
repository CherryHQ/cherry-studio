import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { RowFlex } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import { Button, Switch } from 'antd'
import Input from 'antd/es/input/Input'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingHelpText, SettingRow, SettingRowTitle, SettingTitle } from '..'

const MarkdownExportSettings: FC = () => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const [markdownExportPath, setmarkdownExportPath] = usePreference('data.export.markdown.path')
  const [forceDollarMathInMarkdown, setForceDollarMathInMarkdown] = usePreference(
    'data.export.markdown.force_dollar_math'
  )
  const [useTopicNamingForMessageTitle, setUseTopicNamingForMessageTitle] = usePreference(
    'data.export.markdown.use_topic_naming_for_message_title'
  )
  const [showModelNameInExport, setShowModelNameInMarkdown] = usePreference('data.export.markdown.show_model_name')
  const [showModelProviderInMarkdown, setShowModelProviderInMarkdown] = usePreference(
    'data.export.markdown.show_model_provider'
  )
  const [excludeCitationsInExport, setExcludeCitationsInExport] = usePreference(
    'data.export.markdown.exclude_citations'
  )
  const [standardizeCitationsInExport, setStandardizeCitationsInExport] = usePreference(
    'data.export.markdown.standardize_citations'
  )

  const handleSelectFolder = async () => {
    const path = await window.api.file.selectFolder()
    if (path) {
      setmarkdownExportPath(path)
    }
  }

  const handleClearPath = () => {
    setmarkdownExportPath(null)
  }

  const handleToggleForceDollarMath = (checked: boolean) => {
    setForceDollarMathInMarkdown(checked)
  }

  const handleToggleTopicNaming = (checked: boolean) => {
    setUseTopicNamingForMessageTitle(checked)
  }

  const handleToggleShowModelName = (checked: boolean) => {
    setShowModelNameInMarkdown(checked)
  }

  const handleToggleShowModelProvider = (checked: boolean) => {
    setShowModelProviderInMarkdown(checked)
  }

  const handleToggleExcludeCitations = (checked: boolean) => {
    setExcludeCitationsInExport(checked)
  }

  const handleToggleStandardizeCitations = (checked: boolean) => {
    setStandardizeCitationsInExport(checked)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.markdown_export.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.path')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-[5px]">
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
        </RowFlex>
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.force_dollar_math.title')}</SettingRowTitle>
        <Switch checked={forceDollarMathInMarkdown} onChange={handleToggleForceDollarMath} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.force_dollar_math.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.message_title.use_topic_naming.title')}</SettingRowTitle>
        <Switch checked={useTopicNamingForMessageTitle} onChange={handleToggleTopicNaming} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.message_title.use_topic_naming.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_name.title')}</SettingRowTitle>
        <Switch checked={showModelNameInExport} onChange={handleToggleShowModelName} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_name.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_provider.title')}</SettingRowTitle>
        <Switch checked={showModelProviderInMarkdown} onChange={handleToggleShowModelProvider} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_provider.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.exclude_citations.title')}</SettingRowTitle>
        <Switch checked={excludeCitationsInExport} onChange={handleToggleExcludeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.exclude_citations.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.standardize_citations.title')}</SettingRowTitle>
        <Switch checked={standardizeCitationsInExport} onChange={handleToggleStandardizeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.standardize_citations.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default MarkdownExportSettings
