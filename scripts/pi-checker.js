#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const glob = require('glob').glob;

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  verbose: args.includes('--verbose'),
  json: args.includes('--json'),
  fix: args.includes('--fix'),
  dryRun: args.includes('--dry-run'),
  files: args.find(arg => arg.startsWith('--files='))?.split('=')[1]?.split(',') || null
};

// PI Check Results
const results = {
  passed: true,
  checks: {},
  summary: {
    totalChecks: 0,
    passed: 0,
    warnings: 0,
    failed: 0
  }
};

// Console output helpers
const log = (message) => {
  if (!options.json) {
    console.log(message);
  }
};

const logVerbose = (message) => {
  if (options.verbose && !options.json) {
    console.log(`  ${message}`);
  }
};

// Check status constants
const STATUS = {
  PASSED: 'PASSED',
  WARNING: 'WARNING',
  FAILED: 'FAILED'
};

// Add check result
function addCheckResult(category, status, details = {}) {
  results.checks[category] = {
    status,
    ...details
  };
  
  results.summary.totalChecks++;
  if (status === STATUS.PASSED) {
    results.summary.passed++;
  } else if (status === STATUS.WARNING) {
    results.summary.warnings++;
  } else {
    results.summary.failed++;
    results.passed = false;
  }
}

// Get files to check
async function getFilesToCheck() {
  if (options.files) {
    const allFiles = [];
    for (const pattern of options.files) {
      const files = await glob(pattern, { ignore: ['node_modules/**', 'dist/**', 'out/**'] });
      allFiles.push(...files);
    }
    return allFiles;
  }
  
  // Get all TypeScript/JavaScript files
  const tsFiles = await glob('src/**/*.{ts,tsx,js,jsx}', {
    ignore: ['node_modules/**', 'dist/**', 'out/**', '**/*.test.*', '**/*.spec.*']
  });
  
  return tsFiles;
}

// Check 1: Code Documentation
async function checkCodeDocumentation() {
  log('\n📝 Checking Code Documentation...');
  
  const files = await getFilesToCheck();
  const issues = [];
  let totalFunctions = 0;
  let documentedFunctions = 0;
  let totalComplexFunctions = 0;
  let documentedComplexFunctions = 0;
  let totalTypes = 0;
  let documentedTypes = 0;
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');
    
    // Check exported functions
    const functionRegex = /export\s+(async\s+)?function\s+(\w+)|export\s+const\s+(\w+)\s*=\s*(async\s*)?\(/g;
    const matches = content.matchAll(functionRegex);
    
    for (const match of matches) {
      totalFunctions++;
      const functionName = match[2] || match[3];
      const lineNumber = content.substring(0, match.index).split('\n').length;
      
      // Check if there's a JSDoc comment before this function
      const precedingLines = lines.slice(Math.max(0, lineNumber - 10), lineNumber - 1);
      const hasJSDoc = precedingLines.some(line => line.trim().startsWith('/**'));
      
      if (!hasJSDoc) {
        issues.push({
          file,
          line: lineNumber,
          message: `Function '${functionName}' lacks JSDoc documentation`
        });
      } else {
        documentedFunctions++;
      }
      
      // Check if function is complex (>20 lines)
      let functionEnd = lineNumber;
      let braceCount = 0;
      let foundStart = false;
      
      for (let i = lineNumber - 1; i < lines.length && i < lineNumber + 50; i++) {
        const line = lines[i];
        if (line.includes('{')) {
          braceCount += (line.match(/{/g) || []).length;
          foundStart = true;
        }
        if (line.includes('}')) {
          braceCount -= (line.match(/}/g) || []).length;
        }
        if (foundStart && braceCount === 0) {
          functionEnd = i + 1;
          break;
        }
      }
      
      const functionLength = functionEnd - lineNumber;
      if (functionLength > 20) {
        totalComplexFunctions++;
        if (hasJSDoc) {
          // Check if JSDoc has description
          const jsDocStart = precedingLines.findIndex(line => line.trim().startsWith('/**'));
          if (jsDocStart >= 0) {
            const jsDocContent = precedingLines.slice(jsDocStart).join('\n');
            if (jsDocContent.split('\n').length > 3) { // More than just /** */
              documentedComplexFunctions++;
            } else {
              issues.push({
                file,
                line: lineNumber,
                message: `Complex function '${functionName}' needs detailed documentation`
              });
            }
          }
        }
      }
    }
    
    // Check TypeScript types/interfaces
    const typeRegex = /export\s+(interface|type)\s+(\w+)/g;
    const typeMatches = content.matchAll(typeRegex);
    
    for (const match of typeMatches) {
      totalTypes++;
      const typeName = match[2];
      const lineNumber = content.substring(0, match.index).split('\n').length;
      
      // Check for JSDoc or inline comments
      const precedingLine = lines[lineNumber - 2] || '';
      const hasDoc = precedingLine.trim().startsWith('/**') || precedingLine.trim().startsWith('//');
      
      if (!hasDoc) {
        issues.push({
          file,
          line: lineNumber,
          message: `Type '${typeName}' lacks documentation`
        });
      } else {
        documentedTypes++;
      }
    }
  }
  
  const status = issues.length === 0 ? STATUS.PASSED : 
                 issues.length < 5 ? STATUS.WARNING : STATUS.FAILED;
  
  addCheckResult('Code Documentation', status, {
    totalFunctions,
    documentedFunctions,
    totalComplexFunctions,
    documentedComplexFunctions,
    totalTypes,
    documentedTypes,
    issues: issues.slice(0, 10) // Limit to first 10 issues
  });
  
  logVerbose(`Functions: ${documentedFunctions}/${totalFunctions} documented`);
  logVerbose(`Complex functions: ${documentedComplexFunctions}/${totalComplexFunctions} documented`);
  logVerbose(`Types: ${documentedTypes}/${totalTypes} documented`);
}

