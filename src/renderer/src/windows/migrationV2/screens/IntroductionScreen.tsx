import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Database, Shield, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StepPage } from '../components'
import { MigrationScreenLayout } from './MigrationScreenLayout'

interface LanguageOption {
  value: string
  label: string
}

type Props = {
  currentLanguage: string
  languageOptions: readonly LanguageOption[]
  onLanguageChange: (lang: string) => Promise<void>
  onNext: () => void
}

function HighlightRow({
  icon: Icon,
  title,
  description,
  delay = 0
}: {
  icon: LucideIcon
  title: string
  description: string
  delay?: number
}) {
  return (
    <div
      className="fade-in slide-in-from-bottom-3 flex animate-in items-start gap-4 py-3 text-left transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}>
      <Icon className="lucide-custom mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 max-w-104">
        <p className="font-medium text-foreground text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-sm leading-6">{description}</p>
      </div>
    </div>
  )
}

export function IntroductionScreen({ currentLanguage, languageOptions, onLanguageChange, onNext }: Props) {
  const { t } = useTranslation()

  return (
    <MigrationScreenLayout
      currentStep={1}
      footerMessage={t('migration.footer.introduction')}
      primaryAction={
        <Button className="min-h-10 rounded-md px-4 shadow-none" onClick={onNext}>
          {t('migration.buttons.next')}
          <ArrowRight className="lucide-custom size-4" />
        </Button>
      }>
      <StepPage
        align="center"
        title={t('migration.overview.title')}
        description={t('migration.overview.description')}
        leading={
          <div className="zoom-in-95 flex size-16 animate-in items-center justify-center rounded-2xl bg-primary text-primary-foreground duration-300">
            <Sparkles className="lucide-custom size-8" />
          </div>
        }>
        <div className="mx-auto grid w-fit max-w-full gap-4">
          <HighlightRow
            icon={Database}
            title={t('migration.overview.highlights.scope.title')}
            description={t('migration.overview.highlights.scope.description')}
          />
          <HighlightRow
            icon={Shield}
            title={t('migration.overview.highlights.safety.title')}
            description={t('migration.overview.highlights.safety.description')}
            delay={80}
          />
        </div>
        <div className="mx-auto pt-4">
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="text-muted-foreground text-xs uppercase tracking-[0.18em]">
              {t('migration.language.label')}
            </span>
            <Select value={currentLanguage} onValueChange={(value) => void onLanguageChange(value)}>
              <SelectTrigger aria-label={t('migration.language.label')} size="sm" className="w-32 bg-white shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {languageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </StepPage>
    </MigrationScreenLayout>
  )
}
