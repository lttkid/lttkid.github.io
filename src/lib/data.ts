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
  AiFeatureBinding,
  AiFeatureConfigPayload,
  AiFeatureDefinition,
  AiModelDiscoveryResult,
  AiModelOption,
  AiProfile,
  AiProviderTemplate,
  AiRequestBreakdown,
  AiUserProviderDraft,
  AppUser,
  AnnotationLocator,
  Category,
  DocumentUpdateDraft,
  DocumentRecord,
  ExplainRequest,
  ExplainResponse,
  Highlight,
  HighlightWithDocument,
  LibraryPayload,
  Persona,
  PersonaDraft,
  ReadingSession,
  SummaryRequest,
  StatsSummary,
  ClientPreflightResult,
  UserProfile,
  UserProfileDraft,
  GeneratedHtmlSaveDraft,
  GeneratedHtmlSaveResult,
  HtmlGenerationRequest,
  HtmlGenerationResponse,
  HtmlGenerationType,
} from '../types'
import { normalizePersona } from './companion'
import { estimateReadMinutesFromHtml, extractPlainTextFromHtml, extractTitleFromHtml } from './html'
import { isDemoMode, isSupabaseConfigured, maskSupabaseUrl, supabase } from './supabase'

const HTML_BUCKET = 'html-docs'
const AVATAR_BUCKET = 'user-avatars'
const MAX_INDEX_CHARS = 200000
const DEMO_PERSONAS_KEY = 'html-vault-demo-personas'
const DEMO_USER_PROFILE_KEY = 'html-vault-demo-user-profile'
const DEMO_DOCUMENT_SORT_KEY = 'html-vault-demo-document-sort'
const DEFAULT_AVATAR_COLOR = '#5B7CFF'
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const NO_BACKGROUND_COLOR_VALUE = 'transparent'
const DEMO_AI_BINDINGS_KEY = 'html-vault-demo-ai-feature-bindings'
const DEMO_AI_PROVIDERS_KEY = 'html-vault-demo-ai-user-providers'

const aiProviderTemplates: AiProviderTemplate[] = [
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    provider: 'siliconflow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiType: 'openai-compatible',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    docsUrl: 'https://docs.siliconflow.cn/',
    keyHint: '通常以 sk- 开头',
    notes: '适合 Qwen、DeepSeek、视觉模型等 OpenAI-compatible 模型。',
    models: [
      aiModelOption('Qwen/Qwen2.5-7B-Instruct', ['text', 'html']),
      aiModelOption('Qwen/Qwen2-VL-72B-Instruct', ['text', 'vision', 'html']),
      aiModelOption('deepseek-ai/DeepSeek-V3', ['text', 'long_context', 'html']),
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiType: 'openai-compatible',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://api-docs.deepseek.com/',
    keyHint: 'DeepSeek API Key',
    notes: '适合阅读摘要、划词解释和长文本推理；视觉任务请绑定其他模型。',
    models: [
      aiModelOption('deepseek-chat', ['text', 'long_context', 'html']),
      aiModelOption('deepseek-reasoner', ['text', 'long_context']),
    ],
  },
  {
    id: 'dashscope',
    label: '通义千问 / DashScope',
    provider: 'dashscope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiType: 'openai-compatible',
    defaultModel: 'qwen-plus',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    keyHint: 'DashScope API Key',
    notes: '兼容 OpenAI 接口，视觉任务建议选择 qwen-vl 系列。',
    models: [
      aiModelOption('qwen-plus', ['text', 'long_context', 'html']),
      aiModelOption('qwen-turbo', ['text', 'html']),
      aiModelOption('qwen-vl-plus', ['text', 'vision', 'html']),
    ],
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    provider: 'mimo',
    baseUrl: '',
    apiType: 'openai-compatible',
    defaultModel: 'MiMo-7B-RL',
    docsUrl: 'https://github.com/XiaomiMiMo/MiMo',
    keyHint: '以实际服务商控制台为准',
    notes: '目前先作为模型能力模板，Base URL 需要按实际服务商填写。',
    models: [aiModelOption('MiMo-7B-RL', ['text'])],
  },
  {
    id: 'custom-openai',
    label: 'OpenAI-compatible 自定义',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'openai-compatible',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/docs',
    keyHint: '服务商 API Key',
    notes: '适合任何兼容 /chat/completions 与 /models 的服务。',
    models: [
      aiModelOption('gpt-4o-mini', ['text', 'vision', 'html']),
      aiModelOption('gpt-4.1-mini', ['text', 'vision', 'long_context', 'html']),
    ],
  },
]

function aiModelOption(id: string, capabilities: AiModelOption['capabilities']): AiModelOption {
  return {
    id,
    label: id,
    source: 'preset',
    capabilities,
    htmlRecommended: capabilities.includes('html'),
  }
}
const AVATAR_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

const aiFeatureDefinitions: AiFeatureDefinition[] = [
  {
    id: 'summarize',
    label: '阅读摘要',
    description: '为整篇 HTML 生成摘要和关键词。',
    requestType: 'summarize',
    functionName: 'ai-summarize',
    requiredCapability: 'text',
    status: 'available',
  },
  {
    id: 'explain',
    label: '划词解释',
    description: '解释阅读器中选中的文本片段。',
    requestType: 'explain',
    functionName: 'ai-explain',
    requiredCapability: 'text',
    status: 'available',
  },
  {
    id: 'generate_html',
    label: 'AI HTML 生成',
    description: '根据文字需求生成或改写单文件 HTML。',
    requestType: 'generate_html',
    functionName: 'ai-generate-html',
    requiredCapability: 'html',
    status: 'available',
  },
  {
    id: 'image_question',
    label: '图片识题',
    description: '使用支持视觉输入的模型识别题目图片并生成讲解 HTML。',
    requestType: 'generate_html',
    functionName: 'ai-generate-html',
    requiredCapability: 'vision',
    status: 'available',
  },
  {
    id: 'persona_chat',
    label: '虚拟人物对话',
    description: '为后续人物对话功能预留默认模型。',
    requestType: 'persona_chat',
    functionName: 'ai-persona-chat',
    requiredCapability: 'text',
    status: 'not_deployed',
  },
]

export type HtmlUploadStatus = 'uploaded' | 'duplicate' | 'failed'

