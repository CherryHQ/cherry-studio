const { Octokit } = require('@octokit/rest')
const OpenAI = require('openai')

class GitHubTranslator {
  constructor() {
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    })

    this.openai = new OpenAI({
      apiKey: process.env.API_KEY,
      baseURL: process.env.BASE_URL
    })

    this.model = process.env.MODEL || 'deepseek/deepseek-v3.1'
    this.repo = process.env.GITHUB_REPOSITORY.split('/')
    this.context = JSON.parse(process.env.GITHUB_CONTEXT)
  }

  async translateText(text, targetLang = 'English') {
    if (!text || this.isAlreadyTranslated(text) || this.isPrimarylyEnglish(text)) {
      return null
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a professional translator. Translate the following text to ${targetLang}. Keep the original formatting (markdown, code blocks, links) intact. If the text is already primarily in ${targetLang}, respond with "NO_TRANSLATION_NEEDED".`
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.3
      })

      const translation = response.choices[0].message.content.trim()
      return translation === 'NO_TRANSLATION_NEEDED' ? null : translation
    } catch (error) {
      console.error('Translation error:', error)
      return null
    }
  }

  isAlreadyTranslated(text) {
    return (
      text.includes('**🌐 Translation**') ||
      text.includes('**English Translation**') ||
      text.includes('<!-- Translated by GitHub Translator -->')
    )
  }

  isPrimarylyEnglish(text) {
    // Simple heuristic: if text contains mostly English characters
    const englishChars = text.match(/[a-zA-Z\s]/g) || []
    const totalChars = text.replace(/\s/g, '')
    return englishChars.length / totalChars.length > 0.7
  }

  formatTranslation(originalText, translation) {
    return `${originalText}

---

**🌐 English Translation:**

${translation}

<!-- Translated by GitHub Translator -->`
  }

  async handleIssue() {
    const issue = this.context.event.issue
    if (!issue) return

    let updates = {}

    // Translate title
    if (issue.title) {
      const translatedTitle = await this.translateText(issue.title)
      if (translatedTitle) {
        updates.title = `${issue.title} / ${translatedTitle}`
      }
    }

    // Translate body
    if (issue.body) {
      const translatedBody = await this.translateText(issue.body)
      if (translatedBody) {
        updates.body = this.formatTranslation(issue.body, translatedBody)
      }
    }

    // Update issue if we have translations
    if (Object.keys(updates).length > 0) {
      await this.octokit.issues.update({
        owner: this.repo[0],
        repo: this.repo[1],
        issue_number: issue.number,
        ...updates
      })

      console.log(`✅ Translated issue #${issue.number}`)
    }
  }

  async handleComment() {
    const comment = this.context.event.comment
    if (!comment) return

    const translatedBody = await this.translateText(comment.body)
    if (translatedBody) {
      await this.octokit.issues.updateComment({
        owner: this.repo[0],
        repo: this.repo[1],
        comment_id: comment.id,
        body: this.formatTranslation(comment.body, translatedBody)
      })

      console.log(`✅ Translated comment #${comment.id}`)
    }
  }

  async handlePullRequest() {
    const pr = this.context.event.pull_request
    if (!pr) return

    let updates = {}

    // Translate title
    if (pr.title) {
      const translatedTitle = await this.translateText(pr.title)
      if (translatedTitle) {
        updates.title = `${pr.title} / ${translatedTitle}`
      }
    }

    // Translate body
    if (pr.body) {
      const translatedBody = await this.translateText(pr.body)
      if (translatedBody) {
        updates.body = this.formatTranslation(pr.body, translatedBody)
      }
    }

    // Update PR if we have translations
    if (Object.keys(updates).length > 0) {
      await this.octokit.pulls.update({
        owner: this.repo[0],
        repo: this.repo[1],
        pull_number: pr.number,
        ...updates
      })

      console.log(`✅ Translated PR #${pr.number}`)
    }
  }

  async handleDiscussion() {
    // Note: GitHub's GraphQL API would be needed for full discussion support
    console.log('Discussion translation not implemented yet')
  }

  async run() {
    try {
      const eventName = process.env.GITHUB_EVENT_NAME

      console.log(`🌐 Processing ${eventName} event...`)

      switch (eventName) {
        case 'issues':
          await this.handleIssue()
          break
        case 'issue_comment':
          await this.handleComment()
          break
        case 'pull_request':
        case 'pull_request_target':
          await this.handlePullRequest()
          break
        case 'pull_request_review_comment':
          await this.handleComment()
          break
        case 'discussion':
        case 'discussion_comment':
          await this.handleDiscussion()
          break
        default:
          console.log(`Event ${eventName} not supported`)
      }
    } catch (error) {
      console.error('Translation workflow error:', error)
      process.exit(1)
    }
  }
}

// Run the translator
if (require.main === module) {
  const translator = new GitHubTranslator()
  translator.run()
}

module.exports = GitHubTranslator
