import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const values = {}
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/)
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
  }
  return values
}

const env = { ...parseEnvFile(path.join(root, '.env')), ...parseEnvFile(path.join(root, '.env.local')), ...process.env }

function firstValue(...names) {
  for (const name of names) {
    const value = String(env[name] ?? '').trim()
    if (value && !/^(your-|replace-with-|https:\/\/your-project\.supabase\.co$)/i.test(value)) return value
  }
  return ''
}

const supabaseUrl = firstValue('VITE_SUPABASE_URL', 'SUPABASE_URL')
const supabaseAnonKey = firstValue('VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY')
const primaryEmail = firstValue('LIVE_TEST_EMAIL', 'SUPABASE_OWNER_EMAIL', 'TEST_USER_EMAIL', 'E2E_EMAIL')
const primaryPassword = firstValue('LIVE_TEST_PASSWORD', 'SUPABASE_OWNER_PASSWORD', 'TEST_USER_PASSWORD', 'E2E_PASSWORD')
const secondEmail = firstValue('LIVE_SECOND_EMAIL', 'SECOND_TEST_EMAIL')
const secondPassword = firstValue('LIVE_SECOND_PASSWORD', 'SECOND_TEST_PASSWORD')

function assert(value, message) {
  if (!value) throw new Error(message)
}

for (const [name, value] of [
  ['VITE_SUPABASE_URL', supabaseUrl],
  ['VITE_SUPABASE_ANON_KEY', supabaseAnonKey],
  ['LIVE_TEST_EMAIL', primaryEmail],
  ['LIVE_TEST_PASSWORD', primaryPassword],
  ['LIVE_SECOND_EMAIL', secondEmail],
  ['LIVE_SECOND_PASSWORD', secondPassword],
]) {
  if (!value) throw new Error(`Missing ${name}. Multi-user isolation needs two real Supabase Auth users.`)
}

function makeClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

async function signIn(email, password) {
  const client = makeClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  assert(data.user, `Login did not return a user for ${email}.`)
  return { client, user: data.user }
}

const runId = Date.now().toString(36)
const title = `Isolation Smoke ${runId}`
const html = `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`
const hash = createHash('sha256').update(html).digest('hex')

let primary
let secondary
let categoryId = null
let tagId = null
let documentId = null
let highlightId = null
let noteId = null
let aiRequestId = null
let storagePath = null

async function cleanup() {
  if (!primary) return
  if (aiRequestId) await primary.client.from('ai_requests').delete().eq('id', aiRequestId)
  if (noteId) await primary.client.from('notes').delete().eq('id', noteId)
  if (highlightId) await primary.client.from('highlights').delete().eq('id', highlightId)
  if (documentId) await primary.client.from('documents').delete().eq('id', documentId)
  if (tagId) await primary.client.from('tags').delete().eq('id', tagId)
  if (categoryId) await primary.client.from('categories').delete().eq('id', categoryId)
  if (storagePath) await primary.client.storage.from('html-docs').remove([storagePath])
}

async function expectInsertDenied(client, table, payload, message, cleanupInserted) {
  const result = await client.from(table).insert(payload).select('*').single()
  if (result.error) return
  if (cleanupInserted) await cleanupInserted(result.data)
  throw new Error(message)
}