export interface HtmlUploadResult {
  fileName: string
  status: HtmlUploadStatus
  message: string
  title?: string
  storagePath?: string
  document?: DocumentRecord
}

export interface HighlightDraft {
  note?: string
  color?: string | null
  textColor?: string | null
  locator?: AnnotationLocator | null
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
    sort_order: Number(row.sort_order ?? 2147000000),
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
  applyDemoDocumentSortOrder()
  const documents = demoDocuments.map((document) => ({ ...document }))
  const categories = demoCategories.map((category) => ({ ...category }))
  const personas = readDemoPersonas()
  return {
    documents,
    categories,
    personas,
    aiProfiles: demoAllAiProfiles(),
    aiRequestBreakdown: {
      explain: 1,
      summarize: 1,
      generateHtml: 0,
      healthCheck: 1,
      failed: 0,
    },
    stats: buildStats(documents, demoSessions, 3),
  }
}

function readDemoDocumentSortOrder() {
  try {
    const raw = window.localStorage.getItem(DEMO_DOCUMENT_SORT_KEY)
    return raw ? (JSON.parse(raw) as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function writeDemoDocumentSortOrder() {
  const payload = Object.fromEntries(demoDocuments.map((document) => [document.id, document.sort_order]))
  window.localStorage.setItem(DEMO_DOCUMENT_SORT_KEY, JSON.stringify(payload))
}

function applyDemoDocumentSortOrder() {
  const sortOrder = readDemoDocumentSortOrder()
  for (const document of demoDocuments) {
    if (typeof sortOrder[document.id] === 'number') document.sort_order = sortOrder[document.id]
  }
}

function readDemoAiBindings(): AiFeatureBinding[] {
  const fallback = aiFeatureDefinitions.map((feature, index) => ({
    featureId: feature.id,
    profileId: demoAiProfiles[Math.min(index, demoAiProfiles.length - 1)]?.id ?? null,
    updatedAt: null,
  }))
  try {
    const stored = localStorage.getItem(DEMO_AI_BINDINGS_KEY)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as AiFeatureBinding[]
    return fallback.map((binding) => parsed.find((item) => item.featureId === binding.featureId) ?? binding)
  } catch {
    return fallback
  }
}

function writeDemoAiBindings(bindings: AiFeatureBinding[]) {
  localStorage.setItem(DEMO_AI_BINDINGS_KEY, JSON.stringify(bindings))
}

function readDemoUserProviders(): AiProfile[] {
  try {
    const stored = localStorage.getItem(DEMO_AI_PROVIDERS_KEY)
    if (!stored) return []
    return (JSON.parse(stored) as AiProfile[]).filter((profile) => profile.source === 'user')
  } catch {
    return []
  }
}

function writeDemoUserProviders(profiles: AiProfile[]) {
  localStorage.setItem(DEMO_AI_PROVIDERS_KEY, JSON.stringify(profiles))
}

function demoAllAiProfiles() {
  return [...readDemoUserProviders(), ...demoAiProfiles]
}

function readDemoPersonas(): Persona[] {
  try {
    const raw = window.localStorage.getItem(DEMO_PERSONAS_KEY)
    const source = raw ? (JSON.parse(raw) as unknown[]) : demoPersonas
    return source.map((persona) => normalizePersona(persona as Record<string, unknown>))
  } catch {
    return demoPersonas.map((persona) => normalizePersona(persona as unknown as Record<string, unknown>))
  }
}

function writeDemoPersonas(personas: Persona[]) {
  window.localStorage.setItem(DEMO_PERSONAS_KEY, JSON.stringify(personas))
}

function normalizeAvatarColor(color: string | null | undefined) {
  const value = String(color ?? '').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : DEFAULT_AVATAR_COLOR
}

function defaultDisplayName(email?: string) {
  const trimmed = String(email ?? '').trim()
  if (!trimmed) return 'HTML Reader'
  return trimmed.split('@')[0] || trimmed
}

function normalizeUserProfile(row: Record<string, unknown>, email?: string): UserProfile {
  return {
    owner_id: String(row.owner_id ?? ''),
    display_name: String(row.display_name ?? defaultDisplayName(email)),
    avatar_url: (row.avatar_url as string | null | undefined) ?? null,
    avatar_color: normalizeAvatarColor(row.avatar_color as string | null | undefined),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  }
}

function applyProfileToUser(user: AppUser, profile: UserProfile): AppUser {
  return {
    ...user,
    displayName: profile.display_name || defaultDisplayName(user.email),
    avatarUrl: profile.avatar_url,
    avatarColor: profile.avatar_color,
  }
}

function readDemoUserProfile(user: AppUser): UserProfile {
  try {
    const raw = window.localStorage.getItem(DEMO_USER_PROFILE_KEY)
    if (raw) {
      return normalizeUserProfile(JSON.parse(raw) as Record<string, unknown>, user.email)
    }
  } catch {
    // Ignore corrupt local demo state and fall back to a fresh profile.
  }

  return {
    owner_id: user.id,
    display_name: defaultDisplayName(user.email),
    avatar_url: null,
    avatar_color: DEFAULT_AVATAR_COLOR,
    updated_at: new Date().toISOString(),
  }
}

function writeDemoUserProfile(profile: UserProfile) {
  window.localStorage.setItem(DEMO_USER_PROFILE_KEY, JSON.stringify(profile))
}

function avatarExtensionFor(file: File) {
  return AVATAR_MIME_EXTENSIONS[file.type] ?? ''
}

function validateAvatarFile(file: File) {
  const extension = avatarExtensionFor(file)
  if (!extension) {
    throw new Error('头像只支持 PNG、JPG、WEBP 或 GIF 图片。')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('头像图片不能超过 2MB。')
  }
  return extension
}

function normalizeHighlight(row: Record<string, unknown>): Highlight {
  return {
    ...(row as unknown as Highlight),
    note: (row.note as string | null | undefined) ?? null,
    color: normalizeHighlightColor(row.color),
    text_color: (row.text_color as string | null | undefined) ?? null,
    locator: (row.locator as AnnotationLocator | null | undefined) ?? null,
  }
}

export function hasHighlightNote(highlight: Pick<Highlight, 'note'>) {
  return Boolean(String(highlight.note ?? '').trim())
}

function isMissingHighlightAnnotationColumn(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return message.includes("'text_color' column") || message.includes("'locator' column")
}

function isHighlightColorNotNullConstraint(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message ?? '') : ''
  return message.includes('null value in column "color"') || (message.includes('color') && message.includes('not-null'))
}

function normalizeHighlightColor(value: unknown) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  if (!color || color.toLowerCase() === NO_BACKGROUND_COLOR_VALUE) return null
  return color
}

function readDemoHighlights(documentId: string): Highlight[] {
  const key = `html-vault-demo-highlights:${documentId}`
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>[]) : []
    return parsed.map((highlight) => normalizeHighlight(highlight))
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
  const totalDocumentCount = documents.length
  const readDocumentCount = documents.filter((document) => document.last_read_at).length
  const completedDocumentCount = documents.filter((document) => document.last_scroll >= 0.9).length
  const favoriteCount = documents.filter((document) => document.favorite).length
  const unreadCount = documents.filter((document) => !document.last_read_at).length
  const totalWordCount = documents.reduce((sum, document) => sum + (document.word_count ?? 0), 0)
  const totalEstimateMinutes = documents.reduce((sum, document) => sum + (document.reading_estimate_minutes ?? 0), 0)
  const averageProgress =
    totalDocumentCount > 0
      ? documents.reduce((sum, document) => sum + Math.min(1, Math.max(0, document.last_scroll ?? 0)), 0) /
        totalDocumentCount
      : 0
  const completionRate = totalDocumentCount > 0 ? completedDocumentCount / totalDocumentCount : 0
  const readRate = totalDocumentCount > 0 ? readDocumentCount / totalDocumentCount : 0
  const unreadRate = totalDocumentCount > 0 ? unreadCount / totalDocumentCount : 0
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
      date: key,
      minutes,
    }
  })
  const todayKey = today.toISOString().slice(0, 10)
  const todayReadMinutes = dailyMinutes.find((item) => item.date === todayKey)?.minutes ?? 0
  const weeklyReadMinutes = dailyMinutes.reduce((sum, item) => sum + item.minutes, 0)
  const dailyAverageMinutes = Math.round(weeklyReadMinutes / 7)
  const readDayKeys = new Set(
    sessions
      .filter((session) => session.duration_seconds > 0)
      .map((session) => session.started_at.slice(0, 10)),
  )
  let longestStreakDays = 0
  let currentStreakDays = 0
  for (const item of dailyMinutes) {
    if (readDayKeys.has(item.date)) {
      currentStreakDays += 1
      longestStreakDays = Math.max(longestStreakDays, currentStreakDays)
    } else {
      currentStreakDays = 0
    }
  }

  const recentDocuments = documents
    .filter((document) => document.last_read_at)
    .sort((a, b) => Date.parse(b.last_read_at ?? '') - Date.parse(a.last_read_at ?? ''))
    .slice(0, 5)
    .map((document) => ({
      id: document.id,
      title: document.title,
      lastReadAt: document.last_read_at!,
      progress: Math.min(1, Math.max(0, document.last_scroll ?? 0)),
      categoryName: document.category?.name ?? '未分类',
      categoryColor: document.category?.color ?? '#64748B',
      estimateMinutes: document.reading_estimate_minutes ?? 1,
    }))

  const progressBuckets = [
    { label: '未开始', count: documents.filter((document) => (document.last_scroll ?? 0) <= 0).length },
    {
      label: '进行中',
      count: documents.filter((document) => (document.last_scroll ?? 0) > 0 && (document.last_scroll ?? 0) < 0.9).length,
    },
    { label: '已完成', count: completedDocumentCount },
  ]

  const backlogDocuments = [...documents]
    .filter((document) => !document.last_read_at || document.last_scroll < 0.9)
    .sort((a, b) => {
      const favoriteDiff = Number(b.favorite) - Number(a.favorite)
      if (favoriteDiff !== 0) return favoriteDiff
      const progressDiff = (a.last_scroll ?? 0) - (b.last_scroll ?? 0)
      if (progressDiff !== 0) return progressDiff
      return Date.parse(a.last_read_at ?? a.imported_at) - Date.parse(b.last_read_at ?? b.imported_at)
    })
    .slice(0, 5)
    .map((document) => {
      const progress = Math.min(1, Math.max(0, document.last_scroll ?? 0))
      return {
        id: document.id,
        title: document.title,
        reason: document.favorite && !document.last_read_at ? '收藏未读' : !document.last_read_at ? '尚未开始' : '继续阅读',
        progress,
        categoryName: document.category?.name ?? '未分类',
        categoryColor: document.category?.color ?? '#64748B',
        estimateMinutes: document.reading_estimate_minutes ?? 1,
        favorite: document.favorite,
        lastReadAt: document.last_read_at,
      }
    })

  return {
    totalReadSeconds,
    totalDocumentCount,
    readDocumentCount,
    completedDocumentCount,
    favoriteCount,
    unreadCount,
    averageProgress,
    completionRate,
    readRate,
    unreadRate,
    totalWordCount,
    totalEstimateMinutes,
    todayReadMinutes,
    weeklyReadMinutes,
    dailyAverageMinutes,
    longestStreakDays,
    aiRequestCount,
    categoryMinutes: Array.from(categoryTotals.entries()).map(([name, value]) => ({
      name,
      minutes: value.minutes,
      color: value.color,
    })),
    dailyMinutes,
    progressBuckets,
    recentDocuments,
    backlogDocuments,
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
        .order('sort_order', { ascending: true })
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
    personas: (personasResult.data ?? []).map((row) => normalizePersona(row)),
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
      if (row.request_type === 'generate_html') breakdown.generateHtml += 1
      if (row.request_type === 'health_check') breakdown.healthCheck += 1
      if (row.status === 'error') breakdown.failed += 1
      return breakdown
    },
    { explain: 0, summarize: 0, generateHtml: 0, healthCheck: 0, failed: 0 },
  )
}

