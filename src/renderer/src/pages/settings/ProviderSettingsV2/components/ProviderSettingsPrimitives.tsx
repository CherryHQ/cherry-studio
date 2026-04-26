import { cn } from '@renderer/utils'
import type { ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { ReactNode } from 'react'

/**
 * Provider settings — design alignment (scoped theme + composition)
 *
 * **Shell** — `ProviderSetting.tsx` wraps the detail column in `.provider-settings-default-scope`. Everything
 * that must follow the provider-settings mock must stay in that subtree so tokens and `--color-*` bridge apply.
 *
 * **Two layers**
 * - **CSS** — `assets/styles/tailwind-default-scope.css`: atomic vars only (`--font-size-*`, `--space-*`, soft
 *   surfaces, `--color-*` → shadcn/Tailwind). No screen- or feature-prefixed names. When mock px hurts a11y /
 *   readability, prefer named steps and note the tradeoff in a CSS comment.
 * - **TS (this file)** — merge atoms into `actionClasses`, `fieldClasses`, `modelListClasses`, `apiKeyListClasses`.
 *   Use `var(--*)` in class strings; avoid scattered `text-[Npx]` and inline `fontWeight` styles.
 *
 * **Rules (short)** — Do not satisfy this page by editing global `:root` unless product wants a global change.
 * Figma “infinite” radius exports → `rounded-full` in UI. Secondary actions: `btnNeutral`, not brand primary fill,
 * unless the spec demands emphasis. Execution order: scope vars + bridge in CSS → extend `*Classes` → touch TSX.
 */
export const providerSettingsTypography = {
  menu: 'text-[length:var(--font-size-body-sm)] leading-[length:var(--line-height-body-sm)]',
  body: 'text-[length:var(--font-size-body-sm)] leading-[length:var(--line-height-body-sm)]',
  label: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  micro: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  caption: 'text-[length:var(--font-size-body-xs)] leading-[length:var(--line-height-body-xs)]',
  subtitle: 'text-[length:var(--font-size-body-md)] leading-[length:var(--line-height-body-md)]'
} as const

/**
 * Input row + icon slots for provider settings, using tokens from `tailwind-default-scope.css`
 * (`.provider-settings-default-scope` — `--border`, `--foreground`, `--cherry-*`).
 * The provider detail shell should include `provider-settings-default-scope` so these inherit correctly.
 */
const providerSettingsInputGroupBase =
  'rounded-lg border border-[color:color-mix(in_srgb,var(--border)_30%,transparent)] bg-foreground/[0.03] px-2.5 py-[5px] shadow-none'

/** 连接认证、`ProviderSection`：14px、`/85`、section label 行高；字重用 scope `--font-weight-medium`。 */
const sectionHeadingBase =
  'm-0 text-[length:var(--font-size-body-md)] text-foreground/85 leading-[var(--line-height-section-label)]'

export const sectionHeadingClasses = cn(sectionHeadingBase, 'font-[weight:var(--font-weight-medium)]')

/** Connection-field actions; composes atomic `--space-*`, `--font-size-caption`, `--color-*-soft` from scope CSS. */
export const actionClasses = {
  row: 'flex flex-wrap items-center gap-[length:var(--space-inline-md)]',
  icon: 'size-[length:var(--icon-size-caption)] shrink-0',
  btnBase:
    'h-auto min-h-0 gap-2 rounded-[length:var(--radius-control)] px-[length:var(--padding-x-control)] py-[length:var(--padding-y-control)] text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] shadow-none',
  /** Neutral outline (design: action row — no brand fill on 检测 / 密钥列表). */
  btnNeutral:
    'border-[color:var(--color-border-default-soft)] bg-transparent text-[color:var(--color-fg-subtle)] hover:bg-[var(--accent)] hover:text-[color:var(--foreground)]'
} as const

/** Category filter pills; `rounded-full` matches Figma-style “infinite” corner radius exports. */
const modelListCategoryChipBase =
  'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-[weight:var(--font-weight-medium)] transition-all'

/** Model list block; composes atomic tokens from `tailwind-default-scope.css` under `.provider-settings-default-scope`. */
export const modelListClasses = {
  section: 'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-sm)]',
  headerBlock: 'flex min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-xs)]',
  titleRow: 'flex min-w-0 w-full flex-wrap items-center justify-between gap-3',
  titleWrap: 'flex min-w-0 items-baseline gap-[length:var(--space-inline-md)]',
  titleActions: 'flex max-w-full flex-wrap items-center gap-[length:var(--space-inline-xs)]',
  /** 模型列表区块标题：同字号/行高/色，字重 `--font-weight-semibold`（600） */
  sectionTitle: cn(sectionHeadingBase, 'font-[weight:var(--font-weight-semibold)]'),
  countMeta:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-(--color-muted-foreground) tabular-nums',
  toolbarGhost:
    'h-auto rounded-3xs px-2.5 py-[5px] text-[length:var(--font-size-caption)] leading-[length:var(--line-height-caption)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-hover-soft)] hover:text-foreground',
  /** 模型列表标题行 ghost：较 `toolbarGhost` 再收一档（padding + body-xs + 小图标） */
  toolbarHeaderGhost:
    'h-auto min-h-0 rounded-[length:var(--radius-4xs)] px-[length:var(--padding-x-control-compact)] py-[length:var(--padding-y-control-compact)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarIcon: 'size-[length:var(--icon-size-caption)] shrink-0',
  toolbarHeaderIcon: 'size-[length:var(--icon-size-body-xs)] shrink-0',
  searchRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
  searchActions: 'flex max-w-full shrink-0 flex-wrap items-center gap-2',
  searchWrap:
    'flex flex-1 items-center gap-1.5 rounded-lg border border-[color:var(--color-border-fg-hairline)] bg-[var(--color-surface-fg-sunken)] px-2.5 py-[5px]',
  searchIcon: 'size-[length:var(--icon-size-caption)] shrink-0 text-foreground/55',
  searchInput:
    'min-w-0 flex-1 border-none bg-transparent text-[length:var(--font-size-body-md)] text-foreground/80 outline-none placeholder:text-foreground/50 leading-[var(--line-height-body-md)]',
  searchClear:
    'flex h-[18px] w-[18px] items-center justify-center rounded-full text-foreground/45 transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/65',
  fetchOutline: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'rounded-lg border-[color:var(--color-border-fg-muted)] px-3 py-[5px] text-foreground/75 hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
  ),
  addIconButton:
    'size-8 rounded-lg border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  chipRow: 'flex min-w-0 w-full flex-wrap items-center gap-[5px]',
  chipActive: cn(
    modelListCategoryChipBase,
    'min-w-0 max-w-full border-[color:color-mix(in_srgb,var(--foreground)_15%,transparent)] bg-[var(--color-surface-fg-muted)] text-foreground/85'
  ),
  chipIdle: cn(
    modelListCategoryChipBase,
    'min-w-0 max-w-full border-[color:var(--color-border-fg-muted)] bg-transparent text-foreground/65 hover:border-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)] hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/80'
  ),
  chipLabel: 'min-w-0 truncate text-[length:var(--font-size-chip-label)] leading-[var(--line-height-caption)]',
  chipCount:
    'shrink-0 text-[length:var(--font-size-chip-count)] leading-[var(--line-height-body-xs)] opacity-70 tabular-nums',
  subsectionRow: 'flex items-center gap-2 px-3 py-[4px]',
  subsectionRule: 'h-px flex-1 bg-foreground/[0.08]',
  subsectionTitleEnabled:
    'font-medium text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/75',
  subsectionCountEnabled:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/60 tabular-nums',
  subsectionTitleDisabled:
    'font-medium text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/70',
  subsectionCountDisabled:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/55 tabular-nums',
  emptyState:
    'flex min-h-40 items-center justify-center rounded-2xl border border-(--color-border) border-dashed bg-[var(--color-surface-fg-sunken)] px-4 text-center text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-(--color-muted-foreground)',
  listScroller:
    '-mx-1 min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto pr-1 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[2px]',
  groupShell: 'min-w-0 w-full group [&_.ant-collapse-content-box]:!p-0',
  groupHeaderLabel: 'flex min-w-0 flex-1 items-center gap-2 overflow-hidden',
  groupTitle:
    'min-w-0 flex-shrink truncate text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/78 font-[weight:var(--font-weight-medium)]',
  groupHeaderRule: 'h-px flex-1 bg-foreground/[0.06]',
  groupCount:
    'shrink-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/58 tabular-nums',
  groupActionButton:
    'h-6 min-h-0 rounded-md px-1.5 py-0 text-muted-foreground/65 opacity-0 shadow-none transition-all hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground group-hover:opacity-100',
  row: 'group flex cursor-pointer items-start gap-3 rounded-xl px-3 py-[10px] text-foreground leading-none transition-colors hover:bg-[var(--color-surface-fg-subtle)]',
  rowMain: 'min-w-0 flex-1 items-start gap-3',
  rowAvatar: 'h-[26px] w-[26px] shrink-0 rounded-lg',
  rowBody: 'min-w-0 max-w-full flex-1 overflow-hidden',
  rowBadges: 'mt-1 flex min-h-[18px] min-w-0 max-w-full flex-wrap items-center gap-1.5',
  rowMeta:
    'mt-[3px] block min-w-0 max-w-full truncate text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/65',
  rowActions: 'min-w-0 shrink-0 items-center gap-1.5 self-center',
  rowIconButton:
    'size-7 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
} as const

