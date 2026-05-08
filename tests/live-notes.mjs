import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = process.cwd()
const baseUrl = process.env.LIVE_NOTES_BASE_URL ?? 'http://127.0.0.1:4175/'
let serverProcess = null

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    values[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }

  return values
}

const fileEnv = {
  ...parseEnvFile(path.join(root, '.env')),
  ...parseEnvFile(path.join(root, '.env.local')),
}
const env = { ...fileEnv, ...process.env }

const supabaseUrl = firstValue('VITE_SUPABASE_URL', 'SUPABASE_URL')
const supabaseAnonKey = firstValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY')
const testEmail = firstValue('LIVE_TEST_EMAIL', 'SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL')
const testPassword = firstValue('LIVE_TEST_PASSWORD', 'SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD')

function firstValue(...names) {
  for (const name of names) {
    const value = String(env[name] ?? '').trim()
    if (value && !isPlaceholder(value)) return value
  }
  return ''
}

function isPlaceholder(value) {
  return /^(your-|replace-with-|reader@example\.com$|reader-password$|owner@example\.com$|https:\/\/your-project\.supabase\.co$)/i.test(
    value,
  )
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

function failMissing(name, alternatives = []) {
  const suffix = alternatives.length ? ` (or ${alternatives.join(' / ')})` : ''
  throw new Error(`Missing ${name}${suffix}. Set it in .env.local or the shell environment.`)
}

if (!supabaseUrl) failMissing('VITE_SUPABASE_URL', ['SUPABASE_URL'])
if (!supabaseAnonKey) failMissing('VITE_SUPABASE_ANON_KEY', ['SUPABASE_ANON_KEY'])
if (!testEmail) failMissing('LIVE_TEST_EMAIL', ['SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL'])
if (!testPassword) failMissing('LIVE_TEST_PASSWORD', ['SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD'])

async function isReachable(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url) {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function ensureServer() {
  if (await isReachable(baseUrl)) return

  const parsed = new URL(baseUrl)
  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', parsed.port || '4175'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEMO_MODE: 'false',
      VITE_SUPABASE_URL: supabaseUrl,
      VITE_SUPABASE_ANON_KEY: supabaseAnonKey,
    },
  })
  await waitForServer(baseUrl)
}

async function createAuthedClient() {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  })
  if (error) throw new Error(`Supabase auth failed: ${error.message}`)
  assert(data.user, 'Supabase auth did not return a user.')
  return client
}

async function getLiveDocument(client) {
  const { data, error } = await client
    .from('documents')
    .select('id,title,storage_path')
    .eq('archived', false)
    .order('imported_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`Documents query failed: ${error.message}`)
  assert(data?.length, 'No non-archived documents found for the live notes test user.')
  return data[0]
}

async function queryHighlightByNote(client, note) {
  const { data, error } = await client
    .from('highlights')
    .select('id,document_id,selected_text,note,created_at')
    .eq('note', note)
    .maybeSingle()
  if (error) throw new Error(`Highlight query failed: ${error.message}`)
  return data
}

async function waitForCondition(check, message, timeoutMs = 12000) {
  const started = Date.now()
  let lastValue
  while (Date.now() - started < timeoutMs) {
    lastValue = await check()
    if (lastValue) return lastValue
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(message)
}

async function cleanupVerificationNotes(client) {
  const { error } = await client.from('highlights').delete().ilike('note', 'Live notes verification%')
  if (error) throw new Error(`Verification cleanup failed: ${error.message}`)
}

async function selectTextInsideReader(page) {
  const frame = page.frames().find((item) => item.url().startsWith('about:srcdoc'))
  assert(frame, 'Reader iframe was not created.')
  await frame.locator('body').waitFor({ state: 'visible', timeout: 10000 })

  const target = await frame.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('p, li, td, blockquote, h1, h2, h3, body'))
    for (const element of candidates) {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim()
      const rect = element.getBoundingClientRect()
      if (text.length >= 12 && rect.width > 80 && rect.height > 12) {
        return {
          text: text.slice(0, 80),
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        }
      }
    }
    return null
  })
  assert(target, 'Could not find selectable text inside the live document iframe.')

  const iframeBox = await page.locator('iframe').boundingBox()
  assert(iframeBox, 'Could not locate reader iframe box.')

  const startX = iframeBox.x + target.x + 8
  const y = iframeBox.y + target.y + Math.min(24, Math.max(8, target.height / 2))
  const endX = iframeBox.x + target.x + Math.min(target.width - 8, 420)

  await page.mouse.move(startX, y)
  await page.mouse.down()
  await page.mouse.move(endX, y, { steps: 18 })
  await page.mouse.up()

  const selectedPrefix = target.text.slice(0, 8)
  await page.getByText(selectedPrefix, { exact: false }).waitFor({ timeout: 8000 })
  return target.text
}

