## 搜索框与搜索历史dom
```html
<div class="px-3 pt-3 pb-2 flex-shrink-0"><div class="flex items-center gap-1.5"><div class="flex-1 flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg border border-border/40 bg-muted/20 focus-within:border-cherry-primary/40 focus-within:ring-1 focus-within:ring-cherry-primary/15 transition-all relative"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search text-muted-foreground/35 flex-shrink-0"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input placeholder="输入测试 Query..." class="flex-1 bg-transparent outline-none text-[11px] text-foreground placeholder:text-muted-foreground/30" value=""><button class="text-muted-foreground/30 hover:text-foreground transition-colors text-cherry-primary"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg></button></div><button disabled="" class="h-7 px-3 rounded-lg text-[11px] flex items-center gap-1 transition-all flex-shrink-0 bg-cherry-primary text-white hover:bg-cherry-primary-dark active:scale-[0.97] disabled:opacity-40"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path></svg><span>检索</span></button></div><div class="mt-1 bg-popover border border-border/40 rounded-lg shadow-lg p-1 max-h-[180px] overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150 [&amp;::-webkit-scrollbar]:w-[3px] [&amp;::-webkit-scrollbar-thumb]:bg-border/30 [&amp;::-webkit-scrollbar-thumb]:rounded-full"><div class="flex items-center justify-between px-2 py-0.5 mb-0.5"><span class="text-[9px] text-muted-foreground/30">搜索历史</span><button class="text-[9px] text-muted-foreground/25 hover:text-red-500 transition-colors">清空</button></div><div class="w-full flex items-center gap-2 px-2 py-[4px] rounded-md text-left hover:bg-accent/50 transition-colors group/hist cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history text-muted-foreground/25 flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg><span class="text-[11px] text-foreground truncate flex-1">RAG 检索增强生成原理</span><span class="text-[9px] text-muted-foreground/25 flex-shrink-0">5条 · 823ms</span><span class="text-[9px] text-muted-foreground/20 flex-shrink-0">10:32</span><button class="opacity-0 group-hover/hist:opacity-100 text-muted-foreground/20 hover:text-red-500 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><div class="w-full flex items-center gap-2 px-2 py-[4px] rounded-md text-left hover:bg-accent/50 transition-colors group/hist cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history text-muted-foreground/25 flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg><span class="text-[11px] text-foreground truncate flex-1">向量数据库选型对比</span><span class="text-[9px] text-muted-foreground/25 flex-shrink-0">4条 · 612ms</span><span class="text-[9px] text-muted-foreground/20 flex-shrink-0">10:15</span><button class="opacity-0 group-hover/hist:opacity-100 text-muted-foreground/20 hover:text-red-500 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><div class="w-full flex items-center gap-2 px-2 py-[4px] rounded-md text-left hover:bg-accent/50 transition-colors group/hist cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history text-muted-foreground/25 flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg><span class="text-[11px] text-foreground truncate flex-1">Embedding 模型推荐</span><span class="text-[9px] text-muted-foreground/25 flex-shrink-0">5条 · 945ms</span><span class="text-[9px] text-muted-foreground/20 flex-shrink-0">09:48</span><button class="opacity-0 group-hover/hist:opacity-100 text-muted-foreground/20 hover:text-red-500 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><div class="w-full flex items-center gap-2 px-2 py-[4px] rounded-md text-left hover:bg-accent/50 transition-colors group/hist cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history text-muted-foreground/25 flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg><span class="text-[11px] text-foreground truncate flex-1">如何优化检索召回率</span><span class="text-[9px] text-muted-foreground/25 flex-shrink-0">3条 · 734ms</span><span class="text-[9px] text-muted-foreground/20 flex-shrink-0">昨天 18:20</span><button class="opacity-0 group-hover/hist:opacity-100 text-muted-foreground/20 hover:text-red-500 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><div class="w-full flex items-center gap-2 px-2 py-[4px] rounded-md text-left hover:bg-accent/50 transition-colors group/hist cursor-pointer"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history text-muted-foreground/25 flex-shrink-0"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg><span class="text-[11px] text-foreground truncate flex-1">Chunk 分块最佳实践</span><span class="text-[9px] text-muted-foreground/25 flex-shrink-0">5条 · 567ms</span><span class="text-[9px] text-muted-foreground/20 flex-shrink-0">昨天 16:05</span><button class="opacity-0 group-hover/hist:opacity-100 text-muted-foreground/20 hover:text-red-500 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div></div></div>
```

## 搜索结果列表dom

