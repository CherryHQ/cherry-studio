import { ChevronRight } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, SegmentedControl, Skeleton } from '@cherrystudio/ui'

/** A titled group: the label row (with an optional action on the right) above a bordered card. */
export function ProfilePaneSection({
  title,
  action,
  framed = true,
  children
}: {
  title: string
  action?: ReactNode
  /** False for lists whose rows are cards of their own. */
  framed?: boolean
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex h-5 items-center justify-between px-1">
        <span className="text-muted-foreground text-xs">{title}</span>
        {action}
      </div>
      {framed ? <div className="rounded-xl border border-border-subtle px-3 py-1">{children}</div> : children}
    </section>
  )
}

export function ProfilePaneSectionAction({
  children,
  onClick,
  withChevron = false
}: {
  children: ReactNode
  onClick: () => void
  withChevron?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-5 min-h-0 gap-0.5 px-1 font-normal text-muted-foreground text-xs shadow-none hover:bg-transparent hover:text-foreground">
      {children}
      {withChevron ? <ChevronRight className="size-3" /> : null}
    </Button>
  )
}

export function ProfileSettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <div className="min-w-0 truncate text-foreground text-sm">{label}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** Who it is: the large avatar (changed in place), the name and the description. */
export function ProfilePaneHeader({
  avatar,
  name,
  description
}: {
  avatar: ReactNode
  name: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      {avatar}
      <h2 className="mt-2 font-semibold text-foreground text-lg leading-tight">{name}</h2>
      {description ? <p className="line-clamp-2 px-2 text-[13px] text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export type ProfileStarterCard = { key: string; icon: ReactNode; title: string; hint: string; onClick: () => void }

/** Suggestions or opening questions as cards, with skeleton rows while they are generated. */
export function ProfileStartersSection({
  title,
  hideLabel,
  loading,
  cards,
  onHide
}: {
  title: string
  hideLabel: string
  loading: boolean
  cards: ProfileStarterCard[]
  onHide: () => void
}) {
  const { t } = useTranslation()

  return (
    <ProfilePaneSection
      title={title}
      framed={false}
      action={<ProfilePaneSectionAction onClick={onHide}>{hideLabel}</ProfilePaneSectionAction>}>
      <div className="flex flex-col gap-1.5" aria-busy={loading || undefined}>
        {loading ? (
          <>
            <span className="sr-only">{t('common.loading')}</span>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2">
                <Skeleton className="size-8 shrink-0 rounded-lg" />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/3 rounded-sm" />
                  <Skeleton className="h-3 w-1/2 rounded-sm" />
                </span>
              </div>
            ))}
          </>
        ) : (
          cards.map((card) => (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className="flex items-center gap-2.5 rounded-xl border border-border-subtle px-3 py-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">{card.icon}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-foreground text-sm">{card.title}</span>
                {card.hint ? <span className="truncate text-muted-foreground text-xs">{card.hint}</span> : null}
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-foreground-tertiary" />
            </button>
          ))
        )}
      </div>
    </ProfilePaneSection>
  )
}

type ProfilePaneTab = 'activity' | 'outputs'

/** The Activity and Outputs tabs below the header; Activity shows first. */
export function ProfilePaneTabs({ activity, outputs }: { activity: ReactNode; outputs: ReactNode }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<ProfilePaneTab>('activity')

  return (
    <>
      <SegmentedControl
        size="sm"
        className="self-center"
        aria-label={t('chat.profile_pane.tabs.label')}
        value={tab}
        onValueChange={setTab}
        options={[
          { value: 'activity', label: t('chat.profile_pane.tabs.activity') },
          { value: 'outputs', label: t('chat.profile_pane.tabs.outputs') }
        ]}
      />
      {tab === 'activity' ? activity : outputs}
    </>
  )
}
