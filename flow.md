以后的工作流程

日常开发:

# 直接在 main 分支上工作
git checkout main
# 做您的修改...
git add .
git commit -m "feat: 您的功能"
git push  # 自动推送到 myfork/main

同步上游更新:

# 1. 拉取上游最新代码
git fetch origin main

# 2. 合并到您的 main
git merge origin/main
# 或使用 rebase: git rebase origin/main

# 3. 解决冲突(如果有)

# 4. 推送到您的 fork
git push --force-with-lease

# 5. 重新构建
pnpm build:mac:arm64

查看状态:

git remote -v
# 会看到:
 origin  -> CherryHQ/cherry-studio (上游)
 myfork  -> atoz03/cherry-studio (您的fork)
