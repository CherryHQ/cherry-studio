import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@cherrystudio/ui'
import { useProvider } from '@renderer/hooks/useProvider'
import type { FC } from 'react'
import { useCallback, useMemo } from 'react'

interface CherryINSettingsProps {
  providerId: string
  apiHost: string
  setApiHost: (host: string) => void
}

const API_HOST_OPTIONS = [
  {
    value: 'https://open.cherryin.cc',
    labelKey: '加速域名',
    description: 'open.cherryin.cc'
  },
  {
    value: 'https://open.cherryin.net',
    labelKey: '国际域名',
    description: 'open.cherryin.net'
  },
  {
    value: 'https://open.cherryin.ai',
    labelKey: '备用域名',
    description: 'open.cherryin.ai'
  }
]

const CherryINSettings: FC<CherryINSettingsProps> = ({ providerId, apiHost, setApiHost }) => {
  const { updateProvider } = useProvider(providerId)

  const getCurrentHost = useMemo(() => {
    const matchedOption = API_HOST_OPTIONS.find((option) => apiHost?.includes(option.value.replace('https://', '')))
    return matchedOption?.value ?? API_HOST_OPTIONS[0].value
  }, [apiHost])

  const handleHostChange = useCallback(
    (value: string) => {
      setApiHost(value)
      updateProvider({ apiHost: value, anthropicApiHost: value })
    },
    [setApiHost, updateProvider]
  )

  const currentHostLabel = API_HOST_OPTIONS.find((option) => option.value === getCurrentHost)?.value ?? getCurrentHost

  return (
    <Select value={getCurrentHost} onValueChange={handleHostChange}>
      <SelectTrigger className="mt-1.25 w-full">
        <SelectValue>{currentHostLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {API_HOST_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex flex-col gap-0.5">
              <span>{option.labelKey}</span>
              <span className="text-muted-foreground text-xs">{option.description}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export default CherryINSettings
