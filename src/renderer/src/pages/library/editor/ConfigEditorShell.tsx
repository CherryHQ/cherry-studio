import { Button, MenuItem } from '@cherrystudio/ui'
import type { LucideIcon } from 'lucide-react'
import { ArrowLeft, ChevronRight, Save } from 'lucide-react'
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
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="flex h-7 min-h-0 w-7 items-center justify-center rounded-3xs font-normal text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0">
          <ArrowLeft size={14} />
        </Button>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
          <span className="cursor-pointer transition-colors hover:text-foreground" onClick={onBack}>
            {t('library.config.breadcrumb')}
          </span>
          <ChevronRight size={9} />
          <span className="text-foreground">{title}</span>
        </div>
        <div className="flex-1" />
        <AnimatePresence>
          {saved && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-primary">
              {t('common.saved')}
            </motion.span>
          )}
          {error && (
            <motion.span
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] text-destructive">
              {error}
            </motion.span>
          )}
        </AnimatePresence>
        <Button
          variant="ghost"
          onClick={onBack}
          className="h-auto min-h-0 rounded-3xs border border-border/20 px-3 py-1.5 font-normal text-[11px] text-muted-foreground/50 shadow-none transition-all hover:bg-accent/30 hover:text-foreground focus-visible:ring-0">
          {t('common.cancel')}
        </Button>
        <Button
          variant="default"
          onClick={onSave}
          disabled={saving || !canSave}
          className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs bg-foreground px-3 py-1.5 font-normal text-[11px] text-background shadow-none transition-colors hover:bg-foreground/90 focus-visible:ring-0 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">
          <Save size={10} className="lucide-custom" />
          <span>{saving ? t('library.config.saving') : t('common.save')}</span>
        </Button>
      </div>

      {topBanner}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[180px] shrink-0 border-border/10 border-r p-3">
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
                descriptionClassName="mt-px text-[9px] text-muted-foreground/45 group-data-[active=true]:text-muted-foreground/50"
                className={`mb-1 items-start gap-2.5 rounded-2xs border-0 px-3 py-2.5 text-left font-normal transition-all focus-visible:ring-0 ${
                  active
                    ? 'bg-accent/60 text-foreground data-[active=true]:bg-accent/60 data-[active=true]:text-foreground'
                    : 'text-muted-foreground/60 hover:bg-accent/25 hover:text-foreground'
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