export async function loadUserProfile(user: AppUser): Promise<AppUser> {
  if (isDemoMode) {
    return applyProfileToUser(user, readDemoUserProfile(user))
  }

  const client = requireSupabase()
  const { data: existingProfile, error: selectError } = await client
    .from('user_profiles')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle()
  if (selectError) throw selectError
  if (existingProfile) {
    return applyProfileToUser(user, normalizeUserProfile(existingProfile as Record<string, unknown>, user.email))
  }

  const fallbackProfile = {
    owner_id: user.id,
    display_name: defaultDisplayName(user.email),
    avatar_color: DEFAULT_AVATAR_COLOR,
    avatar_url: null,
  }
  const { data, error } = await client
    .from('user_profiles')
    .insert(fallbackProfile)
    .select('*')
    .single()

  if (error) throw error
  return applyProfileToUser(user, normalizeUserProfile(data as Record<string, unknown>, user.email))
}

export async function uploadUserAvatar(user: AppUser, file: File): Promise<string> {
  const extension = validateAvatarFile(file)

  if (isDemoMode) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('读取头像图片失败。'))
      reader.readAsDataURL(file)
    })
  }

  const client = requireSupabase()
  const path = `${user.id}/avatar.${extension}`
  const { error } = await client.storage.from(AVATAR_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: true,
  })
  if (error) throw error

  const { data, error: signedUrlError } = await client.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365)
  if (signedUrlError) throw signedUrlError
  return data.signedUrl
}

