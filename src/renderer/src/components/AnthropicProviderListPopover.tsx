import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { ProviderAvatar } from '@renderer/components/ProviderAvatar'
import { useAllProviders } from '@renderer/hooks/useProvider'
import ImageStorage from '@renderer/services/ImageStorage'
import type { Provider } from '@renderer/types'
import { getFancyProviderName } from '@renderer/utils'
import { getClaudeSupportedProviders } from '@renderer/utils/provider'
import { ArrowUpRight, HelpCircle } from 'lucide-react'
import type { ComponentProps, CSSProperties, FC, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type PopoverPlacement =
  | 'top'
  | 'topLeft'
  | 'topRight'
  | 'bottom'
  | 'bottomLeft'
  | 'bottomRight'
  | 'left'
  | 'leftTop'
  | 'leftBottom'
  | 'right'
  | 'rightTop'
  | 'rightBottom'

type PopoverSide = ComponentProps<typeof PopoverContent>['side']
type PopoverAlign = ComponentProps<typeof PopoverContent>['align']

interface AnthropicProviderListPopoverProps {
  /** Callback when provider is clicked */
  onProviderClick?: () => void
  /** Use window.navigate instead of Link (for non-router context like TopView) */
  useWindowNavigate?: boolean
  /** Custom trigger element, defaults to HelpCircle icon */
  children?: ReactNode
  /** Popover placement */
  placement?: PopoverPlacement
  /** Custom filter function for providers, defaults to getClaudeSupportedProviders */
  filterProviders?: (providers: Provider[]) => Provider[]
}

const getPopoverSide = (placement: PopoverPlacement): PopoverSide => {
  if (placement.startsWith('top')) return 'top'
  if (placement.startsWith('bottom')) return 'bottom'
  if (placement.startsWith('left')) return 'left'
  return 'right'
}

const getPopoverAlign = (placement: PopoverPlacement): PopoverAlign => {
  if (placement.endsWith('Left') || placement.endsWith('Top')) return 'start'
  if (placement.endsWith('Right') || placement.endsWith('Bottom')) return 'end'
  return 'center'
}

const providerItemClassName =
  'flex w-full cursor-pointer items-center gap-1 rounded-sm bg-transparent p-0 text-left text-sm text-foreground no-underline transition-colors hover:text-link'
const popoverContentStyle: CSSProperties = {
  zIndex: 1100
}

const AnthropicProviderListPopover: FC<AnthropicProviderListPopoverProps> = ({
  onProviderClick,
  useWindowNavigate = false,
  children,
  placement = 'right',
  filterProviders = getClaudeSupportedProviders
}) => {
  const { t } = useTranslation()
  const allProviders = useAllProviders()
  const providers = filterProviders(allProviders)
  const [providerLogos, setProviderLogos] = useState<Record<string, string>>({})
  const [open, setOpen] = useState(false)
  const closeTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const loadAllLogos = async () => {
      const logos: Record<string, string> = {}
      for (const provider of providers) {
        if (provider.id) {
          try {
            const logoData = await ImageStorage.get(`provider-${provider.id}`)
            if (logoData) {
              logos[provider.id] = logoData
            }
          } catch {
            // Ignore errors loading logos
          }
        }
      }
      setProviderLogos(logos)
    }

    void loadAllLogos()
  }, [providers])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const openPopover = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = undefined
    }
    setOpen(true)
  }

  const closePopover = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false)
      closeTimerRef.current = undefined
    }, 120)
  }

  const handleClick = (providerId: string) => {
    onProviderClick?.()
    setOpen(false)
    if (useWindowNavigate) {
      void window.navigate({ to: '/settings/provider', search: { id: providerId } })
    }
  }

  const side = getPopoverSide(placement)
  const align = getPopoverAlign(placement)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ? (
          <span className="inline-flex" onMouseEnter={openPopover} onMouseLeave={closePopover}>
            {children}
          </span>
        ) : (
          <button
            type="button"
            aria-label={t('code.supported_providers')}
            className="inline-flex cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
            onMouseEnter={openPopover}
            onMouseLeave={closePopover}>
            <HelpCircle size={14} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="w-[200px] p-3"
        style={popoverContentStyle}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}>
        <div className="mb-2 font-medium text-sm">{t('code.supported_providers')}</div>
        <div className="flex flex-col gap-2">
          {providers.map((provider) =>
            useWindowNavigate ? (
              <button
                key={provider.id}
                type="button"
                className={providerItemClassName}
                onClick={() => handleClick(provider.id)}>
                <ProviderAvatar
                  provider={provider}
                  customLogos={providerLogos}
                  size={20}
                  style={{ width: 20, height: 20 }}
                />
                {getFancyProviderName(provider)}
                <ArrowUpRight size={14} />
              </button>
            ) : (
              <a
                key={provider.id}
                href={`/settings/provider?id=${provider.id}`}
                className={providerItemClassName}
                onClick={() => handleClick(provider.id)}>
                <ProviderAvatar
                  provider={provider}
                  customLogos={providerLogos}
                  size={20}
                  style={{ width: 20, height: 20 }}
                />
                {getFancyProviderName(provider)}
                <ArrowUpRight size={14} />
              </a>
            )
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default AnthropicProviderListPopover
