import ClipboardCopy from 'lucide-react/dist/esm/icons/clipboard-copy'
import FileQuestion from 'lucide-react/dist/esm/icons/file-question'
import Languages from 'lucide-react/dist/esm/icons/languages'
import Quote from 'lucide-react/dist/esm/icons/quote'
import ScanText from 'lucide-react/dist/esm/icons/scan-text'
import Search from 'lucide-react/dist/esm/icons/search'
import WandSparkles from 'lucide-react/dist/esm/icons/wand-sparkles'
import type { ComponentProps, FC, ReactNode } from 'react'
import { lazy, Suspense } from 'react'

const DynamicSelectionActionIcon = lazy(() => import('./DynamicSelectionActionIcon'))

type StaticSelectionActionIcon = typeof Languages

const BUILT_IN_SELECTION_ACTION_ICONS: Record<string, StaticSelectionActionIcon> = {
  'clipboard-copy': ClipboardCopy,
  'file-question': FileQuestion,
  languages: Languages,
  quote: Quote,
  'scan-text': ScanText,
  search: Search,
  'wand-sparkles': WandSparkles
}

type SelectionActionIconProps = ComponentProps<StaticSelectionActionIcon> & {
  fallback?: () => ReactNode
  name?: string
}

const SelectionActionIcon: FC<SelectionActionIconProps> = ({ fallback, name, ...props }) => {
  const BuiltInIcon = name ? BUILT_IN_SELECTION_ACTION_ICONS[name] : undefined

  if (BuiltInIcon) {
    return <BuiltInIcon {...props} />
  }

  if (!name) {
    return fallback?.() ?? null
  }

  return (
    <Suspense fallback={fallback?.() ?? null}>
      <DynamicSelectionActionIcon fallback={fallback} name={name} {...props} />
    </Suspense>
  )
}

export default SelectionActionIcon
