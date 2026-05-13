import { Alert, Button } from '@cherrystudio/ui'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '..'
import { CodeHeroIllustrationIcon } from './CodeHeroIllustrationIcon'
import { CodeToolCard } from './CodeToolCard'
import type { CodeToolMeta } from './types'

type CliToolItem = (typeof CLI_TOOLS)[number]

export interface CodeToolGalleryProps {
  tools: readonly CliToolItem[]
  isBunInstalled: boolean
  isInstallingBun: boolean
  handleInstallBun: () => void
  activeToolValue: CliToolItem['value'] | undefined
  handleSelectTool: (value: CliToolItem['value']) => void
  toMeta: (tool: CliToolItem) => CodeToolMeta
}

export function CodeToolGallery({
  tools,
  isBunInstalled,
  isInstallingBun,
  handleInstallBun,
  activeToolValue,
  handleSelectTool,
  toMeta
}: CodeToolGalleryProps) {
  const { t } = useTranslation()

  return (
    <div className="relative flex-1 overflow-y-auto bg-background [&::-webkit-scrollbar]:hidden">
      {!isBunInstalled && (
        <Alert
          className="relative mx-4 mt-4 w-auto items-center rounded-xl border-border bg-card px-4 py-3 text-sm text-foreground sm:absolute sm:top-4 sm:right-4 sm:mx-0 sm:mt-0 sm:z-20 sm:whitespace-nowrap"
          message={t('code.bun_required_message')}
          action={
            <Button variant="secondary" size="sm" onClick={handleInstallBun} disabled={isInstallingBun}>
              {isInstallingBun ? t('code.installing_bun') : t('code.install_bun')}
            </Button>
          }
        />
      )}

      <div className="relative z-10 flex min-h-full flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-5xl">
          <div className="mb-12 flex flex-col items-center">
            <CodeHeroIllustrationIcon
              width={96}
              height={96}
              className="mb-4 rounded-full border border-border shadow-lg"
              aria-hidden="true"
            />
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">{t('code.hero_tagline')}</h1>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {tools.map((tool) => {
              const meta = toMeta(tool)
              if (!meta.icon) return null
              const descriptionKey = `code.tool_description.${meta.id.replace(/-/g, '_')}`
              const description = t(descriptionKey, { defaultValue: '' })
              return (
                <CodeToolCard
                  key={tool.value}
                  icon={meta.icon}
                  title={meta.label}
                  subtitle={description || undefined}
                  selected={activeToolValue === tool.value}
                  onClick={() => handleSelectTool(tool.value)}
                />
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
