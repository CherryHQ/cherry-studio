import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Utility function to merge Tailwind CSS classes with clsx
 * @description Combines clsx for conditional classes and tailwind-merge for deduplication
 * @param inputs - Class values to merge
 * @returns Merged class string
 * @example cn('px-2 py-1', condition && 'bg-blue-500', 'px-3') // 'py-1 bg-blue-500 px-3'
 * @since 1.0.0
 * @author v0-AI-Assistant
 * @lastModified 2025-01-27 by v0-AI-Assistant - Initial implementation
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
