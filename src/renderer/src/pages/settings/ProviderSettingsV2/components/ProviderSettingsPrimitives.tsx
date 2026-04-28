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
 * - **TS (this file)** — merge atoms into `actionClasses`, `fieldClasses`, `modelListClasses`, `providerDetailColumnClasses`,
 *   `apiKeyListClasses`, …
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
/** `ModelServicePage` Connection — `bg-muted/50` strip + `border-section-border` (`tailwind-default-scope.css`). */
const providerSettingsInputGroupBase =
  'rounded-lg border border-[color:var(--section-border)] bg-muted/50 px-2.5 py-[5px] shadow-none'

/** 连接认证、`ProviderSection`：14px、`/85`、section label 行高；字重用 scope `--font-weight-medium`。 */
const sectionHeadingBase =
  'm-0 text-[length:var(--font-size-body-md)] text-foreground/85 leading-[var(--line-height-section-label)]'

export const sectionHeadingClasses = cn(sectionHeadingBase, 'font-[weight:var(--font-weight-medium)]')

/**
 * `cherry-studio-ui-design` ModelServicePage — 「连接认证」卡片：描边容器 + 卡内小号标题（区别于模型列表 semibold tier）。
 */
export const authConnectionClasses = {
  shell: 'rounded-[length:var(--radius-button)] border border-[color:var(--section-border)] px-3.5 py-3',
  blockTitle: 'mb-2.5 text-xs font-[weight:var(--font-weight-medium)] text-foreground/70',
  body: 'space-y-2.5'
} as const

/**
 * Provider detail column (`ProviderSetting.tsx`) — padding + scrollbar + gap between Authentication + ModelList.
 * Mirrors `ModelServicePage` provider column scroll: `flex-1 overflow-y-auto px-5 py-4` … `gap-4` / `space-y-4`.
 */
export const providerDetailColumnClasses = {
  headerPad: 'shrink-0 px-5 py-3.5',
  scrollStrip:
    'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[3px]',
  sectionStack: 'flex min-h-full w-full min-w-0 flex-col gap-4'
} as const

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

/** Provider list rows + detached menus; popover content must re-enter `.provider-settings-default-scope`. */
export const providerListClasses = {
  shell:
    'flex h-full w-[clamp(220px,20vw,250px)] shrink-0 basis-[clamp(220px,20vw,250px)] flex-col border-r border-[color:var(--section-border)] bg-(--color-background)',
  header: 'mb-2 flex shrink-0 items-center justify-between gap-2 px-3 pb-0 pt-3.5',
  headerTitle:
    'min-w-0 flex-1 truncate text-sm leading-[1.3] font-[weight:var(--font-weight-semibold)] text-foreground',
  filterTrigger:
    'flex size-5 items-center justify-center rounded-md text-foreground/40 transition-colors hover:bg-[var(--color-surface-hover-soft)] hover:text-foreground/70 disabled:pointer-events-none disabled:opacity-30',
  searchWrap:
    'flex items-center gap-1.5 rounded-lg border border-[color:var(--section-border)] bg-muted/50 px-2 py-[4px]',
  searchIcon: 'size-[9px] shrink-0 text-muted-foreground/60',
  searchInput:
    'min-w-0 flex-1 bg-transparent text-sm leading-[1.25] text-foreground/80 outline-none placeholder:text-muted-foreground/60',
  scroller:
    'min-h-0 flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[2px]',
  sectionStack: 'space-y-3',
  section: 'space-y-2',
  sectionHeader: 'pb-0.5 pl-2 pr-2 pt-1.5',
  sectionHeaderAfterEnabled: 'pt-2',
  sectionLabel: 'mb-0.5 text-xs leading-[1.2] text-muted-foreground',
  emptyState:
    'flex h-full min-h-40 items-center justify-center px-3 text-center text-(--color-muted-foreground) text-[14px]',
  addWrap: 'shrink-0 border-t border-[color:var(--section-border)] px-2.5 py-2',
  addButton:
    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-[color:var(--section-border)] border-dashed bg-transparent py-[5px] text-xs text-muted-foreground shadow-none transition-colors hover:border-[color:var(--color-border)] hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
  item: 'relative flex w-full items-center justify-between rounded-xl border border-transparent px-2 py-2 text-left shadow-none outline-none transition-all focus-visible:ring-0',
  itemSelected: 'bg-muted/55 dark:bg-muted/40',
  itemIdle: 'hover:bg-accent/50',
  itemAvatar: 'shrink-0 rounded-md',
  itemLabel: 'truncate text-sm leading-[1.35]',
  itemMenuContent:
    'provider-settings-default-scope rounded-2xl border-[color:var(--color-border-fg-muted)] bg-(--color-background) p-1.5 shadow-2xl',
  itemMenuEntry: 'rounded-xl px-3 py-[6px] text-sm hover:bg-[var(--color-surface-hover-soft)]'
} as const

