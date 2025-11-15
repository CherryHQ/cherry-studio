/**
 * Feishu (Lark) Webhook Notification Script for Pull Requests
 * Sends GitHub PR summaries to Feishu with @ mentions for reviewers and assignees
 */

const crypto = require('crypto')
const https = require('https')
const fs = require('fs')
const path = require('path')

/**
 * Generate Feishu webhook signature
 * @param {string} secret - Feishu webhook secret
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Base64 encoded signature
 */
function generateSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`
  const hmac = crypto.createHmac('sha256', stringToSign)
  return hmac.digest('base64')
}

/**
 * Send message to Feishu webhook
 * @param {string} webhookUrl - Feishu webhook URL
 * @param {string} secret - Feishu webhook secret
 * @param {object} content - Message content
 * @returns {Promise<void>}
 */
function sendToFeishu(webhookUrl, secret, content) {
  return new Promise((resolve, reject) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const sign = generateSignature(secret, timestamp)

    const payload = JSON.stringify({
      timestamp: timestamp.toString(),
      sign: sign,
      msg_type: 'interactive',
      card: content
    })

    const url = new URL(webhookUrl)
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('✅ Successfully sent to Feishu:', data)
          resolve()
        } else {
          reject(new Error(`Feishu API error: ${res.statusCode} - ${data}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.write(payload)
    req.end()
  })
}

/**
 * Parse user mapping from environment variable
 * Expected format: "github_user1:feishu_id1,github_user2:feishu_id2"
 * @param {string} mappingStr - User mapping string
 * @returns {Map<string, string>} Map of GitHub username to Feishu user ID
 */
function parseUserMapping(mappingStr) {
  const mapping = new Map()
  if (!mappingStr) {
    return mapping
  }

  const pairs = mappingStr.split(',')
  for (const pair of pairs) {
    const [github, feishu] = pair.split(':').map((s) => s.trim())
    if (github && feishu) {
      mapping.set(github, feishu)
    }
  }
  return mapping
}

/**
 * Get PR category display info
 * @param {string} category - PR category
 * @returns {object} Category display info
 */
function getCategoryInfo(category) {
  const categoryMap = {
    chat: { emoji: '💬', name: '对话', color: 'blue' },
    draw: { emoji: '🖼️', name: '绘图', color: 'blue' },
    uiux: { emoji: '🎨', name: 'UI/UX', color: 'blue' },
    knowledge: { emoji: '🧠', name: '知识库', color: 'green' },
    agent: { emoji: '🕹️', name: 'Agent', color: 'turquoise' },
    provider: { emoji: '🔌', name: 'Provider', color: 'turquoise' },
    minapps: { emoji: '🧩', name: '小程序', color: 'turquoise' },
    backup_export: { emoji: '💾', name: '备份/导出', color: 'purple' },
    data_storage: { emoji: '🗄️', name: '数据与存储', color: 'purple' },
    ai_core: { emoji: '🤖', name: 'AI基础设施', color: 'purple' },
    backend: { emoji: '⚙️', name: '后端/平台', color: 'green' },
    docs: { emoji: '📚', name: '文档', color: 'grey' },
    'build-config': { emoji: '🔧', name: '构建/配置', color: 'orange' },
    test: { emoji: '🧪', name: '测试', color: 'yellow' },
    multiple: { emoji: '🔀', name: '多模块', color: 'red' },
    other: { emoji: '📝', name: '其他', color: 'blue' }
  }

  return categoryMap[category] || categoryMap.other
}

/**
 * Load GitHub reviewers per category from .github/pr-modules.yml (optional)
 * Supports inline array style: github_reviewers: ["user1","user2"] or []
 * @returns {Map<string, string[]>}
 */
