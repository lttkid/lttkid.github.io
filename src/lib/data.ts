import {
  demoAiProfiles,
  demoCategories,
  demoDocuments,
  demoHtmlByPath,
  demoPersonas,
  demoSessions,
} from '../demo'
import type {
  AiHealthResult,
  AiProfile,
  AiRequestBreakdown,
  AppUser,
  Category,
  DocumentUpdateDraft,
  DocumentRecord,
  ExplainRequest,
  ExplainResponse,
  Highlight,
  HighlightWithDocument,
  LibraryPayload,
  Persona,
  ReadingSession,
  StatsSummary,
  ClientPreflightResult,
} from '../types'
import { estimateReadMinutesFromHtml, extractPlainTextFromHtml, extractTitleFromHtml } from './html'
import { isDemoMode, isSupabaseConfigured, maskSupabaseUrl, supabase } from './supabase'

const HTML_BUCKET = 'html-docs'
const MAX_INDEX_CHARS = 200000

export type HtmlUploadStatus = 'uploaded' | 'duplicate' | 'failed'

export interface HtmlUploadResult {
  fileName: string
  status: HtmlUploadStatus
  message: string
  title?: string
  storagePath?: string
  document?: DocumentRecord
}

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase 尚未配置。请设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。')
  }
  return supabase
}

function normalizeDocument(row: Record<string, unknown>): DocumentRecord {
  const relationCategory = row.categories as DocumentRecord['category']
  return {
    ...(row as unknown as DocumentRecord),
    category: relationCategory ?? (row.category as DocumentRecord['category']) ?? null,
    tags: [],
    content_text: (row.content_text as string | null | undefined) ?? null,
    word_count: Number(row.word_count ?? 0),
    indexed_at: (row.indexed_at as string | null | undefined) ?? null,
    last_scroll: Number(row.last_scroll ?? 0),
  }
}

function countIndexedWords(text: string) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return chineseChars + latinWords
}

function stripHtmlExtension(fileName: string) {
  return fileName.replace(/\.(html?|HTML?)$/, '').trim() || 'untitled'
}

function slugify(value: string) {
  const ascii = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || 'document'
}

async function hashBuffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function cloneDemoPayload(): LibraryPayload {
  const documents = demoDocuments.map((document) => ({ ...document }))
  const categories = demoCategories.map((category) => ({ ...category }))
  const personas = demoPersonas.map((persona) => ({ ...persona }))
  return {
    documents,
    categories,
    personas,
    aiProfiles: demoAiProfiles,
    aiRequestBreakdown: {
      explain: 1,
      summarize: 1,
      healthCheck: 1,
      failed: 0,
    },
    stats: buildStats(documents, demoSessions, 3),
  }
}

function readDemoHighlights(documentId: string): Highlight[] {
  const key = `html-vault-demo-highlights:${documentId}`
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Highlight[]) : []
  } catch {
    return []
  }
}

function writeDemoHighlights(documentId: string, highlights: Highlight[]) {
  const key = `html-vault-demo-highlights:${documentId}`
  window.localStorage.setItem(key, JSON.stringify(highlights))
}

function readAllDemoHighlights(): HighlightWithDocument[] {
  return demoDocuments.flatMap((document) =>
    readDemoHighlights(document.id).map((highlight) => ({
      ...highlight,
      document: {
        id: document.id,
        title: document.title,
        category_id: document.category_id,
        category: document.category,
        storage_path: document.storage_path,
        archived: document.archived,
      },
    })),
  )
}

