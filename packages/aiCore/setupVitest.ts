// 模拟 Vite SSR helper，避免 Node 环境找不到时报错
;(globalThis as any).__vite_ssr_exportName__ = (name: string, value: any) => value
