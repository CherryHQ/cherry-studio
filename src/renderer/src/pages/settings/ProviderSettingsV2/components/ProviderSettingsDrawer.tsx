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
  /** Matches `cherry-studio-ui-design` ModelManagementPanel chrome (border under title, px-4). */
  headerClassName?: string
  footerClassName?: string
}

/** `manage` ≈ design model management panel; `fetch` ≈ `ModelServicePage` `FetchResultPanel` w-[320px]. */
const drawerSizeClasses: Record<ProviderSettingsDrawerSize, string> = {
  compact: '!w-[clamp(17rem,36cqw,min(480px,calc(100vw-1.5rem)))]',
  form: '!w-[clamp(18rem,44cqw,min(480px,calc(100vw-1.5rem)))]',
  wide: '!w-[clamp(24rem,56cqw,min(480px,calc(100vw-1.5rem)))]',
  manage: '!w-[min(21.25rem,calc(100vw-1.5rem))]',
  fetch: '!w-[min(20rem,calc(100vw-1.5rem))]'
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
  footerClassName: footerClassNameProp
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
      closeButtonClassName={
        isManageLayout
          ? 'ml-1 shrink-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground'
          : undefined
      }
      backdropClassName="bg-black/10 backdrop-blur-[1px]"
      contentClassName={cn(
        'provider-settings-default-scope top-3 right-3 bottom-3 rounded-2xl bg-(--color-background)',
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
