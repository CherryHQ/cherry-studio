import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Same `cn` helper as `frontend/src/lib/utils.ts` (clsx + tailwind-merge), vendored locally so this package stays self-contained. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
