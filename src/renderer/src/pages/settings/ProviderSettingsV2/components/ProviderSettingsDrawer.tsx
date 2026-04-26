import { PageSidePanel } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type ProviderSettingsDrawerSize = 'form' | 'wide'

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
}

const drawerSizeClasses: Record<ProviderSettingsDrawerSize, string> = {
  form: '!w-[min(30rem,calc(100%-1rem))]',
  wide: '!w-[min(52rem,calc(100%-1rem))]'
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
  contentClassName
}: ProviderSettingsDrawerProps) {
  const { t } = useTranslation()

  const header = (
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
      backdropClassName="bg-black/10 backdrop-blur-[1px]"
      contentClassName={cn(
        'provider-settings-default-scope top-3 right-3 bottom-3 rounded-2xl border-(--color-border) bg-(--color-background) shadow-xl',
        drawerSizeClasses[size],
        contentClassName
      )}
      headerClassName="min-h-0 items-start px-5 py-4"
      bodyClassName={cn('flex min-h-0 flex-col gap-4 px-5 py-4', bodyClassName)}
      footerClassName="px-5 py-4">
      {children}
    </PageSidePanel>
  )
}