async function runBrowserFlow(client, document) {
  await ensureServer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const runId = Date.now()
  const originalNote = `Live notes verification ${runId}`
  const editedNote = `Live notes verification edited ${runId}`

  try {
    await page.goto(baseUrl, { waitUntil: 'load' })

    await page.getByLabel('邮箱').fill(testEmail)
    await page.getByLabel('密码').fill(testPassword)
    await page.getByRole('button', { name: '登录' }).click()

    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })
    await page.getByText('Supabase Secure').waitFor()
    await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill(document.title)
    await page.locator('.document-card').filter({ hasText: document.title }).getByRole('button', { name: '阅读' }).click()
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })

    const selectedText = await selectTextInsideReader(page)
    await page.getByPlaceholder('给这段高亮补一条笔记').fill(originalNote)
    await page.getByRole('button', { name: '高亮' }).click()
    await page.getByText(originalNote).waitFor({ timeout: 10000 })

    const inserted = await waitForCondition(
      () => queryHighlightByNote(client, originalNote),
      'Saved highlight was not found in Supabase.',
    )
    assert(inserted.document_id === document.id, 'Saved highlight is attached to the wrong document.')
    assert(inserted.selected_text?.trim().length > 0, 'Saved highlight selected_text is empty.')

    await page.getByRole('button', { name: '笔记' }).click()
    await page.getByRole('heading', { name: '笔记中心' }).waitFor()
    await page.getByPlaceholder('搜索高亮、笔记、来源文档').fill(originalNote)
    await page.getByText(originalNote).waitFor({ timeout: 10000 })

    await page.getByRole('button', { name: '编辑' }).click()
    await page.getByLabel('编辑笔记').fill(editedNote)
    await page.locator('.note-edit-box').getByRole('button', { name: '保存' }).click()
    await page.getByPlaceholder('搜索高亮、笔记、来源文档').fill(editedNote)
    await page.getByText(editedNote).waitFor({ timeout: 10000 })

    await waitForCondition(
      async () => !(await queryHighlightByNote(client, originalNote)),
      'Old note text still exists after editing.',
    )
    const edited = await waitForCondition(
      () => queryHighlightByNote(client, editedNote),
      'Edited note was not found in Supabase.',
    )
    assert(edited?.id === inserted.id, 'Edited note was not updated on the original highlight row.')

    const editedCard = page.locator('.note-card').filter({ hasText: editedNote })
    await editedCard.locator('button.recent-row').click()
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })
    await page.getByRole('heading', { name: document.title }).waitFor({ timeout: 10000 })
    assert(page.url().includes(`#/reader/${document.id}`), 'Source document click did not return to the reader route.')

    await page.getByRole('button', { name: '笔记' }).click()
    await page.getByRole('heading', { name: '笔记中心' }).waitFor()
    await page.getByPlaceholder('搜索高亮、笔记、来源文档').fill(editedNote)
    await page.getByText(editedNote).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '删除' }).click()
    await page.getByText('暂无笔记').waitFor({ timeout: 10000 })

    await waitForCondition(
      async () => !(await queryHighlightByNote(client, editedNote)),
      'Edited note still exists in Supabase after deletion.',
    )
    assert(consoleErrors.length === 0, `Console errors found:\n${consoleErrors.join('\n')}`)

    return {
      documentId: document.id,
      documentTitle: document.title,
      selectedTextPreview: selectedText.slice(0, 40),
      insertedHighlightId: inserted.id,
      createdInSupabase: true,
      editedInSupabase: true,
      deletedInSupabase: true,
      sourceJumpReturnedToReader: true,
    }
  } finally {
    await page.close()
    await browser.close()
  }
}

try {
  const client = await createAuthedClient()
  await cleanupVerificationNotes(client)
  const document = await getLiveDocument(client)
  const result = await runBrowserFlow(client, document)
  await cleanupVerificationNotes(client)
  console.log('Live notes passed: selection, highlight, note edit/delete, and source jump are working on real Supabase data.')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (serverProcess) {
    serverProcess.kill()
  }
}
