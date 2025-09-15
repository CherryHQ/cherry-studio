import { type ClassValue, clsx } from 'clsx'

/**
 * 合并CSS类名的工具函数
 * 基于clsx，支持条件类名和Tailwind CSS
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}