function loadConfigGithubReviewersByCategory() {
  const result = new Map()
  result.__rules = { vendor_added: [], large_change: { changed_files_gt: 30, reviewers: [] } }
  try {
    const candidates = [
      path.join(process.cwd(), '.github', 'pr-modules.yml'),
      path.join(process.cwd(), '.github', 'pr-modules.yaml')
    ]
    let filePath = null
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        filePath = p
        break
      }
    }
    if (!filePath) return result

    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split(/\r?\n/)
    let inCategories = false
    let inRules = false
    let currentCategory = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!inCategories && !inRules) {
        if (/^categories:\s*$/.test(line)) {
          inCategories = true
          continue
        }
        if (/^rules:\s*$/.test(line)) {
          inRules = true
          continue
        }
        continue
      }

      if (inCategories) {
        const catMatch = /^\s{2}([a-zA-Z0-9_-]+):\s*$/.exec(line)
        if (catMatch) {
          currentCategory = catMatch[1]
          continue
        }

        if (currentCategory) {
          const reviewersMatch = /^\s{4}github_reviewers:\s*(.*)$/.exec(line)
          if (reviewersMatch) {
            let value = (reviewersMatch[1] || '').trim()
            let users = []
            if (value.startsWith('[') && value.endsWith(']')) {
              const inner = value.slice(1, -1).trim()
              if (inner.length > 0) {
                users = inner
                  .split(',')
                  .map((s) => s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, ''))
                  .filter(Boolean)
              }
            } else if (value === '' || value === '[]') {
              // try to parse dash list style
              const collected = []
              let j = i + 1
              while (j < lines.length) {
                const l = lines[j]
                const dash = /^\s{6}-\s*(["']?)([^"']*)\1\s*$/.exec(l)
                if (dash) {
                  const user = dash[2].trim()
                  if (user) collected.push(user)
                  j++
                  continue
                }
                break
              }
              users = collected
            }
            result.set(currentCategory, Array.from(new Set(users)))
          }
        }
      } else if (inRules) {
        // vendor_added block
        if (/^\s{2}vendor_added:\s*$/.test(line)) {
          // parse github_reviewers under vendor_added
          let j = i + 1
          const reviewers = []
          while (j < lines.length) {
            const l = lines[j]
            const reviewersLine = /^\s{4}github_reviewers:\s*(.*)$/.exec(l)
            if (reviewersLine) {
              let value = (reviewersLine[1] || '').trim()
              if (value.startsWith('[') && value.endsWith(']')) {
                const inner = value.slice(1, -1).trim()
                if (inner.length > 0) {
                  inner.split(',').forEach((s) => {
                    const u = s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
                    if (u) reviewers.push(u)
                  })
                }
              }
              j++
              continue
            }
            const dash = /^\s{6}-\s*(["']?)([^"']*)\1\s*$/.exec(l)
            if (dash) {
              const u = dash[2].trim()
              if (u) reviewers.push(u)
              j++
              continue
            }
            if (/^\s{2}[a-zA-Z0-9_-]+:\s*$/.test(l)) break
            j++
          }
          result.__rules.vendor_added = Array.from(new Set(reviewers))
        }

        // large_change block
        if (/^\s{2}large_change:\s*$/.test(line)) {
          let j = i + 1
          const rule = { changed_files_gt: 30, reviewers: [] }
          while (j < lines.length) {
            const l = lines[j]
            const threshold = /^\s{4}changed_files_gt:\s*(\d+)\s*$/.exec(l)
            if (threshold) {
              rule.changed_files_gt = parseInt(threshold[1], 10)
              j++
              continue
            }
            const reviewersLine = /^\s{4}github_reviewers:\s*(.*)$/.exec(l)
            if (reviewersLine) {
              let value = (reviewersLine[1] || '').trim()
              if (value.startsWith('[') && value.endsWith(']')) {
                const inner = value.slice(1, -1).trim()
                if (inner.length > 0) {
                  inner.split(',').forEach((s) => {
                    const u = s.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '')
                    if (u) rule.reviewers.push(u)
                  })
                }
              }
              j++
              continue
            }
            const dash = /^\s{6}-\s*(["']?)([^"']*)\1\s*$/.exec(l)
            if (dash) {
              const u = dash[2].trim()
              if (u) rule.reviewers.push(u)
              j++
              continue
            }
            if (/^\s{2}[a-zA-Z0-9_-]+:\s*$/.test(l)) break
            j++
          }
          rule.reviewers = Array.from(new Set(rule.reviewers))
          result.__rules.large_change = rule
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Failed to load .github/pr-modules.yml:', e.message)
  }
  return result
}

/**
 * Get recommended reviewers based on PR category
 * This is a helper for Claude to suggest appropriate reviewers
 * @param {string} category - PR category
 * @param {Map<string, string>} userMapping - GitHub to Feishu user mapping
 * @returns {string[]} List of Feishu user IDs to notify
 */
function getRecommendedReviewersByCategory(category, userMapping, configGithubReviewersMap) {
  // Fallback mapping when config not provided
  const fallback = {
    backend: ['kangfenmao'],
    ai_core: ['kangfenmao'],
    'build-config': ['kangfenmao'],
    multiple: ['kangfenmao']
  }

  const configUsers = (configGithubReviewersMap && configGithubReviewersMap.get(category)) || []
  const fallbackUsers = fallback[category] || []
  const githubUsers = Array.from(new Set([...configUsers, ...fallbackUsers]))
  return githubUsers.map((gh) => userMapping.get(gh)).filter(Boolean)
}

/**
 * Create Feishu card message from PR data
 * @param {object} prData - GitHub PR data
 * @param {Map<string, string>} userMapping - GitHub to Feishu user mapping
 * @returns {object} Feishu card content
 */
function createPRCard(prData, userMapping, configGithubReviewersMap) {
  const {
    prUrl,
    prNumber,
    prTitle,
    prSummary,
    prAuthor,
    labels,
    reviewers,
    assignees,
    category,
    changedFiles,
    additions,
    deletions,
    vendorAdded
  } = prData

  const categoryInfo = getCategoryInfo(category)

  // Build labels section
  const labelElements =
    labels && labels.length > 0
      ? [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**🏷️ Labels:** ${labels.map((l) => `\`${l}\``).join(' ')}`
            }
          }
        ]
      : []

  // Build stats section
  const statsContent = [
    `📁 ${changedFiles || 0} files`,
    `<font color='green'>+${additions || 0}</font>`,
    `<font color='red'>-${deletions || 0}</font>`
  ].join(' · ')

  // Build mention content for reviewers and assignees
  const mentions = []
  const mentionedUsers = new Set()

  // Add reviewers
  if (reviewers && reviewers.length > 0) {
    reviewers.forEach((reviewer) => {
      const feishuId = userMapping.get(reviewer)
      if (feishuId && !mentionedUsers.has(feishuId)) {
        mentions.push(`<at id="${feishuId}"></at>`)
        mentionedUsers.add(feishuId)
      }
    })
  }

  // Add assignees
  if (assignees && assignees.length > 0) {
    assignees.forEach((assignee) => {
      const feishuId = userMapping.get(assignee)
      if (feishuId && !mentionedUsers.has(feishuId)) {
        mentions.push(`<at id="${feishuId}"></at>`)
        mentionedUsers.add(feishuId)
      }
    })
  }

  // Add category-based experts (if not already mentioned)
  const categoryExperts = getRecommendedReviewersByCategory(category, userMapping, configGithubReviewersMap)
  categoryExperts.forEach((feishuId) => {
    if (feishuId && !mentionedUsers.has(feishuId)) {
      mentions.push(`<at id="${feishuId}"></at>`)
      mentionedUsers.add(feishuId)
    }
  })

  // Enforce mandatory reviewers based on rules
  const mandatoryGithubUsers = []
  const rules = configGithubReviewersMap.__rules || {
    vendor_added: [],
    large_change: { changed_files_gt: 30, reviewers: [] }
  }
  if (vendorAdded) {
    mandatoryGithubUsers.push(...(rules.vendor_added || ['Yinsen-Ho']))
  }
  const changedFilesNum = Number(changedFiles) || 0
  const threshold = (rules.large_change && rules.large_change.changed_files_gt) || 30
  if (changedFilesNum > threshold) {
    const reviewers = (rules.large_change && rules.large_change.reviewers) || ['kangfenmao']
    mandatoryGithubUsers.push(...reviewers)
  }

  mandatoryGithubUsers.forEach((gh) => {
    const feishuId = userMapping.get(gh)
    if (feishuId && !mentionedUsers.has(feishuId)) {
      mentions.push(`<at id="${feishuId}"></at>`)
      mentionedUsers.add(feishuId)
    }
  })

  // Build mentions section
  const mentionElements =
    mentions.length > 0
      ? [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**👥 请关注:** ${mentions.join(' ')}`
            }
          }
        ]
      : []

  // Build reviewer and assignee info
  const reviewerInfo = []
  if (reviewers && reviewers.length > 0) {
    reviewerInfo.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**👀 Reviewers:** ${reviewers.map((r) => `\`${r}\``).join(', ')}`
      }
    })
  }
  if (assignees && assignees.length > 0) {
    reviewerInfo.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: `**👤 Assignees:** ${assignees.map((a) => `\`${a}\``).join(', ')}`
      }
    })
  }

  return {
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**🔀 New Pull Request #${prNumber}**`
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**${categoryInfo.emoji} 类型:** ${categoryInfo.name}`
        }
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📝 Title:** ${prTitle}`
        }
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**👤 Author:** \`${prAuthor}\``
        }
      },
      ...reviewerInfo,
      ...labelElements,
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📊 Changes:** ${statsContent}`
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📋 Summary:**\n${prSummary}`
        }
      },
      ...mentionElements,
      {
        tag: 'hr'
      },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            text: {
              tag: 'plain_text',
              content: '🔗 View PR'
            },
            type: 'primary',
            url: prUrl
          }
        ]
      }
    ],
    header: {
      template: categoryInfo.color,
      title: {
        tag: 'plain_text',
        content: `${categoryInfo.emoji} Cherry Studio - New PR [${categoryInfo.name}]`
      }
    }
  }
}