```html
<div class="px-3 pt-3 pb-2 flex-shrink-0"><div class="flex items-center gap-1.5"><div class="flex-1 flex items-center gap-1.5 px-2.5 py-[5px] rounded-lg border border-border/40 bg-muted/20 focus-within:border-cherry-primary/40 focus-within:ring-1 focus-within:ring-cherry-primary/15 transition-all relative"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search text-muted-foreground/35 flex-shrink-0"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path></svg><input placeholder="输入测试 Query..." class="flex-1 bg-transparent outline-none text-[11px] text-foreground placeholder:text-muted-foreground/30" value="RAG 检索增强生成原理"><button class="text-muted-foreground/30 hover:text-foreground transition-colors "><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-history"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path></svg></button></div><button class="h-7 px-3 rounded-lg text-[11px] flex items-center gap-1 transition-all flex-shrink-0 bg-cherry-primary text-white hover:bg-cherry-primary-dark active:scale-[0.97] disabled:opacity-40"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zap"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path></svg><span>检索</span></button></div><div class="flex items-center gap-2.5 mt-1.5 text-[9px] text-muted-foreground/35"><span class="flex items-center gap-0.5"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"></path><path d="M20 3v4"></path><path d="M22 5h-4"></path><path d="M4 17v2"></path><path d="M5 18H3"></path></svg>5 个结果</span><span class="flex items-center gap-0.5"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>814ms</span><span>最高: 95%</span></div></div>
<div class="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5 [&amp;::-webkit-scrollbar]:w-[3px] [&amp;::-webkit-scrollbar-thumb]:bg-border/30 [&amp;::-webkit-scrollbar-thumb]:rounded-full"><div class="rounded-lg border border-border/20 hover:border-border/40 bg-muted/[0.03] transition-all group/chunk"><div class="flex items-center gap-1.5 px-2.5 py-1.5"><span class="w-4 h-4 rounded bg-accent/50 flex items-center justify-center text-[9px] text-muted-foreground/50 flex-shrink-0">1</span><div class="flex items-center gap-1 min-w-0 flex-1"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text text-muted-foreground/35 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg><span class="text-[10px] text-muted-foreground/50 truncate">RAG 技术指南.pdf</span><span class="text-[8px] text-muted-foreground/20 flex-shrink-0">#3</span></div><div class="flex items-center gap-1.5"><div class="w-12 h-[3px] rounded-full bg-border/25 overflow-hidden"><div class="h-full rounded-full bg-emerald-500 transition-all duration-500" style="width: 95%;"></div></div><span class="text-[9px] text-muted-foreground/50 tabular-nums w-6">95%</span></div><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent opacity-0 group-hover/chunk:opacity-100 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></button></div><div class="px-2.5 pb-2 line-clamp-2"><p class="text-[11px] text-foreground/75 leading-relaxed"><mark class="bg-emerald-500/20 text-emerald-600 rounded-sm px-0.5">RAG</mark>（检索增强生成）是一种将信息检索与生成式 AI 模型相结合的技术。它通过从外部知识库中检索相关文档，将检索到的内容作为上下文传递给大语言模型，从而生成更准确、更具参考依据的回答。</p></div></div><div class="rounded-lg border border-border/20 hover:border-border/40 bg-muted/[0.03] transition-all group/chunk"><div class="flex items-center gap-1.5 px-2.5 py-1.5"><span class="w-4 h-4 rounded bg-accent/50 flex items-center justify-center text-[9px] text-muted-foreground/50 flex-shrink-0">2</span><div class="flex items-center gap-1 min-w-0 flex-1"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text text-muted-foreground/35 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg><span class="text-[10px] text-muted-foreground/50 truncate">向量数据库原理.md</span><span class="text-[8px] text-muted-foreground/20 flex-shrink-0">#7</span></div><div class="flex items-center gap-1.5"><div class="w-12 h-[3px] rounded-full bg-border/25 overflow-hidden"><div class="h-full rounded-full bg-blue-500 transition-all duration-500" style="width: 89%;"></div></div><span class="text-[9px] text-muted-foreground/50 tabular-nums w-6">89%</span></div><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent opacity-0 group-hover/chunk:opacity-100 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></button></div><div class="px-2.5 pb-2 line-clamp-2"><p class="text-[11px] text-foreground/75 leading-relaxed">向量检索的核心原理是将文本通过 Embedding 模型转换为高维向量，然后通过余弦相似度或欧氏距离等度量方式计算查询向量与文档向量之间的相似性，返回最相关的文档片段。</p></div></div><div class="rounded-lg border border-border/20 hover:border-border/40 bg-muted/[0.03] transition-all group/chunk"><div class="flex items-center gap-1.5 px-2.5 py-1.5"><span class="w-4 h-4 rounded bg-accent/50 flex items-center justify-center text-[9px] text-muted-foreground/50 flex-shrink-0">3</span><div class="flex items-center gap-1 min-w-0 flex-1"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text text-muted-foreground/35 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg><span class="text-[10px] text-muted-foreground/50 truncate">检索策略对比分析.docx</span><span class="text-[8px] text-muted-foreground/20 flex-shrink-0">#12</span></div><div class="flex items-center gap-1.5"><div class="w-12 h-[3px] rounded-full bg-border/25 overflow-hidden"><div class="h-full rounded-full bg-blue-500 transition-all duration-500" style="width: 84%;"></div></div><span class="text-[9px] text-muted-foreground/50 tabular-nums w-6">84%</span></div><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent opacity-0 group-hover/chunk:opacity-100 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></button></div><div class="px-2.5 pb-2 line-clamp-2"><p class="text-[11px] text-foreground/75 leading-relaxed">混合检索策略结合了语义检索和关键词检索的优势。语义检索擅长理解语义相似的表达，而关键词检索（如 BM25）在精确匹配方面表现更好。两者结合可以显著提升检索召回率和准确率。</p></div></div><div class="rounded-lg border border-border/20 hover:border-border/40 bg-muted/[0.03] transition-all group/chunk"><div class="flex items-center gap-1.5 px-2.5 py-1.5"><span class="w-4 h-4 rounded bg-accent/50 flex items-center justify-center text-[9px] text-muted-foreground/50 flex-shrink-0">4</span><div class="flex items-center gap-1 min-w-0 flex-1"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text text-muted-foreground/35 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg><span class="text-[10px] text-muted-foreground/50 truncate">RAG 技术指南.pdf</span><span class="text-[8px] text-muted-foreground/20 flex-shrink-0">#15</span></div><div class="flex items-center gap-1.5"><div class="w-12 h-[3px] rounded-full bg-border/25 overflow-hidden"><div class="h-full rounded-full bg-blue-500 transition-all duration-500" style="width: 78%;"></div></div><span class="text-[9px] text-muted-foreground/50 tabular-nums w-6">78%</span></div><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent opacity-0 group-hover/chunk:opacity-100 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></button></div><div class="px-2.5 pb-2 line-clamp-2"><p class="text-[11px] text-foreground/75 leading-relaxed">Rerank 模型在初步检索完成后对结果进行精排。常见的 Rerank 模型包括 BGE-Reranker 和 Cohere Rerank，它们能够更精确地评估查询与文档片段之间的相关性，有效提升 Top-K 结果的质量。</p></div></div><div class="rounded-lg border border-border/20 hover:border-border/40 bg-muted/[0.03] transition-all group/chunk"><div class="flex items-center gap-1.5 px-2.5 py-1.5"><span class="w-4 h-4 rounded bg-accent/50 flex items-center justify-center text-[9px] text-muted-foreground/50 flex-shrink-0">5</span><div class="flex items-center gap-1 min-w-0 flex-1"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-file-text text-muted-foreground/35 flex-shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path></svg><span class="text-[10px] text-muted-foreground/50 truncate">知识库最佳实践.md</span><span class="text-[8px] text-muted-foreground/20 flex-shrink-0">#5</span></div><div class="flex items-center gap-1.5"><div class="w-12 h-[3px] rounded-full bg-border/25 overflow-hidden"><div class="h-full rounded-full bg-amber-500 transition-all duration-500" style="width: 72%;"></div></div><span class="text-[9px] text-muted-foreground/50 tabular-nums w-6">72%</span></div><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent opacity-0 group-hover/chunk:opacity-100 transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg></button><button class="w-4 h-4 rounded flex items-center justify-center text-muted-foreground/20 hover:text-foreground hover:bg-accent transition-all flex-shrink-0"><svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-down"><path d="m6 9 6 6 6-6"></path></svg></button></div><div class="px-2.5 pb-2 line-clamp-2"><p class="text-[11px] text-foreground/75 leading-relaxed">分块策略对 <mark class="bg-emerald-500/20 text-emerald-600 rounded-sm px-0.5">RAG</mark> 系统性能有重要影响。常见的分块方法包括固定大小分块、递归字符分块和语义分块。Chunk Size 通常设置在 256-1024 之间，Overlap 设置为 Chunk Size 的 10%-20%。</p></div></div></div>
```