export const apiKeyListClasses = {
  shell: 'provider-settings-default-scope space-y-4 py-1',
  card: 'rounded-xl border border-[color:var(--color-border-fg-muted)] bg-[var(--color-surface-fg-sunken)] px-4 py-3',
  summaryRow: 'flex items-center justify-between gap-3',
  summaryTitle:
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  summaryMeta:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-(--color-muted-foreground) tabular-nums',
  helperText: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground/60',
  listWrap: 'overflow-hidden rounded-xl border border-[color:var(--color-border-fg-muted)] bg-background',
  listScroller: 'max-h-[60vh] overflow-y-auto overflow-x-hidden',
  keyRow: 'flex flex-col gap-2 border-b border-[color:var(--color-border-fg-hairline)] px-4 py-3 last:border-b-0',
  keyRowHeader: 'flex items-start justify-between gap-3',
  keyRowBody: 'flex items-center gap-2',
  keyLabel:
    'min-w-0 truncate text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  keyValue:
    'min-w-0 flex-1 truncate font-mono text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/60',
  keyInputRow: 'grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]',
  input:
    'h-8 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-background px-3 text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/80 outline-none placeholder:text-foreground/35',
  actionRow: 'flex items-center justify-between gap-3',
  actionCluster: 'flex items-center gap-1',
  iconButton:
    'size-8 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  addButton:
    'h-auto rounded-lg border border-dashed border-[color:var(--color-border-fg-muted)] bg-transparent px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground/65 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/85'
} as const

