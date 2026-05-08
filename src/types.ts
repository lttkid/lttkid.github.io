export type SortKey = 'imported_at' | 'source_modified_at'
export type AppView = 'library' | 'reader' | 'notes' | 'stats' | 'personas' | 'deploy'

export interface AppUser {
  id: string
  email?: string
}

export interface Category {
  id: string
  owner_id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface Tag {
  id: string
  owner_id: string
  name: string
  color: string
  created_at: string
}

export interface DocumentRecord {
  id: string
  owner_id: string
  category_id: string | null
  title: string
  storage_path: string
  file_hash: string | null
  source_modified_at: string | null
  imported_at: string
  updated_at: string
  archived: boolean
  favorite: boolean
  summary: string | null
  content_text: string | null
  word_count: number
  indexed_at: string | null
  reading_estimate_minutes: number | null
  last_read_at: string | null
  last_scroll: number
  category?: Category | null
  tags?: Tag[]
}

export interface ReadingSession {
  id: string
  owner_id: string
  document_id: string
  started_at: string
  ended_at: string | null
  duration_seconds: number
  last_scroll: number
}

export interface Highlight {
  id: string
  owner_id: string
  document_id: string
  selected_text: string
  note: string | null
  color: string
  created_at: string
}

export interface HighlightWithDocument extends Highlight {
  document?: Pick<
    DocumentRecord,
    'id' | 'title' | 'category_id' | 'category' | 'storage_path' | 'archived'
  > | null
}

export interface Persona {
  id: string
  owner_id: string
  name: string
  avatar_url: string | null
  tone: string
  system_prompt: string
  default_model: string | null
  created_at: string
}

export interface AiProfile {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured?: boolean
  baseUrlHost?: string
}

export interface AiHealthProfile extends AiProfile {
  configured: boolean
  baseUrlHost: string
  status: 'pass' | 'fail'
  latencyMs: number | null
  checkedAt: string
  error: string | null
}

export interface AiHealthResult {
  generatedAt: string
  profiles: AiHealthProfile[]
}

export interface AiRequestBreakdown {
  explain: number
  summarize: number
  healthCheck: number
  failed: number
}

export interface LibraryPayload {
  documents: DocumentRecord[]
  categories: Category[]
  personas: Persona[]
  aiProfiles: AiProfile[]
  aiRequestBreakdown: AiRequestBreakdown
  stats: StatsSummary
}

export interface StatsSummary {
  totalReadSeconds: number
  favoriteCount: number
  unreadCount: number
  aiRequestCount: number
  categoryMinutes: Array<{ name: string; minutes: number; color: string }>
  dailyMinutes: Array<{ day: string; minutes: number }>
  recentDocuments: Array<{ id: string; title: string; lastReadAt: string }>
}

export interface ExplainRequest {
  documentId: string
  selectedText: string
  personaId?: string
  modelId?: string
}

export interface ExplainResponse {
  answer: string
  model: string
}

export interface DocumentUpdateDraft {
  title?: string
  category_id?: string | null
  favorite?: boolean
  archived?: boolean
}

export interface ClientPreflightCheck {
  id: string
  label: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
}

export interface ClientPreflightResult {
  generatedAt: string
  checks: ClientPreflightCheck[]
}