/**
 * `cherry-studio-ui-design` `ModelServicePage` — custom request headers side panel (one card per header).
 */
export const customHeaderDrawerClasses = {
  headerTitleRow: 'flex w-full min-w-0 items-center justify-between gap-2',
  headerTitleText: 'truncate font-semibold text-foreground text-sm',
  bodyScroll: 'flex flex-col gap-2.5 py-3',
  card: 'space-y-1.5 rounded-xl border border-[color:var(--section-border)] bg-muted/50 p-2.5',
  cardRow: 'flex items-center gap-1.5',
  cardRowLabel: 'w-10 shrink-0 text-xs text-muted-foreground/40',
  cardInput:
    'min-w-0 flex-1 border-0 border-b border-[color:var(--section-border)] bg-transparent p-0 pb-0.5 text-sm text-muted-foreground shadow-none outline-none focus-visible:ring-0 placeholder:text-muted-foreground/50',
  cardRemoveRow: 'flex justify-end',
  removeIconButton:
    'size-6 text-destructive/50 shadow-none hover:bg-transparent hover:text-destructive [&_svg]:size-[9px]',
  addRowButton:
    'flex h-auto w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[color:var(--section-border)] py-2 text-xs text-muted-foreground/40 shadow-none hover:border-[color:var(--section-border)] hover:text-foreground',
  footerOutlineBtn:
    'h-auto px-2.5 py-1 text-xs text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground',
  footerPrimaryBtn: 'h-auto px-3 py-1 text-xs'
} as const

export const drawerClasses = {
  form: 'provider-settings-default-scope flex min-h-0 flex-col gap-5 py-1',
  section: 'space-y-5',
  fieldList: 'space-y-5',
  input:
    'w-full rounded-[20px] border border-[color:var(--color-border-default-soft)] bg-background px-4 py-3 text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/90 outline-none placeholder:text-foreground/35 shadow-none',
  inputDisabled: 'bg-[var(--color-surface-fg-subtle)] text-foreground/55',
  selectTrigger:
    'h-auto w-full rounded-[20px] border-[color:var(--color-border-default-soft)] bg-background px-4 py-3 text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/90 shadow-none aria-expanded:ring-0 aria-expanded:border-[color:var(--color-border-default-soft)] data-[placeholder]:text-foreground/35',
  selectContent:
    'provider-settings-default-scope rounded-xl border-[color:var(--color-border-fg-muted)] bg-(--color-background) shadow-lg',
  helpText: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/80',
  errorText: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-destructive/85',
  toggleButton: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'justify-center gap-1.5 rounded-lg border-[color:var(--color-border-fg-muted)] px-3 py-2 text-foreground/75 hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
  ),
  inlineRow: 'flex flex-wrap items-center gap-2',
  valueRow: 'flex min-w-0 items-center gap-2',
  valueSuffix:
    'shrink-0 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground/80',
  divider: 'h-px bg-[var(--color-border-fg-hairline)]',
  footer: 'flex items-center justify-end gap-2',
  /** Model health-check drawer: determinate progress (scoped neutral track + primary fill). */
  healthProgressTrack:
    'h-1.5 w-full overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--muted-foreground)_12%,transparent)]',
  healthProgressFill: 'h-full rounded-full bg-primary transition-[width] duration-300 ease-out',
  healthProgressMeta: 'text-[length:var(--font-size-caption)] tabular-nums text-muted-foreground/85',
  healthProgressCurrent: 'truncate text-[length:var(--font-size-caption)] text-foreground/80'
} as const

