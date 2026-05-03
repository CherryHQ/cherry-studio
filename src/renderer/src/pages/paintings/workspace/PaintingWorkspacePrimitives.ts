export const paintingWorkspaceClasses = {
  shell: 'painting-workspace-scope flex h-full flex-1 flex-col',
  content: 'flex min-h-0 flex-1 flex-col overflow-hidden !bg-white dark:!bg-background',
  tabsWrap: 'flex justify-center px-6 pt-4 pb-3',
  tabsList:
    'rounded-full border border-border/60 bg-neutral-100 p-1 shadow-[var(--painting-surface-shadow)] backdrop-blur-sm dark:bg-muted/40',
  tabsTrigger:
    'rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-background',
  workspaceFrame: 'relative flex min-h-0 flex-1 overflow-hidden p-2',
  workspaceSurface:
    'relative isolate flex min-w-0 flex-1 overflow-hidden rounded-[28px] border border-border/60 bg-white dark:bg-background',
  centerPane: 'relative flex min-w-0 flex-1 flex-col overflow-hidden',
  panel:
    'painting-workspace-scope-portal absolute top-3 bottom-3 left-3 z-30 flex w-[288px] flex-col overflow-hidden rounded-[24px] border border-border/50 bg-white/95 shadow-[var(--painting-floating-shadow)] backdrop-blur-xl transition-all duration-200 dark:bg-background/95',
  panelHidden: 'pointer-events-none -translate-x-4 opacity-0',
  panelVisible: 'translate-x-0 opacity-100',
  panelHeader: 'flex items-center justify-between px-4 pt-3 pb-2',
  panelBody: 'flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4',
  panelScroll: 'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1',
  historyStrip:
    'flex h-full w-[68px] shrink-0 flex-col gap-2 overflow-y-auto border-border/50 border-l bg-white px-2 py-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden dark:bg-muted/10',
  historyAddButton:
    'sticky top-0 z-10 mb-1 flex h-9 w-11 shrink-0 items-center justify-center rounded-full bg-white text-muted-foreground hover:bg-muted/55 hover:text-foreground dark:bg-background',
  historyItem:
    'group relative flex h-11 w-11 shrink-0 items-center justify-center overflow-visible rounded-[16px] border border-transparent bg-muted/35 transition hover:bg-muted/55',
  historyItemActive: 'border-border bg-white shadow-sm ring-1 ring-foreground/10 dark:bg-background',
  historyDelete:
    'absolute -top-1 -right-1 z-20 flex size-5 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-white/95 text-destructive opacity-0 shadow-sm transition group-hover:opacity-100 dark:bg-background/95',
  promptSettingButton: 'rounded-full text-muted-foreground hover:bg-muted/50 hover:text-foreground',
  promptModeTabsList: 'h-8 rounded-full border border-border/60 bg-muted/35 p-0.5 shadow-none dark:bg-muted/20',
  promptModeTabsTrigger:
    'h-7 rounded-full px-2.5 text-xs text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
  promptWrap: 'shrink-0 px-2 pb-4 pt-2',
  toolbarWrap: 'absolute top-4 left-4 z-20',
  toolbarRail:
    'flex items-center rounded-full border border-border/60 bg-white/90 p-1 shadow-[var(--painting-floating-shadow)] backdrop-blur-xl dark:bg-background/90',
  toolbarButton: 'rounded-full text-muted-foreground hover:bg-muted/55 hover:text-foreground',
  toolbarButtonActive: 'bg-muted text-foreground'
} as const
