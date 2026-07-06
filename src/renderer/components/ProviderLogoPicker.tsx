import { InputGroup, InputGroupAddon, InputGroupInput, Tooltip } from '@cherrystudio/ui'
import { PROVIDER_ICON_CATALOG } from '@cherrystudio/ui/icons'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import { getProviderLabelKey } from '@renderer/i18n/label'
import { Search } from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onProviderClick: (providerId: string) => void
}

const ProviderLogoPicker: FC<Props> = ({ onProviderClick }) => {
  const { t } = useTranslation()
  const [searchText, setSearchText] = useState('')

  const filteredProviders = useMemo(() => {
    const providers = Object.entries(PROVIDER_ICON_CATALOG).map(([id, icon]) => ({
      id,
      icon,
      name: t(getProviderLabelKey(id))
    }))

    if (!searchText) return providers

    const searchLower = searchText.toLowerCase()
    return providers.filter((p) => p.name.toLowerCase().includes(searchLower))
  }, [searchText, t])

  const handleProviderClick = (event: React.MouseEvent, providerId: string) => {
    event.stopPropagation()
    onProviderClick(providerId)
  }

  return (
    <div className="flex max-h-[300px] w-[350px] flex-col">
      <InputGroup className="mb-3">
        <InputGroupAddon align="inline-start">
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={t('common.search')}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </InputGroup>
      <div className="grid flex-1 grid-cols-5 gap-2 overflow-y-auto p-1">
        {filteredProviders.map(({ id, name, icon }) => (
          <Tooltip key={id} content={name}>
            <button
              type="button"
              aria-label={name}
              className="flex size-[52px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/50 bg-muted/50 transition-all hover:scale-105 hover:border-primary hover:bg-muted"
              onClick={(event) => handleProviderClick(event, id)}>
              <ProviderAvatarPrimitive
                providerId={id}
                style={{ width: '52px', height: '52px' }}
                providerName={name}
                logo={icon}
              />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

export default ProviderLogoPicker
