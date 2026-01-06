const { execSync } = require('child_process')
const fs = require('fs')

// 执行命令并返回输出
function exec(command) {
  return execSync(command, { encoding: 'utf8' }).trim()
}

// 获取命令行参数
const args = process.argv.slice(2)
const versionType = args[0] || 'patch'
const shouldPush = args.includes('push')

// 验证版本类型
if (!['patch', 'minor', 'major'].includes(versionType)) {
  console.error('Invalid version type. Use patch, minor, or major.')
  process.exit(1)
}

// 更新版本
exec(`pnpm version ${versionType}`)

// 读取更新后的 package.json 获取新版本号
const updatedPackageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const newVersion = updatedPackageJson.version

// Git 操作
exec('git add .')
exec(`git commit -m "chore(version): ${newVersion}"`)
exec(`git tag -a v${newVersion} -m "Version ${newVersion}"`)

console.log(`Version bumped to ${newVersion}`)

if (shouldPush) {
  console.log('Pushing to remote...')
  exec('git push && git push --tags')
  console.log('Pushed to remote.')
} else {
  console.log('Changes are committed locally. Use "git push && git push --tags" to push to remote.')
}