/**
 * Main function
 */
async function main() {
  try {
    // Get environment variables
    const webhookUrl = process.env.FEISHU_WEBHOOK_URL
    const secret = process.env.FEISHU_WEBHOOK_SECRET
    const userMappingStr = process.env.FEISHU_USER_MAPPING || ''

    const prUrl = process.env.PR_URL
    const prNumber = process.env.PR_NUMBER
    const prTitle = process.env.PR_TITLE
    const prSummary = process.env.PR_SUMMARY
    const prAuthor = process.env.PR_AUTHOR
    const labelsStr = process.env.PR_LABELS || ''
    const reviewersStr = process.env.PR_REVIEWERS || ''
    const assigneesStr = process.env.PR_ASSIGNEES || ''
    const category = process.env.PR_CATEGORY || 'multiple'
    const vendorAdded = String(process.env.PR_VENDOR_ADDED || 'false').toLowerCase() === 'true'
    const changedFiles = process.env.PR_CHANGED_FILES || '0'
    const additions = process.env.PR_ADDITIONS || '0'
    const deletions = process.env.PR_DELETIONS || '0'

    // Validate required environment variables
    if (!webhookUrl) {
      throw new Error('FEISHU_WEBHOOK_URL environment variable is required')
    }
    if (!secret) {
      throw new Error('FEISHU_WEBHOOK_SECRET environment variable is required')
    }
    if (!prUrl || !prNumber || !prTitle || !prSummary) {
      throw new Error('PR data environment variables are required')
    }

    // Parse data
    const userMapping = parseUserMapping(userMappingStr)
    const configGithubReviewersMap = loadConfigGithubReviewersByCategory()

    const labels = labelsStr
      ? labelsStr
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
      : []

    const reviewers = reviewersStr
      ? reviewersStr
          .split(',')
          .map((r) => r.trim())
          .filter(Boolean)
      : []

    const assignees = assigneesStr
      ? assigneesStr
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : []

    // Create PR data object
    const prData = {
      prUrl,
      prNumber,
      prTitle,
      prSummary,
      prAuthor: prAuthor || 'Unknown',
      labels,
      reviewers,
      assignees,
      category,
      vendorAdded,
      changedFiles,
      additions,
      deletions
    }

    console.log('📤 Sending PR notification to Feishu...')
    console.log(`PR #${prNumber}: ${prTitle}`)
    console.log(`Category: ${category}`)
    console.log(`Vendor added: ${vendorAdded}`)
    console.log(`Reviewers: ${reviewers.join(', ') || 'None'}`)
    console.log(`Assignees: ${assignees.join(', ') || 'None'}`)
    console.log(`User mapping entries: ${userMapping.size}`)

    // Create card content
    const card = createPRCard(prData, userMapping, configGithubReviewersMap)

    // Send to Feishu
    await sendToFeishu(webhookUrl, secret, card)

    console.log('✅ PR notification sent successfully!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// Run main function
main()
