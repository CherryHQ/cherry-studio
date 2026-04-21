import {
  Button,
  Input,
  Scrollbar,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider
} from '@cherrystudio/ui'
import { Bot, DatabaseZap, Info, Layers3, RefreshCw, Search, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SectionTitleProps {
  title: string
  icon: typeof Bot
  actionLabel?: string
}

interface FieldProps {
  label: string
  value: string
  suffix?: string
}

interface SelectOption {
  label: string
  value: string
}

interface DimensionFieldProps {
  ariaLabel: string
  label: string
  value: string
}

const SectionTitle = ({ title, icon: Icon, actionLabel }: SectionTitleProps) => {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 pt-1 pb-1.5 font-medium text-[0.75rem] text-foreground leading-4.5">
        <Icon className="size-3.5 text-muted-foreground/70" />
        <span>{title}</span>
      </div>
      {actionLabel ? (
        <Button
          type="button"
          variant="ghost"
          className="h-5 min-h-5 rounded px-2 text-[0.5625rem] text-muted-foreground/50 leading-3.375 shadow-none hover:bg-accent/60 hover:text-foreground">
          <Undo2 className="size-3" />
          <span>{actionLabel}</span>
        </Button>
      ) : null}
    </div>
  )
}

const FieldLabel = ({ label }: { label: string }) => {
  return (
    <div className="mb-1 flex items-center gap-1">
      <span className="text-[0.6875rem] text-foreground/75 leading-4.125">{label}</span>
      <Info className="size-[0.5625rem] text-muted-foreground/40" />
    </div>
  )
}

