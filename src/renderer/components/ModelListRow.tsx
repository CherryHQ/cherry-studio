import type { ReactNode, Ref } from 'react'

import { Avatar, AvatarFallback, RowFlex } from '@cherrystudio/ui'
import { useIcon } from '@cherrystudio/ui/icons'
import { getModelLogoRef } from '@renderer/utils/model'
import { cn } from '@renderer/utils/style'

interface ModelListRowProps {
  ref?: Ref<HTMLDivElement>
  model: NonNullable<Parameters<typeof getModelLogoRef>[0]>
  detail?: string
  children: ReactNode
  className?: string
}

const avatarClassName =
  'inline-flex size-6.5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border [&_*]:overflow-hidden [&_*]:rounded-[inherit] [&_img]:rounded-[inherit] [&_svg]:rounded-[inherit]'

export default function ModelListRow({ ref, model, detail, children, className }: ModelListRowProps) {
  const Icon = useIcon(getModelLogoRef(model))

  return (
    <div
      ref={ref}
      className={cn(
        'group flex min-h-[42px] min-w-0 items-center gap-2.5 px-4 py-1 leading-none text-foreground',
        className
      )}>
      <RowFlex className="min-w-0 flex-1 items-center gap-2.5 self-center">
        {Icon ? (
          <span className={avatarClassName}>
            <Icon.Avatar size={26} shape="circle" />
          </span>
        ) : (
          <Avatar className={avatarClassName}>
            <AvatarFallback className="rounded-[inherit]">{model.name[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
        )}
        <span className="min-w-0 truncate text-sm font-normal select-text" title={model.name}>
          {model.name}
        </span>
        {detail && (
          <span className="max-w-[40%] min-w-0 truncate text-xs text-muted-foreground" title={detail}>
            {detail}
          </span>
        )}
      </RowFlex>
      <RowFlex className="ml-auto min-w-0 shrink-0 items-center gap-2 self-center">{children}</RowFlex>
    </div>
  )
}