// Check 2: Test Coverage
async function checkTestCoverage() {
  log('\n🧪 Checking Test Coverage...');
  
  try {
    // Check if coverage report exists
    const coverageFile = path.join(process.cwd(), 'coverage', 'coverage-summary.json');
    let coverage = null;
    
    try {
      const coverageData = await fs.readFile(coverageFile, 'utf-8');
      coverage = JSON.parse(coverageData);
    } catch (e) {
      // Try to generate coverage
      logVerbose('Generating coverage report...');
      execSync('yarn test:coverage --silent', { stdio: 'ignore' });
      
      try {
        const coverageData = await fs.readFile(coverageFile, 'utf-8');
        coverage = JSON.parse(coverageData);
      } catch (e2) {
        // Coverage generation failed
      }
    }
    
    if (coverage && coverage.total) {
      const totalCoverage = coverage.total.lines.pct;
      const threshold = 80;
      
      const status = totalCoverage >= threshold ? STATUS.PASSED :
                     totalCoverage >= threshold - 5 ? STATUS.WARNING : STATUS.FAILED;
      
      // Find files with low coverage
      const lowCoverageFiles = [];
      for (const [file, data] of Object.entries(coverage)) {
        if (file !== 'total' && data.lines.pct < threshold) {
          lowCoverageFiles.push({
            file: file.replace(process.cwd(), '.'),
            coverage: data.lines.pct
          });
        }
      }
      
      addCheckResult('Test Coverage', status, {
        coverage: totalCoverage,
        threshold,
        lowCoverageFiles: lowCoverageFiles.slice(0, 5)
      });
      
      logVerbose(`Coverage: ${totalCoverage.toFixed(1)}% (threshold: ${threshold}%)`);
    } else {
      // Check for test files
      const files = await getFilesToCheck();
      const missingTests = [];
      
      for (const file of files) {
        // Skip test files themselves
        if (file.includes('.test.') || file.includes('.spec.')) continue;
        
        // Check if test file exists
        const testFile = file.replace(/\.(ts|tsx|js|jsx)$/, '.test.$1');
        const specFile = file.replace(/\.(ts|tsx|js|jsx)$/, '.spec.$1');
        
        try {
          await fs.access(testFile);
        } catch (e1) {
          try {
            await fs.access(specFile);
          } catch (e2) {
            missingTests.push(file);
          }
        }
      }
      
      const status = missingTests.length === 0 ? STATUS.PASSED :
                     missingTests.length < 5 ? STATUS.WARNING : STATUS.FAILED;
      
      addCheckResult('Test Coverage', status, {
        missingTests: missingTests.slice(0, 10)
      });
      
      logVerbose(`Files without tests: ${missingTests.length}`);
    }
  } catch (error) {
    addCheckResult('Test Coverage', STATUS.WARNING, {
      error: 'Could not check test coverage',
      message: error.message
    });
  }
}