const SelectField = ({
  value,
  options,
  onValueChange
}: {
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
}) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        size="sm"
        className="h-auto min-h-0 w-full rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] leading-4.125 shadow-none dark:bg-transparent [&_svg]:size-3.5 [&_svg]:text-muted-foreground/40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="text-[0.6875rem]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-[0.6875rem]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const NumericField = ({ label, value, suffix }: FieldProps) => {
  return (
    <div>
      <FieldLabel label={label} />
      <div className="relative">
        <Input
          readOnly
          value={value}
          className="h-auto rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/30 focus-visible:border-emerald-400/40 focus-visible:ring-1 focus-visible:ring-emerald-400/15 md:text-[0.6875rem]"
        />
        {suffix ? (
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 text-[0.5625rem] text-muted-foreground/25 leading-3.375">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const DimensionField = ({ ariaLabel, label, value }: DimensionFieldProps) => {
  return (
    <div>
      <FieldLabel label={label} />
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={value}
          className="h-auto rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/30 focus-visible:border-emerald-400/40 focus-visible:ring-1 focus-visible:ring-emerald-400/15 md:text-[0.6875rem]"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={ariaLabel}
          className="size-7 min-h-7 min-w-7 shrink-0 rounded-md border border-border/40 p-0 text-muted-foreground/40 shadow-none hover:bg-accent hover:text-foreground"
          onClick={() => undefined}>
          <RefreshCw className="size-2.5" />
        </Button>
      </div>
    </div>
  )
}

const HintText = ({ children, tone = 'info' }: { children: string; tone?: 'info' | 'warning' }) => {
  return (
    <div
      className={
        tone === 'warning'
          ? 'flex items-start gap-2 rounded-md border border-amber-500/12 bg-amber-500/[0.06] px-2.5 py-1.5'
          : 'flex items-start gap-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 px-2.5 py-1.5'
      }>
      <Info
        className={
          tone === 'warning' ? 'mt-px size-3 shrink-0 text-amber-600/60' : 'mt-px size-3 shrink-0 text-emerald-400/70'
        }
      />
      <span
        className={
          tone === 'warning'
            ? 'text-[0.5625rem] text-amber-600/60 leading-[0.9141rem]'
            : 'text-[0.5625rem] text-emerald-400/70 leading-[0.9141rem]'
        }>
        {children}
      </span>
    </div>
  )
}

const SliderRow = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  formatValue
}: {
  label: string
  value: number[]
  onValueChange: (value: number[]) => void
  min: number
  max: number
  step: number
  minLabel: string
  maxLabel: string
  formatValue: (value: number) => string
}) => {
  const currentValue = value[0] ?? min

  return (
    <div>
      <div className="mb-1 flex items-end justify-between gap-3">
        <FieldLabel label={label} />
        <span className="text-[0.6875rem] text-foreground leading-4.125">{formatValue(currentValue)}</span>
      </div>

      <div>
        <Slider
          value={value}
          onValueChange={onValueChange}
          min={min}
          max={max}
          step={step}
          size="sm"
          className="w-full [&_[data-slot=slider-range]]:bg-foreground/65 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:border-foreground/20 [&_[data-slot=slider-thumb]]:bg-background [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-track]]:h-px [&_[data-slot=slider-track]]:bg-border/40"
        />

        <div className="mt-px flex items-center justify-between text-[0.5rem] text-muted-foreground/25 leading-3">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    </div>
  )
}

const RagConfigPanel = () => {
  const { t } = useTranslation()
  const [processor, setProcessor] = useState('unstructured-io')
  const [separatorRule, setSeparatorRule] = useState('default-separator')
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small')
  const [rerankModel, setRerankModel] = useState('disabled')
  const [documentCount, setDocumentCount] = useState([10])
  const [threshold, setThreshold] = useState([0.6])

  const processorOptions: SelectOption[] = [
    { value: 'unstructured-io', label: 'Unstructured.io' },
    { value: 'llama-parse', label: 'LlamaParse' },
    { value: 'mineru', label: 'MinerU' }
  ]

  const separatorOptions: SelectOption[] = [
    { value: 'default-separator', label: t('knowledge_v2.rag.default_separator') },
    { value: 'paragraph-first', label: t('knowledge_v2.rag.default_separator') + ' / Paragraph' },
    { value: 'sentence-first', label: t('knowledge_v2.rag.default_separator') + ' / Sentence' }
  ]

  const embeddingModelOptions: SelectOption[] = [
    { value: 'text-embedding-3-small', label: 'text-embedding-3-small' },
    { value: 'text-embedding-3-large', label: 'text-embedding-3-large' },
    { value: 'bge-m3', label: 'bge-m3' }
  ]

  const rerankModelOptions: SelectOption[] = [
    { value: 'disabled', label: t('knowledge_v2.rag.rerank_disabled') },
    { value: 'bge-reranker-v2-m3', label: 'bge-reranker-v2-m3' },
    { value: 'cohere-rerank-3', label: 'cohere-rerank-3' }
  ]

  return (
    <Scrollbar className="h-full min-h-0">
      <div className="mx-auto max-w-[30rem] space-y-5 px-5 py-4">
        <section className="space-y-2.5">
          <SectionTitle title={t('knowledge.settings.preprocessing')} icon={Bot} />

          <div>
            <FieldLabel label={t('knowledge_v2.rag.processor')} />
            <SelectField value={processor} options={processorOptions} onValueChange={setProcessor} />
          </div>

          <HintText tone="info">{t('knowledge_v2.rag.preprocessing_hint')}</HintText>
        </section>

        <section className="space-y-2.5">
          <SectionTitle
            title={t('knowledge_v2.rag.chunking')}
            icon={Layers3}
            actionLabel={t('knowledge_v2.rag.reset_defaults')}
          />

          <div className="grid grid-cols-2 gap-2">
            <NumericField label={t('knowledge.chunk_size')} value="512" suffix={t('knowledge_v2.rag.tokens_unit')} />
            <NumericField label={t('knowledge.chunk_overlap')} value="50" suffix={t('knowledge_v2.rag.tokens_unit')} />
          </div>

          <div>
            <FieldLabel label={t('knowledge_v2.rag.separator_rule')} />
            <SelectField value={separatorRule} options={separatorOptions} onValueChange={setSeparatorRule} />
          </div>

          <HintText tone="warning">{t('knowledge.chunk_size_change_warning')}</HintText>
        </section>

        <section className="space-y-2.5">
          <SectionTitle title={t('knowledge.embedding_model')} icon={DatabaseZap} />

          <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
            <div>
              <FieldLabel label={t('knowledge.embedding_model')} />
              <SelectField value={embeddingModel} options={embeddingModelOptions} onValueChange={setEmbeddingModel} />
            </div>

            <DimensionField ariaLabel={t('common.refresh')} label={t('knowledge.dimensions')} value="1536" />
          </div>
        </section>

        <section className="space-y-2.5">
          <SectionTitle title={t('knowledge_v2.rag.retrieval')} icon={Search} />

          <SliderRow
            label={t('knowledge.document_count')}
            value={documentCount}
            onValueChange={setDocumentCount}
            min={1}
            max={50}
            step={1}
            minLabel="1"
            maxLabel="50"
            formatValue={(value) => String(value)}
          />
          <SliderRow
            label={t('knowledge.threshold')}
            value={threshold}
            onValueChange={setThreshold}
            min={0}
            max={1}
            step={0.01}
            minLabel="0.00"
            maxLabel="1.00"
            formatValue={(value) => value.toFixed(2).replace(/0$/, '').replace(/\.00$/, '.0')}
          />

          <div>
            <FieldLabel label={t('models.rerank_model')} />
            <SelectField value={rerankModel} options={rerankModelOptions} onValueChange={setRerankModel} />
          </div>
        </section>

        <div className="flex items-center justify-end gap-2 border-border/15 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-6 min-h-6 rounded-md px-3 text-[0.6875rem] text-muted-foreground/50 leading-4.125 shadow-none hover:bg-accent/60 hover:text-foreground"
            onClick={() => undefined}>
            {t('common.reset')}
          </Button>
          <Button
            type="button"
            className="h-6 min-h-6 rounded-md bg-emerald-400 px-3 text-[0.6875rem] text-white leading-4.125 shadow-none hover:bg-emerald-500"
            onClick={() => undefined}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Scrollbar>
  )
}

export default RagConfigPanel