## default(向量检索)
```json
{
    "baseId": "638fec34-45e6-4c8e-aaf6-f3f4c3ef4e35",
    "query": "DeepSeek-V3.2",
    "results": [
        {
            "pageContent": "# DeepSeek-V4:",
            "score": 0.7986750155687332,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 0,
                "chunkIndex": 0,
                "chunkCount": 1,
                "create_date": "2026-04-24T13:02:52.844Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "e92ac91d-8101-4157-8fb5-03eac0e01ac3"
        },
        {
            "pageContent": "Leveraging the expanded 1M-token context\n\nTable 4 | Tool-call schema for DeepSeek-V4 series.\n\nTools\n\nYou have access to a set of tools to help answer the user's question. You can invoke tools by writing a \"<|DSML|tool_calls>\" block like the following:\n\n<|DSML|tool_calls>\n<|DSML|invoke name=\"$TOOL_NAME\">\n<|DSML|parameter name=\"$PARAMETER_NAME\" string=\"true|false\">$PARAMETER_VALUE</DSML|parameter>\n...\n</DSML|invoke>\n<|DSML|invoke name=\"$TOOL_NAME2\">\n...\n</DSML|invoke>\n</DSML|tool_calls>\n\nString parameters should be specified as is and set 'string=\"true\"''. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set 'string=\"false\"''.\n\nIf thinking_mode is enabled (triggered by <think>), you MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response.\n\nOtherwise, output directly after </think> with tool calls or final response.",
            "score": 0.7897455096244812,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 39,
                "chunkIndex": 7,
                "chunkCount": 8,
                "create_date": "2026-04-24T13:02:52.861Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "a4fd438d-b97a-477c-8214-7868ecdb5e49"
        },
        {
            "pageContent": "</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|Assistant}|{response}&lt;|end_of_sentence}|&lt;|title|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|query|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Generates search queries for the user prompt.</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|User|&gt;{prompt}&lt;|query|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|authority|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Classifies the user prompt&#x27;s demand for source authoritativeness.</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|User|&gt;{prompt}&lt;|authority|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|domain|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Identifies the domain of the user prompt.</td><td style='text-align: center; word-wrap: break-word;'>...",
            "score": 0.7629960924386978,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 42,
                "chunkIndex": 2,
                "chunkCount": 6,
                "create_date": "2026-04-24T13:02:52.862Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "4590df60-f688-4955-8574-e21ab1405622"
        },
        {
            "pageContent": "A special system prompt at the beginning. 2. &lt;think&gt; thinking tokens &lt;/think&gt; summary</td></tr></table>\n\nTable 3 | Instruction injected into the system prompt for the \"Think Max\" mode.\n\n\n\n<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td style='text-align: center; word-wrap: break-word;'>Injected Instruction</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>Reasoning Effort: Absolute maximum with no shortcuts permitted. You MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios. Explicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.</td></tr></table>\n\nmodel leverages its own logic to generalize across complex tasks.\n\nTool-Call Schema and Special Token.",
            "score": 0.7487363219261169,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 39,
                "chunkIndex": 5,
                "chunkCount": 8,
                "create_date": "2026-04-24T13:02:52.861Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "c21eb50d-c710-489d-a33f-464034ad7774"
        },
        {
            "pageContent": "# Towards Highly Efficient Million-Token Context Intelligence\n\nDeepSeek-AI\n\nresearch@deepseek.com",
            "score": 0.6874810755252838,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 1,
                "chunkIndex": 0,
                "chunkCount": 1,
                "create_date": "2026-04-24T13:02:52.845Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "71002028-67cf-46d3-864e-bdc0379380b3"
        },
        {
            "pageContent": "URL https://huggingface.co/datasets/openai/MMMLU.\n\nOpenAI. Openai mrcr: Long context multiple needle in a haystack benchmark, 2024b. URL https://huggingface.co/datasets/openai/mrcr.\n\nOpenAI. Learning to reason with llms, 2024c. URL https://openai.com/index/learning-to-reason-with-ll{{ABBREV_10}}\n\nOpenAI. Introducing SimpleQA, 2024d. URL https://openai.com/index/introducing-simpleqa/.\n\nOpenAI. Introducing SWE-bench verified we're releasing a human-validated subset of swe-bench that more, 2024e. URL https://openai.com/index/introducing-swe-bench-verified/.\n\nOpenAI. gpt-oss-120b & gpt-oss-20b model card. CoRR, abs/2508.10925, 2025. doi: 10.48550/A RXIV.2508.10925. URL https://doi.org/10.48550/arXiv.2508.10925.\n\nM. Osama, D. Merrill, C. Cecka, M. Garland, and J. D. Owens. Stream-k: Work-centric parallel decomposition for dense matrix-matrix multiplication on the GPU. In Proceedings of the 28th ACM SIGPLAN Annual Symposium on Principles and Practice of Parallel Programming, pages 429–431, 2023.\n\nT. Patwardhan, R.",
            "score": 0.6863836050033569,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 58,
                "chunkIndex": 19,
                "chunkCount": 35,
                "create_date": "2026-04-24T13:02:52.876Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "1b27f769-9862-43be-ab38-ac4e95c46bd4"
        },
        {
            "pageContent": "word-wrap: break-word;'>Output (tokens)</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Agentic Search</td><td style='text-align: center; word-wrap: break-word;'>16.2</td><td style='text-align: center; word-wrap: break-word;'>13649</td><td style='text-align: center; word-wrap: break-word;'>1526</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Retrieval Augmented Search</td><td style='text-align: center; word-wrap: break-word;'>—</td><td style='text-align: center; word-wrap: break-word;'>10453</td><td style='text-align: center; word-wrap: break-word;'>1308</td></tr></table>\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Table 11 | Comparative Evaluation of DeepSeek-V4-Pro and DeepSeek-V3.2 on Search Q&A Tasks.</div> </div>",
            "score": 0.6592675745487213,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 63,
                "chunkIndex": 5,
                "chunkCount": 75,
                "create_date": "2026-04-24T13:02:52.881Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "9d2419a2-18d2-473e-826d-7bd754926577"
        },
        {
            "pageContent": "Deepseek-coder-v2: Breaking the barrier of closed-source models in code intelligence.  $ \\underline{\\text{CoRR}} $, abs/2406.11931, 2024. URL https://doi.org/10.48550/arXiv.2406.11931.\n\nDeepSeek-AI. Deepseek-v3 technical report.  $ \\underline{\\text{CoRR}} $, abs/2412.19437, 2024. URL https://doi.org/10.48550/arXiv.2412.19437.\n\nDeepSeek-AI. Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model.  $ \\underline{\\text{CoRR}} $, abs/2405.04434, 2024. URL https://doi.org/10.48550/arXiv.2405.04434.\n\nDeepSeek-AI. Fire-flyer file system, 2025. URL https://github.com/deepseek-ai/3FS.\n\nDeepSeek-AI. Deepseek-r1 incentivizes reasoning in llms through reinforcement learning.  $ \\underline{\\text{Nat., 645(8081):633–638, 2025. URL https://doi.org/10.1038/s41586-025-09422-z.}} $\n\nDeepSeek-AI. Deepseek-v3.2: Pushing the frontier of open large language models, 2025. URL https://arxiv.org/abs/2512.02556.\n\nX. Deng, J. Da, E. Pan, Y. Y. He, C. Ide, K. Garg, N. Lauffer, A. Park, N. Pasari, C. Rane, K.",
            "score": 0.6588278114795685,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 58,
                "chunkIndex": 8,
                "chunkCount": 35,
                "create_date": "2026-04-24T13:02:52.875Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "fdc9fe3a-a98b-4203-bf05-593861afaee4"
        },
        {
            "pageContent": "<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 7 | Thinking management of DeepSeek-V4 series.</div> </div>\n\n\nQuick Instruction. In chatbot scenarios, a number of auxiliary tasks (e.g., determining whether to trigger a web search, intent recognition, etc.) must be executed before generating the response. Conventionally, these tasks are handled by a separate small model, requiring redundant prefilling since it cannot reuse the existing KV cache. To overcome this limitation, we introduce Quick Instruction. We append a set of dedicated special tokens directly to the input sequence, where each token corresponds to a specific auxiliary task. By directly reusing the already-computed KV cache, this mechanism completely avoids redundant prefilling and allows certain tasks, such as generating search queries and determining authority and domain, to be executed in parallel. Consequently, this approach significantly reduces the user-perceived time-to-first-token (TTFT) and eliminates the engineering overhead of maintaining and iterating an extra small model. The supported Quick Instruction tokens are summarized in Table 5.",
            "score": 0.65628582239151,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 41,
                "chunkIndex": 1,
                "chunkCount": 2,
                "create_date": "2026-04-24T13:02:52.861Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "8e800aac-5819-4330-8ff9-e7f292ceda23"
        },
        {
            "pageContent": "### a) Thinking with tools\n\n<div style=\"text-align: center;\"><img src=\"https://pplines-online.bj.bcebos.com/deploy/official/paddleocr/pp-ocr-vl-15//0f84fdc0-f76e-4b54-986a-9f4c767a4837/markdown_0/imgs/img_in_image_box_326_572_858_843.jpg?authorization=bce-auth-v1%2FALTAKzReLNvew3ySINYJ0fuAMN%2F2026-04-24T03%3A09%3A09Z%2F-1%2F%2Fdfdb5b25f77b98eeda6a73a669b6ece274d659c773b06b11fb29765f2e40043b\" alt=\"Image\" width=\"44%\" /></div>\n\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">b) Thinking without tools</div> </div>\n\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 7 | Thinking management of DeepSeek-V4 series.</div> </div>",
            "score": 0.6511613428592682,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
                "itemType": "file",
                "sourceDocumentIndex": 41,
                "chunkIndex": 0,
                "chunkCount": 2,
                "create_date": "2026-04-24T13:02:52.861Z"
            },
            "itemId": "019dbf95-4f2d-70b9-be58-dfea74db18c7",
            "chunkId": "04600ead-1a25-4308-ab72-5c2988c7a534"
        }
    ]
}
```

