import { Combobox, type ComboboxOption } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { BookOpen } from 'lucide-react'
import type { FC } from 'react'
import { useMemo } from 'react'

interface Props {
  value: string[]
  onChange: (ids: string[]) => void
}

/**
 * Knowledge base multi-select — writes the top-level `knowledgeBaseIds` array
 * on the assistant. The legacy `knowledgeRecognition` toggle is intentionally
 * omitted since the v2 Assistant schema does not carry that field yet.
 */
const KnowledgeSection: FC<Props> = ({ value, onChange }) => {
  const { data, isLoading } = useQuery('/knowledge-bases', { query: { limit: 100 } })
  const bases = useMemo(() => data?.items ?? [], [data])

  // Defensive: keep ids the user bound previously that the list hasn't surfaced
  // yet (e.g. a base deleted in another window) so their labels can still show.
  const options = useMemo<ComboboxOption[]>(() => {
    const byId = new Map(bases.map((b) => [b.id, b.name]))
    const extras = value.filter((id) => !byId.has(id))
    return [
      ...bases.map((b) => ({ value: b.id, label: b.name })),
      ...extras.map((id) => ({ value: id, label: `${id.slice(0, 8)}... (已失效)` }))
    ]
  }, [bases, value])

  const hasNoBases = !isLoading && bases.length === 0

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="mb-1 text-[14px] text-foreground">知识库</h3>
        <p className="text-[10px] text-muted-foreground/55">
          关联一个或多个知识库,对话时会按配置在知识库中检索相关内容
        </p>
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] text-muted-foreground/60">已关联的知识库</label>
        {hasNoBases ? (
          <EmptyHint />
        ) : (
          <>
            <Combobox
              multiple
              searchable
              options={options}
              value={value}
              onChange={(v) => onChange(Array.isArray(v) ? v : v ? [v] : [])}
              placeholder={isLoading ? '加载中...' : '选择知识库'}
              searchPlaceholder="搜索知识库"
              emptyText="未找到匹配的知识库"
              className="w-full"
              disabled={isLoading}
            />
            <p className="mt-1.5 text-[9px] text-muted-foreground/40">
              如需新建知识库,请前往「知识」页面创建后在此处关联
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function EmptyHint() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xs border border-border/20 border-dashed py-8">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xs bg-accent/30">
        <BookOpen size={18} strokeWidth={1.3} className="text-muted-foreground/30" />
      </div>
      <p className="mb-1 text-[11px] text-muted-foreground/60">尚未创建任何知识库</p>
      <p className="text-[10px] text-muted-foreground/40">请前往「知识」页面创建知识库后再回来关联</p>
    </div>
  )
}

export default KnowledgeSection