try {
  primary = await signIn(primaryEmail, primaryPassword)
  secondary = await signIn(secondEmail, secondPassword)

  storagePath = `${primary.user.id}/uploads/isolation/${slug(title)}-${hash.slice(0, 12)}.html`
  const upload = await primary.client.storage.from('html-docs').upload(storagePath, new Blob([html], { type: 'text/html' }), {
    contentType: 'text/html',
    upsert: false,
  })
  if (upload.error) throw upload.error

  const insertedCategory = await primary.client
    .from('categories')
    .insert({
      owner_id: primary.user.id,
      name: `Isolation ${runId}`,
      color: '#2563EB',
      sort_order: 999,
    })
    .select('id')
    .single()
  if (insertedCategory.error) throw insertedCategory.error
  categoryId = insertedCategory.data.id

  const insertedTag = await primary.client
    .from('tags')
    .insert({
      owner_id: primary.user.id,
      name: `isolation-${runId}`,
      color: '#64748B',
    })
    .select('id')
    .single()
  if (insertedTag.error) throw insertedTag.error
  tagId = insertedTag.data.id

  const insertedDocument = await primary.client
    .from('documents')
    .insert({
      owner_id: primary.user.id,
      category_id: categoryId,
      title,
      storage_path: storagePath,
      file_hash: hash,
      content_text: title,
      word_count: title.split(/\s+/).length,
      indexed_at: new Date().toISOString(),
      reading_estimate_minutes: 1,
      metadata: { source: 'isolation_test' },
    })
    .select('id')
    .single()
  if (insertedDocument.error) throw insertedDocument.error
  documentId = insertedDocument.data.id

  const insertedHighlight = await primary.client
    .from('highlights')
    .insert({
      owner_id: primary.user.id,
      document_id: documentId,
      selected_text: title,
      note: 'isolation note',
    })
    .select('id')
    .single()
  if (insertedHighlight.error) throw insertedHighlight.error
  highlightId = insertedHighlight.data.id

  const insertedNote = await primary.client
    .from('notes')
    .insert({
      owner_id: primary.user.id,
      document_id: documentId,
      body: 'isolation note body',
    })
    .select('id')
    .single()
  if (insertedNote.error) throw insertedNote.error
  noteId = insertedNote.data.id

  const insertedAiRequest = await primary.client
    .from('ai_requests')
    .insert({
      owner_id: primary.user.id,
      document_id: documentId,
      request_type: 'isolation_test',
      provider: 'test',
      model: 'test',
      status: 'ok',
    })
    .select('id')
    .single()
  if (insertedAiRequest.error) throw insertedAiRequest.error
  aiRequestId = insertedAiRequest.data.id

  const secondaryDocument = await secondary.client.from('documents').select('id').eq('id', documentId)
  if (secondaryDocument.error) throw secondaryDocument.error
  assert((secondaryDocument.data ?? []).length === 0, 'Second user can read the primary user document.')

  const secondaryHighlight = await secondary.client.from('highlights').select('id').eq('id', highlightId)
  if (secondaryHighlight.error) throw secondaryHighlight.error
  assert((secondaryHighlight.data ?? []).length === 0, 'Second user can read the primary user highlight.')

  const secondaryNote = await secondary.client.from('notes').select('id').eq('id', noteId)
  if (secondaryNote.error) throw secondaryNote.error
  assert((secondaryNote.data ?? []).length === 0, 'Second user can read the primary user note.')

  const secondaryAiRequest = await secondary.client.from('ai_requests').select('id').eq('id', aiRequestId)
  if (secondaryAiRequest.error) throw secondaryAiRequest.error
  assert((secondaryAiRequest.data ?? []).length === 0, 'Second user can read the primary user AI request.')

  await expectInsertDenied(
    secondary.client,
    'documents',
    {
      owner_id: secondary.user.id,
      category_id: categoryId,
      title: `Cross category ${runId}`,
      storage_path: `${secondary.user.id}/cross-category-${runId}.html`,
      metadata: { source: 'isolation_cross_category_test' },
    },
    'Second user can create a document under the primary user category.',
    async (row) => {
      await secondary.client.from('documents').delete().eq('id', row.id)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'document_tags',
    {
      owner_id: secondary.user.id,
      document_id: documentId,
      tag_id: tagId,
    },
    'Second user can attach a primary user document/tag to their own document_tags row.',
    async () => {
      await secondary.client.from('document_tags').delete().eq('document_id', documentId).eq('tag_id', tagId)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'reading_sessions',
    {
      owner_id: secondary.user.id,
      document_id: documentId,
      duration_seconds: 1,
      last_scroll: 0,
    },
    'Second user can create a reading session for the primary user document.',
    async (row) => {
      await secondary.client.from('reading_sessions').delete().eq('id', row.id)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'highlights',
    {
      owner_id: secondary.user.id,
      document_id: documentId,
      selected_text: 'cross-user highlight',
    },
    'Second user can create a highlight for the primary user document.',
    async (row) => {
      await secondary.client.from('highlights').delete().eq('id', row.id)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'notes',
    {
      owner_id: secondary.user.id,
      document_id: documentId,
      body: 'cross-user note',
    },
    'Second user can create a note for the primary user document.',
    async (row) => {
      await secondary.client.from('notes').delete().eq('id', row.id)
    },
  )

  await expectInsertDenied(
    secondary.client,
    'ai_requests',
    {
      owner_id: secondary.user.id,
      document_id: documentId,
      request_type: 'isolation_cross_user',
      provider: 'test',
      model: 'test',
      status: 'ok',
    },
    'Second user can create an AI request for the primary user document.',
    async (row) => {
      await secondary.client.from('ai_requests').delete().eq('id', row.id)
    },
  )

  const secondaryDownload = await secondary.client.storage.from('html-docs').download(storagePath)
  assert(secondaryDownload.error, 'Second user can download the primary user Storage object.')

  const wrongUpload = await secondary.client.storage.from('html-docs').upload(storagePath, new Blob([html], { type: 'text/html' }), {
    contentType: 'text/html',
    upsert: true,
  })
  assert(wrongUpload.error, 'Second user can upload into the primary user Storage path.')

  console.log(
    JSON.stringify(
      {
        isolated: true,
        primaryUser: primary.user.id,
        secondaryUser: secondary.user.id,
        documentHiddenFromSecondUser: true,
        storageDownloadDenied: true,
        highlightsHidden: true,
        notesHidden: true,
        aiRequestsHidden: true,
        crossDocumentWritesDenied: true,
      },
      null,
      2,
    ),
  )
} finally {
  await cleanup()
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