export function buildStats(
  documents: DocumentRecord[],
  sessions: ReadingSession[],
  aiRequestCount: number,
): StatsSummary {
  const documentById = new Map(documents.map((document) => [document.id, document]))
  const totalReadSeconds = sessions.reduce((sum, session) => sum + session.duration_seconds, 0)
  const favoriteCount = documents.filter((document) => document.favorite).length
  const unreadCount = documents.filter((document) => !document.last_read_at).length
  const categoryTotals = new Map<string, { minutes: number; color: string }>()

  for (const session of sessions) {
    const document = documentById.get(session.document_id)
    const categoryName = document?.category?.name ?? '未分类'
    const color = document?.category?.color ?? '#64748B'
    const current = categoryTotals.get(categoryName) ?? { minutes: 0, color }
    current.minutes += Math.round(session.duration_seconds / 60)
    categoryTotals.set(categoryName, current)
  }

  const today = new Date()
  const dailyMinutes = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    const key = date.toISOString().slice(0, 10)
    const minutes = sessions
      .filter((session) => session.started_at.slice(0, 10) === key)
      .reduce((sum, session) => sum + Math.round(session.duration_seconds / 60), 0)
    return {
      day: new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date),
      minutes,
    }
  })

  const recentDocuments = documents
    .filter((document) => document.last_read_at)
    .sort((a, b) => Date.parse(b.last_read_at ?? '') - Date.parse(a.last_read_at ?? ''))
    .slice(0, 5)
    .map((document) => ({
      id: document.id,
      title: document.title,
      lastReadAt: document.last_read_at!,
    }))

  return {
    totalReadSeconds,
    favoriteCount,
    unreadCount,
    aiRequestCount,
    categoryMinutes: Array.from(categoryTotals.entries()).map(([name, value]) => ({
      name,
      minutes: value.minutes,
      color: value.color,
    })),
    dailyMinutes,
    recentDocuments,
  }
}

export async function loadLibrary(): Promise<LibraryPayload> {
  if (isDemoMode) {
    return cloneDemoPayload()
  }

  const client = requireSupabase()
  const [documentsResult, categoriesResult, personasResult, sessionsResult, aiRequestsResult, aiCountResult, profiles] =
    await Promise.all([
      client
        .from('documents')
        .select('*, categories(id, owner_id, name, color, sort_order, created_at)')
        .eq('archived', false)
        .order('imported_at', { ascending: false }),
      client.from('categories').select('*').order('sort_order', { ascending: true }),
      client.from('personas').select('*').order('created_at', { ascending: false }),
      client.from('reading_sessions').select('*').order('started_at', { ascending: false }).limit(300),
      client.from('ai_requests').select('request_type,status').order('created_at', { ascending: false }).limit(500),
      client.from('ai_requests').select('id', { count: 'exact', head: true }),
      fetchAiProfiles(),
    ])

  if (documentsResult.error) throw documentsResult.error
  if (categoriesResult.error) throw categoriesResult.error
  if (personasResult.error) throw personasResult.error
  if (sessionsResult.error) throw sessionsResult.error
  if (aiRequestsResult.error) throw aiRequestsResult.error
  if (aiCountResult.error) throw aiCountResult.error

  const documents = (documentsResult.data ?? []).map((row) => normalizeDocument(row))
  const sessions = (sessionsResult.data ?? []) as ReadingSession[]
  const aiRequestBreakdown = buildAiRequestBreakdown(aiRequestsResult.data ?? [])

  return {
    documents,
    categories: categoriesResult.data ?? [],
    personas: personasResult.data ?? [],
    aiProfiles: profiles,
    aiRequestBreakdown,
    stats: buildStats(documents, sessions, aiCountResult.count ?? 0),
  }
}

function buildAiRequestBreakdown(rows: Array<{ request_type: string | null; status: string | null }>): AiRequestBreakdown {
  return rows.reduce<AiRequestBreakdown>(
    (breakdown, row) => {
      if (row.request_type === 'explain') breakdown.explain += 1
      if (row.request_type === 'summarize') breakdown.summarize += 1
      if (row.request_type === 'health_check') breakdown.healthCheck += 1
      if (row.status === 'error') breakdown.failed += 1
      return breakdown
    },
    { explain: 0, summarize: 0, healthCheck: 0, failed: 0 },
  )
}

