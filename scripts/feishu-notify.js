/**
 * Feishu (Lark) Webhook Notification Script
 * Sends GitHub issue summaries to Feishu with signature verification
 */

const crypto = require('crypto')
const https = require('https')

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
 * Create Feishu card message from issue data
 * @param {object} issueData - GitHub issue data
 * @returns {object} Feishu card content
 */
function createIssueCard(issueData) {
  const { issueUrl, issueNumber, issueTitle, issueSummary, issueAuthor, labels } = issueData

  // Build labels section if labels exist
  const labelElements =
    labels && labels.length > 0
      ? labels.map((label) => ({
          tag: 'markdown',
          content: `\`${label}\``
        }))
      : []

  return {
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**👤 Author:** ${issueAuthor}`
        }
      },
      ...(labelElements.length > 0
        ? [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: `**🏷️ Labels:** ${labels.join(', ')}`
              }
            }
          ]
        : []),
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**📋 Summary:**\n${issueSummary}`
        }
      },
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
              content: '🔗 View Issue'
            },
            type: 'primary',
            url: issueUrl
          }
        ]
      }
    ],
    header: {
      template: 'blue',
      title: {
        tag: 'plain_text',
        content: `#${issueNumber} - ${issueTitle}`
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
    const issueUrl = process.env.ISSUE_URL
    const issueNumber = process.env.ISSUE_NUMBER
    const issueTitle = process.env.ISSUE_TITLE
    const issueSummary = process.env.ISSUE_SUMMARY
    const issueAuthor = process.env.ISSUE_AUTHOR
    const labelsStr = process.env.ISSUE_LABELS || ''

    // Validate required environment variables
    if (!webhookUrl) {
      throw new Error('FEISHU_WEBHOOK_URL environment variable is required')
    }
    if (!secret) {
      throw new Error('FEISHU_WEBHOOK_SECRET environment variable is required')
    }
    if (!issueUrl || !issueNumber || !issueTitle || !issueSummary) {
      throw new Error('Issue data environment variables are required')
    }

    // Parse labels
    const labels = labelsStr
      ? labelsStr
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
      : []

    // Create issue data object
    const issueData = {
      issueUrl,
      issueNumber,
      issueTitle,
      issueSummary,
      issueAuthor: issueAuthor || 'Unknown',
      labels
    }

    // Create card content
    const card = createIssueCard(issueData)

    console.log('📤 Sending notification to Feishu...')
    console.log(`Issue #${issueNumber}: ${issueTitle}`)

    // Send to Feishu
    await sendToFeishu(webhookUrl, secret, card)

    console.log('✅ Notification sent successfully!')
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// Run main function
main()