export const fieldClasses = {
  inputRow: 'flex min-w-0 items-center gap-1.5',
  /** Reserves 24×24 next to `inputGroup` in `inputRow` when there is no trailing action (aligns with `iconButton`). */
  inputRowEndSlot: 'inline-flex h-6 w-6 shrink-0',
  /** In a `inputRow` next to a 24px icon button */
  inputGroup: ['min-w-0 flex-1 h-8 py-[5px]', providerSettingsInputGroupBase].join(' '),
  /** Full-width field (no side icon) */
  inputGroupBlock: ['w-full', providerSettingsInputGroupBase].join(' '),
  /**
   * Body text: 14px. Must repeat at `md:` — `Input` ships `md:text-sm` and plain `text-[14px]` does not
   * remove that responsive class, so ≥md would still use `text-sm` otherwise.
   */
  input: 'text-[12px] text-foreground/75 placeholder:text-foreground/30 md:text-[12px] h-8',
  /**
   * Small 24px icon control (e.g. copy / settings) — `var(--cherry-*)` match `tailwind-default-scope.css`.
   */
  iconButton:
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[var(--cherry-active-border)] text-[var(--cherry-text-muted)] transition-colors hover:bg-[var(--cherry-active-bg)] hover:text-[var(--cherry-primary-hover)] disabled:pointer-events-none disabled:opacity-40',
  /** Inline show/hide control (draft: inside field, no extra border) */
  apiKeyVisibilityToggle:
    'ml-1.5 shrink-0 text-[var(--cherry-text-muted)] transition-colors hover:text-[var(--cherry-primary-hover)] disabled:pointer-events-none disabled:opacity-40'
} as const

export function ProviderSettingsContainer({
  theme,
  className,
  children
}: {
  theme?: ThemeMode
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        theme === 'dark' ? 'bg-(--color-background)' : 'bg-(--color-background)',
        className
      )}>
      {children}
    </div>
  )
}

export function ProviderSettingsSubtitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('mt-4 select-none font-semibold text-foreground', providerSettingsTypography.subtitle, className)}>
      {children}
    </div>
  )
}

export function ProviderHelpText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-foreground opacity-40', providerSettingsTypography.label, className)}>{children}</div>
}

export function ProviderHelpTextRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-row items-center py-[5px]', className)}>{children}</div>
}

export function ProviderHelpLink({ children, className, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(
        'mx-[5px] cursor-pointer text-(--color-primary) hover:underline',
        providerSettingsTypography.label,
        className
      )}
      {...props}>
      {children}
    </a>
  )
}
