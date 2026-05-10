import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const root = process.cwd()
const baseUrl = process.env.LIVE_NOTES_BASE_URL ?? 'http://127.0.0.1:4175/'
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

async function assertAnnotationSchema(client) {
  const { error } = await client.from('highlights').select('id,color,text_color,locator').limit(1)
  if (!error) return
  const message = error.message || String(error)
  if (message.includes('text_color') || message.includes('locator')) {
    throw new Error(
      'Live database is missing highlights.text_color / highlights.locator. Apply supabase/migrations/005_highlight_annotation_styles.sql and 006_highlight_nullable_color.sql before running npm run test:live:notes.',
    )
  }
  throw new Error(`Highlight annotation schema check failed: ${message}`)
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
    .select('id,document_id,selected_text,note,color,text_color,locator,created_at')
    .eq('note', note)
    .maybeSingle()
  if (error) throw new Error(`Highlight query failed: ${error.message}`)
  return data
}

async function queryHighlightsBySelectedText(client, documentId, selectedText) {
  const { data, error } = await client
    .from('highlights')
    .select('id,document_id,selected_text,note,color,text_color,locator,created_at')
    .eq('document_id', documentId)
    .eq('selected_text', selectedText)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Highlight query by text failed: ${error.message}`)
  return data ?? []
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

async function cleanupHighlightsBySelectedText(client, documentId, selectedText) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { error } = await client.from('highlights').delete().eq('document_id', documentId).eq('selected_text', selectedText)
    if (!error) return
    lastError = error
    await new Promise((resolve) => setTimeout(resolve, 500 + attempt * 500))
  }
  throw new Error(`Existing highlight cleanup failed: ${lastError?.message ?? String(lastError)}`)
}

async function waitForAnnotationStyle(frame, selectedText, expectedColor) {
  const needle = selectedText.slice(0, Math.min(8, selectedText.length)).trim()
  await frame.waitForFunction(
    ({ needle: currentNeedle, expectedColor: currentColor }) =>
      Array.from(document.querySelectorAll('.html-reader-annotation')).some((node) => {
        const style = window.getComputedStyle(node)
        return (node.textContent || '').includes(currentNeedle) && style.color === currentColor
      }),
    { needle, expectedColor },
    { timeout: 10000 },
  )
  return frame.evaluate(({ needle: currentNeedle, expectedColor: currentColor }) => {
    const match = Array.from(document.querySelectorAll('.html-reader-annotation')).find((node) => {
      const style = window.getComputedStyle(node)
      return (node.textContent || '').includes(currentNeedle) && style.color === currentColor
    })
    if (!match) return null
    const style = window.getComputedStyle(match)
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      text: match.textContent,
    }
  }, { needle, expectedColor })
}

async function countAnnotationsForText(frame, selectedText) {
  const needle = selectedText.slice(0, Math.min(8, selectedText.length)).trim()
  return frame.evaluate(
    (currentNeedle) =>
      Array.from(document.querySelectorAll('.html-reader-annotation')).filter((node) =>
        (node.textContent || '').includes(currentNeedle),
      ).length,
    needle,
  )
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

  let selectedText = await frame.evaluate(() => String(window.getSelection?.() || '').replace(/\s+/g, ' ').trim())
  if (selectedText.length < 4) {
    selectedText = await frame.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim()
        if (text.length < 12) continue
        const source = node.nodeValue || ''
        const leading = source.search(/\S/)
        const start = Math.max(0, leading)
        const end = Math.min(source.length, start + Math.min(80, text.length))
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        return String(selection || '').replace(/\s+/g, ' ').trim()
      }
      return ''
    })
  }
  assert(selectedText.length >= 4, 'Could not select text inside the live document iframe.')
  const selectedPrefix = selectedText.slice(0, 8)
  await page.getByText(selectedPrefix, { exact: false }).waitFor({ timeout: 8000 })
  return selectedText
}

async function runBrowserFlow(client, document) {
  await ensureServer()

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Failed to load resource: the server responded with a status of 404')) return
    consoleErrors.push(text)
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const runId = Date.now()
  const originalNote = `Live notes verification ${runId}`
  const editedNote = `Live notes verification edited ${runId}`
  let touchedHighlightId = ''

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

    let selectedText = await selectTextInsideReader(page)
    await cleanupHighlightsBySelectedText(client, document.id, selectedText)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('heading', { name: document.title }).waitFor({ timeout: 20000 })
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })
    selectedText = await selectTextInsideReader(page)
    if ((await page.locator('.annotation-tools').count()) === 0) {
      await page.getByRole('button', { name: '打开功能面板' }).click()
    }
    await page.locator('.annotation-tools').waitFor({ timeout: 10000 })
    await page.getByLabel('背景色无背景').click({ force: true })
    await page.getByLabel('字体色红色').click({ force: true })
    const frame = page.frames().find((item) => item.url().startsWith('about:srcdoc'))
    assert(frame, 'Reader iframe disappeared after applying a text style.')
    const styleOnlyAnnotation = await waitForAnnotationStyle(frame, selectedText, 'rgb(220, 38, 38)')
    assert(styleOnlyAnnotation, 'Style-only annotation did not render for the selected text.')
    assert(styleOnlyAnnotation.text?.trim().length, 'Live style-only annotation rendered with empty text.')
    assert(styleOnlyAnnotation.backgroundColor === 'rgba(0, 0, 0, 0)', `Style-only annotation unexpectedly has a background: ${styleOnlyAnnotation.backgroundColor}`)
    assert(styleOnlyAnnotation.color === 'rgb(220, 38, 38)', `Unexpected style-only text color: ${styleOnlyAnnotation.color}`)

    const styleOnly = await waitForCondition(
      async () => {
        const rows = await queryHighlightsBySelectedText(client, document.id, selectedText)
        return rows.find(
          (row) =>
            !String(row.note ?? '').trim() &&
            (row.color === null || row.color === 'transparent') &&
            row.text_color === '#DC2626',
        )
      },
      'Style-only highlight was not found in Supabase.',
    )
    touchedHighlightId = styleOnly.id
    assert(styleOnly.document_id === document.id, 'Style-only highlight is attached to the wrong document.')
    assert(styleOnly.selected_text?.trim().length > 0, 'Style-only highlight selected_text is empty.')
    assert(styleOnly.locator?.strategy === 'text-position-v1', 'Style-only highlight locator is missing or invalid.')

    if ((await page.locator('.annotation-tools').count()) === 0) {
      await page.getByRole('button', { name: '打开功能面板' }).click()
    }
    await page.locator('.annotation-tools').waitFor({ timeout: 10000 })
    await page.getByLabel('背景色粉色').click({ force: true })
    await page.getByLabel('字体色蓝色').click({ force: true })
    await page.getByPlaceholder('给这段文字补一条笔记').fill(originalNote)
    await page.getByRole('button', { name: '添加笔记' }).click()
    await page.getByText(originalNote).waitFor({ timeout: 10000 })

    const inserted = await waitForCondition(
      () => queryHighlightByNote(client, originalNote),
      'Saved note was not found in Supabase.',
    )
    assert(inserted.id === styleOnly.id, 'Adding a note should update the existing style row instead of creating a duplicate.')
    assert(inserted.document_id === document.id, 'Saved note is attached to the wrong document.')
    assert(inserted.selected_text?.trim().length > 0, 'Saved note selected_text is empty.')
    assert(inserted.color === '#FBCFE8', `Saved note stored the wrong background color: ${inserted.color}`)
    assert(inserted.text_color === '#2563EB', `Saved note stored the wrong text color: ${inserted.text_color}`)
    assert(inserted.locator?.strategy === 'text-position-v1', 'Saved note locator is missing or invalid.')

    await page.getByRole('button', { name: '笔记', exact: true }).click()
    await page.getByRole('heading', { name: '笔记中心' }).waitFor()
    await page.getByPlaceholder('搜索笔记、来源文档').fill(originalNote)
    await page.getByText(originalNote).waitFor({ timeout: 10000 })

    await page.getByRole('button', { name: '编辑' }).click()
    await page.getByLabel('编辑笔记').fill(editedNote)
    await page.locator('.note-edit-box').getByRole('button', { name: '保存' }).click()
    await page.getByPlaceholder('搜索笔记、来源文档').fill(editedNote)
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
    const reopenedFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'))
    assert(reopenedFrame, 'Reader iframe was not available after returning from notes.')
    const reopenedAnnotationStyle = await waitForAnnotationStyle(reopenedFrame, selectedText, 'rgb(37, 99, 235)')
    assert(reopenedAnnotationStyle, 'Reopened annotation did not render for the selected text.')
    assert(reopenedAnnotationStyle.backgroundColor === 'rgb(251, 207, 232)', 'Saved annotation background did not survive reopening the reader.')
    assert(reopenedAnnotationStyle.color === 'rgb(37, 99, 235)', 'Saved annotation text color did not survive reopening the reader.')

    await page.getByRole('button', { name: '笔记', exact: true }).click()
    await page.getByRole('heading', { name: '笔记中心' }).waitFor()
    await page.getByPlaceholder('搜索笔记、来源文档').fill(editedNote)
    await page.getByText(editedNote).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: '删除' }).click()
    await page.getByText('暂无笔记').waitFor({ timeout: 10000 })

    await waitForCondition(
      async () => !(await queryHighlightByNote(client, editedNote)),
      'Edited note still exists in Supabase after deletion.',
    )
    await page.evaluate((documentId) => {
      window.location.hash = `#/reader/${documentId}`
    }, document.id)
    await page.locator('iframe').waitFor({ state: 'visible', timeout: 20000 })
    const deletedFrame = page.frames().find((item) => item.url().startsWith('about:srcdoc'))
    assert(deletedFrame, 'Reader iframe was not available after deleting the highlight.')
    await page.waitForTimeout(800)
    const annotationCountAfterDelete = await countAnnotationsForText(deletedFrame, selectedText)
    assert(annotationCountAfterDelete === 0, 'Deleted highlight still renders inside the reader iframe.')
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
    if (touchedHighlightId) {
      await client.from('highlights').delete().eq('id', touchedHighlightId)
    }
    await page.close()
    await browser.close()
  }
}

try {
  const client = await createAuthedClient()
  await assertAnnotationSchema(client)
  await cleanupVerificationNotes(client)
  const document = await getLiveDocument(client)
  const result = await runBrowserFlow(client, document)
  await cleanupVerificationNotes(client)
  console.log('Live notes passed: selection styling, note edit/delete, and source jump are working on real Supabase data.')
  console.log(JSON.stringify(result, null, 2))
} finally {
  stopServer()
}