// Check 3: Code Quality
async function checkCodeQuality() {
  log('\n🔍 Checking Code Quality...');
  
  const files = await getFilesToCheck();
  const issues = {
    consoleLogs: [],
    anyTypes: [],
    unhandledAsync: [],
    largeFiles: []
  };
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Check for console.log (not in tests or exempted)
      if (line.includes('console.log') && 
          !line.includes('PI-EXEMPT') &&
          !file.includes('.test.') &&
          !file.includes('.spec.')) {
        issues.consoleLogs.push({
          file,
          line: index + 1,
          content: line.trim()
        });
      }
      
      // Check for 'any' types without justification
      if (line.includes(': any') && !line.includes('PI-EXEMPT') && !line.includes('// any:')) {
        issues.anyTypes.push({
          file,
          line: index + 1,
          content: line.trim()
        });
      }
      
      // Check for unhandled async operations
      if (line.includes('async') && !line.includes('try') && !line.includes('catch') && !line.includes('.catch')) {
        // Look for try-catch in the next few lines
        const nextLines = lines.slice(index + 1, index + 10).join('\n');
        if (!nextLines.includes('try') && !nextLines.includes('catch')) {
          issues.unhandledAsync.push({
            file,
            line: index + 1,
            content: line.trim()
          });
        }
      }
    });
    
    // Check file size
    if (lines.length > 500) {
      issues.largeFiles.push({
        file,
        lines: lines.length
      });
    }
  }
  
  const totalIssues = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0);
  const status = totalIssues === 0 ? STATUS.PASSED :
                 totalIssues < 5 ? STATUS.WARNING : STATUS.FAILED;
  
  addCheckResult('Code Quality', status, {
    issues: {
      consoleLogs: issues.consoleLogs.slice(0, 5),
      anyTypes: issues.anyTypes.slice(0, 5),
      unhandledAsync: issues.unhandledAsync.slice(0, 5),
      largeFiles: issues.largeFiles
    },
    totalIssues
  });
  
  logVerbose(`Total quality issues: ${totalIssues}`);
}

// Check 4: File Organization
async function checkFileOrganization() {
  log('\n📁 Checking File Organization...');
  
  const files = await getFilesToCheck();
  const issues = [];
  
  for (const file of files) {
    const basename = path.basename(file);
    const dir = path.dirname(file);
    
    // Check naming conventions
    // React components should be PascalCase
    if (file.endsWith('.tsx') && dir.includes('components') && !/^[A-Z]/.test(basename)) {
      issues.push({
        file,
        message: 'React component files should use PascalCase'
      });
    }
    
    // Services and utils should be camelCase
    if ((dir.includes('services') || dir.includes('utils')) && 
        !basename.includes('.test.') && 
        !/^[a-z]/.test(basename)) {
      issues.push({
        file,
        message: 'Service/utility files should use camelCase'
      });
    }
    
    // Check for index files that are too large
    if (basename === 'index.ts' || basename === 'index.tsx') {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n').length;
      if (lines > 50) {
        issues.push({
          file,
          message: `Index file too large (${lines} lines). Consider breaking it up.`
        });
      }
    }
  }
  
  const status = issues.length === 0 ? STATUS.PASSED :
                 issues.length < 3 ? STATUS.WARNING : STATUS.FAILED;
  
  addCheckResult('File Organization', status, {
    issues: issues.slice(0, 10),
    totalFiles: files.length
  });
  
  logVerbose(`Organization issues: ${issues.length}`);
}

