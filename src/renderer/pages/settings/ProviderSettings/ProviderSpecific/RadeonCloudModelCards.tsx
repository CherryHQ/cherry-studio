import { Avatar, AvatarFallback } from '@cherrystudio/ui'
import { type IconRef, modelIconRef, providerIconRef, useIcon } from '@cherrystudio/ui/icons'
import { ExternalLink } from 'lucide-react'

const TOKEN_FACTORY_URL = 'https://developer.amd.com.cn/radeon/tokenfactory?source=cherry-studio'

interface RadeonCloudModelCard {
  name: string
  publisher: string
  service: 'AMD Radeon Cloud'
  type: 'LLM (Text)' | 'VLM (Vision)'
  icon: IconRef
}

const RADEON_CLOUD_ICON = providerIconRef('radeon-cloud')

const RADEON_CLOUD_MODELS: readonly RadeonCloudModelCard[] = [
  {
    name: 'Qwen3.6-35B-A3B',
    publisher: 'Qwen',
    service: 'AMD Radeon Cloud',
    type: 'VLM (Vision)',
    icon: providerIconRef('qwen')
  },
  {
    name: 'DeepSeek-V4-Flash',
    publisher: 'DeepSeek',
    service: 'AMD Radeon Cloud',
    type: 'LLM (Text)',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'DeepSeek-V4-Pro',
    publisher: 'DeepSeek',
    service: 'AMD Radeon Cloud',
    type: 'LLM (Text)',
    icon: providerIconRef('deepseek')
  },
  {
    name: 'GLM 5.1',
    publisher: 'Z.ai',
    service: 'AMD Radeon Cloud',
    type: 'LLM (Text)',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'GLM 5.2',
    publisher: 'Z.ai',
    service: 'AMD Radeon Cloud',
    type: 'LLM (Text)',
    icon: providerIconRef('z-ai')
  },
  {
    name: 'OpenAI gpt-oss-120b',
    publisher: 'OpenAI',
    service: 'AMD Radeon Cloud',
    type: 'LLM (Text)',
    icon: modelIconRef('gpt-oss-120b')
  },
  {
    name: 'Kimi K2.6',
    publisher: 'Moonshot',
    service: 'AMD Radeon Cloud',
    type: 'VLM (Vision)',
    icon: modelIconRef('kimi')
  }
]

function RadeonCloudModelCard({ model }: { model: RadeonCloudModelCard }) {
  const Icon = useIcon(model.icon)

  return (
    <div
      data-testid="radeon-cloud-model-row"
      className="grid h-12 min-w-0 grid-cols-[32px_minmax(0,1fr)] items-center gap-3 px-4 text-left">
      <span
        data-testid="radeon-cloud-model-icon"
        className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border-subtle bg-muted/25">
        {Icon ? (
          <Icon.Avatar size={32} shape="rounded" />
        ) : (
          <Avatar className="size-8 rounded-lg">
            <AvatarFallback className="rounded-lg font-semibold text-sm">{model.publisher[0]}</AvatarFallback>
          </Avatar>
        )}
      </span>

      <span data-testid="radeon-cloud-model-details" className="min-w-0 truncate text-sm leading-tight">
        <span className="font-semibold text-foreground">{model.name}</span>
        <span className="text-muted-foreground">
          {' · '}
          {model.publisher} · {model.service} · {model.type}
        </span>
      </span>
    </div>
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
          <a
            href={TOKEN_FACTORY_URL}
            target="_blank"
            rel="noreferrer"
            className="flex w-fit max-w-full items-center gap-1.5 truncate font-semibold text-[15px] text-foreground leading-tight hover:text-primary focus-visible:outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35">
            AMD GPU Cloud
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
          </a>
          <span className="truncate text-muted-foreground text-xs leading-tight">Official Model APIs</span>
        </span>
      </div>
      <div className="divide-y divide-border-subtle">
        {RADEON_CLOUD_MODELS.map((model) => (
          <RadeonCloudModelCard key={model.name} model={model} />
        ))}
      </div>
    </section>
  )
}
