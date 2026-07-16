import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'
import { ExternalLink } from 'lucide-react'

const RADEON_CLOUD_MODELS_URL = 'https://developer.amd.com.cn/radeon/modelapis'

interface RadeonCloudModelCard {
  name: string
  publisher: string
  service: 'Radeon Cloud' | 'Fireworks'
  type: 'LLM (Text)' | 'VLM (Vision)'
  icon: IconRef
}

const RADEON_CLOUD_ICON = providerIconRef('radeon-cloud')

const RADEON_CLOUD_MODELS: readonly RadeonCloudModelCard[] = [
  {
    name: 'Qwen3.6-35B-A3B',
    publisher: 'Qwen',
    service: 'Radeon Cloud',
    type: 'VLM (Vision)',
    icon: providerIconRef('qwen')
  },
  {
    name: 'DeepSeek-V4-Flash',
    publisher: 'DeepSeek',
    service: 'Radeon Cloud',
    type: 'LLM (Text)',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'DeepSeek-V4-Pro',
    publisher: 'DeepSeek',
    service: 'Fireworks',
    type: 'LLM (Text)',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'GLM 5.1',
    publisher: 'Z.ai',
    service: 'Fireworks',
    type: 'LLM (Text)',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'GLM 5.2',
    publisher: 'Z.ai',
    service: 'Fireworks',
    type: 'LLM (Text)',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'OpenAI gpt-oss-120b',
    publisher: 'OpenAI',
    service: 'Fireworks',
    type: 'LLM (Text)',
    icon: modelIconRef('gpt-oss-120b')
  },
  {
    name: 'Kimi K2.6',
    publisher: 'Moonshot',
    service: 'Fireworks',
    type: 'VLM (Vision)',
    icon: modelIconRef('kimi')
  }
]

function RadeonCloudModelCard({ model }: { model: RadeonCloudModelCard }) {
  const Icon = useIcon(model.icon)

  return (
    <a
      data-testid="radeon-cloud-model-link"
      href={RADEON_CLOUD_MODELS_URL}
      target="_blank"
      rel="noreferrer"
      aria-label={model.name}
      className="group grid h-[68px] min-w-0 grid-cols-[36px_minmax(0,1fr)_28px] items-center gap-3 px-4 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35 focus-visible:ring-inset">
      <span
        data-testid="radeon-cloud-model-icon"
        className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-muted/25">
        {Icon ? (
          <Icon.Avatar size={36} shape="rounded" />
        ) : (
          <Avatar className="size-9 rounded-lg">
            <AvatarFallback className="rounded-lg font-semibold text-sm">{model.publisher[0]}</AvatarFallback>
          </Avatar>
        )}
      </span>

      <span className="flex min-w-0 flex-col justify-center gap-1.5">
        <span className="truncate font-semibold text-foreground text-sm leading-tight">{model.name}</span>
        <span className="truncate text-muted-foreground text-xs leading-tight">
          {model.publisher} · {model.service} · {model.type}
        </span>
      </span>

      <span className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors group-hover:bg-accent group-hover:text-foreground">
        <ExternalLink className="size-3.5" aria-hidden />
      </span>
    </a>
  )
}

export default function RadeonCloudModelCards() {
  const RadeonCloudIcon = useIcon(RADEON_CLOUD_ICON)

  return (
    <section
      data-testid="radeon-cloud-model-cards"
      className="overflow-hidden rounded-lg border border-border-muted bg-background">
      <div className="flex min-h-[72px] items-center gap-3 border-border-subtle border-b bg-muted/20 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-background">
          {RadeonCloudIcon ? (
            <RadeonCloudIcon.Avatar size={40} shape="rounded" />
          ) : (
            <Avatar className="size-10 rounded-lg">
              <AvatarFallback className="rounded-lg font-semibold text-sm">AMD</AvatarFallback>
            </Avatar>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold text-[15px] text-foreground leading-tight">AMD GPU Cloud</span>
          <span className="truncate text-muted-foreground text-xs leading-tight">Official Model APIs</span>
        </span>
        <a
          href={RADEON_CLOUD_MODELS_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="AMD GPU Cloud Model APIs"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-muted bg-background px-2.5 font-medium text-foreground-secondary text-xs transition-colors hover:border-border-hover hover:bg-accent focus-visible:outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35">
          Model APIs
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="divide-y divide-border-subtle">
        {RADEON_CLOUD_MODELS.map((model) => (
          <RadeonCloudModelCard key={model.name} model={model} />
        ))}
      </div>
    </section>
  )
}