// Check 5: Security Standards
async function checkSecurityStandards() {
  log('\n🔒 Checking Security Standards...');
  
  const files = await getFilesToCheck();
  const issues = {
    hardcodedSecrets: [],
    unsafeIPC: [],
    unvalidatedInputs: []
  };
  
  // Common patterns for secrets
  const secretPatterns = [
    /api[_-]?key\s*[:=]\s*["'][\w\-]+["']/i,
    /password\s*[:=]\s*["'][\w\-]+["']/i,
    /token\s*[:=]\s*["'][\w\-]+["']/i,
    /secret\s*[:=]\s*["'][\w\-]+["']/i,
    /private[_-]?key\s*[:=]\s*["'][\w\-]+["']/i
  ];
  
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Check for hardcoded secrets
      for (const pattern of secretPatterns) {
        if (pattern.test(line) && 
            !line.includes('process.env') && 
            !line.includes('import.meta.env') &&
            !line.includes('PI-EXEMPT')) {
          issues.hardcodedSecrets.push({
            file,
            line: index + 1,
            content: line.trim().substring(0, 50) + '...'
          });
        }
      }
      
      // Check for unsafe IPC usage (direct ipcRenderer without preload)
      if (file.includes('renderer') && 
          line.includes('ipcRenderer') && 
          !file.includes('preload')) {
        issues.unsafeIPC.push({
          file,
          line: index + 1,
          message: 'Direct ipcRenderer usage detected. Use preload scripts.'
        });
      }
      
      // Check for unvalidated user inputs
      if (line.includes('innerHTML') && !line.includes('sanitize')) {
        issues.unvalidatedInputs.push({
          file,
          line: index + 1,
          message: 'Potential XSS: innerHTML without sanitization'
        });
      }
    });
  }
  
  // Check dependencies for vulnerabilities
  let auditIssues = 0;
  try {
    execSync('yarn audit --level high --json', { stdio: 'pipe' });
  } catch (error) {
    // Yarn audit returns non-zero exit code if vulnerabilities found
    if (error.stdout) {
      const auditResults = error.stdout.toString().split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
      
      auditIssues = auditResults.filter(r => r.type === 'auditAdvisory').length;
    }
  }
  
  const totalIssues = Object.values(issues).reduce((sum, arr) => sum + arr.length, 0) + auditIssues;
  const status = totalIssues === 0 ? STATUS.PASSED : STATUS.FAILED;
  
  addCheckResult('Security Standards', status, {
    issues: {
      hardcodedSecrets: issues.hardcodedSecrets.slice(0, 3),
      unsafeIPC: issues.unsafeIPC.slice(0, 3),
      unvalidatedInputs: issues.unvalidatedInputs.slice(0, 3),
      auditVulnerabilities: auditIssues
    },
    totalIssues
  });
  
  logVerbose(`Security issues: ${totalIssues}`);
}

// Check 6: Commit Standards (for current branch)
async function checkCommitStandards() {
  log('\n📝 Checking Commit Standards...');
  
  try {
    // Get commits from current branch not in main
    const commits = execSync('git log main..HEAD --oneline --no-merges 2>/dev/null || git log -10 --oneline --no-merges', { encoding: 'utf-8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    
    const issues = [];
    const conventionalCommitRegex = /^[a-f0-9]+ (feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?: .+/;
    
    for (const commit of commits) {
      if (!conventionalCommitRegex.test(commit)) {
        issues.push({
          commit: commit.substring(0, 60),
          message: 'Does not follow conventional commit format'
        });
      }
      
      // Check for signed commits
      const hash = commit.split(' ')[0];
      try {
        const showOutput = execSync(`git show --no-patch --format='%GS' ${hash}`, { encoding: 'utf-8' });
        if (!showOutput.trim()) {
          issues.push({
            commit: commit.substring(0, 60),
            message: 'Commit is not signed'
          });
        }
      } catch (e) {
        // Can't check signature
      }
    }
    
    const status = issues.length === 0 ? STATUS.PASSED :
                   issues.length <= commits.length * 0.2 ? STATUS.WARNING : STATUS.FAILED;
    
    addCheckResult('Commit Standards', status, {
      totalCommits: commits.length,
      issues: issues.slice(0, 5)
    });
    
    logVerbose(`Commit issues: ${issues.length}/${commits.length}`);
  } catch (error) {
    addCheckResult('Commit Standards', STATUS.WARNING, {
      error: 'Could not check commit standards',
      message: error.message
    });
  }
}

// Main execution
async function main() {
  log('🔍 Perfect Information (PI) Check');
  log('━'.repeat(50));
  
  try {
    await checkCodeDocumentation();
    await checkTestCoverage();
    await checkCodeQuality();
    await checkFileOrganization();
    await checkSecurityStandards();
    await checkCommitStandards();
    
    // Output results
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      log('\n' + '━'.repeat(50));
      log('📊 Summary\n');
      
      for (const [category, result] of Object.entries(results.checks)) {
        const icon = result.status === STATUS.PASSED ? '✅' :
                     result.status === STATUS.WARNING ? '⚠️ ' : '❌';
        log(`${icon} ${category}: ${result.status}`);
        
        if (result.status !== STATUS.PASSED && options.verbose) {
          if (result.issues) {
            if (Array.isArray(result.issues)) {
              result.issues.forEach(issue => {
                logVerbose(`  - ${issue.file}:${issue.line} - ${issue.message}`);
              });
            } else {
              for (const [type, items] of Object.entries(result.issues)) {
                if (items.length > 0) {
                  logVerbose(`  ${type}:`);
                  items.forEach(item => {
                    logVerbose(`    - ${item.file || item.commit || item.message}`);
                  });
                }
              }
            }
          }
        }
      }
      
      log('\n' + '━'.repeat(50));
      log(`Overall Status: ${results.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
      log(`${results.summary.totalChecks} checks: ${results.summary.passed} passed, ${results.summary.warnings} warnings, ${results.summary.failed} failed`);
      
      if (!results.passed) {
        log(`\n${results.summary.failed} issues must be resolved before merge`);
      }
    }
    
    // Exit with appropriate code
    process.exit(results.passed ? 0 : 1);
  } catch (error) {
    console.error('Error running PI checker:', error);
    process.exit(2);
  }
}

// Run the checker
main();