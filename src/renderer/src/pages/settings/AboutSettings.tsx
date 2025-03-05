import { GithubOutlined } from '@ant-design/icons'
import { FileProtectOutlined, GlobalOutlined, MailOutlined, SoundOutlined } from '@ant-design/icons'
import IndicatorLight from '@renderer/components/IndicatorLight'
import { HStack } from '@renderer/components/Layout'
import MinApp from '@renderer/components/MinApp'
import { APP_NAME, AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setUpdateState } from '@renderer/store/runtime'
import { setManualUpdateCheck } from '@renderer/store/settings'
import { ThemeMode } from '@renderer/types'
import { compareVersions, runAsyncFunction } from '@renderer/utils'
import { Avatar, Button, Progress, Row, Switch, Tag } from 'antd'
import { debounce } from 'lodash'
import { FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import { Link } from 'react-router-dom'
import styled from 'styled-components'

import { SettingContainer, SettingDivider, SettingGroup, SettingRow, SettingTitle } from '.'

const AboutSettings: FC = () => {
  const [version, setVersion] = useState('')
  const { t } = useTranslation()
  const { manualUpdateCheck } = useSettings()
  const { theme } = useTheme()
  const dispatch = useAppDispatch()
  const { update } = useRuntime()

  const onCheckUpdate = debounce(
    async () => {
      if (update.checking || update.downloading) {
        return
      }

      if (update.downloaded) {
        window.api.showUpdateDialog()
        return
      }

      dispatch(setUpdateState({ checking: true }))

      try {
        await window.api.checkForUpdate()
      } catch (error) {
        window.message.error(t('settings.about.updateError'))
      }

      dispatch(setUpdateState({ checking: false }))
    },
    2000,
    { leading: true, trailing: false }
  )

  const onOpenWebsite = (url: string) => {
    window.api.openWebsite(url)
  }

  const mailto = async () => {
    const email = 'support@cherry-ai.com'
    const subject = `${APP_NAME} Feedback`
    const version = (await window.api.getAppInfo()).version
    const platform = window.electron.process.platform
    const url = `mailto:${email}?subject=${subject}&body=%0A%0AVersion: ${version} | Platform: ${platform}`
    onOpenWebsite(url)
  }

  const showLicense = async () => {
    const { appPath } = await window.api.getAppInfo()
    MinApp.start({
      name: t('settings.about.license.title'),
      url: `file://${appPath}/resources/cherry-studio/license.html`,
      logo: AppLogo
    })
  }

  const showReleases = async () => {
    const { appPath } = await window.api.getAppInfo()
    MinApp.start({
      name: t('settings.about.releases.title'),
      url: `file://${appPath}/resources/cherry-studio/releases.html?theme=${theme === ThemeMode.dark ? 'dark' : 'light'}`,
      logo: AppLogo
    })
  }

  const hasNewVersion = update?.info?.version && version ? compareVersions(update.info.version, version) > 0 : false

  useEffect(() => {
    runAsyncFunction(async () => {
      const appInfo = await window.api.getAppInfo()
      setVersion(appInfo.version)
    })
  }, [])

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>
          {t('settings.about.title')}
          <HStack alignItems="center">
            <Link to="https://github.com/kangfenmao/cherry-studio">
              <GithubOutlined style={{ marginRight: 4, color: 'var(--color-text)', fontSize: 20 }} />
            </Link>
          </HStack>
        </SettingTitle>
        <SettingDivider />
        <AboutHeader>
          <Row align="middle">
            <AvatarWrapper onClick={() => onOpenWebsite('https://github.com/kangfenmao/cherry-studio')}>
              {update.downloadProgress > 0 && (
                <ProgressCircle
                  type="circle"
                  size={84}
                  percent={update.downloadProgress}
                  showInfo={false}
                  strokeLinecap="butt"
                  strokeColor="#67ad5b"
                />
              )}
              <Avatar src={AppLogo} size={80} style={{ minHeight: 80 }} />
            </AvatarWrapper>
            <VersionWrapper>
              <Title>{APP_NAME}</Title>
              <Description>{t('settings.about.description')}</Description>
              <Tag
                onClick={() => onOpenWebsite('https://github.com/kangfenmao/cherry-studio/releases')}
                color="cyan"
                style={{ marginTop: 8, cursor: 'pointer' }}>
                v{version}
              </Tag>
            </VersionWrapper>
          </Row>
          <CheckUpdateButton
            onClick={onCheckUpdate}
            loading={update.checking}
            disabled={update.downloading || update.checking}>
            {update.downloading
              ? t('settings.about.downloading')
              : update.available
                ? t('settings.about.checkUpdate.available')
                : t('settings.about.checkUpdate')}
          </CheckUpdateButton>
        </AboutHeader>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>{t('settings.general.manually_check_update.title')}</SettingRowTitle>
          <Switch value={manualUpdateCheck} onChange={(v) => dispatch(setManualUpdateCheck(v))} />
        </SettingRow>
      </SettingGroup>
      {hasNewVersion && update.info && (
        <SettingGroup theme={theme}>
          <SettingRow>
            <SettingRowTitle>
              {t('settings.about.updateAvailable', { version: update.info.version })}
              <IndicatorLight color="green" />
            </SettingRowTitle>
          </SettingRow>
          <UpdateNotesWrapper>
            <Markdown>
              {typeof update.info.releaseNotes === 'string'
                ? update.info.releaseNotes.replaceAll('\n', '\n\n')
                : update.info.releaseNotes?.map((note) => note.note).join('\n')}
            </Markdown>
          </UpdateNotesWrapper>
        </SettingGroup>
      )}
      <SettingGroup theme={theme}>
        <SettingRow>
          <SettingRowTitle>
            <SoundOutlined />
            {t('settings.about.releases.title')}
          </SettingRowTitle>
          <Button onClick={showReleases}>{t('settings.about.releases.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <GlobalOutlined />
            {t('settings.about.website.title')}
          </SettingRowTitle>
          <Button onClick={() => onOpenWebsite('https://cherry-ai.com')}>{t('settings.about.website.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <GithubOutlined />
            {t('settings.about.feedback.title')}
          </SettingRowTitle>
          <Button onClick={() => onOpenWebsite('https://github.com/kangfenmao/cherry-studio/issues/new/choose')}>
            {t('settings.about.feedback.button')}
          </Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <FileProtectOutlined />
            {t('settings.about.license.title')}
          </SettingRowTitle>
          <Button onClick={showLicense}>{t('settings.about.license.button')}</Button>
        </SettingRow>
        <SettingDivider />
        <SettingRow>
          <SettingRowTitle>
            <MailOutlined /> {t('settings.about.contact.title')}
          </SettingRowTitle>
          <Button onClick={mailto}>{t('settings.about.contact.button')}</Button>
        </SettingRow>
      </SettingGroup>
    </SettingContainer>
  )
}

const AboutHeader = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 5px 0;
`

const VersionWrapper = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 80px;
  justify-content: center;
  align-items: flex-start;
`

const Title = styled.div`
  font-size: 20px;
  font-weight: bold;
  color: var(--color-text-1);
  margin-bottom: 5px;
`

const Description = styled.div`
  font-size: 14px;
  color: var(--color-text-2);
  text-align: center;
`

const CheckUpdateButton = styled(Button)``

const AvatarWrapper = styled.div`
  position: relative;
  cursor: pointer;
  margin-right: 15px;
`

const ProgressCircle = styled(Progress)`
  position: absolute;
  top: -2px;
  left: -2px;
`

export const SettingRowTitle = styled.div`
  font-size: 14px;
  line-height: 18px;
  color: var(--color-text-1);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  .anticon {
    font-size: 16px;
    color: var(--color-text-1);
  }
`

const UpdateNotesWrapper = styled.div`
  padding: 12px 0;
  margin: 8px 0;
  background-color: var(--color-bg-2);
  border-radius: 6px;

  p {
    margin: 0;
    color: var(--color-text-2);
    font-size: 14px;
  }
`

export default AboutSettings