export async function saveUserProfile(user: AppUser, draft: UserProfileDraft): Promise<AppUser> {
  const displayName = draft.displayName.trim() || defaultDisplayName(user.email)
  const avatarColor = normalizeAvatarColor(draft.avatarColor)
  const avatarUrl = draft.avatarFile ? await uploadUserAvatar(user, draft.avatarFile) : (user.avatarUrl ?? null)
  const profile: UserProfile = {
    owner_id: user.id,
    display_name: displayName,
    avatar_url: avatarUrl,
    avatar_color: avatarColor,
    updated_at: new Date().toISOString(),
  }

  if (isDemoMode) {
    writeDemoUserProfile(profile)
    return applyProfileToUser(user, profile)
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('user_profiles')
    .upsert(
      {
        owner_id: user.id,
        display_name: displayName,
        avatar_url: avatarUrl,
        avatar_color: avatarColor,
      },
      { onConflict: 'owner_id' },
    )
    .select('*')
    .single()
  if (error) throw error
  return applyProfileToUser(user, normalizeUserProfile(data as Record<string, unknown>, user.email))
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
    return demoAllAiProfiles()
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
      profiles: demoAllAiProfiles().map((profile) => ({
        ...profile,
        configured: true,
        baseUrlHost: profile.baseUrlHost ?? 'demo.local',
        status: 'pass',
        latencyMs: 128,
        checkedAt: generatedAt,
        error: null,
      })),
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiHealthResult>('ai-health')
  if (error) throw await translateFunctionError(error, 'AI_HEALTH_FAILED')
  if (!data) throw new Error('AI 健康检查没有返回内容。')
  return data
}

export async function fetchAiFeatureConfig(): Promise<AiFeatureConfigPayload> {
  if (isDemoMode) {
    const profiles = demoAllAiProfiles()
    return {
      generatedAt: new Date().toISOString(),
      profiles,
      providerTemplates: aiProviderTemplates,
      features: aiFeatureDefinitions,
      bindings: readDemoAiBindings(),
      stats: {
        total: 5,
        byFeature: [
          { featureId: 'summarize', total: 1, ok: 1, error: 0, lastCalledAt: new Date(Date.now() - 36 * 60 * 1000).toISOString() },
          { featureId: 'explain', total: 2, ok: 2, error: 0, lastCalledAt: new Date(Date.now() - 18 * 60 * 1000).toISOString() },
          { featureId: 'generate_html', total: 1, ok: 1, error: 0, lastCalledAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
          { featureId: 'health_check', total: 1, ok: 1, error: 0, lastCalledAt: new Date().toISOString() },
        ],
        byModel: [
          { model: 'Qwen/Qwen2.5-7B-Instruct', total: 3, ok: 3, error: 0, lastCalledAt: new Date().toISOString() },
          { model: 'deepseek-chat', total: 1, ok: 1, error: 0, lastCalledAt: new Date(Date.now() - 18 * 60 * 1000).toISOString() },
          { model: 'vision-demo-model', total: 1, ok: 1, error: 0, lastCalledAt: new Date(Date.now() - 12 * 60 * 1000).toISOString() },
        ],
        byStatus: [
          { status: 'ok', count: 5 },
          { status: 'error', count: 0 },
        ],
      },
      security: {
        keyStorage: 'Supabase Secrets + encrypted per-user provider keys',
        frontendKeyAccess: false,
        userKeyMode: 'encrypted-server-proxy',
      },
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiFeatureConfigPayload>('ai-feature-config')
  if (error) throw await translateFunctionError(error, 'AI_FEATURE_CONFIG_FAILED')
  if (!data) throw new Error('AI 功能配置接口没有返回内容。')
  return data
}

export async function saveAiFeatureBindings(bindings: AiFeatureBinding[]): Promise<AiFeatureConfigPayload> {
  if (isDemoMode) {
    const saved = bindings.map((binding) => ({
      ...binding,
      updatedAt: new Date().toISOString(),
      validationStatus: binding.profileId ? 'pass' as const : 'unknown' as const,
      validatedAt: binding.profileId ? new Date().toISOString() : null,
      validatedModel: demoAllAiProfiles().find((profile) => profile.id === binding.profileId)?.model ?? null,
      validationError: null,
    }))
    writeDemoAiBindings(saved)
    return fetchAiFeatureConfig()
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiFeatureConfigPayload>('ai-feature-config', {
    body: {
      bindings: bindings.map((binding) => ({
        featureId: binding.featureId,
        profileId: binding.profileId,
      })),
    },
  })
  if (error) throw await translateFunctionError(error, 'AI_BINDING_SAVE_FAILED')
  if (!data) throw new Error('AI 功能配置保存后没有返回内容。')
  return data
}

export async function fetchAiModelOptions(input: {
  profileId?: string
  providerDraft?: AiUserProviderDraft
  force?: boolean
}): Promise<AiModelDiscoveryResult> {
  if (isDemoMode) {
    const template = aiProviderTemplates.find((item) => (
      item.provider === input.providerDraft?.provider || item.id === input.providerDraft?.provider
    )) ?? aiProviderTemplates[0]
    return {
      generatedAt: new Date().toISOString(),
      profileId: input.profileId ?? null,
      provider: input.providerDraft?.provider ?? template.provider,
      baseUrlHost: safeHost(input.providerDraft?.baseUrl ?? template.baseUrl),
      models: template.models,
      cached: !input.force,
      error: null,
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiModelDiscoveryResult>('ai-feature-config', {
    body: {
      action: 'list_models',
      profileId: input.profileId,
      providerDraft: input.providerDraft,
      force: input.force,
    },
  })
  if (error) throw await translateFunctionError(error, 'MODEL_DISCOVERY_FAILED')
  if (!data) throw new Error('模型列表接口没有返回内容。')
  return data
}

export async function saveAiUserProvider(draft: AiUserProviderDraft): Promise<AiFeatureConfigPayload> {
  if (isDemoMode) {
    const profiles = readDemoUserProviders()
    const id = draft.id?.replace(/^user:/, '') || crypto.randomUUID()
    const profile: AiProfile = {
      id: `user:${id}`,
      userProviderId: id,
      source: 'user',
      label: draft.label.trim(),
      provider: draft.provider.trim() || 'openai-compatible',
      model: draft.model.trim(),
      enabled: draft.enabled,
      configured: true,
      baseUrl: draft.baseUrl.trim(),
      baseUrlHost: safeHost(draft.baseUrl),
      keyHint: draft.apiKey ? `${draft.apiKey.slice(0, 3)}...${draft.apiKey.slice(-4)}` : profiles.find((item) => item.id === `user:${id}`)?.keyHint ?? '已保存',
      supportsVision: draft.supportsVision,
      supportsHtmlGeneration: draft.supportsHtmlGeneration,
    }
    writeDemoUserProviders([profile, ...profiles.filter((item) => item.id !== profile.id)])
    return fetchAiFeatureConfig()
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiFeatureConfigPayload>('ai-feature-config', {
    body: {
      action: 'upsert_provider',
      provider: draft,
    },
  })
  if (error) throw await translateFunctionError(error, 'AI_PROVIDER_SAVE_FAILED')
  if (!data) throw new Error('AI API 配置保存后没有返回内容。')
  return data
}

export async function deleteAiUserProvider(profileId: string): Promise<AiFeatureConfigPayload> {
  if (isDemoMode) {
    writeDemoUserProviders(readDemoUserProviders().filter((profile) => profile.id !== profileId))
    writeDemoAiBindings(readDemoAiBindings().map((binding) => (
      binding.profileId === profileId ? { ...binding, profileId: demoAiProfiles[0]?.id ?? null } : binding
    )))
    return fetchAiFeatureConfig()
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<AiFeatureConfigPayload>('ai-feature-config', {
    body: {
      action: 'delete_provider',
      providerId: profileId,
    },
  })
  if (error) throw await translateFunctionError(error, 'AI_PROVIDER_DELETE_FAILED')
  if (!data) throw new Error('AI API 配置删除后没有返回内容。')
  return data
}

function safeHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return 'invalid-url'
  }
}

type AiFunctionErrorBody = {
  error?: string
  code?: string
  suggestion?: string
}

async function translateFunctionError(error: unknown, fallbackCode: string) {
  const rawMessage = error instanceof Error ? error.message : String(error)
  const context = (error as { context?: unknown })?.context
  let body: AiFunctionErrorBody | null = null

  if (context instanceof Response) {
    const text = await context.clone().text().catch(() => '')
    if (text) {
      try {
        body = JSON.parse(text) as AiFunctionErrorBody
      } catch {
        body = { error: text }
      }
    }
  }

  const code = body?.code ?? inferClientAiErrorCode(rawMessage, fallbackCode)
  const message = body?.error ?? rawMessage
  const suggestion = body?.suggestion ?? aiClientSuggestion(code)
  return new Error(`[${code}] ${message}\n建议：${suggestion}`)
}

function inferClientAiErrorCode(message: string, fallbackCode: string) {
  const lower = message.toLowerCase()
  if (lower.includes('failed to send a request') || lower.includes('not_found') || lower.includes('404')) return 'FUNCTION_NOT_DEPLOYED'
  if (lower.includes('timeout') || lower.includes('abort')) return 'MODEL_TIMEOUT'
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized')) return 'PROVIDER_AUTH_FAILED'
  if (lower.includes('markdown fences') || lower.includes('<!doctype html>') || lower.includes('output')) return 'MODEL_OUTPUT_INVALID'
  return fallbackCode
}

function aiClientSuggestion(code: string) {
  const suggestions: Record<string, string> = {
    FUNCTION_NOT_DEPLOYED: '请确认 Supabase Edge Function 已部署，尤其是 ai-feature-config 和 ai-generate-html。',
    MODEL_TIMEOUT: '模型响应超时。可以换更快模型、缩短需求，或稍后重试。',
    PROVIDER_AUTH_FAILED: '请检查 Provider API Key、额度和 Base URL，并重新保存配置。',
    MODEL_OUTPUT_INVALID: '模型输出不是合规单文件 HTML。建议换更强的 HTML 模型或简化生成需求。',
    MODEL_DISCOVERY_FAILED: '无法自动拉取模型列表，可先使用模板推荐模型或手动填写。',
    AI_BINDING_SAVE_FAILED: '功能绑定没有保存成功，请刷新配置中心后重试。',
    AI_PROVIDER_SAVE_FAILED: 'API 平台没有保存成功，请检查 Base URL、模型名和 Key。',
    AI_PROVIDER_DELETE_FAILED: 'API 平台没有删除成功，请刷新后重试。',
    AI_FEATURE_CONFIG_FAILED: '请确认 ai-feature-config 已部署并且 migrations 已应用。',
    AI_HEALTH_FAILED: '请确认 ai-health 已部署，并检查 Supabase 登录态。',
  }
  return suggestions[code] ?? '请查看部署中心 AI 健康检查与 ai_requests 日志定位原因。'
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

const generationTypeLabels: Record<HtmlGenerationType, string> = {
  learning: '学习讲解',
  animation: '概念动画',
  interactive: '互动理解',
  game: 'HTML 小游戏',
  general: '通用页面',
}

function compactTitle(value: string, fallback: string) {
  return (
    value
      .replace(/\s+/g, ' ')
      .replace(/[<>:"/\\|?*]+/g, '')
      .trim()
      .slice(0, 42) || fallback
  )
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function buildDemoGeneratedHtml(request: HtmlGenerationRequest) {
  const label = generationTypeLabels[request.type]
  const topic = compactTitle(request.brief, 'AI 生成 HTML')
  const revised = request.mode === 'revise' && request.revisionInstruction?.trim()
  const revisionNote = revised ? `<p class="revision">已按修改要求调整：${escapeHtml(request.revisionInstruction)}</p>` : ''
  const imageNote = request.image
    ? `<section class="image-question-card">
        <h2>图片识题</h2>
        <p>已读取相册图片：${escapeHtml(request.image.name)}。真实模型会先识别图片中的文字、公式、图表和选项，再生成讲解 HTML。</p>
        <img src="data:${request.image.mimeType};base64,${request.image.data}" alt="用户上传的题目图片预览" />
      </section>`
    : ''
  const isGame = request.type === 'game'
  const isInteractive = request.type === 'interactive' || request.type === 'animation' || request.type === 'game'
  const body = isGame
    ? `
      <section class="play-area" aria-label="小游戏区域">
        <div class="score">得分 <strong id="score">0</strong></div>
        <button id="start" type="button">开始 / 重开</button>
        <button id="tap" type="button">点击收集能量</button>
        <p id="state">30 秒内尽量多收集能量，键盘空格也可以操作。</p>
      </section>
      <script>
        const score = document.getElementById('score');
        const state = document.getElementById('state');
        let value = 0;
        const add = () => { value += 1; score.textContent = String(value); state.textContent = value >= 5 ? '做得好，已经掌握节奏。' : '继续收集能量。'; };
        document.getElementById('start').addEventListener('click', () => { value = 0; score.textContent = '0'; state.textContent = '游戏开始。'; });
        document.getElementById('tap').addEventListener('click', add);
        window.addEventListener('keydown', (event) => { if (event.code === 'Space') add(); });
      </script>`
    : `
      <section class="concept-map">
        <div class="node primary">主题</div>
        <div class="node">例子</div>
        <div class="node">图解</div>
        <div class="node">理解线索</div>
      </section>
      <section>
        <h2>为什么这样理解</h2>
        <p>页面会先把概念拆成可观察的部分，再用对比、流程和重点提示帮助用户建立直觉。学习类内容不强制练习题，重点是读得懂、看得清、能复述。</p>
      </section>
      ${isInteractive ? '<button id="replay" type="button">重播演示</button><p id="demo-state">演示已就绪。</p><script>document.getElementById("replay").addEventListener("click",()=>{document.body.classList.remove("run"); void document.body.offsetWidth; document.body.classList.add("run"); document.getElementById("demo-state").textContent="正在重播关键变化。";});</script>' : ''}`

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Demo Mode 生成的${label}页面：${escapeHtml(topic)}" />
    <title>${escapeHtml(label)}：${escapeHtml(topic)}</title>
    <style>
      :root { color: #172033; background: #f5f7fb; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; }
      body { margin: 0; min-height: 100vh; background: linear-gradient(135deg, #f8fbff 0%, #eef6f2 52%, #fff8ed 100%); }
      main { width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 44px 0; }
      header, section, .play-area { border: 1px solid rgba(100,116,139,.22); border-radius: 8px; background: rgba(255,255,255,.84); box-shadow: 0 18px 44px rgba(15,23,42,.08); padding: clamp(20px, 4vw, 36px); margin-bottom: 18px; }
      h1 { margin: 0 0 12px; font-size: clamp(30px, 5vw, 54px); line-height: 1.08; letter-spacing: 0; }
      h2 { margin: 0 0 10px; font-size: 22px; }
      p { max-width: 72ch; line-height: 1.75; color: #475569; }
      .badge { display: inline-flex; gap: 8px; align-items: center; padding: 6px 12px; border-radius: 999px; background: #e8f0ff; color: #2453b8; font-weight: 700; }
      .concept-map { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .node { min-height: 96px; display: grid; place-items: center; border-radius: 8px; background: #fff7e7; border: 1px solid #fed7aa; font-weight: 800; animation: pulse 3s ease-in-out infinite; }
      .node.primary { background: #e8f0ff; border-color: #bfdbfe; color: #1d4ed8; }
      .image-question-card img { display: block; max-width: min(100%, 520px); max-height: 360px; object-fit: contain; border-radius: 8px; border: 1px solid #dbe4f0; background: #f8fafc; }
      .run .node { animation-duration: 900ms; }
      button { min-height: 44px; border: 0; border-radius: 8px; padding: 0 16px; margin: 4px 8px 4px 0; background: #1f6feb; color: white; font-weight: 800; }
      .score { font-size: 22px; margin-bottom: 12px; }
      .revision { color: #9a3412; background: #fffbeb; border-left: 4px solid #f59e0b; padding: 10px 12px; border-radius: 8px; }
      @keyframes pulse { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      @media (max-width: 720px) { main { width: min(100% - 24px, 980px); padding: 24px 0; } .concept-map { grid-template-columns: 1fr 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <span class="badge">${escapeHtml(label)}</span>
        <h1>${escapeHtml(topic)}</h1>
        <p>这是 Demo Mode 的生成结果，用来验证预设 Prompt、预览、对话式修改和保存入库流程。</p>
        <p class="brief">原始需求：${escapeHtml(request.brief)}</p>
        ${revisionNote}
      </header>
      ${imageNote}
      ${body}
    </main>
  </body>
</html>`
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function requestAiHtmlGeneration(request: HtmlGenerationRequest): Promise<HtmlGenerationResponse> {
  if (isDemoMode) {
    const html = buildDemoGeneratedHtml(request)
    const title = extractTitleFromHtml(html, `${generationTypeLabels[request.type]}：${compactTitle(request.brief, 'AI 生成 HTML')}`)
    return {
      title,
      html,
      summary: `Demo 生成的${generationTypeLabels[request.type]}页面，已按统一视觉标准生成。`,
      type: request.type,
      model: 'demo-model',
      promptVersion: 'html-generator-demo-v1',
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<HtmlGenerationResponse>('ai-generate-html', {
    body: request,
  })
  if (error) throw await translateFunctionError(error, 'AI_HTML_GENERATION_FAILED')
  if (!data) throw new Error('AI HTML 生成接口没有返回内容。')
  return data
}

export async function saveGeneratedHtml(user: AppUser, draft: GeneratedHtmlSaveDraft): Promise<GeneratedHtmlSaveResult> {
  const html = draft.html.trim()
  if (!html) throw new Error('生成结果为空，无法保存。')

  const bytes = new TextEncoder().encode(html)
  const buffer = toArrayBuffer(bytes)
  const hash = await hashBuffer(buffer)
  const now = new Date()
  const importedAt = now.toISOString()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const title = compactTitle(draft.title, extractTitleFromHtml(html, 'AI 生成 HTML'))
  const storagePath = `${user.id}/generated/${year}/${month}/${slugify(title)}-${hash.slice(0, 12)}.html`
  const indexedText = extractPlainTextFromHtml(html).slice(0, MAX_INDEX_CHARS)
  const wordCount = countIndexedWords(indexedText)
  const category = draft.categoryId ? demoCategories.find((item) => item.id === draft.categoryId) ?? null : null

  if (isDemoMode) {
    const duplicate = demoDocuments.find((document) => document.file_hash === hash)
    if (duplicate) {
      return {
        document: duplicate,
        status: 'duplicate',
        message: '这份生成结果已在资料库中，已保留现有文档。',
      }
    }

    const document: DocumentRecord = {
      id: crypto.randomUUID(),
      owner_id: user.id,
      category_id: draft.categoryId,
      title,
      storage_path: storagePath,
      file_hash: hash,
      source_modified_at: importedAt,
      imported_at: importedAt,
      updated_at: importedAt,
      sort_order: 0,
      archived: false,
      favorite: false,
      summary: draft.summary ?? null,
      content_text: indexedText,
      word_count: wordCount,
      indexed_at: importedAt,
      reading_estimate_minutes: estimateReadMinutesFromHtml(html),
      last_read_at: null,
      last_scroll: 0,
      metadata: {
        source: 'ai_generated',
        generation_type: draft.generationType,
        prompt_version: draft.promptVersion,
        brief: draft.brief.slice(0, 2000),
        size: bytes.byteLength,
      },
      category,
      tags: [],
    }
    demoDocuments.unshift(document)
    demoHtmlByPath[storagePath] = html
    return {
      document,
      status: 'saved',
      message: '已保存到资料库，正文搜索已可用。',
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
    return {
      document: normalizeDocument(existing),
      status: 'duplicate',
      message: '这份生成结果已在资料库中，已保留现有文档。',
    }
  }

  const { error: uploadError } = await client.storage.from(HTML_BUCKET).upload(storagePath, new Blob([buffer], { type: 'text/html' }), {
    contentType: 'text/html',
    upsert: false,
  })
  if (uploadError) throw uploadError

  const { data, error } = await client
    .from('documents')
    .insert({
      owner_id: user.id,
      category_id: draft.categoryId,
      title,
      storage_path: storagePath,
      file_hash: hash,
      source_modified_at: importedAt,
      imported_at: importedAt,
      sort_order: 0,
      archived: false,
      favorite: false,
      summary: draft.summary ?? null,
      content_text: indexedText,
      word_count: wordCount,
      indexed_at: importedAt,
      reading_estimate_minutes: estimateReadMinutesFromHtml(html),
      metadata: {
        source: 'ai_generated',
        generation_type: draft.generationType,
        prompt_version: draft.promptVersion,
        brief: draft.brief.slice(0, 2000),
        size: bytes.byteLength,
      },
    })
    .select('*, categories(id, owner_id, name, color, sort_order, created_at)')
    .single()
  if (error) throw error

  return {
    document: normalizeDocument(data),
    status: 'saved',
    message: '已保存到资料库，正文搜索已可用。',
  }
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
        sort_order: 0,
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
      sort_order: 0,
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

export async function updateDocumentSortOrder(documents: Array<Pick<DocumentRecord, 'id' | 'sort_order'>>) {
  if (documents.length === 0) return

  if (isDemoMode) {
    for (const update of documents) {
      const document = demoDocuments.find((item) => item.id === update.id)
      if (document) document.sort_order = update.sort_order
    }
    writeDemoDocumentSortOrder()
    return
  }

  const client = requireSupabase()
  const results = await Promise.all(
    documents.map((document) =>
      client
        .from('documents')
        .update({ sort_order: document.sort_order })
        .eq('id', document.id),
    ),
  )
  const failed = results.find((result) => result.error)
  if (failed?.error) throw failed.error
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

  const [storageResult, profiles, featureConfig] = await Promise.allSettled([
    supabase.storage.from(HTML_BUCKET).list(user.id, { limit: 1 }),
    fetchAiProfiles(),
    fetchAiFeatureConfig(),
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
    {
      id: 'ai-feature-config',
      label: 'AI 功能绑定',
      status: featureConfig.status === 'fulfilled' ? 'pass' : 'warn',
      detail:
        featureConfig.status === 'fulfilled'
          ? `配置中心已读取 ${featureConfig.value.features.length} 个 AI 功能绑定项。`
          : '无法读取 AI 功能配置中心，请确认 ai-feature-config 已部署。',
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

export async function createPersona(user: AppUser, draft: PersonaDraft) {
  const persona: Persona = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    avatar_url: null,
    created_at: new Date().toISOString(),
    ...draft,
  }

  if (isDemoMode) {
    writeDemoPersonas([persona, ...readDemoPersonas()])
    return persona
  }

  const client = requireSupabase()
  const { data, error } = await client.from('personas').insert(persona).select('*').single()
  if (error) throw error
  return normalizePersona(data)
}

export async function updatePersona(persona: Persona, draft: PersonaDraft) {
  const updated: Persona = {
    ...persona,
    ...draft,
  }

  if (isDemoMode) {
    writeDemoPersonas(readDemoPersonas().map((item) => (item.id === persona.id ? updated : item)))
    return updated
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('personas')
    .update(draft)
    .eq('id', persona.id)
    .select('*')
    .single()
  if (error) throw error
  return normalizePersona(data)
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
  return (data ?? []).map((row) => normalizeHighlight(row))
}

export async function loadHighlightsWithDocuments(): Promise<HighlightWithDocument[]> {
  if (isDemoMode) {
    return readAllDemoHighlights()
      .filter(hasHighlightNote)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  }

  const client = requireSupabase()
  const { data, error } = await client
    .from('highlights')
    .select(
      '*, documents(id, title, category_id, storage_path, archived, categories(id, owner_id, name, color, sort_order, created_at))',
    )
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data ?? [])
    .map((row) => {
      const documentRow = row.documents as
        | (Record<string, unknown> & { categories?: DocumentRecord['category'] })
        | null
      return {
        ...normalizeHighlight(row),
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
    .filter(hasHighlightNote)
}

export async function saveHighlight(
  user: AppUser,
  document: DocumentRecord,
  selectedText: string,
  draft: HighlightDraft = {},
) {
  const note = String(draft.note ?? '').trim() || null
  const color = draft.color || null
  const textColor = draft.textColor || null
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    owner_id: user.id,
    document_id: document.id,
    selected_text: selectedText,
    note,
    color,
    text_color: textColor,
    locator: draft.locator ?? null,
    created_at: new Date().toISOString(),
  }

  if (isDemoMode) {
    const highlights = [highlight, ...readDemoHighlights(document.id)]
    writeDemoHighlights(document.id, highlights)
    return highlight
  }

  const client = requireSupabase()
  const storedColor = color ?? NO_BACKGROUND_COLOR_VALUE
  const insertPayload = {
    owner_id: user.id,
    document_id: document.id,
    selected_text: selectedText,
    note,
    color: storedColor,
    text_color: textColor,
    locator: draft.locator ?? null,
  }
  const { data, error } = await client.from('highlights').insert(insertPayload).select('*').single()
  if (error && color === null && isHighlightColorNotNullConstraint(error)) {
    const retryPayload = { ...insertPayload, color: NO_BACKGROUND_COLOR_VALUE }
    const { data: retryData, error: retryError } = await client
      .from('highlights')
      .insert(retryPayload)
      .select('*')
      .single()
    if (retryError && isMissingHighlightAnnotationColumn(retryError)) {
      const { data: legacyData, error: legacyError } = await client
        .from('highlights')
        .insert({
          owner_id: retryPayload.owner_id,
          document_id: retryPayload.document_id,
          selected_text: retryPayload.selected_text,
          note: retryPayload.note,
          color: retryPayload.color,
        })
        .select('*')
        .single()
      if (legacyError) throw legacyError
      return normalizeHighlight(legacyData)
    }
    if (retryError) throw retryError
    return normalizeHighlight(retryData)
  }
  if (error && isMissingHighlightAnnotationColumn(error)) {
    const { data: legacyData, error: legacyError } = await client
      .from('highlights')
      .insert({
        owner_id: insertPayload.owner_id,
        document_id: insertPayload.document_id,
        selected_text: insertPayload.selected_text,
        note: insertPayload.note,
        color: insertPayload.color ?? NO_BACKGROUND_COLOR_VALUE,
      })
      .select('*')
      .single()
    if (legacyError) throw legacyError
    return normalizeHighlight(legacyData)
  }
  if (error) throw error
  return normalizeHighlight(data)
}

export async function updateHighlight(highlightId: string, draft: HighlightDraft) {
  const note = draft.note !== undefined ? String(draft.note).trim() || null : undefined
  const color = draft.color !== undefined ? draft.color || null : undefined
  const textColor = draft.textColor !== undefined ? draft.textColor || null : undefined
  const storedColor = color !== undefined ? color ?? NO_BACKGROUND_COLOR_VALUE : undefined
  const patch = {
    ...(note !== undefined ? { note } : {}),
    ...(storedColor !== undefined ? { color: storedColor } : {}),
    ...(textColor !== undefined ? { text_color: textColor } : {}),
    ...(draft.locator !== undefined ? { locator: draft.locator } : {}),
  }

  if (isDemoMode) {
    for (const document of demoDocuments) {
      const highlights = readDemoHighlights(document.id)
      if (highlights.some((highlight) => highlight.id === highlightId)) {
        writeDemoHighlights(
          document.id,
          highlights.map((highlight) =>
            highlight.id === highlightId
              ? {
                  ...highlight,
                  ...(note !== undefined ? { note } : {}),
                  ...(color !== undefined ? { color } : {}),
                  ...(textColor !== undefined ? { text_color: textColor } : {}),
                  ...(draft.locator !== undefined ? { locator: draft.locator } : {}),
                }
              : highlight,
          ),
        )
        return
      }
    }
    return
  }

  const client = requireSupabase()
  const { error } = await client.from('highlights').update(patch).eq('id', highlightId)
  if (error && color === null && isHighlightColorNotNullConstraint(error)) {
    const retryPatch = { ...patch, color: NO_BACKGROUND_COLOR_VALUE }
    const { error: retryError } = await client.from('highlights').update(retryPatch).eq('id', highlightId)
    if (retryError && isMissingHighlightAnnotationColumn(retryError)) {
      const legacyPatch = {
        ...(note !== undefined ? { note } : {}),
        color: NO_BACKGROUND_COLOR_VALUE,
      }
      const { error: legacyError } = await client.from('highlights').update(legacyPatch).eq('id', highlightId)
      if (legacyError) throw legacyError
      return
    }
    if (retryError) throw retryError
    return
  }
  if (error && isMissingHighlightAnnotationColumn(error)) {
    const legacyPatch = {
      ...(note !== undefined ? { note } : {}),
      ...(color !== undefined ? { color: color ?? NO_BACKGROUND_COLOR_VALUE } : {}),
    }
    const { error: legacyError } = await client.from('highlights').update(legacyPatch).eq('id', highlightId)
    if (legacyError) throw legacyError
    return
  }
  if (error) throw error
}

export async function updateHighlightNote(highlightId: string, note: string) {
  return updateHighlight(highlightId, { note })
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

export async function requestDocumentSummary(document: DocumentRecord, request: Omit<SummaryRequest, 'documentId'> = {}) {
  if (isDemoMode) {
    return {
      answer: document.summary ?? '这份文档主要围绕一个主题展开，并包含若干可行动要点。',
      model: 'demo-model',
    }
  }

  const client = requireSupabase()
  const { data, error } = await client.functions.invoke<ExplainResponse>('ai-summarize', {
    body: { documentId: document.id, ...request },
  })
  if (error) throw error
  if (!data) throw new Error('AI 摘要接口没有返回内容。')
  return data
}