/** Category filter pills; `rounded-full` matches Figma-style “infinite” corner radius exports. */
const modelListCategoryChipBase =
  'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-[weight:var(--font-weight-medium)] transition-all'

/** Model list block; composes atomic tokens from `tailwind-default-scope.css` under `.provider-settings-default-scope`. */
export const modelListClasses = {
  /** Inline-size container for `@container model-list` rules in `tailwind-default-scope.css` (replaces JS width measurement). */
  cqRoot: 'ps-model-list-cq flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-sm)]',
  section: 'flex h-full min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-sm)]',
  headerBlock: 'flex min-h-0 min-w-0 w-full flex-1 flex-col gap-[length:var(--space-stack-xs)]',
  titleRow: 'flex min-w-0 w-full flex-wrap items-center justify-between gap-3',
  /** Model list header stack — matches `cherry-studio-ui-design` `ModelServicePage` model list block. */
  headerToolStack: 'flex min-w-0 w-full flex-col gap-2',
  titleWrap: 'flex min-w-0 items-baseline gap-[length:var(--space-inline-md)]',
  titleActions: 'flex max-w-full flex-wrap items-center gap-0.5',
  /** Ghost icon triggers (design reference: inline provider model list toolbar). */
  toolbarDesignIconTrigger:
    'inline-flex size-7 shrink-0 items-center justify-center rounded-md p-0 text-muted-foreground/40 shadow-none transition-colors hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarDesignIconTriggerOn: 'bg-[var(--color-surface-fg-muted)] text-foreground',
  toolbarDesignIcon: 'size-[11px] shrink-0',
  /** Outline primary actions after the icon cluster. */
  toolbarOutlineActions: 'ms-1 flex max-w-full flex-wrap items-center gap-1',
  /** 模型列表区块标题：同字号/行高/色，字重 `--font-weight-semibold`（600） */
  sectionTitle: cn(sectionHeadingBase, 'font-[weight:var(--font-weight-semibold)]'),
  countMeta:
    'text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-(--color-muted-foreground) tabular-nums',
  toolbarGhost:
    'h-auto rounded-3xs px-2.5 py-[5px] text-[length:var(--font-size-caption)] leading-[length:var(--line-height-caption)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-hover-soft)] hover:text-foreground',
  /** 模型列表标题行 ghost：较 `toolbarGhost` 再收一档（padding + body-xs + 小图标） */
  toolbarHeaderGhost:
    'h-auto min-h-0 rounded-[length:var(--radius-4xs)] px-[length:var(--padding-x-control-compact)] py-[length:var(--padding-y-control-compact)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarHeaderIconButton:
    'size-8 rounded-[length:var(--radius-4xs)] p-0 text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground',
  toolbarIcon: 'size-[length:var(--icon-size-caption)] shrink-0',
  toolbarHeaderIcon: 'size-[length:var(--icon-size-body-xs)] shrink-0',
  searchExpandRow: 'flex min-w-0 w-full flex-wrap items-center gap-2',
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
    'min-w-0 max-w-full border-[color:color-mix(in_srgb,var(--foreground)_15%,transparent)] bg-[var(--color-surface-fg-muted)] ps-model-list-cap-chip text-foreground/85'
  ),
  chipIdle: cn(
    modelListCategoryChipBase,
    'min-w-0 max-w-full border-[color:var(--color-border-fg-muted)] bg-transparent ps-model-list-cap-chip text-foreground/65 hover:border-[color:color-mix(in_srgb,var(--foreground)_20%,transparent)] hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground/80'
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
  /**
   * `ModelServicePage` `ModelManagementPanel` — grouped catalog inside manage drawer (flat headers, no collapse).
   */
  manageListGroupShell: 'mb-1',
  manageListGroupHeader: 'flex items-center gap-1.5 px-1 py-[3px]',
  manageListGroupTitle:
    'font-[weight:var(--font-weight-medium)] text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground',
  manageListGroupRule: 'h-px min-w-0 flex-1 bg-muted/50',
  manageListRow: 'group flex items-center gap-2 rounded-lg px-1.5 py-[5px] transition-colors hover:bg-accent/50',
  manageListRowLast: 'mb-0.5',
  manageDrawerFilterChipBase: 'h-auto min-h-0 rounded-full px-2 py-[2px] font-medium text-xs transition-colors',
  manageDrawerFilterChipActive: 'bg-accent/50 !text-foreground',
  manageDrawerFilterChipIdle: 'text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground',
  manageDrawerCapChipBase:
    'h-auto min-h-0 min-w-0 items-center gap-[3px] rounded-full px-1.5 py-[2px] font-medium text-xs transition-colors',
  manageDrawerCapChipActive: 'bg-accent/50 !text-foreground',
  manageDrawerCapChipIdle: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  manageDrawerCountBadge:
    'shrink-0 rounded-full bg-muted/50 px-1.5 py-[1px] text-[length:var(--font-size-body-xs)] text-muted-foreground/60 tabular-nums',
  /** Trailing close in ModelManagementPanel title row (paired with bulk actions); matches `hover:bg-accent`. */
  manageDrawerCloseInTitle:
    "ml-1 !size-6 !min-h-6 shrink-0 gap-0 rounded-[length:var(--radius-control)] p-0 text-muted-foreground/60 shadow-none hover:bg-accent hover:text-foreground [&_svg:not([class*='size-'])]:size-[11px]",
  manageDrawerBulkGhost:
    'inline-flex !h-auto !min-h-0 items-center justify-center gap-1 rounded-[length:var(--radius-control)] px-1.5 py-[2px] text-[length:var(--font-size-body-xs)] font-medium tracking-[-0.14px] text-muted-foreground/60 shadow-none transition-colors hover:bg-accent has-[>svg]:px-1.5',
  /** Enable-all hover — brand `--primary` in this shell (design `hover:text-cherry-primary`). */
  manageDrawerBulkGhostEnableHover: 'hover:!text-primary',
  /** Disable-all hover — destructive (design draft). */
  manageDrawerBulkGhostDisableHover: 'hover:!text-destructive',
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
  /** Shown when model id !== name; hidden in narrow container via `.ps-model-list-id` rule. */
  modelIdBadge:
    'ps-model-list-id min-w-0 max-w-[50%] shrink truncate rounded-md bg-foreground/[0.05] px-1.5 py-[1px] font-mono text-[length:var(--font-size-body-xs)] text-muted-foreground leading-[var(--line-height-body-xs)]',
  rowBadges: 'mt-1 flex min-h-[18px] min-w-0 max-w-full flex-wrap items-center gap-1.5',
  /** Capability / trial tags to the left of the enable switch; design: single line with the toggle. */
  rowCapabilityStrip:
    'flex min-w-0 max-w-[min(100%,20rem)] shrink items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
  rowMeta:
    'ps-model-list-meta mt-[3px] block min-w-0 max-w-full truncate text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/65',
  /** Wraps `HealthStatusIndicator` so latency (antd Typography) can be hidden via container query. */
  healthStatusSlot: 'ps-model-list-health shrink-0',
  /** Trailing column: health + (capability strip + enable) on one row. */
  rowActionsCluster: 'flex min-w-0 items-center gap-2',
  rowActions: 'min-w-0 shrink-0 items-center gap-1.5 self-center',
  rowIconButton:
    'size-7 rounded-lg border border-[color:var(--color-border-fg-muted)] bg-transparent text-muted-foreground/70 shadow-none hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
} as const