## hybrid
```json
{
    "baseId": "29adeca3-56eb-482a-aa21-ceaefafc7f89",
    "query": "DeepSeek-V3.2",
    "results": [
        {
            "pageContent": "#### 5.4.2. Search\n\nSearch-augmented question answering is a core capability of the DeepSeek chatbot. On the DeepSeek web and app, the \"non-think\" mode employs Retrieval-Augmented Search (RAG), whereas the \"thinking\" mode utilizes agentic search.\n\nRetrieval Augmented Search. We conducted a pairwise evaluation comparing DeepSeek-V4-Pro and DeepSeek-V3.2 across both objective and subjective Q&A categories. As presented in Table 11, DeepSeek-V4-Pro outperforms DeepSeek-V3.2 by a substantial margin, demonstrating a consistent advantage across both categories. The most pronounced gains are observed in single-value search and planning & strategy tasks, suggesting that DeepSeek-V4-Pro excels at locating precise factual answers and synthesizing structured plans from retrieved context. However, DeepSeek-V3.",
            "score": 0.014756944444444444,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 54,
                "chunkIndex": 0,
                "chunkCount": 2,
                "create_date": "2026-04-24T14:01:22.385Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "f4eab33b-5f24-429b-baef-25643a1750d6"
        },
        {
            "pageContent": "<div style=\"text-align: center;\"><img src=\"https://pplines-online.bj.bcebos.com/deploy/official/paddleocr/pp-ocr-vl-15//a5a1aa7f-056c-4b5f-911e-8d6fff1a6b39/markdown_0/imgs/img_in_chart_box_602_167_1003_525.jpg?authorization=bce-auth-v1%2FALTAKzReLNvew3ySINYJ0fuAMN%2F2026-04-24T03%3A09%3A15Z%2F-1%2F%2Fc6daf13f56fe98b650fba441575f079cebdec2531757bee370b5952553421eb3\" alt=\"Image\" width=\"33%\" /></div>\n\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 10 | HLE and Terminal Bench 2.0 performance by reasoning effort. “None” indicates Non-think mode, and “Speciale” indicates DeepSeek-V3.2-Speciale model.</div> </div>\n\n\nDeepSeek-V3.2.",
            "score": 0.013960604322050105,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 51,
                "chunkIndex": 36,
                "chunkCount": 37,
                "create_date": "2026-04-24T14:01:22.385Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "801cfee0-c0e4-4d6a-87b7-584518250748"
        },
        {
            "pageContent": "word-wrap: break-word;'>Output (tokens)</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Agentic Search</td><td style='text-align: center; word-wrap: break-word;'>16.2</td><td style='text-align: center; word-wrap: break-word;'>13649</td><td style='text-align: center; word-wrap: break-word;'>1526</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Retrieval Augmented Search</td><td style='text-align: center; word-wrap: break-word;'>—</td><td style='text-align: center; word-wrap: break-word;'>10453</td><td style='text-align: center; word-wrap: break-word;'>1308</td></tr></table>\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Table 11 | Comparative Evaluation of DeepSeek-V4-Pro and DeepSeek-V3.2 on Search Q&A Tasks.</div> </div>",
            "score": 0.013791800491214812,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 63,
                "chunkIndex": 5,
                "chunkCount": 75,
                "create_date": "2026-04-24T14:01:22.392Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "568c0cc6-6d88-49e8-8df7-61f12ec04c76"
        },
        {
            "pageContent": "<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 1 | Left: benchmark performance of DeepSeek-V4-Pro-Max and its counterparts. Right: inference FLOPs and KV cache size of DeepSeek-V4 series and DeepSeek-V3.2.</div> </div>",
            "score": 0.013644688644688645,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 2,
                "chunkIndex": 4,
                "chunkCount": 5,
                "create_date": "2026-04-24T14:01:22.348Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "66ef4c12-8912-44a7-9e3c-719a9f28b9e5"
        },
        {
            "pageContent": "As with DeepSeek-V3.2, agent frameworks that simulate tool interactions via user messages (e.g., Terminus) may not trigger the tool-calling context path and thus may not benefit from enhanced reasoning persistence. We continue to recommend non-think models for such architectures.\n\n<div style=\"text-align: center;\"><img src=\"https://pplines-online.bj.bcebos.com/deploy/official/paddleocr/pp-ocr-vl-15//0f84fdc0-f76e-4b54-986a-9f4c767a4837/markdown_0/imgs/img_in_image_box_326_174_858_519.jpg?authorization=bce-auth-v1%2FALTAKzReLNvew3ySINYJ0fuAMN%2F2026-04-24T03%3A09%3A09Z%2F-1%2F%2F580d64a2a7c2ba5539603a2cf398d0b1524628420cb2ddf0bde880604df4d8fd\" alt=\"Image\" width=\"44%\" /></div>",
            "score": 0.013523391812865496,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 40,
                "chunkIndex": 1,
                "chunkCount": 2,
                "create_date": "2026-04-24T14:01:22.369Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "59c3449d-5d58-456c-898d-2ec466e58c89"
        },
        {
            "pageContent": "Deepseek-coder-v2: Breaking the barrier of closed-source models in code intelligence.  $ \\underline{\\text{CoRR}} $, abs/2406.11931, 2024. URL https://doi.org/10.48550/arXiv.2406.11931.\n\nDeepSeek-AI. Deepseek-v3 technical report.  $ \\underline{\\text{CoRR}} $, abs/2412.19437, 2024. URL https://doi.org/10.48550/arXiv.2412.19437.\n\nDeepSeek-AI. Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model.  $ \\underline{\\text{CoRR}} $, abs/2405.04434, 2024. URL https://doi.org/10.48550/arXiv.2405.04434.\n\nDeepSeek-AI. Fire-flyer file system, 2025. URL https://github.com/deepseek-ai/3FS.\n\nDeepSeek-AI. Deepseek-r1 incentivizes reasoning in llms through reinforcement learning.  $ \\underline{\\text{Nat., 645(8081):633–638, 2025. URL https://doi.org/10.1038/s41586-025-09422-z.}} $\n\nDeepSeek-AI. Deepseek-v3.2: Pushing the frontier of open large language models, 2025. URL https://arxiv.org/abs/2512.02556.\n\nX. Deng, J. Da, E. Pan, Y. Y. He, C. Ide, K. Garg, N. Lauffer, A. Park, N. Pasari, C. Rane, K.",
            "score": 0.01330532212885154,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 58,
                "chunkIndex": 8,
                "chunkCount": 35,
                "create_date": "2026-04-24T14:01:22.387Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "d28e3f39-45f1-4861-a66c-acea53d33b00"
        },
        {
            "pageContent": "'>1308</td></tr></table>\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Table 11 | Comparative Evaluation of DeepSeek-V4-Pro and DeepSeek-V3.2 on Search Q&A Tasks.</div> </div>\n\n\n\n\n<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td rowspan=\"2\">Category</td><td rowspan=\"2\">Subcategory</td><td rowspan=\"2\">#</td><td colspan=\"6\">Internal Evaluation (内部综合评估)</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 win</td><td style='text-align: center; word-wrap: break-word;'>V3.2 win</td><td style='text-align: center; word-wrap: break-word;'>tie</td><td style='text-align: center; word-wrap: break-word;'>V4%</td><td style='text-align: center; word-wrap: break-word;'>V3.2%</td><td style='text-align: center; word-wrap: break-word;'>tie%</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>Objective</td><td style='text-align: center; word-wrap: break-word;'>Single-value Search (单值信息查找)</td><td style='text-align: center; word-wrap: break-word;",
            "score": 0.012924606462303232,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 63,
                "chunkIndex": 6,
                "chunkCount": 75,
                "create_date": "2026-04-24T14:01:22.392Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "7ef15226-e6b2-4661-989d-25a5a6e9c9de"
        },
        {
            "pageContent": "Unlike MRCR, CorpusQA is similar to real scenarios. The evaluation results also indicate that DeepSeek-V4-Pro is better than Gemini-3.1-Pro.\n\nReasoning Effort. As shown in Table 7, the Max mode, which employs longer contexts and reduced length penalties in RL, outperforms the High mode on the most challenging tasks. Figure 10 presents a comparison of performance and cost among DeepSeek-V4-Pro, DeepSeek-V4-Flash, and DeepSeek-V3.2 on representative reasoning and agentic tasks. By scaling test-time compute, DeepSeek-V4 series achieve substantial improvements over the predecessor.",
            "score": 0.011896622453165594,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 51,
                "chunkIndex": 34,
                "chunkCount": 37,
                "create_date": "2026-04-24T14:01:22.384Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "4792853f-7d41-46c7-bcc4-7d0296a1c89d"
        },
        {
            "pageContent": "Nevertheless, we report our performance on the original Terminal-Bench 2.0 dataset for consistency. On the Terminal-Bench 2.0 Verified subset, DeepSeek-V4-Pro achieves a score of approximately 72.0.\n\nFor search agent tasks (BrowseComp, HLE w/ tool), we also use an in-house harness with websearch and Python tool, and set maximum interaction steps to 500 and the maximum context length to 512K tokens. For BrowseComp, we use the same discard-all context management strategy as DeepSeek-V3.2 (DeepSeek-AI, 2025).",
            "score": 0.011876006441223833,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 50,
                "chunkIndex": 5,
                "chunkCount": 6,
                "create_date": "2026-04-24T14:01:22.380Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "f5a5588f-7321-497c-b3d2-f4a44dbda3fd"
        },
        {
            "pageContent": "We pre-train both models on more than 32T diverse and high-quality tokens, followed by a comprehensive post-training pipeline that unlocks and further enhances their capabilities. DeepSeek-V4-Pro Max, the maximum reasoning effort mode of DeepSeek-V4-Pro, redefines the state-of-the-art for open models, outperforming its predecessors in core tasks. Meanwhile, DeepSeek-V4 series are highly efficient in long-context scenarios. In the one-million-token context setting, DeepSeek-V4-Pro requires only 27% of single-token inference FLOPs and 10% of KV cache compared with DeepSeek-V3.2. This enables us to routinely support one-million-token contexts, thereby making long-horizon tasks and further test-time scaling more feasible.",
            "score": 0.011658717541070483,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 2,
                "chunkIndex": 1,
                "chunkCount": 5,
                "create_date": "2026-04-24T14:01:22.347Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "40042edb-861d-4d1d-bfbe-ea9cbe815648"
        }
    ]
}
```

