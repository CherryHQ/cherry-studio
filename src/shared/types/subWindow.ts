import type { TabType } from '../data/cache/cacheValueTypes'

/**
 * Initialization payload for a detached SubWindow.
 *
 * Delivered main → renderer via WindowManager's initData channel
 * (`wm.open(WindowType.SubWindow, { initData })` on the main side;
 * `useWindowInitData<SubWindowInitData>()` on the renderer side).
 *
 * Field shape overlaps heavily with `Tab` but is deliberately separate:
 * - This is a one-shot IPC payload, not a cached value.
 * - `id` is renamed to `tabId` so renderer-side reads (`init.tabId`)
 *   self-document the ID namespace and do not get confused with
 *   WindowManager's `windowId` or any React `id` prop.
 */
export type SubWindowInitData = {
  tabId: string
  url: string
  title?: string
  type?: TabType
  isPinned?: boolean
}
