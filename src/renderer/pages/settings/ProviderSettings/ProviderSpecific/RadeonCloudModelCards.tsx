import { ExternalLink } from 'lucide-react'

const RADEON_CLOUD_MODELS_URL = 'https://developer.amd.com.cn/radeon/modelapis'

const RADEON_CLOUD_MODELS = ['Qwen3.6-35B-A3B', 'DeepSeek-V4-Flash', 'MiniMax M3', 'Kimi 2.6'] as const

export default function RadeonCloudModelCards() {
  return (
    <div
      data-testid="radeon-cloud-model-cards"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
      {RADEON_CLOUD_MODELS.map((model) => (
        <a
          key={model}
          href={RADEON_CLOUD_MODELS_URL}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-12 min-w-0 items-center justify-between gap-2 rounded-lg border border-border-muted bg-muted/30 px-3 py-2.5 text-left shadow-none transition-colors hover:border-border hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[1px] focus-visible:ring-ring/35">
          <span className="min-w-0 break-words text-foreground text-sm leading-tight">{model}</span>
          <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        </a>
      ))}
    </div>
  )
}
