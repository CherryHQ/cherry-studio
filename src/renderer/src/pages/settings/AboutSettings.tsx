import { Badge, Button, CircularProgress, Divider, RadioGroup, RadioGroupItem, Switch, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import LogoAvatar from '@renderer/components/Icons/LogoAvatar'
import IndicatorLight from '@renderer/components/IndicatorLight'
import UpdateDialogPopup from '@renderer/components/Popups/UpdateDialogPopup'
import { APP_NAME, AppLogo } from '@renderer/config/env'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdate'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import i18n from '@renderer/i18n'
import { cn, runAsyncFunction } from '@renderer/utils'
import { ThemeMode, UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { debounce } from 'lodash'
import { BadgeQuestionMark, Briefcase, Bug, Building2, Github, Globe, Mail, Rss } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

const AboutSettings: FC = () => {
  const [autoCheckUpdate, setAutoCheckUpdate] = usePreference('app.dist.auto_update.enabled')
  const [testPlan, setTestPlan] = usePreference('app.dist.test_plan.enabled')
  const [testChannel, setTestChannel] = usePreference('app.dist.test_plan.channel')

  const [version, setVersion] = useState('')
  const [isPortable, setIsPortable] = useState(false)
  const { t } = useTranslation()
  const { theme } = useTheme()
  const { openSmartMinapp } = useMinappPopup()

  const { appUpdateState, updateAppUpdateState } = useAppUpdateState()

  const onCheckUpdate = debounce(
    async () => {
      if (appUpdateState.checking || appUpdateState.downloading) {
        return
      }

      if (appUpdateState.downloaded) {
        void UpdateDialogPopup.show({ releaseInfo: appUpdateState.info || null })
        return
      }

      updateAppUpdateState({ checking: true, manualCheck: true })

      try {
        await window.api.checkForUpdate()
      } catch {
        updateAppUpdateState({ manualCheck: false })
        window.toast.error(t('settings.about.updateError'))
      }

      updateAppUpdateState({ checking: false })
    },
    2000,
    { leading: true, trailing: false }
  )

  const onOpenWebsite = (url: string) => {
    void window.api.openWebsite(url)
  }

  const mailto = async () => {
    const email = 'support@cherry-ai.com'
    const subject = `${APP_NAME} Feedback`
    const version = (await window.api.getAppInfo()).version
    const platform = window.electron.process.platform
    const url = `mailto:${email}?subject=${subject}&body=%0A%0AVersion: ${version} | Platform: ${platform}`
    onOpenWebsite(url)
  }

  const debug = async () => {
    await window.api.devTools.toggle()
  }

  const showEnterprise = async () => {
    onOpenWebsite('https://enterprise.cherry-ai.com')
  }

  const showReleases = async () => {
    const { appPath } = await window.api.getAppInfo()
    openSmartMinapp({
      id: 'cherrystudio-releases',
      name: t('settings.about.releases.title'),
      url: `file://${appPath}/resources/cherry-studio/releases.html?theme=${theme === ThemeMode.dark ? 'dark' : 'light'}`,
      logo: AppLogo
    })
  }

  const currentChannelByVersion =
    [
      { pattern: `-${UpgradeChannel.BETA}.`, channel: UpgradeChannel.BETA },
      { pattern: `-${UpgradeChannel.RC}.`, channel: UpgradeChannel.RC }
    ].find(({ pattern }) => version.includes(pattern))?.channel || UpgradeChannel.LATEST

  const handleTestChannelChange = async (value: UpgradeChannel) => {
    if (testPlan && currentChannelByVersion !== UpgradeChannel.LATEST && value !== currentChannelByVersion) {
      window.toast.warning(t('settings.general.test_plan.version_channel_not_match'))
    }
    void setTestChannel(value)
    updateAppUpdateState({
      available: false,
      info: null,
      downloaded: false,
      checking: false,
      downloading: false,
      downloadProgress: 0
    })
  }

  const getAvailableTestChannels = () => {
    return [
      {
        tooltip: t('settings.general.test_plan.rc_version_tooltip'),
        label: t('settings.general.test_plan.rc_version'),
        value: UpgradeChannel.RC
      },
      {
        tooltip: t('settings.general.test_plan.beta_version_tooltip'),
        label: t('settings.general.test_plan.beta_version'),
        value: UpgradeChannel.BETA
      }
    ]
  }

  const handleSetTestPlan = (value: boolean) => {
    void setTestPlan(value)
    updateAppUpdateState({
      available: false,
      info: null,
      downloaded: false,
      checking: false,
      downloading: false,
      downloadProgress: 0
    })

    if (value === true) {
      void setTestChannel(getTestChannel())
    }
  }

  const getTestChannel = () => {
    if (testChannel === UpgradeChannel.LATEST) {
      return UpgradeChannel.RC
    }
    return testChannel
  }

  useEffect(() => {
    void runAsyncFunction(async () => {
      const appInfo = await window.api.getAppInfo()
      setVersion(appInfo.version)
      setIsPortable(appInfo.isPortable)
    })
    void setAutoCheckUpdate(autoCheckUpdate)
  }, [autoCheckUpdate, setAutoCheckUpdate])

  const onOpenDocs = () => {
    const isChinese = i18n.language.startsWith('zh')
    void window.api.openWebsite(isChinese ? 'https://docs.cherry-ai.com/' : 'https://docs.cherry-ai.com/docs/en-us')
  }

  const testChannels = getAvailableTestChannels()

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-y-auto px-5 py-4 [&::-webkit-scrollbar]:hidden'
      )}>
      <AboutGroup theme={theme}>
        <div className="flex select-none items-center justify-between gap-2 font-bold text-sm">
          <div>{t('settings.about.title')}</div>
          <button
            type="button"
            onClick={() => onOpenWebsite('https://github.com/CherryHQ/cherry-studio')}
            className="inline-flex items-center justify-center rounded-md p-1 text-(--color-foreground) transition-colors hover:bg-(--color-muted)">
            <Github className="size-5" />
          </button>
        </div>

        <Divider className="my-1.5" />

        <div className="flex flex-wrap items-center justify-between gap-3 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenWebsite('https://github.com/CherryHQ/cherry-studio')}
              className="relative cursor-pointer">
              {appUpdateState.downloadProgress > 0 && (
                <div className="-top-0.5 -left-0.5 pointer-events-none absolute">
                  <CircularProgress
                    value={appUpdateState.downloadProgress}
                    size={76}
                    strokeWidth={4}
                    shape="square"
                    className="stroke-transparent"
                    progressClassName="stroke-[#67ad5b]"
                  />
                </div>
              )}
              <LogoAvatar logo={AppLogo} size={72} className="rounded-full" />
            </button>

            <div className="flex min-h-[72px] flex-col items-start justify-center">
              <div className="mb-1 font-bold text-(--color-foreground) text-lg">{APP_NAME}</div>
              <div className="text-(--color-foreground-secondary) text-sm">{t('settings.about.description')}</div>
              <button
                type="button"
                onClick={() => onOpenWebsite('https://github.com/CherryHQ/cherry-studio/releases')}
                className="mt-1.5">
                <Badge className="cursor-pointer rounded-[10px] border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 font-medium text-cyan-500 text-sm transition-colors hover:bg-cyan-500/15">
                  v{version}
                </Badge>
              </button>
            </div>
          </div>

          {!isPortable && (
            <div className="flex shrink-0 items-center justify-end">
              <Button
                size="sm"
                loading={appUpdateState.checking}
                onClick={onCheckUpdate}
                disabled={appUpdateState.downloading}
                className="!w-fit !min-w-0 shrink-0">
                {appUpdateState.downloading
                  ? t('settings.about.downloading')
                  : appUpdateState.available
                    ? t('settings.about.checkUpdate.available')
                    : t('settings.about.checkUpdate.label')}
              </Button>
            </div>
          )}
        </div>

        {!isPortable && (
          <>
            <Divider className="my-3" />
            <AboutRow>
              <AboutRowTitle>{t('settings.general.auto_check_update.title')}</AboutRowTitle>
              <Switch checked={autoCheckUpdate} onCheckedChange={(v) => setAutoCheckUpdate(v)} />
            </AboutRow>

            <Divider className="my-3" />
            <AboutRow>
              <AboutRowTitle>{t('settings.general.test_plan.title')}</AboutRowTitle>
              <Tooltip content={t('settings.general.test_plan.tooltip')}>
                <Switch checked={testPlan} onCheckedChange={(v) => handleSetTestPlan(v)} />
              </Tooltip>
            </AboutRow>

            {testPlan && (
              <>
                <Divider className="my-1.5" />
                <AboutRow className="items-start">
                  <AboutRowTitle className="pt-1">{t('settings.general.test_plan.version_options')}</AboutRowTitle>
                  <RadioGroup
                    className="flex flex-wrap justify-end gap-3"
                    value={getTestChannel()}
                    onValueChange={(value) => handleTestChannelChange(value as UpgradeChannel)}>
                    {testChannels.map((option) => {
                      const id = `about-test-channel-${option.value}`
                      return (
                        <Tooltip key={option.value} content={option.tooltip}>
                          <label
                            htmlFor={id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-(--color-border) px-3 py-2 text-(--color-foreground) text-sm transition-colors hover:bg-(--color-background-subtle)">
                            <RadioGroupItem id={id} value={option.value} />
                            <span>{option.label}</span>
                          </label>
                        </Tooltip>
                      )
                    })}
                  </RadioGroup>
                </AboutRow>
              </>
            )}
          </>
        )}
      </AboutGroup>

      {appUpdateState.info && appUpdateState.available && (
        <AboutGroup theme={theme}>
          <AboutRow>
            <AboutRowTitle>
              {t('settings.about.updateAvailable', { version: appUpdateState.info.version })}
              <IndicatorLight color="green" />
            </AboutRowTitle>
          </AboutRow>
          <div className="markdown my-2 rounded-md bg-muted px-0 py-3 text-(--color-foreground-secondary) text-sm [&_p]:m-0">
            <Markdown>
              {typeof appUpdateState.info.releaseNotes === 'string'
                ? appUpdateState.info.releaseNotes.replace(/\n/g, '\n\n')
                : appUpdateState.info.releaseNotes?.map((note) => note.note).join('\n')}
            </Markdown>
          </div>
        </AboutGroup>
      )}

      <AboutGroup theme={theme}>
        <AboutActionRow
          icon={<BadgeQuestionMark className="size-4.5" />}
          title={t('docs.title')}
          actionLabel={t('settings.about.website.button')}
          onAction={onOpenDocs}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Rss className="size-4.5" />}
          title={t('settings.about.releases.title')}
          actionLabel={t('settings.about.releases.button')}
          onAction={showReleases}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Globe className="size-4.5" />}
          title={t('settings.about.website.title')}
          actionLabel={t('settings.about.website.button')}
          onAction={() => onOpenWebsite('https://cherry-ai.com')}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Github className="size-4.5" />}
          title={t('settings.about.feedback.title')}
          actionLabel={t('settings.about.feedback.button')}
          onAction={() => onOpenWebsite('https://github.com/CherryHQ/cherry-studio/issues/new/choose')}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Building2 className="size-4.5" />}
          title={t('settings.about.enterprise.title')}
          actionLabel={t('settings.about.website.button')}
          onAction={showEnterprise}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Mail className="size-4.5" />}
          title={t('settings.about.contact.title')}
          actionLabel={t('settings.about.contact.button')}
          onAction={mailto}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Briefcase className="size-4.5" />}
          title={t('settings.about.careers.title')}
          actionLabel={t('settings.about.careers.button')}
          onAction={() => onOpenWebsite('https://www.cherry-ai.com/careers')}
        />
        <Divider className="my-3" />
        <AboutActionRow
          icon={<Bug className="size-4.5" />}
          title={t('settings.about.debug.title')}
          actionLabel={t('settings.about.debug.open')}
          onAction={debug}
        />
      </AboutGroup>
    </div>
  )
}

function AboutGroup({ children, theme }: { children: ReactNode; theme: ThemeMode }) {
  return (
    <div
      className={cn(
        'mb-3 rounded-2xl border border-border/60 bg-background p-4 last:mb-0',
        theme === ThemeMode.dark ? 'bg-black/5' : 'bg-(--color-background)'
      )}>
      {children}
    </div>
  )
}

function AboutRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-6 items-center justify-between gap-3', className)}>{children}</div>
}

function AboutRowTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5 text-(--color-foreground) text-sm leading-4.5', className)}>
      {children}
    </div>
  )
}

function AboutActionRow({
  actionLabel,
  icon,
  onAction,
  title
}: {
  actionLabel: string
  icon: ReactNode
  onAction: () => void | Promise<void>
  title: string
}) {
  return (
    <AboutRow>
      <AboutRowTitle>
        {icon}
        {title}
      </AboutRowTitle>
      <Button size="sm" onClick={() => void onAction()}>
        {actionLabel}
      </Button>
    </AboutRow>
  )
}

export default AboutSettings
