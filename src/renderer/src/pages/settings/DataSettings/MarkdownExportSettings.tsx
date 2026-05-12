import { DeleteOutlined, FolderOpenOutlined } from '@ant-design/icons'
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  RowFlex,
  Switch
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
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
      void setmarkdownExportPath(path)
    }
  }

  const handleClearPath = () => {
    void setmarkdownExportPath(null)
  }

  const handleToggleForceDollarMath = (checked: boolean) => {
    void setForceDollarMathInMarkdown(checked)
  }

  const handleToggleTopicNaming = (checked: boolean) => {
    void setUseTopicNamingForMessageTitle(checked)
  }

  const handleToggleShowModelName = (checked: boolean) => {
    void setShowModelNameInMarkdown(checked)
  }

  const handleToggleShowModelProvider = (checked: boolean) => {
    void setShowModelProviderInMarkdown(checked)
  }

  const handleToggleExcludeCitations = (checked: boolean) => {
    void setExcludeCitationsInExport(checked)
  }

  const handleToggleStandardizeCitations = (checked: boolean) => {
    void setStandardizeCitationsInExport(checked)
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.data.markdown_export.title')}</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.path')}</SettingRowTitle>
        <RowFlex className="w-[315px] items-center gap-1.25">
          <InputGroup className="h-8 w-[250px]">
            <InputGroupInput
              type="text"
              value={markdownExportPath || ''}
              readOnly
              placeholder={t('settings.data.markdown_export.path_placeholder')}
            />
            {markdownExportPath && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  onClick={handleClearPath}
                  size="icon-sm"
                  className="text-destructive hover:text-destructive">
                  <DeleteOutlined />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          <Button onClick={handleSelectFolder} variant="outline" className="h-8">
            <FolderOpenOutlined />
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
        <Switch checked={forceDollarMathInMarkdown} onCheckedChange={handleToggleForceDollarMath} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.force_dollar_math.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.message_title.use_topic_naming.title')}</SettingRowTitle>
        <Switch checked={useTopicNamingForMessageTitle} onCheckedChange={handleToggleTopicNaming} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.message_title.use_topic_naming.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_name.title')}</SettingRowTitle>
        <Switch checked={showModelNameInExport} onCheckedChange={handleToggleShowModelName} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_name.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.show_model_provider.title')}</SettingRowTitle>
        <Switch checked={showModelProviderInMarkdown} onCheckedChange={handleToggleShowModelProvider} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.show_model_provider.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.exclude_citations.title')}</SettingRowTitle>
        <Switch checked={excludeCitationsInExport} onCheckedChange={handleToggleExcludeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.exclude_citations.help')}</SettingHelpText>
      </SettingRow>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>{t('settings.data.markdown_export.standardize_citations.title')}</SettingRowTitle>
        <Switch checked={standardizeCitationsInExport} onCheckedChange={handleToggleStandardizeCitations} />
      </SettingRow>
      <SettingRow>
        <SettingHelpText>{t('settings.data.markdown_export.standardize_citations.help')}</SettingHelpText>
      </SettingRow>
    </SettingGroup>
  )
}

export default MarkdownExportSettings
