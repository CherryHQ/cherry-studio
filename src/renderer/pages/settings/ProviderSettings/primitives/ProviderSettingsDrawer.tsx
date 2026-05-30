import { PageSidePanel } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type ProviderSettingsDrawerSize = 'compact' | 'form' | 'wide' | 'manage' | 'fetch'

interface ProviderSettingsDrawerProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  size?: ProviderSettingsDrawerSize
  children?: ReactNode
  bodyClassName?: string
  contentClassName?: string
  /** Applies the manage-drawer title chrome. */
  headerClassName?: string
  footerClassName?: string
  /** Allows manage-style title rows to own their close action. */
  showHeaderCloseButton?: boolean
}

/**
 * Width: `clamp(min_rem, preferred_vw, min(max_vw, 100vw - gutter))` — lower/upper bounds scale with the viewport
 * (`vw` / `100vw`), no fixed `px`/`rem` ceiling. Gutter keeps the panel inside the window when narrow.
 */
const drawerSizeClasses: Record<ProviderSettingsDrawerSize, string> = {
  compact: '!w-[clamp(17rem,28vw,min(37vw,calc(100vw-1.5rem)))]',
  form: '!w-[clamp(18rem,36vw,min(42vw,calc(100vw-1.5rem)))]',
  wide: '!w-[clamp(24rem,44vw,min(52vw,calc(100vw-1.5rem)))]',
  manage: '!w-[clamp(18rem,32vw,min(37vw,calc(100vw-1.5rem)))]',
  fetch: '!w-[clamp(18rem,30vw,min(34vw,calc(100vw-1.5rem)))]'
}

export default function ProviderSettingsDrawer({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'form',
  children,
  bodyClassName,
  contentClassName,
  headerClassName: headerClassNameProp,
  footerClassName: footerClassNameProp,
  showHeaderCloseButton = true
}: ProviderSettingsDrawerProps) {
  const { t } = useTranslation()
  const isManageLayout = size === 'manage' || size === 'fetch'

  const header = isManageLayout ? (
    title
  ) : (
    <div className="min-w-0">
      <div className="truncate font-semibold text-[15px] text-foreground/90">{title}</div>
      {description ? (
        <div className="mt-1 text-[12px] text-muted-foreground/80 leading-[1.4]">{description}</div>
      ) : null}
    </div>
  )

  return (
    <PageSidePanel
      open={open}
      onClose={onClose}
      header={header}
      footer={footer}
      closeLabel={t('common.close')}
      showCloseButton={showHeaderCloseButton}
      closeButtonClassName={
        isManageLayout && showHeaderCloseButton
          ? 'ml-1 shrink-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground'
          : undefined
      }
      backdropClassName="!bottom-[-16px] bg-black/10 backdrop-blur-[1px]"
      contentClassName={cn(
        'provider-settings-default-scope top-3 right-3 bottom-3 rounded-2xl bg-[var(--drawer-background)]',
        isManageLayout ? 'border-[color:var(--section-border)] shadow-2xl' : 'border-(--color-border) shadow-xl',
        drawerSizeClasses[size],
        contentClassName
      )}
      headerClassName={cn(
        isManageLayout
          ? 'h-auto min-h-0 items-center border-[color:var(--section-border)] border-b px-4 py-3'
          : 'min-h-0 items-start px-5 py-4',
        headerClassNameProp
      )}
      bodyClassName={cn(
        isManageLayout ? 'flex min-h-0 flex-col gap-0 px-4 py-0' : 'flex min-h-0 flex-col gap-4 px-5 py-4',
        bodyClassName
      )}
      footerClassName={cn(
        isManageLayout ? 'border-[color:var(--section-border)] border-t px-4 py-2.5' : 'px-5 py-4',
        footerClassNameProp
      )}>
      {children}
    </PageSidePanel>
  )
}
