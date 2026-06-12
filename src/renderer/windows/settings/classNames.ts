// The settings window can be 760px wide, just below Tailwind's md breakpoint.
// Keep desktop settings form controls at the same text size at every window width.
export const settingsWindowFormControlTextClassName = [
  '[&_[data-slot=input].text-base]:text-sm',
  '[&_[data-slot=input-group-control].text-base]:text-sm',
  '[&_[data-slot=textarea-input].text-lg]:text-sm'
].join(' ')
