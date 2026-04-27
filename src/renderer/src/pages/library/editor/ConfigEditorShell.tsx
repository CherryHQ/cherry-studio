import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  MenuItem
} from '@cherrystudio/ui'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, Save } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface SectionDescriptor<Id extends string> {
  id: Id
  icon: LucideIcon
  labelKey: string
  descKey: string
}

export interface ConfigEditorShellProps<Id extends string> {
  title: string
  sections: readonly SectionDescriptor<Id>[]
  activeSection: Id
  onSectionChange: (section: Id) => void

  canSave: boolean
  saving: boolean
  saved: boolean
  error: string | null
  onSave: () => void
  onBack: () => void

  /** Rendered between the top bar and the two-column body. Used by Agent's create-mode notice. */
  topBanner?: ReactNode
  children: ReactNode
}

/**
 * Shared shell for resource config editors (Agent / Assistant).
 * Owns the top bar (back + breadcrumb + saved/error flash + cancel +
 * save) and the left section sidebar; the active section's body is
 * rendered via `children` inside an `AnimatePresence` so each editor
 * keeps its own `{activeSection === 'x' && <X/>}` switch.
 */
export function ConfigEditorShell<Id extends string>({
  title,
  sections,
  activeSection,
  onSectionChange,
  canSave,
  saving,
  saved,
  error,
  onSave,
  onBack,
  topBanner,
  children
}: ConfigEditorShellProps<Id>) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-border/15 border-b px-5 py-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="text-muted-foreground/50">
          <ArrowLeft size={14} />
        </Button>
        <Breadcrumb>
          <BreadcrumbList className="gap-1 text-xs text-muted-foreground/50 sm:gap-1">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button type="button" className="cursor-pointer" onClick={onBack}>
                  {t('library.config.breadcrumb')}
                </button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="[&>svg]:size-2.5" />
            <BreadcrumbItem>
              <BreadcrumbPage className="text-foreground">{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex-1" />
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-primary">
              {t('common.saved')}
            </motion.span>
          )}
          {error && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-xs text-destructive">
              {error}
            </motion.span>
          )}
        </AnimatePresence>
        <Button variant="outline" size="sm" onClick={onBack} className="text-muted-foreground/60">
          {t('common.cancel')}
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={onSave}
          disabled={saving || !canSave}
          className="gap-1.5 transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">
          <Save size={10} className="lucide-custom" />
          <span>{saving ? t('library.config.saving') : t('common.save')}</span>
        </Button>
      </div>

      {topBanner}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 border-border/15 border-r p-3">
          {sections.map((s) => {
            const Icon = s.icon
            const active = activeSection === s.id
            return (
              <MenuItem
                key={s.id}
                variant="ghost"
                size="sm"
                active={active}
                onClick={() => onSectionChange(s.id)}
                icon={<Icon size={13} strokeWidth={1.6} className="mt-0.5 shrink-0" />}
                label={t(s.labelKey)}
                description={t(s.descKey)}
                descriptionClassName="mt-px text-xs text-muted-foreground/60 group-data-[active=true]:text-muted-foreground/50"
                className={`mb-1 items-start gap-2.5 rounded-xs border-0 px-3 py-2.5 text-left font-normal transition-all focus-visible:ring-0 ${
                  active
                    ? 'bg-accent/50 text-foreground data-[active=true]:bg-accent/50 data-[active=true]:text-foreground'
                    : 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground'
                }`}
              />
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[3px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}>
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

export default ConfigEditorShell