export async function loadArchivedDocuments(): Promise<DocumentRecord[]> {
  if (isDemoMode) {
    return demoDocuments.filter((document) => document.archived).map((document) => ({ ...document }))
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('documents')
    .select('*, categories(id, owner_id, name, color, sort_order, created_at)')
    .eq('archived', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => normalizeDocument(row))
}

export async function fetchAiProfiles(): Promise<AiProfile[]> {
  if (isDemoMode) {
    return demoAiProfiles
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<{ profiles: AiProfile[] }>('ai-profiles')
  if (error) {
    return [
      {
        id: 'default',
        label: '默认服务端模型',
        provider: 'server',
        model: 'configured-model',
        enabled: true,
      },
    ]
  }
  return data?.profiles?.filter((profile) => profile.enabled) ?? []
}

export async function fetchAiHealth(): Promise<AiHealthResult> {
  if (isDemoMode) {
    const generatedAt = new Date().toISOString()
    return {
      generatedAt,
      profiles: demoAiProfiles.map((profile) => ({
        ...profile,
        configured: true,
        baseUrlHost: 'demo.local',
        status: 'pass',
        latencyMs: 128,
        checkedAt: generatedAt,
        error: null,
      })),
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiHealthResult>('ai-health')
  if (error) throw error
  if (!data) throw new Error('AI 健康检查没有返回内容。')
  return data
}

export async function fetchDocumentHtml(document: DocumentRecord) {
  if (isDemoMode) {
    return demoHtmlByPath[document.storage_path] ?? '<main><h1>Demo HTML</h1></main>'
  }

  const client = requireSupabase()
  const { data, error } = await client.storage.from(HTML_BUCKET).download(document.storage_path)
  if (error) throw error
  return data.text()
}

async function uploadSingleHtmlFile(user: AppUser, file: File, categoryId: string | null): Promise<HtmlUploadResult> {
  try {
    if (!/\.(html?|HTML?)$/.test(file.name)) {
      return {
        fileName: file.name,
        status: 'failed',
        message: '上传失败：只支持 .html 或 .htm 文件。',
      }
    }

    const buffer = await file.arrayBuffer()
    const html = new TextDecoder().decode(buffer)
    const hash = await hashBuffer(buffer)
    const fallbackTitle = stripHtmlExtension(file.name)
    const title = extractTitleFromHtml(html, fallbackTitle)
    const indexedText = extractPlainTextFromHtml(html).slice(0, MAX_INDEX_CHARS)
    const wordCount = countIndexedWords(indexedText)
    const now = new Date()
    const importedAt = now.toISOString()
    const year = String(now.getFullYear())
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const storagePath = `${user.id}/uploads/${year}/${month}/${slugify(title)}-${hash.slice(0, 12)}.html`
    const category = categoryId ? demoCategories.find((item) => item.id === categoryId) ?? null : null

    if (isDemoMode) {
      const duplicate = demoDocuments.find((document) => document.file_hash === hash)
      if (duplicate) {
        return {
          fileName: file.name,
          status: 'duplicate',
          title: duplicate.title,
          storagePath: duplicate.storage_path,
          document: duplicate,
          message: '重复文件，已保留现有文档。',
        }
      }

      const document: DocumentRecord = {
        id: crypto.randomUUID(),
        owner_id: user.id,
        category_id: categoryId,
        title,
        storage_path: storagePath,
        file_hash: hash,
        source_modified_at: new Date(file.lastModified || now.getTime()).toISOString(),
        imported_at: importedAt,
        updated_at: importedAt,
        archived: false,
        favorite: false,
        summary: null,
        content_text: indexedText,
        word_count: wordCount,
        indexed_at: importedAt,
        reading_estimate_minutes: estimateReadMinutesFromHtml(html),
        last_read_at: null,
        last_scroll: 0,
        metadata: {
          source: 'browser_upload',
          original_name: file.name,
          size: file.size,
        },
        category,
        tags: [],
      }
      demoDocuments.unshift(document)
      demoHtmlByPath[storagePath] = html
      return {
        fileName: file.name,
        status: 'uploaded',
        title,
        storagePath,
        document,
        message: '已写入资料库，正文搜索已可用。',
      }
    }

    const client = requireSupabase()
    const { data: existing, error: duplicateError } = await client
      .from('documents')
      .select('*, categories(id, owner_id, name, color, sort_order, created_at)')
      .eq('file_hash', hash)
      .limit(1)
      .maybeSingle()
    if (duplicateError) throw duplicateError
    if (existing) {
      const document = normalizeDocument(existing)
      return {
        fileName: file.name,
        status: 'duplicate',
        title: document.title,
        storagePath: document.storage_path,
        document,
        message: '重复文件，已保留现有文档。',
      }
    }

    const { error: uploadError } = await client.storage.from(HTML_BUCKET).upload(storagePath, new Blob([buffer], { type: 'text/html' }), {
      contentType: 'text/html',
      upsert: false,
    })
    if (uploadError) throw uploadError

    const record = {
      owner_id: user.id,
      category_id: categoryId,
      title,
      storage_path: storagePath,
      file_hash: hash,
      source_modified_at: new Date(file.lastModified || now.getTime()).toISOString(),
      imported_at: importedAt,
      archived: false,
      favorite: false,
      summary: null,
      content_text: indexedText,
      word_count: wordCount,
      indexed_at: importedAt,
      reading_estimate_minutes: estimateReadMinutesFromHtml(html),
      metadata: {
        source: 'browser_upload',
        original_name: file.name,
        size: file.size,
      },
    }

    const { data, error } = await client
      .from('documents')
      .insert(record)
      .select('*, categories(id, owner_id, name, color, sort_order, created_at)')
      .single()
    if (error) throw error

    const document = normalizeDocument(data)
    return {
      fileName: file.name,
      status: 'uploaded',
      title,
      storagePath,
      document,
      message: '已写入资料库，正文搜索已可用。',
    }
  } catch (error) {
    return {
      fileName: file.name,
      status: 'failed',
      message: error instanceof Error ? `上传失败：${error.message}` : '上传失败，可直接重试。',
    }
  }
}

export async function uploadHtmlFiles(user: AppUser, files: File[], categoryId: string | null) {
  const results: HtmlUploadResult[] = []
  for (const file of files) {
    results.push(await uploadSingleHtmlFile(user, file, categoryId))
  }
  return results
}

export async function toggleDocumentFavorite(document: DocumentRecord, favorite: boolean) {
  if (isDemoMode) return

  const client = requireSupabase()
  const { error } = await client.from('documents').update({ favorite }).eq('id', document.id)
  if (error) throw error
}

export async function updateDocumentManagement(document: DocumentRecord, draft: DocumentUpdateDraft) {
  if (isDemoMode) return

  const client = requireSupabase()
  const { error } = await client.from('documents').update(draft).eq('id', document.id)
  if (error) throw error
}

export async function restoreDocument(document: DocumentRecord) {
  await updateDocumentManagement(document, { archived: false })
}

export async function runClientPreflight(user: AppUser | null): Promise<ClientPreflightResult> {
  const checks: ClientPreflightResult['checks'] = [
    {
      id: 'demo-mode',
      label: 'Demo Mode',
      status: isDemoMode ? 'warn' : 'pass',
      detail: isDemoMode ? '当前启用了演示模式，生产环境需要设置 VITE_DEMO_MODE=false。' : '演示模式未启用。',
    },
    {
      id: 'supabase-env',
      label: 'Supabase 前端配置',
      status: isSupabaseConfigured ? 'pass' : 'fail',
      detail: isSupabaseConfigured
        ? `已配置 ${maskSupabaseUrl()}。`
        : '缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。',
    },
    {
      id: 'auth-session',
      label: '登录会话',
      status: user ? 'pass' : 'fail',
      detail: user ? `当前用户 ${user.email ?? user.id} 已登录。` : '当前没有登录用户。',
    },
  ]

  if (isDemoMode) {
    checks.push(
      {
        id: 'storage',
        label: '私密 Storage',
        status: 'warn',
        detail: '演示模式跳过真实 Storage 检查。',
      },
      {
        id: 'edge-functions',
        label: 'AI Edge Functions',
        status: 'warn',
        detail: '演示模式跳过真实 Edge Function 检查。',
      },
    )
    return { generatedAt: new Date().toISOString(), checks }
  }

  if (!supabase || !user) {
    checks.push(
      {
        id: 'storage',
        label: '私密 Storage',
        status: 'fail',
        detail: '需要配置 Supabase 并登录后检查 Storage。',
      },
      {
        id: 'edge-functions',
        label: 'AI Edge Functions',
        status: 'fail',
        detail: '需要配置 Supabase 并登录后检查 Edge Functions。',
      },
    )
    return { generatedAt: new Date().toISOString(), checks }
  }

  const [storageResult, profiles] = await Promise.allSettled([
    supabase.storage.from(HTML_BUCKET).list(user.id, { limit: 1 }),
    fetchAiProfiles(),
  ])

  checks.push(
    {
      id: 'storage',
      label: '私密 Storage',
      status:
        storageResult.status === 'fulfilled' && !storageResult.value.error
          ? 'pass'
          : 'fail',
      detail:
        storageResult.status === 'fulfilled' && !storageResult.value.error
          ? 'html-docs bucket 可访问。'
          : '无法访问 html-docs bucket，请确认 SQL migration 和 RLS 已运行。',
    },
    {
      id: 'edge-functions',
      label: 'AI Edge Functions',
      status: profiles.status === 'fulfilled' && profiles.value.length > 0 ? 'pass' : 'warn',
      detail:
        profiles.status === 'fulfilled' && profiles.value.length > 0
          ? `已读取 ${profiles.value.length} 个模型配置。`
          : '未读取到模型配置，请确认 ai-profiles 已部署并设置 AI secrets。',
    },
    {
      id: 'ai-profile-config',
      label: 'AI 模型配置',
      status:
        profiles.status === 'fulfilled' && profiles.value.some((profile) => profile.configured !== false)
          ? 'pass'
          : 'warn',
      detail:
        profiles.status === 'fulfilled'
          ? `已读取 ${profiles.value.length} 个模型，${profiles.value.filter((profile) => profile.configured !== false).length} 个显示为已配置。`
          : '无法读取 AI 模型配置。',
    },
  )

  return { generatedAt: new Date().toISOString(), checks }
}

export async function createCategory(user: AppUser, draft: Pick<Category, 'name' | 'color'>) {
  const category: Category = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    name: draft.name,
    color: draft.color,
    sort_order: 100,
    created_at: new Date().toISOString(),
  }

  if (isDemoMode) {
    return category
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('categories')
    .insert({
      owner_id: user.id,
      name: draft.name,
      color: draft.color,
      sort_order: 100,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Category
}

export async function startReadingSession(user: AppUser, document: DocumentRecord) {
  if (isDemoMode) {
    return `demo-session-${Date.now()}`
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('reading_sessions')
    .insert({
      owner_id: user.id,
      document_id: document.id,
      started_at: new Date().toISOString(),
      duration_seconds: 0,
      last_scroll: document.last_scroll ?? 0,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateReadingSession(sessionId: string, durationSeconds: number, lastScroll: number) {
  if (isDemoMode) return

  const client = requireSupabase()
  const { error } = await client
    .from('reading_sessions')
    .update({
      duration_seconds: Math.max(0, Math.round(durationSeconds)),
      last_scroll: lastScroll,
      ended_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
  if (error) throw error
}

export async function touchDocumentProgress(document: DocumentRecord, lastScroll: number) {
  if (isDemoMode) return

  const client = requireSupabase()
  const { error } = await client
    .from('documents')
    .update({
      last_read_at: new Date().toISOString(),
      last_scroll: lastScroll,
    })
    .eq('id', document.id)
  if (error) throw error
}

export async function createPersona(
  user: AppUser,
  draft: Pick<Persona, 'name' | 'tone' | 'system_prompt' | 'default_model'>,
) {
  const persona: Persona = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    avatar_url: null,
    created_at: new Date().toISOString(),
    ...draft,
  }

  if (isDemoMode) {
    return persona
  }

  const client = requireSupabase()
  const { data, error } = await client.from('personas').insert(persona).select('*').single()
  if (error) throw error
  return data as Persona
}

export async function fetchHighlights(document: DocumentRecord) {
  if (isDemoMode) {
    return readDemoHighlights(document.id)
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('highlights')
    .select('*')
    .eq('document_id', document.id)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Highlight[]
}

export async function loadHighlightsWithDocuments(): Promise<HighlightWithDocument[]> {
  if (isDemoMode) {
    return readAllDemoHighlights().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('highlights')
    .select(
      '*, documents(id, title, category_id, storage_path, archived, categories(id, owner_id, name, color, sort_order, created_at))',
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data ?? []).map((row) => {
    const documentRow = row.documents as
      | (Record<string, unknown> & { categories?: DocumentRecord['category'] })
      | null
    return {
      ...(row as unknown as Highlight),
      document: documentRow
        ? {
            id: documentRow.id as string,
            title: documentRow.title as string,
            category_id: (documentRow.category_id as string | null) ?? null,
            storage_path: documentRow.storage_path as string,
            archived: Boolean(documentRow.archived),
            category: documentRow.categories ?? null,
          }
        : null,
    }
  })
}

export async function saveHighlight(user: AppUser, document: DocumentRecord, selectedText: string, note = '') {
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    document_id: document.id,
    selected_text: selectedText,
    note,
    color: '#FDE68A',
    created_at: new Date().toISOString(),
  }

  if (isDemoMode) {
    const highlights = [highlight, ...readDemoHighlights(document.id)]
    writeDemoHighlights(document.id, highlights)
    return highlight
  }

  const client = requireSupabase()
  const { data, error } = await client.from('highlights').insert({
    owner_id: user.id,
    document_id: document.id,
    selected_text: selectedText,
    note,
    color: '#FDE68A',
  }).select('*').single()
  if (error) throw error
  return data as Highlight
}

export async function updateHighlightNote(highlightId: string, note: string) {
  if (isDemoMode) {
    for (const document of demoDocuments) {
      const highlights = readDemoHighlights(document.id)
      if (highlights.some((highlight) => highlight.id === highlightId)) {
        writeDemoHighlights(
          document.id,
          highlights.map((highlight) => (highlight.id === highlightId ? { ...highlight, note } : highlight)),
        )
        return
      }
    }
    return
  }

  const client = requireSupabase()
  const { error } = await client.from('highlights').update({ note }).eq('id', highlightId)
  if (error) throw error
}

export async function deleteHighlight(highlightId: string) {
  if (isDemoMode) {
    for (const document of demoDocuments) {
      const highlights = readDemoHighlights(document.id)
      if (highlights.some((highlight) => highlight.id === highlightId)) {
        writeDemoHighlights(
          document.id,
          highlights.filter((highlight) => highlight.id !== highlightId),
        )
        return
      }
    }
    return
  }

  const client = requireSupabase()
  const { error } = await client.from('highlights').delete().eq('id', highlightId)
  if (error) throw error
}

export async function askAiExplain(request: ExplainRequest): Promise<ExplainResponse> {
  if (isDemoMode) {
    return {
      model: 'demo-model',
      answer: `这段内容的核心是在说明“${request.selectedText.slice(0, 34)}”。可以先抓住它的因果关系：它提出一个问题，再说明为什么这样处理会更稳妥。`,
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<ExplainResponse>('ai-explain', {
    body: request,
  })
  if (error) throw error
  if (!data) throw new Error('AI 接口没有返回内容。')
  return data
}

export async function requestDocumentSummary(document: DocumentRecord, modelId?: string) {
  if (isDemoMode) {
    return {
      answer: document.summary ?? '这份文档主要围绕一个主题展开，并包含若干可行动要点。',
      model: 'demo-model',
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<ExplainResponse>('ai-summarize', {
    body: { documentId: document.id, modelId },
  })
  if (error) throw error
  if (!data) throw new Error('AI 摘要接口没有返回内容。')
  return data
}
