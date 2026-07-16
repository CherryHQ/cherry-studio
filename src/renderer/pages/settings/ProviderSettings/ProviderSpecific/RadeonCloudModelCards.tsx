import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'
import { ExternalLink } from 'lucide-react'

const RADEON_CLOUD_MODELS_URL = 'https://developer.amd.com.cn/radeon/modelapis'

interface RadeonCloudModelCard {
  name: string
  publisher: string
  service: 'Radeon Cloud' | 'Fireworks'
  type: 'LLM (Text)' | 'VLM (Vision)'
  credit: 'AMD GPU CLOUD' | 'FIREWORKS CREDITS'
  icon: IconRef
}

const RADEON_CLOUD_MODELS: readonly RadeonCloudModelCard[] = [
  {
    name: 'Qwen3.6-35B-A3B',
    publisher: 'Qwen',
    service: 'Radeon Cloud',
    type: 'VLM (Vision)',
    credit: 'AMD GPU CLOUD',
    icon: providerIconRef('qwen')
  },
  {
    name: 'DeepSeek-V4-Flash',
    publisher: 'DeepSeek',
    service: 'Radeon Cloud',
    type: 'LLM (Text)',
    credit: 'AMD GPU CLOUD',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'DeepSeek-V4-Pro',
    publisher: 'DeepSeek',
    service: 'Fireworks',
    type: 'LLM (Text)',
    credit: 'FIREWORKS CREDITS',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'GLM 5.1',
    publisher: 'Z.ai',
    service: 'Fireworks',
    type: 'LLM (Text)',
    credit: 'FIREWORKS CREDITS',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'GLM 5.2',
    publisher: 'Z.ai',
    service: 'Fireworks',
    type: 'LLM (Text)',
    credit: 'FIREWORKS CREDITS',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'OpenAI gpt-oss-120b',
    publisher: 'OpenAI',
    service: 'Fireworks',
    type: 'LLM (Text)',
    credit: 'FIREWORKS CREDITS',
    icon: modelIconRef('gpt-oss-120b')
  },
  {
    name: 'Kimi K2.6',
    publisher: 'Moonshot',
    service: 'Fireworks',
    type: 'VLM (Vision)',
    credit: 'FIREWORKS CREDITS',
    icon: modelIconRef('kimi')
  }
]

function RadeonCloudModelCard({ model }: { model: RadeonCloudModelCard }) {
  const Icon = useIcon(model.icon)
  const isAmdCredit = model.credit === 'AMD GPU CLOUD'

  return (
    <a
      href={RADEON_CLOUD_MODELS_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={model.name}
      className="group grid h-[88px] min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border-muted bg-background px-3.5 py-3 text-left shadow-none transition-[border-color,background-color,box-shadow] hover:border-border-hover hover:bg-accent/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35">
      <span
        data-testid="radeon-cloud-model-icon"
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-muted/30">
        {Icon ? (
          <Icon.Avatar size={40} shape="rounded" />
        ) : (
          <Avatar className="size-10 rounded-lg">
            <AvatarFallback className="rounded-lg font-semibold text-sm">{model.publisher[0]}</AvatarFallback>
          </Avatar>
        )}
      </span>

      <span className="flex min-w-0 flex-col justify-center gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-medium text-foreground-secondary text-xs leading-none">{model.publisher}</span>
          <span className="h-px min-w-3 flex-1 bg-border-subtle" aria-hidden />
        </span>
        <span className="truncate font-semibold text-[15px] text-foreground leading-tight">{model.name}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs leading-none">
          <span className="rounded-full bg-muted px-2 py-1 text-muted-foreground">{model.service}</span>
          <span className="rounded-full bg-primary/8 px-2 py-1 font-medium text-primary">{model.type}</span>
        </span>
      </span>

      <span className="flex h-full min-w-[116px] shrink-0 flex-col items-end justify-between">
        <span
          className={
            isAmdCredit
              ? 'rounded-md bg-[#eee8ff] px-2 py-1 font-semibold text-[#6840d8] text-xs leading-none dark:bg-[#6840d8]/20 dark:text-[#c7b5ff]'
              : 'rounded-md bg-[#fff0ee] px-2 py-1 font-semibold text-[#c84035] text-xs leading-none dark:bg-[#c84035]/20 dark:text-[#ffaaa3]'
          }>
          {model.credit}
        </span>
        <span className="flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors group-hover:bg-accent group-hover:text-foreground">
          <ExternalLink className="size-3.5" aria-hidden />
        </span>
      </span>
    </a>
  )
}

export default function RadeonCloudModelCards() {
  return (
    <div data-testid="radeon-cloud-model-cards" className="grid grid-cols-1 gap-2.5">
      {RADEON_CLOUD_MODELS.map((model) => (
        <RadeonCloudModelCard key={model.name} model={model} />
      ))}
    </div>
  )
}
