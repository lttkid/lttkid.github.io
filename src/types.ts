export type SortKey = 'manual' | 'imported_at' | 'source_modified_at'
export type AppView = 'library' | 'generator' | 'reader' | 'notes' | 'stats' | 'personas' | 'deploy' | 'api-config'

export interface AppUser {
  id: string
  email?: string
  displayName?: string
  avatarUrl?: string | null
  avatarColor?: string
}

export interface UserProfile {
  owner_id: string
  display_name: string
  avatar_url: string | null
  avatar_color: string
  updated_at: string
}

export interface UserProfileDraft {
  displayName: string
  avatarColor: string
  avatarFile?: File | null
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
  sort_order: number
  archived: boolean
  favorite: boolean
  summary: string | null
  content_text: string | null
  word_count: number
  indexed_at: string | null
  reading_estimate_minutes: number | null
  last_read_at: string | null
  last_scroll: number
  metadata?: Record<string, unknown>
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

export interface AnnotationLocator {
  strategy: 'text-position-v1'
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

export interface Highlight {
  id: string
  owner_id: string
  document_id: string
  selected_text: string
  note: string | null
  color: string | null
  text_color: string | null
  locator: AnnotationLocator | null
  created_at: string
}

export interface HighlightWithDocument extends Highlight {
  document?: Pick<
    DocumentRecord,
    'id' | 'title' | 'category_id' | 'category' | 'storage_path' | 'archived'
  > | null
}

export type CompanionBodyShape = 'bean' | 'orb' | 'capsule'
export type CompanionEars = 'none' | 'soft' | 'pointed'
export type CompanionTail = 'none' | 'curl' | 'spark'
export type CompanionExpression = 'curious' | 'happy' | 'focused'
export type CompanionMotion = 'still' | 'gentle' | 'lively'
export type CompanionSize = 'small' | 'medium' | 'large'

export interface CompanionVisualConfig {
  version: 1
  bodyShape: CompanionBodyShape
  palette: {
    body: string
    accent: string
    eye: string
    cheek: string
  }
  features: {
    ears: CompanionEars
    antenna: boolean
    tail: CompanionTail
    glasses: boolean
  }
  expression: CompanionExpression
  motion: CompanionMotion
  size: CompanionSize
}

export interface Persona {
  id: string
  owner_id: string
  name: string
  avatar_url: string | null
  tone: string
  system_prompt: string
  default_model: string | null
  visual_config: CompanionVisualConfig
  companion_enabled: boolean
  created_at: string
}

export type PersonaDraft = Pick<
  Persona,
  'name' | 'tone' | 'system_prompt' | 'default_model' | 'visual_config' | 'companion_enabled'
>

export interface AiProfile {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured?: boolean
  baseUrl?: string
  baseUrlHost?: string
  source?: 'server' | 'user'
  userProviderId?: string
  keyHint?: string | null
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
  configurationError?: string | null
}

export type AiModelCapability = 'text' | 'vision' | 'long_context' | 'html'

export interface AiModelOption {
  id: string
  label: string
  ownedBy?: string | null
  capabilities: AiModelCapability[]
  source: 'provider' | 'preset' | 'manual'
  contextWindow?: number | null
  htmlRecommended?: boolean
}

export interface AiProviderTemplate {
  id: string
  label: string
  provider: string
  icon: string
  baseUrl: string
  apiType: 'openai-compatible'
  defaultModel: string
  docsUrl?: string
  keyHint: string
  notes: string
  models: AiModelOption[]
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

export type AiFeatureId = 'summarize' | 'explain' | 'generate_html' | 'image_question' | 'persona_chat'

export type AiFeatureCapability = 'text' | 'vision' | 'html'

export interface AiFeatureDefinition {
  id: AiFeatureId
  label: string
  description: string
  requestType: string
  functionName: string
  requiredCapability: AiFeatureCapability
  status: 'available' | 'not_deployed' | 'not_configured'
}

export interface AiFeatureBinding {
  featureId: AiFeatureId
  profileId: string | null
  updatedAt: string | null
  validationStatus?: 'pass' | 'fail' | 'unknown'
  validatedAt?: string | null
  validatedModel?: string | null
  validationError?: string | null
}

export interface AiStatBucket {
  total: number
  ok: number
  error: number
  lastCalledAt: string | null
  lastUsedModel?: string | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
}

export interface AiBindingValidation {
  featureId: AiFeatureId
  profileId: string | null
  status: 'pass' | 'fail' | 'skipped'
  checkedAt: string
  usedModel: string | null
  latencyMs: number | null
  error: string | null
}

export interface AiFeatureConfigPayload {
  generatedAt: string
  profiles: AiProfile[]
  providerTemplates: AiProviderTemplate[]
  features: AiFeatureDefinition[]
  bindings: AiFeatureBinding[]
  bindingValidation?: AiBindingValidation[]
  stats: {
    total: number
    byFeature: Array<AiStatBucket & { featureId: string }>
    byModel: Array<AiStatBucket & { model: string }>
    byProfile: Array<AiStatBucket & { profileId: string }>
    byStatus: Array<{ status: string; count: number }>
    recentFailures: Array<{
      featureId: string
      requestType: string
      provider: string
      model: string
      usedModel: string | null
      profileId: string | null
      profileSource: string | null
      errorCode: string | null
      errorMessage: string | null
      createdAt: string
    }>
  }
  security: {
    keyStorage: string
    frontendKeyAccess: boolean
    userKeyMode: string
  }
}

export interface AiUserProviderDraft {
  id?: string
  label: string
  provider: string
  baseUrl: string
  model: string
  apiKey?: string
  supportsVision: boolean
  supportsHtmlGeneration: boolean
  enabled: boolean
}

export interface AiModelDiscoveryResult {
  generatedAt: string
  profileId: string | null
  provider: string
  baseUrlHost: string
  models: AiModelOption[]
  cached: boolean
  source: 'provider' | 'cache' | 'template'
  validated: boolean
  error: string | null
  errorCode?: string | null
  suggestion?: string | null
}

export interface AiRequestBreakdown {
  explain: number
  summarize: number
  generateHtml: number
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
  totalDocumentCount: number
  readDocumentCount: number
  completedDocumentCount: number
  favoriteCount: number
  unreadCount: number
  averageProgress: number
  completionRate: number
  readRate: number
  unreadRate: number
  totalWordCount: number
  totalEstimateMinutes: number
  todayReadMinutes: number
  weeklyReadMinutes: number
  dailyAverageMinutes: number
  longestStreakDays: number
  aiRequestCount: number
  categoryMinutes: Array<{ name: string; minutes: number; color: string }>
  dailyMinutes: Array<{ day: string; date: string; minutes: number }>
  progressBuckets: Array<{ label: string; count: number }>
  recentDocuments: Array<{
    id: string
    title: string
    lastReadAt: string
    progress: number
    categoryName: string
    categoryColor: string
    estimateMinutes: number
  }>
  backlogDocuments: Array<{
    id: string
    title: string
    reason: string
    progress: number
    categoryName: string
    categoryColor: string
    estimateMinutes: number
    favorite: boolean
    lastReadAt: string | null
  }>
}

export interface ExplainRequest {
  documentId: string
  selectedText: string
  personaId?: string
  modelId?: string
}

export interface SummaryRequest {
  documentId: string
  personaId?: string
  modelId?: string
}

export interface ExplainResponse {
  answer: string
  model: string
}

export type HtmlGenerationType = 'learning' | 'animation' | 'interactive' | 'game' | 'general'
export type HtmlGenerationMode = 'create' | 'revise'

export interface HtmlGenerationImageInput {
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
}

export interface HtmlGenerationRequest {
  mode: HtmlGenerationMode
  type: HtmlGenerationType
  brief: string
  currentHtml?: string
  revisionInstruction?: string
  image?: HtmlGenerationImageInput
  personaId?: string
  modelId?: string
  audience?: string
  stylePreset?: string
}

export interface HtmlGenerationResponse {
  title: string
  html: string
  summary: string
  type: HtmlGenerationType
  model: string
  profileId?: string
  provider?: string
  source?: 'server' | 'user'
  promptVersion: string
}

export interface GeneratedHtmlSaveDraft {
  title: string
  html: string
  categoryId: string | null
  generationType: HtmlGenerationType
  brief: string
  promptVersion: string
  summary?: string
}

export interface GeneratedHtmlSaveResult {
  document: DocumentRecord
  status: 'saved' | 'duplicate'
  message: string
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