## bm25
```json
{
    "baseId": "29adeca3-56eb-482a-aa21-ceaefafc7f89",
    "query": "DeepSeek-V3.2",
    "results": [
        {
            "pageContent": "# DeepSeek-V4:",
            "score": 0.7986750155687332,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 0,
                "chunkIndex": 0,
                "chunkCount": 1,
                "create_date": "2026-04-24T14:01:22.346Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "cd7fe6dc-21c5-43f6-88c8-6fd29e336f8f"
        },
        {
            "pageContent": "Leveraging the expanded 1M-token context\n\nTable 4 | Tool-call schema for DeepSeek-V4 series.\n\nTools\n\nYou have access to a set of tools to help answer the user's question. You can invoke tools by writing a \"<|DSML|tool_calls>\" block like the following:\n\n<|DSML|tool_calls>\n<|DSML|invoke name=\"$TOOL_NAME\">\n<|DSML|parameter name=\"$PARAMETER_NAME\" string=\"true|false\">$PARAMETER_VALUE</DSML|parameter>\n...\n</DSML|invoke>\n<|DSML|invoke name=\"$TOOL_NAME2\">\n...\n</DSML|invoke>\n</DSML|tool_calls>\n\nString parameters should be specified as is and set 'string=\"true\"''. For all other types (numbers, booleans, arrays, objects), pass the value in JSON format and set 'string=\"false\"''.\n\nIf thinking_mode is enabled (triggered by <think>), you MUST output your complete reasoning inside <think>...</think> BEFORE any tool calls or final response.\n\nOtherwise, output directly after </think> with tool calls or final response.",
            "score": 0.7897455096244812,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 39,
                "chunkIndex": 7,
                "chunkCount": 8,
                "create_date": "2026-04-24T14:01:22.368Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "6ae3966e-1ef2-4a44-9caf-80e9b1ac3905"
        },
        {
            "pageContent": "</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|Assistant}|{response}&lt;|end_of_sentence}|&lt;|title|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|query|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Generates search queries for the user prompt.</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|User|&gt;{prompt}&lt;|query|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|authority|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Classifies the user prompt&#x27;s demand for source authoritativeness.</td><td style='text-align: center; word-wrap: break-word;'>...&lt;|User|&gt;{prompt}&lt;|authority|&gt;</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>&lt;|domain|&gt;</td><td style='text-align: center; word-wrap: break-word;'>Identifies the domain of the user prompt.</td><td style='text-align: center; word-wrap: break-word;'>...",
            "score": 0.7629960924386978,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 42,
                "chunkIndex": 2,
                "chunkCount": 6,
                "create_date": "2026-04-24T14:01:22.370Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "93bbbbb6-6620-4245-948a-90f83b169fb8"
        },
        {
            "pageContent": "A special system prompt at the beginning. 2. &lt;think&gt; thinking tokens &lt;/think&gt; summary</td></tr></table>\n\nTable 3 | Instruction injected into the system prompt for the \"Think Max\" mode.\n\n\n\n<table border=1 style='margin: auto; word-wrap: break-word;'><tr><td style='text-align: center; word-wrap: break-word;'>Injected Instruction</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>Reasoning Effort: Absolute maximum with no shortcuts permitted. You MUST be very thorough in your thinking and comprehensively decompose the problem to resolve the root cause, rigorously stress-testing your logic against all potential paths, edge cases, and adversarial scenarios. Explicitly write out your entire deliberation process, documenting every intermediate step, considered alternative, and rejected hypothesis to ensure absolutely no assumption is left unchecked.</td></tr></table>\n\nmodel leverages its own logic to generalize across complex tasks.\n\nTool-Call Schema and Special Token.",
            "score": 0.7487363219261169,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 39,
                "chunkIndex": 5,
                "chunkCount": 8,
                "create_date": "2026-04-24T14:01:22.368Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "f9886221-1d09-4598-a028-9eb642927a97"
        },
        {
            "pageContent": "# Towards Highly Efficient Million-Token Context Intelligence\n\nDeepSeek-AI\n\nresearch@deepseek.com",
            "score": 0.6874810755252838,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 1,
                "chunkIndex": 0,
                "chunkCount": 1,
                "create_date": "2026-04-24T14:01:22.347Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "68d1d10e-7f87-4ba9-b855-303f2611d257"
        },
        {
            "pageContent": "URL https://huggingface.co/datasets/openai/MMMLU.\n\nOpenAI. Openai mrcr: Long context multiple needle in a haystack benchmark, 2024b. URL https://huggingface.co/datasets/openai/mrcr.\n\nOpenAI. Learning to reason with llms, 2024c. URL https://openai.com/index/learning-to-reason-with-ll{{ABBREV_10}}\n\nOpenAI. Introducing SimpleQA, 2024d. URL https://openai.com/index/introducing-simpleqa/.\n\nOpenAI. Introducing SWE-bench verified we're releasing a human-validated subset of swe-bench that more, 2024e. URL https://openai.com/index/introducing-swe-bench-verified/.\n\nOpenAI. gpt-oss-120b & gpt-oss-20b model card. CoRR, abs/2508.10925, 2025. doi: 10.48550/A RXIV.2508.10925. URL https://doi.org/10.48550/arXiv.2508.10925.\n\nM. Osama, D. Merrill, C. Cecka, M. Garland, and J. D. Owens. Stream-k: Work-centric parallel decomposition for dense matrix-matrix multiplication on the GPU. In Proceedings of the 28th ACM SIGPLAN Annual Symposium on Principles and Practice of Parallel Programming, pages 429–431, 2023.\n\nT. Patwardhan, R.",
            "score": 0.6863836050033569,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 58,
                "chunkIndex": 19,
                "chunkCount": 35,
                "create_date": "2026-04-24T14:01:22.388Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "41614a4b-ecb5-40fa-a7c6-22e78e4cb80c"
        },
        {
            "pageContent": "word-wrap: break-word;'>Output (tokens)</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Agentic Search</td><td style='text-align: center; word-wrap: break-word;'>16.2</td><td style='text-align: center; word-wrap: break-word;'>13649</td><td style='text-align: center; word-wrap: break-word;'>1526</td></tr><tr><td style='text-align: center; word-wrap: break-word;'>V4 Retrieval Augmented Search</td><td style='text-align: center; word-wrap: break-word;'>—</td><td style='text-align: center; word-wrap: break-word;'>10453</td><td style='text-align: center; word-wrap: break-word;'>1308</td></tr></table>\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Table 11 | Comparative Evaluation of DeepSeek-V4-Pro and DeepSeek-V3.2 on Search Q&A Tasks.</div> </div>",
            "score": 0.6592675745487213,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 63,
                "chunkIndex": 5,
                "chunkCount": 75,
                "create_date": "2026-04-24T14:01:22.392Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "568c0cc6-6d88-49e8-8df7-61f12ec04c76"
        },
        {
            "pageContent": "Deepseek-coder-v2: Breaking the barrier of closed-source models in code intelligence.  $ \\underline{\\text{CoRR}} $, abs/2406.11931, 2024. URL https://doi.org/10.48550/arXiv.2406.11931.\n\nDeepSeek-AI. Deepseek-v3 technical report.  $ \\underline{\\text{CoRR}} $, abs/2412.19437, 2024. URL https://doi.org/10.48550/arXiv.2412.19437.\n\nDeepSeek-AI. Deepseek-v2: A strong, economical, and efficient mixture-of-experts language model.  $ \\underline{\\text{CoRR}} $, abs/2405.04434, 2024. URL https://doi.org/10.48550/arXiv.2405.04434.\n\nDeepSeek-AI. Fire-flyer file system, 2025. URL https://github.com/deepseek-ai/3FS.\n\nDeepSeek-AI. Deepseek-r1 incentivizes reasoning in llms through reinforcement learning.  $ \\underline{\\text{Nat., 645(8081):633–638, 2025. URL https://doi.org/10.1038/s41586-025-09422-z.}} $\n\nDeepSeek-AI. Deepseek-v3.2: Pushing the frontier of open large language models, 2025. URL https://arxiv.org/abs/2512.02556.\n\nX. Deng, J. Da, E. Pan, Y. Y. He, C. Ide, K. Garg, N. Lauffer, A. Park, N. Pasari, C. Rane, K.",
            "score": 0.6588278114795685,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 58,
                "chunkIndex": 8,
                "chunkCount": 35,
                "create_date": "2026-04-24T14:01:22.387Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "d28e3f39-45f1-4861-a66c-acea53d33b00"
        },
        {
            "pageContent": "<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 7 | Thinking management of DeepSeek-V4 series.</div> </div>\n\n\nQuick Instruction. In chatbot scenarios, a number of auxiliary tasks (e.g., determining whether to trigger a web search, intent recognition, etc.) must be executed before generating the response. Conventionally, these tasks are handled by a separate small model, requiring redundant prefilling since it cannot reuse the existing KV cache. To overcome this limitation, we introduce Quick Instruction. We append a set of dedicated special tokens directly to the input sequence, where each token corresponds to a specific auxiliary task. By directly reusing the already-computed KV cache, this mechanism completely avoids redundant prefilling and allows certain tasks, such as generating search queries and determining authority and domain, to be executed in parallel. Consequently, this approach significantly reduces the user-perceived time-to-first-token (TTFT) and eliminates the engineering overhead of maintaining and iterating an extra small model. The supported Quick Instruction tokens are summarized in Table 5.",
            "score": 0.65628582239151,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 41,
                "chunkIndex": 1,
                "chunkCount": 2,
                "create_date": "2026-04-24T14:01:22.369Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "76c406f2-90fe-4b6d-a3b7-92752432b37c"
        },
        {
            "pageContent": "### a) Thinking with tools\n\n<div style=\"text-align: center;\"><img src=\"https://pplines-online.bj.bcebos.com/deploy/official/paddleocr/pp-ocr-vl-15//0f84fdc0-f76e-4b54-986a-9f4c767a4837/markdown_0/imgs/img_in_image_box_326_572_858_843.jpg?authorization=bce-auth-v1%2FALTAKzReLNvew3ySINYJ0fuAMN%2F2026-04-24T03%3A09%3A09Z%2F-1%2F%2Fdfdb5b25f77b98eeda6a73a669b6ece274d659c773b06b11fb29765f2e40043b\" alt=\"Image\" width=\"44%\" /></div>\n\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">b) Thinking without tools</div> </div>\n\n\n<div style=\"text-align: center;\"><div style=\"text-align: center;\">Figure 7 | Thinking management of DeepSeek-V4 series.</div> </div>",
            "score": 0.6511613428592682,
            "metadata": {
                "file_path": "/Users/eeee/Downloads/DeepSeek_V4.md",
                "file_name": "DeepSeek_V4.md",
                "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
                "itemType": "file",
                "sourceDocumentIndex": 41,
                "chunkIndex": 0,
                "chunkCount": 2,
                "create_date": "2026-04-24T14:01:22.369Z"
            },
            "itemId": "019dbfca-be1d-754e-a07f-505f43e1e523",
            "chunkId": "a840f98a-47fa-421c-9479-16a1e8bb009d"
        }
    ]
}
```
