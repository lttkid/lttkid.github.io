import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = process.cwd()
const baseUrl = process.env.LIVE_SMOKE_BASE_URL ?? 'http://127.0.0.1:4174/'
let serverProcess = null

function stopServer() {
  if (!serverProcess?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    serverProcess.kill()
  }
  serverProcess = null
}

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

function unexpectedConsoleErrors(consoleErrors) {
  return consoleErrors.filter(
    (text) => !text.includes('Failed to load resource: the server responded with a status of 400'),
  )
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
  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', parsed.port || '4174'], {
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

function isBrowserUpload(document) {
  return document.metadata?.source === 'browser_upload'
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
  return { client, user: data.user }
}

async function getSyncImportedDocument(client) {
  const { data: documents, error } = await client
    .from('documents')
    .select('id,title,storage_path,metadata,last_scroll,last_read_at')
    .eq('archived', false)
    .order('imported_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`Documents query failed: ${error.message}`)

  const document = (documents ?? []).find((item) => !isBrowserUpload(item))
  assert(document, 'No sync-imported non-archived document found for the live test user.')

  const { data: htmlBlob, error: storageError } = await client.storage
    .from('html-docs')
    .download(document.storage_path)
  if (storageError) throw new Error(`Sync-imported Storage download failed: ${storageError.message}`)

  const html = await htmlBlob.text()
  assert(html.trim().length > 0, 'Sync-imported document HTML is empty.')
  return document
}

async function createMissingStorageDocument(client, userId) {
  const runId = Date.now().toString(36)
  const title = `Live Missing Storage Smoke ${runId}`
  const storagePath = `${userId}/missing/live-missing-storage-${runId}.html`

  const { data, error } = await client
    .from('documents')
    .insert({
      owner_id: userId,
      title,
      storage_path: storagePath,
      archived: false,
      favorite: false,
      summary: '临时验证阅读失败提示的文档。',
      reading_estimate_minutes: 1,
      metadata: {
        source: 'live_missing_storage_test',
      },
    })
    .select('id,title,storage_path,metadata')
    .single()
  if (error) throw new Error(`Could not create missing-storage document: ${error.message}`)
  return data
}

async function openDocumentFromLibrary(page, title) {
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill(title)
  const card = page.locator('.document-card').filter({ hasText: title }).first()
  await card.getByRole('button', { name: '阅读' }).click()
}

async function checkBrowserFlow(syncDocument, missingDocument) {
  await ensureServer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(baseUrl, { waitUntil: 'load' })

    await page.getByLabel('邮箱').fill(testEmail)
    await page.getByLabel('密码').fill(testPassword)
    await page.getByRole('button', { name: '登录' }).click()

    await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor({ timeout: 20000 })
    await page.getByText('Supabase Secure').waitFor()
    await page.locator('.source-badge', { hasText: '同步导入' }).first().waitFor({ timeout: 10000 })

    await openDocumentFromLibrary(page, syncDocument.title)
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })

    const syncBody = page.frameLocator('iframe').locator('body')
    await syncBody.waitFor({ timeout: 10000 })
    const bodyText = (await syncBody.innerText()).trim()
    assert(bodyText.length > 0, 'Sync-imported reader iframe rendered empty HTML.')

    const readerMetrics = await page.evaluate(() => {
      const iframe = document.querySelector('iframe')?.getBoundingClientRect()
      return {
        noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        iframeLargeEnough: Boolean(iframe && iframe.width > 600 && iframe.height > 500),
      }
    })
    assert(readerMetrics.noHorizontalOverflow, 'Reader has horizontal overflow on desktop viewport.')
    assert(readerMetrics.iframeLargeEnough, 'Reader iframe is unexpectedly small.')

    await page.getByRole('button', { name: '返回资料库' }).click()
    await openDocumentFromLibrary(page, missingDocument.title)
    await page.getByText('阅读文件加载失败').waitFor({ timeout: 20000 })

    const unexpectedErrors = unexpectedConsoleErrors(consoleErrors)
    assert(unexpectedErrors.length === 0, `Console errors found:\n${unexpectedErrors.join('\n')}`)
  } finally {
    await page.close()
    await browser.close()
  }
}

let client
let missingDocument

try {
  const auth = await createAuthedClient()
  client = auth.client
  const syncDocument = await getSyncImportedDocument(client)
  missingDocument = await createMissingStorageDocument(client, auth.user.id)
  await checkBrowserFlow(syncDocument, missingDocument)
  console.log('Live smoke passed: sync-imported reader entry and reader failure notice are working.')
} finally {
  if (missingDocument && client) {
    await client.from('documents').delete().eq('id', missingDocument.id)
  }
  if (serverProcess) {
    stopServer()
  }
}
