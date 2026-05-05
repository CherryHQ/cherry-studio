import { Badge, MenuDivider, MenuItem, MenuList, Switch } from '@cherrystudio/ui'
import { LogoAvatar } from '@renderer/components/Icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { isMac } from '@renderer/config/constant'
import { getPreprocessProviderLogo, PREPROCESS_PROVIDER_CONFIG } from '@renderer/config/preprocessProviders'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useOcrProviders } from '@renderer/hooks/useOcrProvider'
import { useDefaultPreprocessProvider, usePreprocessProviders } from '@renderer/hooks/usePreprocess'
import type { OcrProvider, PreprocessProvider } from '@renderer/types'
import { isBuiltinOcrProvider, isImageOcrProvider } from '@renderer/types'
import { ExternalLink, Sparkles } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitleExternalLink } from '..'
import {
  settingsContentBodyClassName,
  settingsContentScrollClassName,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '../shared/menuStyles'
import OcrProviderSettings from './OcrProviderSettings'
import PreprocessProviderSettings from './PreprocessProviderSettings'

type DocProcessMenuEntry =
  | {
      key: string
      kind: 'ocr'
      provider: OcrProvider
    }
  | {
      key: string
      kind: 'preprocess'
      provider: PreprocessProvider
    }

const OCR_PROVIDER_ORDER = ['system', 'tesseract', 'paddleocr', 'ovocr']
const PREPROCESS_PROVIDER_ORDER = ['mistral', 'mineru', 'doc2x', 'open-mineru', 'paddleocr']

const sortByConfiguredOrder = <T extends { id: string }>(items: T[], order: string[]) =>
  [...items].sort((a, b) => {
    const aIndex = order.indexOf(a.id)
    const bIndex = order.indexOf(b.id)

    if (aIndex === -1 && bIndex === -1) {
      return a.id.localeCompare(b.id)
    }
    if (aIndex === -1) {
      return 1
    }
    if (bIndex === -1) {
      return -1
    }

    return aIndex - bIndex
  })

const DocProcessSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const {
    providers: ocrProviders,
    imageProvider,
    setImageProviderId,
    getOcrProviderName,
    OcrProviderLogo
  } = useOcrProviders()
  const { preprocessProviders } = usePreprocessProviders()
  const { provider: defaultPreprocessProvider, setDefaultPreprocessProvider } = useDefaultPreprocessProvider()

  const visibleOcrProviders = useMemo(
    () =>
      sortByConfiguredOrder(
        ocrProviders.filter((provider) => isImageOcrProvider(provider) && provider.id !== 'ovocr'),
        OCR_PROVIDER_ORDER
      ),
    [ocrProviders]
  )

  const visiblePreprocessProviders = useMemo(
    () => sortByConfiguredOrder(preprocessProviders, PREPROCESS_PROVIDER_ORDER),
    [preprocessProviders]
  )

  const menuEntries = useMemo<DocProcessMenuEntry[]>(
    () => [
      ...visibleOcrProviders.map((provider) => ({
        key: `ocr:${provider.id}`,
        kind: 'ocr' as const,
        provider
      })),
      ...visiblePreprocessProviders.map((provider) => ({
        key: `preprocess:${provider.id}`,
        kind: 'preprocess' as const,
        provider
      }))
    ],
    [visibleOcrProviders, visiblePreprocessProviders]
  )

  const [activeKey, setActiveKey] = useState(() => menuEntries[0]?.key ?? '')

  useEffect(() => {
    if (!menuEntries.some((entry) => entry.key === activeKey)) {
      setActiveKey(menuEntries[0]?.key ?? '')
    }
  }, [activeKey, menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey)

  const isActiveDefault =
    activeEntry?.kind === 'ocr'
      ? imageProvider?.id === activeEntry.provider.id
      : defaultPreprocessProvider?.id === activeEntry?.provider.id

  const providerDescription = useMemo(() => {
    if (!activeEntry) {
      return ''
    }

    if (activeEntry.kind === 'ocr') {
      if (!isBuiltinOcrProvider(activeEntry.provider)) {
        return t('settings.tool.ocr.title')
      }

      switch (activeEntry.provider.id) {
        case 'system':
          return isMac ? t('settings.tool.ocr.features.system.macos') : t('settings.tool.ocr.features.system.windows')
        case 'tesseract':
          return t('settings.tool.ocr.features.tesseract')
        case 'paddleocr':
          return t('settings.tool.ocr.features.paddleocr')
        default:
          return t('settings.tool.ocr.title')
      }
    }

    switch (activeEntry.provider.id) {
      case 'mistral':
        return t('settings.tool.preprocess.features.mistral')
      case 'mineru':
        return t('settings.tool.preprocess.features.mineru')
      case 'doc2x':
        return t('settings.tool.preprocess.features.doc2x')
      case 'open-mineru':
        return t('settings.tool.preprocess.features.open_mineru')
      case 'paddleocr':
        return t('settings.tool.preprocess.features.paddleocr')
      default:
        return t('settings.tool.preprocess.tooltip')
    }
  }, [activeEntry, t])

  const handleDefaultToggle = (checked: boolean) => {
    if (!checked || !activeEntry) {
      return
    }

    if (activeEntry.kind === 'ocr') {
      setImageProviderId(activeEntry.provider.id)
      return
    }

    setDefaultPreprocessProvider(activeEntry.provider)
  }

  const renderMenuIcon = (entry: DocProcessMenuEntry) => {
    if (entry.kind === 'ocr') {
      return <OcrProviderLogo provider={entry.provider} size={18} />
    }

    return <LogoAvatar logo={getPreprocessProviderLogo(entry.provider.id)} size={18} className="h-[18px] w-[18px]" />
  }

  const renderProviderPanel = () => {
    if (!activeEntry) {
      return null
    }

    if (activeEntry.kind === 'ocr') {
      return <OcrProviderSettings provider={activeEntry.provider} embedded />
    }

    return <PreprocessProviderSettings provider={activeEntry.provider} hideHeader />
  }

  const renderHeaderIcon = () => {
    if (!activeEntry) {
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground shadow-xs">
          <div className="flex size-6 shrink-0 items-center justify-center">
            <Sparkles size={16} />
          </div>
        </div>
      )
    }

    if (activeEntry.kind === 'ocr') {
      return (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted shadow-xs">
          <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md text-foreground [&_svg]:size-4.5 [&_svg]:shrink-0">
            <OcrProviderLogo provider={activeEntry.provider} size={18} />
          </div>
        </div>
      )
    }

    return (
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted shadow-xs">
        <div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md">
          <LogoAvatar
            logo={getPreprocessProviderLogo(activeEntry.provider.id)}
            size={24}
            className="aspect-square size-6 shrink-0 [&_.cs-avatar]:size-6 [&_img]:size-6 [&_img]:object-contain"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1" data-theme-mode={themeMode}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <div className={settingsSubmenuSectionTitleClassName}>{t('settings.tool.ocr.title')}</div>
            {visibleOcrProviders.map((provider) => (
              <MenuItem
                key={`ocr:${provider.id}`}
                label={getOcrProviderName(provider)}
                active={activeKey === `ocr:${provider.id}`}
                onClick={() => setActiveKey(`ocr:${provider.id}`)}
                icon={renderMenuIcon({ key: `ocr:${provider.id}`, kind: 'ocr', provider })}
                className={settingsSubmenuItemClassName}
                suffix={
                  imageProvider?.id === provider.id ? (
                    <Badge className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                      {t('common.default')}
                    </Badge>
                  ) : undefined
                }
              />
            ))}

            <MenuDivider className={settingsSubmenuDividerClassName} />
            <div className={settingsSubmenuSectionTitleClassName}>{t('settings.tool.preprocess.title')}</div>
            {visiblePreprocessProviders.map((provider) => (
              <MenuItem
                key={`preprocess:${provider.id}`}
                label={provider.name}
                active={activeKey === `preprocess:${provider.id}`}
                onClick={() => setActiveKey(`preprocess:${provider.id}`)}
                icon={renderMenuIcon({ key: `preprocess:${provider.id}`, kind: 'preprocess', provider })}
                className={settingsSubmenuItemClassName}
                suffix={
                  defaultPreprocessProvider?.id === provider.id ? (
                    <Badge className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                      {t('common.default')}
                    </Badge>
                  ) : undefined
                }
              />
            ))}
          </MenuList>
        </Scrollbar>

        <Scrollbar className={settingsContentScrollClassName}>
          <div className={settingsContentBodyClassName}>
            {activeEntry ? (
              <div className="flex w-full flex-col gap-4">
                <div className="flex items-center justify-between gap-4 px-1">
                  <div className="flex min-w-0 items-center gap-4">
                    {renderHeaderIcon()}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-[15px] text-foreground leading-5">
                          {activeEntry.kind === 'ocr'
                            ? getOcrProviderName(activeEntry.provider)
                            : activeEntry.provider.name}
                        </span>
                        {activeEntry.kind === 'preprocess' &&
                          PREPROCESS_PROVIDER_CONFIG[activeEntry.provider.id]?.websites?.official && (
                            <SettingTitleExternalLink
                              href={PREPROCESS_PROVIDER_CONFIG[activeEntry.provider.id].websites.official}
                              className="shrink-0">
                              <ExternalLink size={14} className="lucide-custom" />
                            </SettingTitleExternalLink>
                          )}
                      </div>
                      {providerDescription && (
                        <p className="mt-1 text-[13px] text-foreground-muted leading-5">{providerDescription}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center">
                    <Switch checked={Boolean(isActiveDefault)} onCheckedChange={handleDefaultToggle} />
                  </div>
                </div>

                <div className="h-px bg-border/60" />

                <div className="min-h-0 px-1">{renderProviderPanel()}</div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-foreground-muted text-sm">{t('common.no_results')}</div>
              </div>
            )}
          </div>
        </Scrollbar>
      </div>
    </div>
  )
}

export default DocProcessSettings
