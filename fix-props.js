const fs = require('fs');
const path = require('path');

// 需要替换的属性列表
const propsToFix = [
  { old: 'alignItems="', new: '$alignItems="' },
  { old: 'gap={', new: '$gap={' },
  { old: 'gap="', new: '$gap="' },
  { old: 'justifyContent="', new: '$justifyContent="' },
  { old: 'p="', new: '$p="' },
  { old: 'p={', new: '$p={' }
];

// 递归遍历目录
function traverseDirectory(directory) {
  const files = fs.readdirSync(directory);
  
  for (const file of files) {
    const fullPath = path.join(directory, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      traverseDirectory(fullPath);
    } else if (stat.isFile() && (fullPath.endsWith('.tsx') || fullPath.endsWith('.jsx'))) {
      fixFile(fullPath);
    }
  }
}

// 修复文件中的属性
function fixFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let hasChanges = false;
    
    for (const prop of propsToFix) {
      if (content.includes(prop.old)) {
        content = content.split(prop.old).join(prop.new);
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`已修复文件: ${filePath}`);
    }
  } catch (error) {
    console.error(`处理文件 ${filePath} 时出错:`, error);
  }
}

// 开始修复
const srcDir = path.join(__dirname, 'src');
console.log(`开始修复 ${srcDir} 目录下的文件...`);
traverseDirectory(srcDir);
console.log('修复完成！');
