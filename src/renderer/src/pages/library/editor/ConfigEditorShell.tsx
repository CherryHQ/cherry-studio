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

export interface ResourceEditorSaveButtonProps {
  canSave: boolean
  saving: boolean
  onSave: () => void
}

export interface ResourceEditorTopBarProps {
  title: string
  onBack: () => void
  saved?: boolean
  error?: string | null
  saveButton?: ResourceEditorSaveButtonProps
}

export interface ResourceEditorShellProps extends ResourceEditorTopBarProps {
  topBanner?: ReactNode
  children: ReactNode
}

export function ResourceEditorTopBar({
  title,
  onBack,
  saved = false,
  error = null,
  saveButton
}: ResourceEditorTopBarProps) {
  const { t } = useTranslation()

  return (
    <div className="flex shrink-0 items-center gap-3 border-border/50 border-b px-5 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label={t('common.back')}
        className="text-muted-foreground/50">
        <ArrowLeft size={14} />
      </Button>
      <Breadcrumb>
        <BreadcrumbList className="gap-1 text-muted-foreground/50 text-xs sm:gap-1">
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
            className="text-primary text-xs">
            {t('common.saved')}
          </motion.span>
        )}
        {error && (
          <motion.span
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className="text-destructive text-xs">
            {error}
          </motion.span>
        )}
      </AnimatePresence>
      {saveButton && (
        <>
          <Button variant="outline" size="sm" onClick={onBack} className="text-muted-foreground/60">
            {t('common.cancel')}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={saveButton.onSave}
            disabled={saveButton.saving || !saveButton.canSave}
            className="gap-1.5 transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40">
            <Save size={10} className="lucide-custom" />
            <span>{saveButton.saving ? t('library.config.saving') : t('common.save')}</span>
          </Button>
        </>
      )}
    </div>
  )
}

export function ResourceEditorShell({ topBanner, children, ...topBarProps }: ResourceEditorShellProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <ResourceEditorTopBar {...topBarProps} />
      {topBanner}
      {children}
    </div>
  )
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
    <ResourceEditorShell
      title={title}
      onBack={onBack}
      saved={saved}
      error={error}
      saveButton={{ canSave, saving, onSave }}
      topBanner={topBanner}>
      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className="w-[220px] shrink-0 border-sidebar-border border-r bg-sidebar p-3">
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
                descriptionClassName="mt-px text-xs text-sidebar-foreground/55 group-data-[active=true]:text-sidebar-foreground/50"
                className={`mb-1 items-start gap-2.5 rounded-lg border-0 px-3 py-2.5 text-left font-normal transition-all focus-visible:ring-0 ${
                  active
                    ? 'bg-sidebar-accent text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground'
                    : 'text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground'
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
    </ResourceEditorShell>
  )
}

export default ConfigEditorShell