export const modelSyncClasses = {
  panel: 'provider-settings-default-scope flex min-h-0 flex-1 flex-col gap-4',
  summaryCard:
    'rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-[var(--color-surface-fg-sunken)] px-4 py-3',
  summaryTitle:
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  summaryMeta: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  summaryGrid: 'mt-3 grid gap-2 sm:grid-cols-3',
  summaryMetric:
    'rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-background/75 px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-foreground/75',
  warningBlock:
    'rounded-2xl border border-[color:var(--color-border-warning-soft)] bg-[var(--color-surface-warning-soft)] px-4 py-3 text-[length:var(--font-size-caption)] leading-[var(--line-height-body-md)] text-foreground/80',
  section: 'rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-background px-4 py-4 shadow-none',
  sectionHeader: 'flex flex-wrap items-center justify-between gap-3',
  sectionTitleWrap: 'min-w-0',
  sectionTitle:
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85 font-[weight:var(--font-weight-medium)]',
  sectionMeta: 'text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  sectionActions: 'flex flex-wrap items-center gap-2',
  toggleButton: cn(
    actionClasses.btnBase,
    actionClasses.btnNeutral,
    'rounded-lg border-[color:var(--color-border-fg-muted)] px-3 py-[5px] text-foreground/70 hover:bg-[var(--color-surface-fg-subtle)] hover:text-foreground'
  ),
  list: 'mt-4 space-y-2',
  row: 'flex items-start gap-3 rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-[var(--color-surface-fg-sunken)] px-3 py-3',
  /** Pull preview rows — `FetchResultPanel`: circular control, white check on primary fill (`Checkbox` indicator SVG). */
  checkbox:
    'mt-0.5 size-4 rounded-full border-[color:color-mix(in_srgb,var(--border)_45%,transparent)] bg-background shadow-none ' +
    'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:[&_svg]:text-white',
  rowBody: 'min-w-0 flex-1',
  rowTitle: 'truncate text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground/85',
  rowMeta: 'mt-1 text-[length:var(--font-size-caption)] leading-[var(--line-height-caption)] text-muted-foreground/75',
  rowBadgeRow: 'mt-2 flex flex-wrap items-center gap-1.5',
  rowBadge:
    'rounded-full border border-[color:var(--color-border-fg-muted)] bg-background px-2 py-0.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/65',
  rowDangerBadge:
    'rounded-full border border-[color:var(--color-border-warning-soft)] bg-[var(--color-surface-warning-soft)] px-2 py-0.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-foreground/75',
  impactCard:
    'rounded-2xl border border-[color:var(--color-border-info-soft)] bg-[var(--color-surface-info-soft)] px-4 py-4',
  impactList: 'mt-3 space-y-2',
  impactItem:
    'rounded-xl border border-[color:var(--color-border-fg-hairline)] bg-background/80 px-3 py-2 text-[length:var(--font-size-caption)] leading-[var(--line-height-body-md)] text-foreground/78',
  emptyState:
    'rounded-2xl border border-dashed border-[color:var(--color-border-fg-muted)] bg-[var(--color-surface-fg-sunken)] px-4 py-8 text-center text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-muted-foreground/75',
  footer: 'flex items-center justify-end gap-2',
  /** `cherry-studio-ui-design` `ModelServicePage` `FetchResultPanel` — pull result side panel */
  fetchRoot: 'flex min-h-0 min-w-0 flex-1 flex-col',
  fetchScroll: 'flex-1 space-y-4 overflow-y-auto px-4 py-3',
  fetchEmpty: 'flex flex-col items-center justify-center py-10 text-center',
  fetchEmptyIconWrap: 'mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50',
  fetchSectionHeader: 'mb-2 flex items-center justify-between',
  fetchSectionTitleRow: 'flex items-center gap-1.5',
  fetchDotNew: 'h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--cherry-primary)]',
  fetchDotRemoved: 'h-[6px] w-[6px] shrink-0 rounded-full bg-destructive',
  fetchSectionTitle:
    'text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] text-foreground leading-tight',
  fetchSectionCount: 'text-[length:var(--font-size-body-xs)] leading-tight text-muted-foreground/60',
  fetchGhostAll:
    'inline-flex !h-auto !min-h-0 items-center justify-center px-1.5 py-[2px] !text-[length:var(--font-size-body-xs)] !leading-none text-muted-foreground/60 shadow-none hover:bg-[var(--cherry-active-bg)] hover:text-[var(--cherry-primary)]',
  fetchGhostAllRemoved:
    'inline-flex !h-auto !min-h-0 items-center justify-center px-1.5 py-[2px] !text-[length:var(--font-size-body-xs)] !leading-none text-muted-foreground/60 shadow-none hover:bg-destructive/[0.06] hover:text-destructive',
  fetchRowNew:
    'flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-accent/50 data-[checked=true]:bg-[var(--cherry-active-bg)]',
  fetchRowRemoved:
    'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/50 data-[checked=true]:bg-destructive/[0.06]',
  fetchAvatar:
    'flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted/50 font-medium text-[length:var(--font-size-body-xs)] leading-none text-muted-foreground',
  fetchRowTitle:
    'truncate text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] leading-tight text-foreground',
  fetchRowTitleStrike:
    'truncate text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] leading-tight text-muted-foreground line-through',
  fetchRowId: 'mt-[1px] truncate font-mono text-xs text-muted-foreground/60',
  fetchRowIdStrike: 'mt-[1px] truncate font-mono text-xs text-muted-foreground/40',
  /** Trailing capability icons — `ModelServicePage` FetchResultPanel strip */
  fetchCapabilityStrip: 'flex shrink-0 flex-wrap items-center justify-end gap-[3px]',
  fetchRemovedShell: 'rounded-xl border border-destructive/[0.08] bg-destructive/[0.03] p-2.5',
  fetchRemovedHint: 'mb-2.5 flex items-start gap-1.5',
  fetchMeta: 'text-xs text-muted-foreground/60',
  fetchFooter: 'shrink-0 space-y-2.5 border-t border-[color:var(--section-border)] px-4 py-3',
  fetchFooterSummary: 'flex flex-wrap items-center gap-3 text-xs text-muted-foreground/60',
  fetchFooterActions: 'flex items-center gap-2',
  fetchFooterBtn: 'inline-flex !h-auto !min-h-0 flex-1 items-center justify-center px-3 py-[5px] text-xs',
  /** Primary confirm — design `FetchResultPanel` disabled:opacity-30 */
  fetchFooterPrimary:
    'inline-flex !h-auto !min-h-0 flex-1 items-center justify-center px-3 py-[5px] text-xs disabled:opacity-30',
  fetchOkBtn: 'inline-flex !h-auto !min-h-0 w-full items-center justify-center px-3 py-[5px] text-xs'
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

export const oauthCardClasses = {
  /** Fills the auth column; no max-width so the card tracks the detail pane (fluid layout). */
  container: 'w-full min-w-0',
  /** Loading skeleton shell */
  shell:
    'w-full min-w-0 overflow-hidden rounded-2xl border border-[color:var(--color-border-default-soft)] bg-background px-4 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:px-5 sm:py-[18px]',
  /**
   * Logged-out: `cherry-studio-ui-design` `CherryINAccountSection` — gradient card, full-width CTA, footer links.
   */
  shellLoggedOut:
    'w-full min-w-0 overflow-hidden rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-gradient-to-br from-muted/50 to-muted/30 p-4',
  loginHeaderRow: 'mb-3 flex items-center gap-3',
  loginIconWrap:
    'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/50 text-foreground shadow-sm',
  loginTextBlock: 'min-w-0 flex-1',
  loginTitle: 'm-0 text-sm font-[weight:var(--font-weight-medium)] leading-tight text-foreground',
  loginSubtitle:
    'm-0 mt-0.5 text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-muted-foreground/60',
  /** Primary CTA: Cherry primary; hover stays solid brand green (no gradient). */
  loginPrimaryCta:
    'h-auto w-full justify-center gap-2 rounded-xl border-0 bg-primary px-4 py-[7px] text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] text-white shadow-sm transition-colors hover:bg-primary',
  loginFooterRow: 'mt-2.5 flex items-center justify-center gap-4',
  loginFooterLink:
    'h-auto min-h-0 p-0 text-[length:var(--font-size-body-xs)] text-muted-foreground/60 shadow-none hover:bg-transparent hover:text-foreground',
  loginFooterDivider: 'text-[length:var(--font-size-body-xs)] text-muted-foreground/50',
  /** CherryIN portal link — matches scoped caption + primary link treatment. */
  externalLink:
    'mt-1 inline-block text-[length:var(--font-size-body-xs)] leading-[var(--line-height-body-xs)] text-primary hover:underline',
  /** Logged-in CherryIN: mock `CherryINAccountSection` — one row, no stat grid. */
  shellLoggedIn:
    'w-full min-w-0 overflow-hidden rounded-2xl border border-[color:var(--color-border-fg-muted)] bg-background p-3.5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]',
  loggedInRow: 'flex w-full min-w-0 flex-wrap items-center justify-between gap-3',
  profileMeta: 'flex min-w-0 flex-1 items-center gap-3',
  /** Design: 32px round avatar, primary fill, initials (`ModelServicePage` / CherryIN row). */
  avatarSm:
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-[weight:var(--font-weight-semibold)] text-white',
  nameBlock: 'min-w-0',
  nameRow: 'flex flex-wrap items-center gap-1.5',
  name: 'truncate text-[15px] leading-[1.2] font-semibold tracking-tight text-foreground',
  /** Logged-in title line — `text-xs` in design mock. */
  loggedInName:
    'truncate text-[length:var(--font-size-body-xs)] font-[weight:var(--font-weight-medium)] leading-tight text-foreground',
  loggedInEmail: 'mt-0.5 truncate text-[length:var(--font-size-body-xs)] leading-[1.35] text-muted-foreground/40',
  badge:
    'inline-flex items-center rounded bg-[color:color-mix(in_srgb,var(--warning)_10%,transparent)] px-1 py-[0.5px] text-[10px] font-[weight:var(--font-weight-medium)] leading-tight text-[color:var(--warning)]',
  loggedInActions: 'flex shrink-0 flex-wrap items-center justify-end gap-2',
  inlineBalanceBlock: 'text-right',
  inlineBalanceLabel: 'text-[length:var(--font-size-body-xs)] text-muted-foreground/40',
  inlineBalanceValue: 'text-sm font-semibold leading-tight text-foreground tabular-nums',
  balanceValueSkeleton: 'inline-block w-20',
  topupOutlineButton:
    'h-auto min-h-0 rounded-md border border-[color:var(--color-border-fg-muted)] px-2.5 py-[3px] text-xs text-muted-foreground shadow-none hover:text-foreground',
  logoutCompact:
    'h-auto min-h-0 rounded-md px-1.5 py-[3px] text-xs text-muted-foreground/30 shadow-none hover:bg-transparent hover:text-foreground',
  serviceAttribution:
    'mt-2.5 border-t border-[color:var(--color-border-fg-hairline)] pt-2.5 text-[length:var(--font-size-body-xs)] text-muted-foreground/25',
  serviceLink: 'text-muted-foreground/40 transition-colors hover:text-foreground',
  actionsRow: 'flex flex-wrap items-center gap-2',
  footer: 'mt-4 text-[12px] leading-[1.35] text-muted-foreground'
} as const

export const fieldClasses = {
  inputRow: 'flex min-w-0 items-center gap-1.5',
  /** Reserves 24×24 next to `inputGroup` in `inputRow` when there is no trailing action (aligns with `iconButton`). */
  inputRowEndSlot: 'inline-flex h-6 w-6 shrink-0',
  /** In a `inputRow` next to a 24px icon button */
  inputGroup: ['flex min-h-0 min-w-0 flex-1 items-center py-[5px]', providerSettingsInputGroupBase].join(' '),
  /** Full-width field (no side icon) */
  inputGroupBlock: ['flex w-full items-center', providerSettingsInputGroupBase].join(' '),
  /**
   * Matches `ModelServicePage` connection row: body-md, full foreground, muted placeholder; flush in group.
   * Repeat `md:` so `InputGroupInput` defaults do not re-assert `md:text-sm` alone on the base layer.
   */
  input:
    'min-h-0 h-auto min-w-0 flex-1 border-0 bg-transparent p-0 shadow-none outline-none focus-visible:ring-0 ' +
    'text-[length:var(--font-size-body-md)] leading-[var(--line-height-body-md)] text-foreground ' +
    'placeholder:text-muted-foreground/60 md:text-[length:var(--font-size-body-md)]',
  /**
   * Small 24px icon control (e.g. copy / settings) — `var(--cherry-*)` match `tailwind-default-scope.css`.
   */
  iconButton:
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[var(--cherry-active-border)] text-[var(--cherry-text-muted)] transition-colors hover:bg-[var(--cherry-active-bg)] hover:text-[var(--cherry-primary-hover)] disabled:pointer-events-none disabled:opacity-40',
  /** Inline show/hide control kept inside the field without adding another border. */
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
