import { AnimatePresence, motion, type Variants } from 'framer-motion'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Folder,
  GripVertical,
  Heart,
  Highlighter,
  ImagePlus,
  Keyboard,
  Library,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  Monitor,
  Moon,
  NotebookPen,
  PaintBucket,
  Palette,
  Pin,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Type,
  UploadCloud,
  UserRoundPlus,
  X,
} from 'lucide-react'
import {
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  askAiExplain,
  createCategory,
  createPersona,
  deleteAiUserProvider,
  fetchAiFeatureConfig,
  fetchAiModelOptions,
  deleteHighlight,
  fetchAiHealth,
  fetchDocumentHtml,
  fetchHighlights,
  hasHighlightNote,
  loadArchivedDocuments,
  loadHighlightsWithDocuments,
  loadLibrary,
  loadUserProfile,
  requestAiHtmlGeneration,
  requestDocumentSummary,
  restoreDocument,
  runClientPreflight,
  saveAiFeatureBindings,
  saveAiUserProvider,
  saveGeneratedHtml,
  saveHighlight,
  saveUserProfile,
  startReadingSession,
  toggleDocumentFavorite,
  touchDocumentProgress,
  updateHighlight,
  updateHighlightNote,
  updateReadingSession,
  updateDocumentManagement,
  updateDocumentSortOrder,
  updatePersona,
  uploadHtmlFiles,
  type HtmlUploadResult,
} from './lib/data'
import { defaultCompanionVisualConfig, normalizeCompanionVisualConfig } from './lib/companion'
import { createReaderSrcDoc, type ReaderRenderMode } from './lib/html'
import { isDemoMode, isSupabaseConfigured, supabase } from './lib/supabase'
import type {
  AiHealthResult,
  AiFeatureBinding,
  AiFeatureConfigPayload,
  AiFeatureId,
  AiModelDiscoveryResult,
  AiModelOption,
  AiProfile,
  AiRequestBreakdown,
  AiUserProviderDraft,
  AnnotationLocator,
  AppUser,
  AppView,
  Category,
  ClientPreflightResult,
  DocumentRecord,
  DocumentUpdateDraft,
  GeneratedHtmlSaveDraft,
  GeneratedHtmlSaveResult,
  HtmlGenerationImageInput,
  HtmlGenerationResponse,
  HtmlGenerationType,
  Highlight,
  HighlightWithDocument,
  LibraryPayload,
  Persona,
  PersonaDraft,
  CompanionVisualConfig,
  SortKey,
  UserProfileDraft,
} from './types'

const StatsCharts = lazy(() => import('./components/StatsCharts'))

const storageKeys = {
  themeMode: 'html-vault-theme-mode',
  pinnedActions: 'html-vault-tab-dock-pins',
  companionEnabled: 'html-vault-companion-enabled',
  companionCollapsed: 'html-vault-companion-collapsed',
  companionPersona: 'html-vault-companion-persona',
  companionSize: 'html-vault-companion-size',
  companionPosition: 'html-vault-companion-position',
} as const

const quickActionEvents = {
  openUpload: 'html-vault-open-upload',
  openCategory: 'html-vault-open-category',
  readerSummary: 'html-vault-reader-summary',
  readerHighlights: 'html-vault-reader-highlights',
} as const

const companionEvents = {
  status: 'html-vault-companion-status',
  personaChange: 'html-vault-companion-persona-change',
} as const

const motionEase: [number, number, number, number] = [0.16, 1, 0.3, 1]

const pageMotion: Variants = {
  hidden: { opacity: 0, y: 14, filter: 'blur(10px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.32, ease: motionEase } },
  exit: { opacity: 0, y: -10, filter: 'blur(10px)', transition: { duration: 0.2, ease: motionEase } },
}

const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.045,
      delayChildren: 0.04,
    },
  },
}

const cardMotion: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: motionEase } },
}

const panelMotion: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: 0.28, ease: motionEase } },
  exit: { opacity: 0, y: 14, scale: 0.985, filter: 'blur(8px)', transition: { duration: 0.18, ease: motionEase } },
}

const commandPanelMotion: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 24, filter: 'blur(14px)' },
  show: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.34, ease: motionEase } },
  exit: { opacity: 0, scale: 0.94, y: 18, filter: 'blur(12px)', transition: { duration: 0.2, ease: motionEase } },
}

const fadeMotion: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.22, ease: motionEase } },
  exit: { opacity: 0, transition: { duration: 0.16, ease: motionEase } },
}

const liftHover = { y: -4, scale: 1.01 }
const pressTap = { scale: 0.985 }

type ThemeMode = 'light' | 'dark' | 'system'
type CompanionState = 'idle' | 'reading' | 'selection' | 'thinking' | 'success' | 'warning' | 'happy' | 'follow'
type CompanionDockSize = 'small' | 'medium' | 'large'

type CompanionStatusDetail = {
  state: CompanionState
  message?: string
  durationMs?: number
}

type CompanionPosition = {
  x: number
  y: number
}

type TabDockActionId =
  | 'library'
  | 'generator'
  | 'notes'
  | 'stats'
  | 'personas'
  | 'deploy'
  | 'upload'
  | 'category'
  | 'refresh'
  | 'theme'
  | 'favorite'
  | 'summary'
  | 'highlights'
  | 'signOut'

type TabDockAction = {
  id: TabDockActionId
  label: string
  description: string
  icon: ComponentType<{ size?: number; className?: string; color?: string }>
  disabled?: boolean
  run: () => void | Promise<void>
}

const defaultPinnedActions: TabDockActionId[] = ['generator', 'upload', 'theme', 'notes']

const defaultHighlightColor = ''
const customColorFallback = '#FDE68A'
const backgroundColorOptions = [
  { label: '无背景', value: '' },
  { label: '黄色', value: '#FDE68A' },
  { label: '绿色', value: '#BBF7D0' },
  { label: '蓝色', value: '#BFDBFE' },
  { label: '粉色', value: '#FBCFE8' },
  { label: '紫色', value: '#DDD6FE' },
  { label: '灰色', value: '#E5E7EB' },
] as const
const textColorOptions = [
  { label: '默认', value: '' },
  { label: '红色', value: '#DC2626' },
  { label: '橙色', value: '#EA580C' },
  { label: '绿色', value: '#15803D' },
  { label: '蓝色', value: '#2563EB' },
  { label: '紫色', value: '#7C3AED' },
  { label: '深灰', value: '#374151' },
] as const

const htmlGenerationPresets: Array<{
  type: HtmlGenerationType
  label: string
  description: string
}> = [
  {
    type: 'learning',
    label: '学习讲解',
    description: '清晰讲透主题，按需要加入图示、对比或小动画，不强制习题。',
  },
  {
    type: 'animation',
    label: '概念动画',
    description: '用 CSS、SVG 或 canvas 演示抽象过程，带暂停或重播控制。',
  },
  {
    type: 'interactive',
    label: '互动理解',
    description: '做成可调参数、可点击或可拖动的小实验，帮助建立直觉。',
  },
  {
    type: 'game',
    label: 'HTML 小游戏',
    description: '生成可玩的单文件小游戏，包含规则、分数、状态和重开。',
  },
  {
    type: 'general',
    label: '通用页面',
    description: '生成展示页、说明页、工具页或创意页面，保持统一视觉标准。',
  },
]

const audienceOptions = ['初学者', '进阶学习者', '儿童友好', '专业读者']
const generatorStyleOptions = ['清爽阅读', '图解卡片', '互动演示', '沉浸游戏']
const generatorImageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
const maxGeneratorImageBytes = 5 * 1024 * 1024

type RouteState = {
  view: AppView
  documentId?: string
}

type AuthState = {
  loading: boolean
  user: AppUser | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (draft: UserProfileDraft) => Promise<void>
}

type UploadQueueStatus = 'queued' | 'uploading' | HtmlUploadResult['status']

type UploadQueueItem = {
  id: string
  file: File
  fileName: string
  status: UploadQueueStatus
  message: string
  title?: string
  storagePath?: string
  document?: DocumentRecord
}

type SelectionStylePatch = {
  color?: string | null
  textColor?: string | null
}

const defaultRoute: RouteState = { view: 'library' }
const defaultAvatarColor = '#5B7CFF'
const avatarColorOptions = ['#5B7CFF', '#35C9D0', '#FF7D9C', '#FFC66D', '#8B7CFF', '#2E3046']

function createUploadQueueItem(file: File): UploadQueueItem {
  return {
    id: crypto.randomUUID(),
    file,
    fileName: file.name,
    status: 'queued',
    message: '等待开始，可批量上传。',
  }
}

function getUploadStatusLabel(status: UploadQueueStatus) {
  if (status === 'queued') return '待上传'
  if (status === 'uploading') return '上传中'
  if (status === 'uploaded') return '已完成'
  if (status === 'duplicate') return '重复文件'
  return '上传失败'
}

async function readGeneratorImage(file: File): Promise<HtmlGenerationImageInput> {
  if (!generatorImageMimeTypes.includes(file.type as (typeof generatorImageMimeTypes)[number])) {
    throw new Error('图片只支持 PNG、JPG 或 WEBP。')
  }
  if (file.size > maxGeneratorImageBytes) {
    throw new Error('图片不能超过 5MB，请先裁剪或压缩后再上传。')
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
  const [, data = ''] = dataUrl.split(',')
  if (!data) throw new Error('图片读取失败，请重新选择。')
  return {
    name: file.name,
    mimeType: file.type as HtmlGenerationImageInput['mimeType'],
    data,
  }
}

function normalizeSelectionText(value: string | null | undefined) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function isTextLocator(locator: AnnotationLocator | null | undefined): locator is AnnotationLocator {
  return Boolean(
    locator &&
      locator.strategy === 'text-position-v1' &&
      Number.isFinite(locator.start) &&
      Number.isFinite(locator.end) &&
      locator.end > locator.start,
  )
}

function locatorsMatch(left: AnnotationLocator | null | undefined, right: AnnotationLocator | null | undefined) {
  return Boolean(
    isTextLocator(left) &&
      isTextLocator(right) &&
      left.strategy === right.strategy &&
      left.start === right.start &&
      left.end === right.end &&
      left.exact === right.exact,
  )
}

function rangesIntersect(left: AnnotationLocator, right: AnnotationLocator) {
  return left.start < right.end && right.start < left.end
}

function highlightIntersectsSelection(highlight: Highlight, selectedText: string, locator: AnnotationLocator | null) {
  if (isTextLocator(highlight.locator) && isTextLocator(locator)) return rangesIntersect(highlight.locator, locator)
  return normalizeSelectionText(highlight.selected_text) === normalizeSelectionText(selectedText)
}

function highlightMatchesSelection(highlight: Highlight, selectedText: string, locator: AnnotationLocator | null) {
  if (locatorsMatch(highlight.locator, locator)) return true
  return normalizeSelectionText(highlight.selected_text) === normalizeSelectionText(selectedText)
}

function hasVisibleHighlightStyle(value: Pick<Highlight, 'color' | 'text_color'>) {
  return Boolean(value.color || value.text_color)
}

function buildLocatorFragment(locator: AnnotationLocator, start: number, end: number): AnnotationLocator | null {
  if (start < locator.start || end > locator.end || end <= start) return null
  const localStart = start - locator.start
  const localEnd = end - locator.start
  const exact = locator.exact.slice(localStart, localEnd)
  if (!exact.trim()) return null
  return {
    strategy: 'text-position-v1',
    start,
    end,
    exact,
    prefix: `${locator.prefix}${locator.exact.slice(0, localStart)}`.slice(-48),
    suffix: `${locator.exact.slice(localEnd)}${locator.suffix}`.slice(0, 48),
  }
}

function parseHash(): RouteState {
  const [view, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  if (view === 'reader' && id) return { view: 'reader', documentId: id }
  if (view === 'stats' || view === 'personas' || view === 'library' || view === 'generator' || view === 'notes' || view === 'deploy') {
    return { view }
  }
  return defaultRoute
}

function navigate(view: AppView, documentId?: string) {
  window.location.hash = view === 'reader' && documentId ? `#/reader/${documentId}` : `#/${view}`
}

function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(storageKeys.themeMode)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function getStoredPinnedActions(): TabDockActionId[] {
  if (typeof window === 'undefined') return defaultPinnedActions
  const stored = window.localStorage.getItem(storageKeys.pinnedActions)
  if (!stored) return defaultPinnedActions
  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return defaultPinnedActions
    const allowed = new Set<TabDockActionId>([
      'library',
      'generator',
      'notes',
      'stats',
      'personas',
      'deploy',
      'upload',
      'category',
      'refresh',
      'theme',
      'favorite',
      'summary',
      'highlights',
      'signOut',
    ])
    const pinned = parsed.filter((item): item is TabDockActionId => typeof item === 'string' && allowed.has(item as TabDockActionId))
    return pinned.length > 0 ? pinned.slice(0, 4) : defaultPinnedActions
  } catch {
    return defaultPinnedActions
  }
}

function shouldReserveTabForFocus(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'select' || tagName === 'textarea' || tagName === 'iframe'
}

function dispatchQuickAction(name: (typeof quickActionEvents)[keyof typeof quickActionEvents]) {
  window.dispatchEvent(new CustomEvent(name))
}

function dispatchCompanionStatus(detail: CompanionStatusDetail) {
  window.dispatchEvent(new CustomEvent<CompanionStatusDetail>(companionEvents.status, { detail }))
}

function dispatchCompanionPersonaChange(personaId: string) {
  window.dispatchEvent(new CustomEvent<{ personaId: string }>(companionEvents.personaChange, { detail: { personaId } }))
}

function getStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') return fallback
  const stored = window.localStorage.getItem(key)
  if (stored === 'true') return true
  if (stored === 'false') return false
  return fallback
}

function getStoredCompanionSize(): CompanionDockSize {
  if (typeof window === 'undefined') return 'medium'
  const stored = window.localStorage.getItem(storageKeys.companionSize)
  return stored === 'small' || stored === 'medium' || stored === 'large' ? stored : 'medium'
}

function clampCompanionPosition(position: CompanionPosition, size: CompanionDockSize): CompanionPosition {
  if (typeof window === 'undefined') return position
  const dockWidth = size === 'large' ? 220 : size === 'small' ? 148 : 184
  const dockHeight = size === 'large' ? 230 : size === 'small' ? 166 : 202
  const minX = 12
  const minY = 12
  const maxX = Math.max(minX, window.innerWidth - dockWidth - 12)
  const maxY = Math.max(minY, window.innerHeight - dockHeight - 12)
  return {
    x: Math.min(maxX, Math.max(minX, position.x)),
    y: Math.min(maxY, Math.max(minY, position.y)),
  }
}

function getStoredCompanionPosition(size: CompanionDockSize): CompanionPosition {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  const fallback = {
    x: Math.max(12, window.innerWidth - (size === 'large' ? 226 : size === 'small' ? 156 : 190)),
    y: Math.max(12, window.innerHeight - (size === 'large' ? 244 : size === 'small' ? 180 : 216)),
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKeys.companionPosition) ?? '') as Partial<CompanionPosition>
    if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
      return clampCompanionPosition({ x: parsed.x, y: parsed.y }, size)
    }
  } catch {
    // Ignore invalid local preference and use the default dock position.
  }
  return clampCompanionPosition(fallback, size)
}

function buildBaseUser(id: string, email?: string): AppUser {
  return {
    id,
    email,
    displayName: email?.split('@')[0] || 'HTML Reader',
    avatarUrl: null,
    avatarColor: defaultAvatarColor,
  }
}

function getUserDisplayName(user: AppUser) {
  return user.displayName?.trim() || user.email?.split('@')[0] || '已登录用户'
}

function getUserInitial(user: AppUser) {
  const source = getUserDisplayName(user) || user.email || user.id
  return source.trim().slice(0, 1).toUpperCase() || 'U'
}

function useAuth(): AuthState {
  const [loading, setLoading] = useState(!isDemoMode && isSupabaseConfigured)
  const [user, setUser] = useState<AppUser | null>(
    isDemoMode ? buildBaseUser('demo-user', 'demo@html-vault.local') : null,
  )

  useEffect(() => {
    if (isDemoMode) {
      void loadUserProfile(buildBaseUser('demo-user', 'demo@html-vault.local')).then(setUser)
      setLoading(false)
      return undefined
    }

    if (!supabase) {
      setLoading(false)
      return undefined
    }

    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      const sessionUser = data.session?.user ? buildBaseUser(data.session.user.id, data.session.user.email) : null
      if (!sessionUser) {
        setUser(null)
        setLoading(false)
        return
      }
      void loadUserProfile(sessionUser)
        .then((profiledUser) => {
          if (mounted) setUser(profiledUser)
        })
        .catch(() => {
          if (mounted) setUser(sessionUser)
        })
        .finally(() => {
          if (mounted) setLoading(false)
        })
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user ? buildBaseUser(session.user.id, session.user.email) : null
      if (!sessionUser) {
        setUser(null)
        return
      }
      setUser(sessionUser)
      void loadUserProfile(sessionUser)
        .then((profiledUser) => {
          setUser((current) => (current?.id === profiledUser.id ? profiledUser : current))
        })
        .catch(() => {
          setUser((current) => current ?? sessionUser)
        })
    })

    return () => {
      mounted = false
      data.subscription.unsubscribe()
    }
  }, [])

  return {
    loading,
    user,
    signIn: async (email: string, password: string) => {
      if (isDemoMode) {
        setUser(await loadUserProfile(buildBaseUser('demo-user', email || 'demo@html-vault.local')))
        return
      }
      if (!supabase) {
        throw new Error('Supabase 尚未配置。')
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      if (isDemoMode) {
        setUser(await loadUserProfile(buildBaseUser('demo-user', 'demo@html-vault.local')))
        return
      }
      await supabase?.auth.signOut()
    },
    updateProfile: async (draft: UserProfileDraft) => {
      if (!user) return
      const updatedUser = await saveUserProfile(user, draft)
      setUser(updatedUser)
    },
  }
}

export default function App() {
  const auth = useAuth()
  const [route, setRoute] = useState<RouteState>(() => parseHash())
  const [payload, setPayload] = useState<LibraryPayload | null>(null)
  const [archivedDocuments, setArchivedDocuments] = useState<DocumentRecord[]>([])
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!auth.user) return
    setRefreshing(true)
    setLoadError('')
    try {
      setPayload(await loadLibrary())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '资料加载失败。')
    } finally {
      setRefreshing(false)
    }
  }, [auth.user])

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHashChange)
    if (!window.location.hash) navigate('library')
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectedDocument = useMemo(
    () => payload?.documents.find((document) => document.id === route.documentId) ?? null,
    [payload?.documents, route.documentId],
  )

  const handleFavorite = async (document: DocumentRecord, favorite: boolean) => {
    setPayload((current) =>
      current
        ? {
            ...current,
            documents: current.documents.map((item) => (item.id === document.id ? { ...item, favorite } : item)),
          }
        : current,
    )
    try {
      await toggleDocumentFavorite(document, favorite)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '收藏状态更新失败。')
      void refresh()
    }
  }

  const handleCreateCategory = async (draft: Pick<Category, 'name' | 'color'>) => {
    if (!auth.user) return
    const category = await createCategory(auth.user, draft)
    setPayload((current) =>
      current
        ? {
            ...current,
            categories: [...current.categories, category].sort((a, b) => a.sort_order - b.sort_order),
          }
        : current,
    )
  }

  const handleUploadDocuments = async (files: File[], categoryId: string | null) => {
    if (!auth.user) return []
    const results = await uploadHtmlFiles(auth.user, files, categoryId)
    if (results.some((result) => result.status === 'uploaded')) {
      dispatchCompanionStatus({ state: 'success', message: '上传完成，资料库已更新。' })
      await refresh()
    } else if (results.some((result) => result.status === 'failed')) {
      dispatchCompanionStatus({ state: 'warning', message: '有文件上传失败，可以原地重试。' })
    }
    return results
  }

  const handleSaveGeneratedHtml = async (draft: GeneratedHtmlSaveDraft) => {
    if (!auth.user) throw new Error('请先登录后再保存生成结果。')
    const result = await saveGeneratedHtml(auth.user, draft)
    dispatchCompanionStatus({ state: 'success', message: '生成结果已保存进资料库。' })
    await refresh()
    return result
  }

  const handleUpdateDocument = async (document: DocumentRecord, draft: DocumentUpdateDraft) => {
    const nextCategory = payload?.categories.find((category) => category.id === draft.category_id) ?? null
    const updatedDocument: DocumentRecord = {
      ...document,
      ...draft,
      category: draft.category_id !== undefined ? nextCategory : document.category,
      updated_at: new Date().toISOString(),
    }
    setPayload((current) =>
      current
        ? {
            ...current,
            documents: current.documents
              .map((item) =>
                item.id === document.id
                  ? {
                      ...updatedDocument,
                    }
                  : item,
              )
              .filter((item) => !item.archived),
          }
        : current,
    )
    if (draft.archived) {
      setArchivedDocuments((current) => [updatedDocument, ...current.filter((item) => item.id !== document.id)])
    }

    try {
      await updateDocumentManagement(document, draft)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '文档更新失败。')
      void refresh()
    }
  }

  const handleReorderDocuments = async (orderedDocuments: DocumentRecord[]) => {
    const currentDocuments = [...(payload?.documents ?? [])].sort(
      (a, b) =>
        (a.sort_order ?? 2147000000) - (b.sort_order ?? 2147000000) ||
        Date.parse(b.imported_at ?? '') - Date.parse(a.imported_at ?? ''),
    )
    const orderedIds = new Set(orderedDocuments.map((document) => document.id))
    const orderedQueue = [...orderedDocuments]
    const mergedDocuments =
      orderedDocuments.length === currentDocuments.length
        ? orderedDocuments
        : currentDocuments.map((document) => (orderedIds.has(document.id) ? orderedQueue.shift() ?? document : document))
    const updates = mergedDocuments.map((document, index) => ({
      id: document.id,
      sort_order: (index + 1) * 1000,
    }))
    const updateById = new Map(updates.map((item) => [item.id, item.sort_order]))

    setPayload((current) =>
      current
        ? {
            ...current,
            documents: current.documents.map((document) =>
              updateById.has(document.id)
                ? {
                    ...document,
                    sort_order: updateById.get(document.id)!,
                    updated_at: new Date().toISOString(),
                  }
                : document,
            ),
          }
        : current,
    )

    try {
      await updateDocumentSortOrder(updates)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '排序保存失败。')
      void refresh()
    }
  }

  const handleLoadArchived = async () => {
    if (isDemoMode && archivedDocuments.length > 0) return
    setArchiveLoading(true)
    setLoadError('')
    try {
      setArchivedDocuments(await loadArchivedDocuments())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '归档文档加载失败。')
    } finally {
      setArchiveLoading(false)
    }
  }

  const handleRestoreDocument = async (document: DocumentRecord) => {
    const restored = { ...document, archived: false, updated_at: new Date().toISOString() }
    setArchivedDocuments((current) => current.filter((item) => item.id !== document.id))
    setPayload((current) =>
      current
        ? {
            ...current,
            documents: [restored, ...current.documents.filter((item) => item.id !== document.id)],
          }
        : current,
    )

    try {
      await restoreDocument(document)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '恢复归档失败。')
      void refresh()
      void handleLoadArchived()
    }
  }

  const handleSavePersona = async (draft: PersonaDraft, persona?: Persona) => {
    if (!auth.user) return
    const savedPersona = persona ? await updatePersona(persona, draft) : await createPersona(auth.user, draft)
    setPayload((current) =>
      current
        ? {
            ...current,
            personas: persona
              ? current.personas.map((item) => (item.id === savedPersona.id ? savedPersona : item))
              : [savedPersona, ...current.personas],
          }
        : current,
    )
  }

  const handleProgress = useCallback((documentId: string, lastScroll: number) => {
    const readAt = new Date().toISOString()
    setPayload((current) =>
      {
        if (!current) return current

        const documents = current.documents.map((document) =>
          document.id === documentId
            ? { ...document, last_scroll: lastScroll, last_read_at: readAt }
            : document,
        )
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

        return {
          ...current,
          documents,
          stats: {
            ...current.stats,
            unreadCount: documents.filter((document) => !document.last_read_at).length,
            recentDocuments,
          }
        }
      },
    )
  }, [])

  if (auth.loading) return <LoadingScreen />

  if (!auth.user) {
    return <LoginPage configReady={isSupabaseConfigured || isDemoMode} onSignIn={auth.signIn} />
  }

  return (
    <AppShell
      user={auth.user}
      route={route}
      onNavigate={navigate}
      onSignOut={auth.signOut}
      onUpdateProfile={auth.updateProfile}
      onRefresh={refresh}
      activeDocument={selectedDocument}
      personas={payload?.personas ?? []}
      onFavorite={handleFavorite}
      refreshing={refreshing}
    >
      {loadError ? <InlineNotice tone="danger" title="加载遇到问题" body={loadError} /> : null}
      {!payload ? (
        <LoadingScreen compact />
      ) : route.view === 'reader' && selectedDocument ? (
        <ReaderView
          user={auth.user}
          document={selectedDocument}
          personas={payload.personas}
          aiProfiles={payload.aiProfiles}
          onBack={() => navigate('library')}
          onFavorite={handleFavorite}
          onProgress={handleProgress}
        />
      ) : route.view === 'stats' ? (
        <StatsView payload={payload} />
      ) : route.view === 'generator' ? (
        <GeneratorView
          user={auth.user}
          categories={payload.categories}
          personas={payload.personas}
          aiProfiles={payload.aiProfiles}
          onSave={handleSaveGeneratedHtml}
          onOpenDocument={(document) => navigate('reader', document.id)}
        />
      ) : route.view === 'notes' ? (
        <NotesView documents={payload.documents} categories={payload.categories} onOpenDocument={(id) => navigate('reader', id)} />
      ) : route.view === 'personas' ? (
        <PersonasView personas={payload.personas} aiProfiles={payload.aiProfiles} onSave={handleSavePersona} />
      ) : route.view === 'deploy' ? (
        <DeployCenter
          user={auth.user}
          aiProfiles={payload.aiProfiles}
          aiRequestBreakdown={payload.aiRequestBreakdown}
        />
      ) : (
        <LibraryView
          payload={payload}
          archivedDocuments={archivedDocuments}
          archiveLoading={archiveLoading}
          onOpen={(document) => navigate('reader', document.id)}
          onFavorite={handleFavorite}
          onCreateCategory={handleCreateCategory}
          onUpload={handleUploadDocuments}
          onOpenGenerator={() => navigate('generator')}
          onUpdateDocument={handleUpdateDocument}
          onReorderDocuments={handleReorderDocuments}
          onLoadArchived={handleLoadArchived}
          onRestoreDocument={handleRestoreDocument}
        />
      )}
    </AppShell>
  )
}

function LoadingScreen({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'loading compact' : 'loading'}>
      <Loader2 className="spin" size={26} />
      <span>正在准备阅读空间</span>
    </div>
  )
}

function LoginPage({
  configReady,
  onSignIn,
}: {
  configReady: boolean
  onSignIn: (email: string, password: string) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onSignIn(email, password)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-screen">
      <section className="login-shell">
        <div className="login-copy">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <p className="eyebrow">Private HTML Vault</p>
          <h1>你的 HTML 阅读库</h1>
          <p className="muted">
            使用 Supabase Auth 和 RLS 保护内容，GitHub Pages 只负责静态前端。没有注册入口，用户由你在数据库后台创建。
          </p>
          <div className="security-row">
            <span>
              <LockKeyhole size={16} />
              私密 Storage
            </span>
            <span>
              <Sparkles size={16} />
              AI 代理接口
            </span>
            <span>
              <UploadCloud size={16} />
              Actions 同步
            </span>
          </div>
        </div>

        <form className="login-panel" onSubmit={submit}>
          <h2>安全登录</h2>
          {!configReady ? (
            <InlineNotice
              tone="warning"
              title="等待 Supabase 配置"
              body="复制 .env.example 为 .env.local，并填入 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY。"
            />
          ) : null}
          <label>
            邮箱
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
          </label>
          <label>
            密码
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={!configReady || submitting}>
            {submitting ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
            登录
          </button>
        </form>
      </section>
    </main>
  )
}

function AppShell({
  user,
  route,
  refreshing,
  activeDocument,
  personas,
  children,
  onNavigate,
  onSignOut,
  onUpdateProfile,
  onRefresh,
  onFavorite,
}: {
  user: AppUser
  route: RouteState
  refreshing: boolean
  activeDocument: DocumentRecord | null
  personas: Persona[]
  children: ReactNode
  onNavigate: (view: AppView) => void
  onSignOut: () => Promise<void>
  onUpdateProfile: (draft: UserProfileDraft) => Promise<void>
  onRefresh: () => Promise<void>
  onFavorite: (document: DocumentRecord, favorite: boolean) => void
}) {
  const [tabDockOpen, setTabDockOpen] = useState(false)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode())
  const [pinnedActions, setPinnedActions] = useState<TabDockActionId[]>(() => getStoredPinnedActions())
  const navItems = [
    { view: 'library' as AppView, label: '资料库', icon: Library },
    { view: 'generator' as AppView, label: 'AI 生成', icon: Sparkles },
    { view: 'notes' as AppView, label: '笔记', icon: NotebookPen },
    { view: 'stats' as AppView, label: '统计', icon: BarChart3 },
    { view: 'personas' as AppView, label: '人物', icon: BrainCircuit },
    { view: 'deploy' as AppView, label: '部署', icon: Server },
  ]
  const themeIcon = themeMode === 'dark' ? Moon : themeMode === 'light' ? Sun : Monitor

  useEffect(() => {
    const applyTheme = () => {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      const resolvedTheme = themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode
      document.documentElement.dataset.theme = resolvedTheme
      document.documentElement.dataset.themeMode = themeMode
    }

    applyTheme()
    window.localStorage.setItem(storageKeys.themeMode, themeMode)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [themeMode])

  useEffect(() => {
    window.localStorage.setItem(storageKeys.pinnedActions, JSON.stringify(pinnedActions.slice(0, 4)))
  }, [pinnedActions])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key === 'Escape') {
        setTabDockOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      if (shouldReserveTabForFocus(event.target)) return
      event.preventDefault()
      setTabDockOpen((open) => !open)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const closeTabDock = () => setTabDockOpen(false)
  const navigateFromDock = (view: AppView) => {
    onNavigate(view)
    closeTabDock()
  }
  const cycleThemeMode = () => {
    setThemeMode((current) => (current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system'))
  }

  const actions = useMemo<TabDockAction[]>(() => {
    const navigationActions: TabDockAction[] = [
      {
        id: 'library',
        label: '资料库',
        description: '回到 HTML 文件管理',
        icon: Library,
        run: () => navigateFromDock('library'),
      },
      {
        id: 'generator',
        label: 'AI 生成',
        description: '用预设 Prompt 生成可保存的 HTML',
        icon: Sparkles,
        run: () => navigateFromDock('generator'),
      },
      {
        id: 'notes',
        label: '笔记',
        description: '查看文字样式和阅读笔记',
        icon: NotebookPen,
        run: () => navigateFromDock('notes'),
      },
      {
        id: 'stats',
        label: '统计',
        description: '打开阅读数据面板',
        icon: BarChart3,
        run: () => navigateFromDock('stats'),
      },
      {
        id: 'personas',
        label: '人物',
        description: '配置 AI 人物和陪读宠物',
        icon: BrainCircuit,
        run: () => navigateFromDock('personas'),
      },
      {
        id: 'deploy',
        label: '部署中心',
        description: '检查 AI 与部署状态',
        icon: Server,
        run: () => navigateFromDock('deploy'),
      },
    ]

    return [
      ...navigationActions,
      {
        id: 'upload',
        label: '上传 HTML',
        description: '跳到资料库并展开上传入口',
        icon: UploadCloud,
        run: () => {
          onNavigate('library')
          window.setTimeout(() => dispatchQuickAction(quickActionEvents.openUpload), 80)
          closeTabDock()
        },
      },
      {
        id: 'category',
        label: '新建分类',
        description: '跳到资料库并创建分类',
        icon: Folder,
        run: () => {
          onNavigate('library')
          window.setTimeout(() => dispatchQuickAction(quickActionEvents.openCategory), 80)
          closeTabDock()
        },
      },
      {
        id: 'refresh',
        label: '刷新资料库',
        description: refreshing ? '正在同步最新数据' : '重新拉取文档和统计',
        icon: RefreshCcw,
        disabled: refreshing,
        run: async () => {
          await onRefresh()
          closeTabDock()
        },
      },
      {
        id: 'theme',
        label: '切换外观',
        description: themeMode === 'system' ? '当前跟随系统' : themeMode === 'dark' ? '当前深色模式' : '当前浅色模式',
        icon: themeIcon,
        run: cycleThemeMode,
      },
      {
        id: 'favorite',
        label: activeDocument?.favorite ? '取消收藏' : '收藏当前',
        description: activeDocument ? activeDocument.title : '阅读文档时可用',
        icon: Heart,
        disabled: route.view !== 'reader' || !activeDocument,
        run: () => {
          if (!activeDocument) return
          onFavorite(activeDocument, !activeDocument.favorite)
          closeTabDock()
        },
      },
      {
        id: 'summary',
        label: 'AI 摘要',
        description: route.view === 'reader' ? '让阅读浮层生成摘要' : '阅读文档时可用',
        icon: Sparkles,
        disabled: route.view !== 'reader',
        run: () => {
          dispatchQuickAction(quickActionEvents.readerSummary)
          closeTabDock()
        },
      },
      {
        id: 'highlights',
        label: '样式笔记',
        description: route.view === 'reader' ? '打开当前文档样式和笔记面板' : '阅读文档时可用',
        icon: Highlighter,
        disabled: route.view !== 'reader',
        run: () => {
          dispatchQuickAction(quickActionEvents.readerHighlights)
          closeTabDock()
        },
      },
      {
        id: 'signOut',
        label: '退出登录',
        description: isDemoMode ? 'Demo Mode 会保持演示账号' : getUserDisplayName(user),
        icon: LogOut,
        run: async () => {
          await onSignOut()
          closeTabDock()
        },
      },
    ]
  }, [activeDocument, onFavorite, onNavigate, onRefresh, onSignOut, refreshing, route.view, themeIcon, themeMode, user])

  const pinnedActionItems = pinnedActions
    .map((id) => actions.find((action) => action.id === id))
    .filter((action): action is TabDockAction => Boolean(action))

  const togglePinnedAction = (actionId: TabDockActionId) => {
    setPinnedActions((current) => {
      if (current.includes(actionId)) return current.filter((id) => id !== actionId)
      return [actionId, ...current].slice(0, 4)
    })
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark small">
            <BookOpen size={18} />
          </div>
          <div>
            <strong>HTML Vault</strong>
            <span>{isDemoMode ? 'Demo Mode' : 'Supabase Secure'}</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = route.view === item.view
            return (
              <button key={item.view} className={active ? 'nav-item active' : 'nav-item'} onClick={() => onNavigate(item.view)}>
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <button className="account-card" type="button" onClick={() => setProfileEditorOpen(true)} aria-label="用户资料">
            <UserAvatar user={user} size="medium" />
            <span>
              <strong>{getUserDisplayName(user)}</strong>
              <small>{user.email ?? '已登录用户'}</small>
            </span>
          </button>
          <div className="sidebar-actions">
            <button className="icon-button" onClick={() => setProfileEditorOpen(true)} title="头像设置" aria-label="头像设置">
              <ImagePlus size={18} />
            </button>
            <button className="icon-button tab-trigger" onClick={() => setTabDockOpen(true)} title="打开 TAB 指挥盘">
              <Keyboard size={18} />
            </button>
            <button className="icon-button" onClick={() => void onRefresh()} title="刷新同步状态">
              <RefreshCcw className={refreshing ? 'spin' : undefined} size={18} />
            </button>
            <button className="icon-button" onClick={() => void onSignOut()} title="退出登录">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <main className="workspace">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${route.view}-${route.documentId ?? 'index'}`}
            variants={pageMotion}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
      <TabCommandDock
        open={tabDockOpen}
        route={route}
        themeMode={themeMode}
        user={user}
        actions={actions}
        pinnedActions={pinnedActionItems}
        pinnedActionIds={pinnedActions}
        onClose={closeTabDock}
        onThemeModeChange={setThemeMode}
        onTogglePinnedAction={togglePinnedAction}
      />
      <AnimatePresence>
        {profileEditorOpen ? (
          <UserProfileDialog user={user} onSave={onUpdateProfile} onClose={() => setProfileEditorOpen(false)} />
        ) : null}
      </AnimatePresence>
      <CompanionDock route={route} personas={personas} activeDocument={activeDocument} onNavigate={onNavigate} />
    </div>
  )
}

function TabCommandDock({
  open,
  route,
  themeMode,
  user,
  actions,
  pinnedActions,
  pinnedActionIds,
  onClose,
  onThemeModeChange,
  onTogglePinnedAction,
}: {
  open: boolean
  route: RouteState
  themeMode: ThemeMode
  user: AppUser
  actions: TabDockAction[]
  pinnedActions: TabDockAction[]
  pinnedActionIds: TabDockActionId[]
  onClose: () => void
  onThemeModeChange: (mode: ThemeMode) => void
  onTogglePinnedAction: (actionId: TabDockActionId) => void
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const availableActions = actions.filter((action) => !action.disabled)
  const navigationActions = actions.filter((action) => ['library', 'generator', 'notes', 'stats', 'personas', 'deploy'].includes(action.id))
  const toolActions = actions.filter((action) => !['library', 'generator', 'notes', 'stats', 'personas', 'deploy', 'signOut'].includes(action.id))
  const activeAction = availableActions[activeIndex] ?? availableActions[0]

  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    window.setTimeout(() => panelRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => (availableActions.length === 0 ? 0 : (index + 1) % availableActions.length))
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) =>
          availableActions.length === 0 ? 0 : (index - 1 + availableActions.length) % availableActions.length,
        )
      }
      if (event.key === 'Enter' && activeAction) {
        event.preventDefault()
        void activeAction.run()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeAction, availableActions.length, open])

  const runAction = (action: TabDockAction) => {
    if (action.disabled) return
    void action.run()
  }

  const renderActionButton = (action: TabDockAction, variant: 'pinned' | 'nav' | 'tool') => {
    const Icon = action.icon
    const keyboardIndex = availableActions.findIndex((item) => item.id === action.id)
    const selected = keyboardIndex === activeIndex && !action.disabled
    return (
      <motion.button
        key={action.id}
        type="button"
        className={`tab-command-action ${variant}${selected ? ' selected' : ''}`}
        onClick={() => runAction(action)}
        onMouseEnter={() => {
          if (keyboardIndex >= 0) setActiveIndex(keyboardIndex)
        }}
        disabled={action.disabled}
        whileHover={action.disabled ? undefined : liftHover}
        whileTap={action.disabled ? undefined : pressTap}
      >
        <span className="tab-command-icon">
          <Icon size={variant === 'pinned' ? 20 : 18} />
        </span>
        <span>
          <strong>{action.label}</strong>
          <small>{action.description}</small>
        </span>
      </motion.button>
    )
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div className="tab-command-layer" variants={fadeMotion} initial="hidden" animate="show" exit="exit">
          <motion.button
            className="tab-command-scrim"
            type="button"
            aria-label="关闭 TAB 指挥盘"
            onClick={onClose}
            variants={fadeMotion}
          />
          <motion.div
            ref={panelRef}
            className="tab-command-panel"
            role="dialog"
            aria-modal="true"
            aria-label="TAB 指挥盘"
            tabIndex={-1}
            variants={commandPanelMotion}
          >
            <div className="tab-command-orb" aria-hidden="true" />
            <div className="tab-command-head">
              <div>
                <span className="tab-command-kicker">
                  <Keyboard size={16} />
                  TAB Command Dock
                </span>
                <h2>快速指挥盘</h2>
                <p>{route.view === 'reader' ? '阅读辅助、收藏和 AI 动作已就绪。' : '导航、上传、外观和系统动作集中在这里。'}</p>
              </div>
              <button className="tab-command-close" type="button" onClick={onClose} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            <div className="tab-command-theme" aria-label="外观模式">
              {(['system', 'dark', 'light'] as ThemeMode[]).map((mode) => {
                const Icon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun
                return (
                  <button
                    key={mode}
                    type="button"
                    className={themeMode === mode ? 'active' : undefined}
                    onClick={() => onThemeModeChange(mode)}
                  >
                    <Icon size={16} />
                    {mode === 'system' ? '跟随系统' : mode === 'dark' ? '深色' : '浅色'}
                  </button>
                )
              })}
            </div>

            <motion.div
              className="tab-command-pinned"
              initial="hidden"
              animate="show"
              variants={staggerContainer}
            >
              {pinnedActions.map((action) => (
                <motion.div key={action.id} variants={cardMotion}>
                  {renderActionButton(action, 'pinned')}
                </motion.div>
              ))}
            </motion.div>

            <div className="tab-command-grid">
              <section>
                <div className="tab-command-section-title">
                  <span>快速导航</span>
                  <small>当前：{route.view}</small>
                </div>
                <div className="tab-command-list">{navigationActions.map((action) => renderActionButton(action, 'nav'))}</div>
              </section>
              <section>
                <div className="tab-command-section-title">
                  <span>功能与自定义</span>
                  <small>固定 4 个槽位</small>
                </div>
                <div className="tab-command-list">{toolActions.map((action) => renderActionButton(action, 'tool'))}</div>
              </section>
            </div>

            <div className="tab-command-customizer">
              <div>
                <strong>自定义快捷位</strong>
                <span>点击图钉固定到顶部，本地保存，不影响账号数据。</span>
              </div>
              <div className="tab-command-pin-list">
                {actions
                  .filter((action) => action.id !== 'signOut')
                  .map((action) => {
                    const pinned = pinnedActionIds.includes(action.id)
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={pinned ? 'active' : undefined}
                        onClick={() => onTogglePinnedAction(action.id)}
                      >
                        <Pin size={13} />
                        {action.label}
                      </button>
                    )
                  })}
              </div>
            </div>

            <div className="tab-command-foot">
              <span className="tab-command-key">
                <kbd>Tab</kbd> 打开/关闭
              </span>
              <span className="tab-command-key">
                <kbd>↑↓</kbd> 选择
              </span>
              <span className="tab-command-key">
                <kbd>Enter</kbd> 执行
              </span>
              <span className="tab-command-user">
                <UserAvatar user={user} size="small" />
                <span>
                  <strong>{getUserDisplayName(user)}</strong>
                  <small>{isDemoMode ? 'Demo Mode' : user.email ?? '已登录用户'}</small>
                </span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function UserAvatar({ user, size = 'medium' }: { user: AppUser; size?: 'small' | 'medium' | 'large' }) {
  const [imageFailed, setImageFailed] = useState(false)
  const avatarUrl = user.avatarUrl && !imageFailed ? user.avatarUrl : null

  useEffect(() => {
    setImageFailed(false)
  }, [user.avatarUrl])

  return (
    <span
      className={`user-avatar ${size}`}
      style={
        {
          '--avatar-color': user.avatarColor ?? defaultAvatarColor,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" onError={() => setImageFailed(true)} />
      ) : (
        <span>{getUserInitial(user)}</span>
      )}
    </span>
  )
}

function UserProfileDialog({
  user,
  onSave,
  onClose,
}: {
  user: AppUser
  onSave: (draft: UserProfileDraft) => Promise<void>
  onClose: () => void
}) {
  const [displayName, setDisplayName] = useState(getUserDisplayName(user))
  const [avatarColor, setAvatarColor] = useState(user.avatarColor ?? defaultAvatarColor)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const previewUser: AppUser = {
    ...user,
    displayName,
    avatarColor,
    avatarUrl: previewUrl ?? user.avatarUrl ?? null,
  }

  useEffect(() => {
    if (!avatarFile) {
      setPreviewUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(avatarFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  const selectFile = (file: File | null) => {
    setError('')
    if (!file) {
      setAvatarFile(null)
      return
    }
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('头像只支持 PNG、JPG、WEBP 或 GIF 图片。')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('头像图片不能超过 2MB。')
      return
    }
    setAvatarFile(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await onSave({ displayName, avatarColor, avatarFile })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存头像失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      className="modal-backdrop"
      variants={fadeMotion}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.form
        className="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="编辑用户头像"
        variants={panelMotion}
        onSubmit={submit}
      >
        <div className="panel-title">
          <span>
            <ImagePlus size={17} />
            编辑用户头像
          </span>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭头像编辑">
            <X size={17} />
          </button>
        </div>

        <div className="profile-editor-main">
          <UserAvatar user={previewUser} size="large" />
          <div>
            <strong>{displayName.trim() || getUserDisplayName(user)}</strong>
            <span>{avatarFile ? avatarFile.name : user.email ?? '已登录用户'}</span>
          </div>
        </div>

        <label>
          显示名
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={40}
            placeholder="输入显示名称"
          />
        </label>

        <label className="avatar-file-picker">
          上传头像
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <div className="avatar-color-field">
          <span>头像配色</span>
          <div className="avatar-color-options">
            {avatarColorOptions.map((color) => (
              <button
                key={color}
                type="button"
                className={avatarColor === color ? 'active' : undefined}
                style={{ '--swatch-color': color } as CSSProperties}
                onClick={() => setAvatarColor(color)}
                aria-label={`选择头像颜色 ${color}`}
              />
            ))}
          </div>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="manager-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={saving}>
            <X size={18} />
            取消
          </button>
          <button className="primary-button" disabled={saving || !displayName.trim()}>
            {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            保存头像
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function GeneratorView({
  user,
  categories,
  personas,
  aiProfiles,
  onSave,
  onOpenDocument,
}: {
  user: AppUser
  categories: Category[]
  personas: Persona[]
  aiProfiles: AiProfile[]
  onSave: (draft: GeneratedHtmlSaveDraft) => Promise<GeneratedHtmlSaveResult>
  onOpenDocument: (document: DocumentRecord) => void
}) {
  const [type, setType] = useState<HtmlGenerationType>('learning')
  const [brief, setBrief] = useState('')
  const [audience, setAudience] = useState(audienceOptions[0])
  const [stylePreset, setStylePreset] = useState(generatorStyleOptions[0])
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '')
  const [modelId, setModelId] = useState(personas[0]?.default_model ?? aiProfiles[0]?.id ?? '')
  const [result, setResult] = useState<HtmlGenerationResponse | null>(null)
  const [revisionInstruction, setRevisionInstruction] = useState('')
  const [saveTitle, setSaveTitle] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [revising, setRevising] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedDocument, setSavedDocument] = useState<DocumentRecord | null>(null)
  const [imageInput, setImageInput] = useState<HtmlGenerationImageInput | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const activePersona = useMemo(
    () => personas.find((persona) => persona.id === personaId) ?? personas[0],
    [personaId, personas],
  )
  const previewSrcDoc = useMemo(() => (result ? createReaderSrcDoc(result.html, 0, 'interactive') : ''), [result])
  const imagePreviewSrc = imageInput ? `data:${imageInput.mimeType};base64,${imageInput.data}` : ''

  useEffect(() => {
    if (!personaId && personas[0]) setPersonaId(personas[0].id)
  }, [personaId, personas])

  useEffect(() => {
    if (activePersona?.default_model) setModelId(activePersona.default_model)
  }, [activePersona?.default_model, activePersona?.id])

  const runGenerate = async () => {
    const trimmedBrief = brief.trim()
    if (!trimmedBrief && !imageInput) {
      setError('请先写下你想生成的内容，或从相册选择一张题目图片。')
      dispatchCompanionStatus({ state: 'warning', message: '先给我一点主题或图片，我再开始生成。' })
      return
    }
    setGenerating(true)
    setError('')
    setStatus('')
    setSavedDocument(null)
    dispatchCompanionStatus({ state: 'thinking', message: imageInput ? '我在识别图片并生成 HTML。' : '我在生成 HTML，稍等一下。', durationMs: 0 })
    try {
      const response = await requestAiHtmlGeneration({
        mode: 'create',
        type,
        brief: trimmedBrief || '请识别图片中的题目或内容，并生成一份便于理解的讲解 HTML。',
        image: imageInput ?? undefined,
        audience,
        stylePreset,
        personaId: personaId || undefined,
        modelId: modelId || undefined,
      })
      setResult(response)
      setSaveTitle(response.title)
      setStatus(isDemoMode ? 'Demo 生成已完成，可以预览、修改或保存。' : `生成已完成，实际使用模型：${response.model}。`)
      dispatchCompanionStatus({ state: 'success', message: '生成好了，可以预览或继续修改。' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI HTML 生成失败。')
      dispatchCompanionStatus({ state: 'warning', message: '生成没成功，我把错误放在页面上了。' })
    } finally {
      setGenerating(false)
    }
  }

  const runRevision = async () => {
    const instruction = revisionInstruction.trim()
    if (!result || !instruction) return
    setRevising(true)
    setError('')
    setStatus('')
    setSavedDocument(null)
    dispatchCompanionStatus({ state: 'thinking', message: '我在按你的要求修改 HTML。', durationMs: 0 })
    try {
      const response = await requestAiHtmlGeneration({
        mode: 'revise',
        type: result.type,
        brief: brief.trim() || '请识别图片中的题目或内容，并生成一份便于理解的讲解 HTML。',
        currentHtml: result.html,
        revisionInstruction: instruction,
        image: imageInput ?? undefined,
        audience,
        stylePreset,
        personaId: personaId || undefined,
        modelId: modelId || undefined,
      })
      setResult(response)
      setSaveTitle(response.title)
      setRevisionInstruction('')
      setStatus(isDemoMode ? '修改已应用，请检查预览。' : `修改已应用，实际使用模型：${response.model}。`)
      dispatchCompanionStatus({ state: 'success', message: '修改已应用，预览已更新。' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI HTML 修改失败。')
      dispatchCompanionStatus({ state: 'warning', message: '修改失败了，先看一下错误信息。' })
    } finally {
      setRevising(false)
    }
  }

  const saveResult = async () => {
    if (!result) return
    setSaving(true)
    setError('')
    setStatus('')
    dispatchCompanionStatus({ state: 'thinking', message: '我在把生成结果保存到资料库。', durationMs: 0 })
    try {
      const saved = await onSave({
        title: saveTitle.trim() || result.title,
        html: result.html,
        categoryId: categoryId || null,
        generationType: result.type,
        brief: brief.trim(),
        promptVersion: result.promptVersion,
        summary: result.summary,
      })
      setSavedDocument(saved.document)
      setStatus(saved.message)
      dispatchCompanionStatus({ state: 'success', message: '保存完成，可以打开阅读。' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存生成结果失败。')
      dispatchCompanionStatus({ state: 'warning', message: '保存失败了，错误信息已经显示。' })
    } finally {
      setSaving(false)
    }
  }

  const handleImageSelection = async (file: File | null) => {
    if (!file) return
    setImageLoading(true)
    setError('')
    try {
      setImageInput(await readGeneratorImage(file))
      setSavedDocument(null)
      setStatus('图片已读取，可以直接生成讲解 HTML。')
      dispatchCompanionStatus({ state: 'happy', message: '图片读到了，我可以根据它生成讲解。' })
    } catch (caught) {
      setImageInput(null)
      setError(caught instanceof Error ? caught.message : '图片读取失败。')
      dispatchCompanionStatus({ state: 'warning', message: '图片读取失败，换一张试试。' })
    } finally {
      setImageLoading(false)
    }
  }

  return (
    <section className="page-stack generator-view">
      <div className="page-header">
        <div>
          <p className="eyebrow">AI HTML Generator</p>
          <h1>AI HTML 生成器</h1>
          <p className="generator-summary-copy">选择预设 Prompt，输入需求，生成可预览、可修改、可保存的单文件 HTML。</p>
        </div>
        <div className="sync-pill">
          <Sparkles size={18} />
          严格 HTML
        </div>
      </div>

      <div className="generator-layout">
        <section className="generator-panel">
          <div className="generator-section-title">
            <span>预设 Prompt</span>
            <small>先标准化质量，后续再开放自定义角色模板</small>
          </div>
          <div className="generator-preset-grid" role="list" aria-label="HTML 生成类型">
            {htmlGenerationPresets.map((preset) => (
              <button
                key={preset.type}
                type="button"
                className={type === preset.type ? 'generator-preset active' : 'generator-preset'}
                onClick={() => setType(preset.type)}
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>

          <label>
            想生成什么
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="例如：用动图讲清楚 HTTP 请求从浏览器到服务器再返回的过程。也可以直接从相册选择题目图片。"
              rows={6}
            />
          </label>

          <div className="generator-image-box">
            <div>
              <strong>题目图片</strong>
              <span>支持从相册选择 PNG、JPG、WEBP，图片只用于本次 AI 识别，不会作为原图保存到资料库。</span>
            </div>
            <label className="generator-image-picker">
              <ImagePlus size={18} />
              {imageLoading ? '读取图片中' : imageInput ? '更换图片' : '选择图片'}
              <input
                aria-label="题目图片"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/*"
                disabled={generating || revising || imageLoading}
                onChange={(event) => {
                  void handleImageSelection(event.currentTarget.files?.[0] ?? null)
                  event.currentTarget.value = ''
                }}
              />
            </label>
            {imageInput ? (
              <div className="generator-image-preview">
                <img src={imagePreviewSrc} alt="题目图片预览" />
                <div>
                  <strong>{imageInput.name}</strong>
                  <span>{imageInput.mimeType}</span>
                  <button className="ghost-button compact" type="button" onClick={() => setImageInput(null)}>
                    <X size={16} />
                    移除图片
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="generator-options-grid">
            <label>
              受众
              <select value={audience} onChange={(event) => setAudience(event.target.value)}>
                {audienceOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              视觉方向
              <select value={stylePreset} onChange={(event) => setStylePreset(event.target.value)}>
                {generatorStyleOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              虚拟人物
              <select value={personaId} onChange={(event) => setPersonaId(event.target.value)}>
                <option value="">不指定</option>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select value={modelId} onChange={(event) => setModelId(event.target.value)}>
                <option value="">默认模型</option>
                {aiProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="generator-actions">
            <button className="primary-button" type="button" disabled={generating || (!brief.trim() && !imageInput)} onClick={() => void runGenerate()}>
              {generating ? <Loader2 className="spin" size={18} /> : <Sparkles size={18} />}
              生成预览
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setBrief('')
                setImageInput(null)
              }}
              disabled={generating || (!brief && !imageInput)}
            >
              <X size={18} />
              清空
            </button>
          </div>

          {error ? <InlineNotice tone="danger" title="生成器遇到问题" body={error} /> : null}
          {status ? <InlineNotice tone="success" title="生成器状态" body={status} /> : null}
        </section>

        <section className="generator-preview-panel">
          <div className="generator-preview-head">
            <div>
              <span>预览</span>
              <strong>{result?.title ?? '等待生成'}</strong>
            </div>
            {result ? <small>{result.model} · {result.promptVersion}</small> : null}
          </div>

          <div className="generator-preview">
            {result ? (
              <iframe title={result.title} sandbox="allow-scripts allow-forms allow-popups" srcDoc={previewSrcDoc} />
            ) : (
              <div className="generator-empty-preview">
                <Sparkles size={24} />
                <strong>生成结果会在这里预览</strong>
                <p>预览使用沙盒 iframe，确认满意后再保存进资料库。</p>
              </div>
            )}
          </div>

          <div className="generator-revision-box">
            <label>
              修改要求
              <textarea
                value={revisionInstruction}
                onChange={(event) => setRevisionInstruction(event.target.value)}
                placeholder="例如：把动画节奏放慢，增加一步对比说明，移动端按钮再大一点。"
                rows={3}
                disabled={!result || revising}
              />
            </label>
            <button className="ghost-button" type="button" disabled={!result || revising || !revisionInstruction.trim()} onClick={() => void runRevision()}>
              {revising ? <Loader2 className="spin" size={18} /> : <MessageSquareText size={18} />}
              应用修改
            </button>
          </div>

          <div className="generator-save-box">
            <label>
              保存标题
              <input value={saveTitle} onChange={(event) => setSaveTitle(event.target.value)} disabled={!result || saving} />
            </label>
            <label>
              保存分类
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={!result || saving}>
                <option value="">未分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" disabled={!result || saving} onClick={() => void saveResult()}>
              {saving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
              保存到资料库
            </button>
            {savedDocument ? (
              <button className="ghost-button" type="button" onClick={() => onOpenDocument(savedDocument)}>
                <BookOpen size={18} />
                打开阅读
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <div className="metric-strip">
        <Metric label="当前用户" value={getUserDisplayName(user)} icon={UserRoundPlus} />
        <Metric label="预设类型" value={htmlGenerationPresets.length.toString()} icon={SlidersHorizontal} />
        <Metric label="模型" value={aiProfiles.length.toString()} icon={BrainCircuit} />
        <Metric label="保存位置" value="资料库" icon={Library} />
      </div>
    </section>
  )
}

function LibraryView({
  payload,
  archivedDocuments,
  archiveLoading,
  onOpen,
  onFavorite,
  onCreateCategory,
  onUpload,
  onOpenGenerator,
  onUpdateDocument,
  onReorderDocuments,
  onLoadArchived,
  onRestoreDocument,
}: {
  payload: LibraryPayload
  archivedDocuments: DocumentRecord[]
  archiveLoading: boolean
  onOpen: (document: DocumentRecord) => void
  onFavorite: (document: DocumentRecord, favorite: boolean) => void
  onCreateCategory: (draft: Pick<Category, 'name' | 'color'>) => Promise<void>
  onUpload: (files: File[], categoryId: string | null) => Promise<HtmlUploadResult[]>
  onOpenGenerator: () => void
  onUpdateDocument: (document: DocumentRecord, draft: DocumentUpdateDraft) => Promise<void>
  onReorderDocuments: (documents: DocumentRecord[]) => Promise<void>
  onLoadArchived: () => Promise<void>
  onRestoreDocument: (document: DocumentRecord) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('manual')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [archiveMode, setArchiveMode] = useState(false)
  const [managedDocument, setManagedDocument] = useState<DocumentRecord | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadCategoryId, setUploadCategoryId] = useState('')
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([])
  const [draggingDocumentId, setDraggingDocumentId] = useState<string | null>(null)
  const [sortSaving, setSortSaving] = useState(false)
  const [sortMessage, setSortMessage] = useState('')

  const handleUploadFileSelection = (files: File[]) => {
    setUploadItems(files.map((file) => createUploadQueueItem(file)))
  }

  const runUploadQueue = async (targetIds?: string[]) => {
    if (uploading) return
    const itemsToUpload = uploadItems.filter((item) =>
      targetIds ? targetIds.includes(item.id) : item.status === 'queued',
    )
    if (itemsToUpload.length === 0) return

    setUploading(true)
    try {
      for (const item of itemsToUpload) {
        setUploadItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: 'uploading',
                  message: '正在写入资料库并生成正文索引。',
                }
              : entry,
          ),
        )

        const [result] = await onUpload([item.file], uploadCategoryId || null)
        setUploadItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: result.status,
                  message: result.message,
                  title: result.title,
                  storagePath: result.storagePath,
                  document: result.document,
                }
              : entry,
          ),
        )
      }
    } finally {
      setUploading(false)
    }
  }

  const sourceDocuments = archiveMode ? archivedDocuments : payload.documents
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    return sourceDocuments
      .filter((document) => (favoritesOnly ? document.favorite : true))
      .filter((document) => (categoryId === 'all' ? true : document.category_id === categoryId))
      .map((document) => ({
        document,
        snippet: query ? buildSearchSnippet(document, query) : '',
      }))
      .filter((item) => {
        if (!query) return true
        return Boolean(item.snippet)
      })
      .sort((a, b) => {
        if (sortKey === 'manual') {
          return (
            (a.document.sort_order ?? 2147000000) - (b.document.sort_order ?? 2147000000) ||
            Date.parse(b.document.imported_at ?? '') - Date.parse(a.document.imported_at ?? '')
          )
        }
        return Date.parse(b.document[sortKey] ?? '') - Date.parse(a.document[sortKey] ?? '')
      })
  }, [categoryId, favoritesOnly, search, sortKey, sourceDocuments])

  const filteredDocuments = useMemo(() => {
    return searchResults.map((item) => item.document)
  }, [searchResults])
  const canReorder =
    !archiveMode &&
    sortKey === 'manual' &&
    !favoritesOnly &&
    !search.trim() &&
    filteredDocuments.length > 1
  const reorderScopeLabel = categoryId === 'all' ? '全局书架顺序' : '当前分类内顺序'

  const persistReorder = async (documents: DocumentRecord[], reason: 'drag' | 'button') => {
    if (!canReorder || sortSaving) return
    setSortSaving(true)
    setSortMessage('')
    try {
      await onReorderDocuments(documents)
      setSortMessage(reason === 'drag' ? '拖放排序已保存。' : '移动排序已保存。')
    } finally {
      setSortSaving(false)
    }
  }

  const moveDocumentTo = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    const nextDocuments = moveDocumentBefore(filteredDocuments, sourceId, targetId)
    void persistReorder(nextDocuments, 'drag')
  }

  const moveDocumentByStep = (documentId: string, direction: -1 | 1) => {
    const currentIndex = filteredDocuments.findIndex((document) => document.id === documentId)
    const nextIndex = currentIndex + direction
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= filteredDocuments.length) return
    const nextDocuments = [...filteredDocuments]
    const [document] = nextDocuments.splice(currentIndex, 1)
    nextDocuments.splice(nextIndex, 0, document)
    void persistReorder(nextDocuments, 'button')
  }

  useEffect(() => {
    const openUpload = () => {
      setArchiveMode(false)
      setUploadOpen(true)
      window.setTimeout(() => document.querySelector<HTMLInputElement>('.upload-panel input[type="file"]')?.focus(), 80)
    }
    const openCategory = () => {
      setArchiveMode(false)
      setCreatingCategory(true)
      window.setTimeout(() => document.querySelector<HTMLInputElement>('.inline-editor input')?.focus(), 80)
    }
    window.addEventListener(quickActionEvents.openUpload, openUpload)
    window.addEventListener(quickActionEvents.openCategory, openCategory)
    return () => {
      window.removeEventListener(quickActionEvents.openUpload, openUpload)
      window.removeEventListener(quickActionEvents.openCategory, openCategory)
    }
  }, [])

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Library</p>
          <h1>HTML 文件管理</h1>
        </div>
        <div className="sync-pill">
          <UploadCloud size={18} />
          GitHub Actions 同步
        </div>
      </div>

      <div className="toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、摘要、分类、正文" />
        </label>
        <label className="select-box">
          <Folder size={18} />
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">全部分类</option>
            {payload.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
        <label className="select-box">
          <SlidersHorizontal size={18} />
          <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="manual">自定义顺序</option>
            <option value="imported_at">按导入时间</option>
            <option value="source_modified_at">按修改时间</option>
          </select>
          <ChevronDown size={16} />
        </label>
        <button className={favoritesOnly ? 'ghost-button active' : 'ghost-button'} onClick={() => setFavoritesOnly((value) => !value)}>
          <Heart size={18} />
          收藏
        </button>
        <button className={creatingCategory ? 'ghost-button active' : 'ghost-button'} onClick={() => setCreatingCategory((value) => !value)}>
          <Folder size={18} />
          新建分类
        </button>
        <button className={uploadOpen ? 'primary-button compact active' : 'primary-button compact'} onClick={() => setUploadOpen((value) => !value)}>
          <UploadCloud size={18} />
          上传 HTML
        </button>
        <button className="primary-button compact" onClick={onOpenGenerator}>
          <Sparkles size={18} />
          AI 生成
        </button>
        <button
          className={archiveMode ? 'ghost-button active' : 'ghost-button'}
          onClick={() => {
            const next = !archiveMode
            setArchiveMode(next)
            if (next) void onLoadArchived()
          }}
        >
          {archiveLoading ? <Loader2 className="spin" size={18} /> : <Archive size={18} />}
          归档
        </button>
      </div>

      <AnimatePresence>
        {uploadOpen ? (
          <HtmlUploadPanel
            categories={payload.categories}
            categoryId={uploadCategoryId}
            items={uploadItems}
            uploading={uploading}
            onCategoryChange={setUploadCategoryId}
            onFilesChange={handleUploadFileSelection}
            onCancel={() => setUploadOpen(false)}
            onUpload={() => runUploadQueue()}
            onRetry={(itemId) => runUploadQueue([itemId])}
          />
        ) : null}
        {creatingCategory ? (
          <CategoryCreator
            onCancel={() => setCreatingCategory(false)}
            onCreate={async (draft) => {
              await onCreateCategory(draft)
              setCreatingCategory(false)
            }}
          />
        ) : null}
      </AnimatePresence>

      <div className="metric-strip">
        <Metric label="文档" value={payload.documents.length.toString()} icon={FileText} />
        <Metric label="归档" value={archivedDocuments.length.toString()} icon={Archive} />
        <Metric label="未读" value={payload.stats.unreadCount.toString()} icon={Clock3} />
        <Metric label="收藏" value={payload.stats.favoriteCount.toString()} icon={Heart} />
      </div>

      <div className={canReorder ? 'sort-guidance active' : 'sort-guidance'}>
        <GripVertical size={18} />
        <div>
          <strong>{canReorder ? `正在调整${reorderScopeLabel}` : '排序规则'}</strong>
          <p>
            {canReorder
              ? '桌面端可拖放卡片；移动端使用卡片底部的上移/下移按钮。保存后刷新仍保持当前顺序。'
              : sortKey !== 'manual'
                ? '切换到“自定义顺序”后可以手动调整书架。'
                : archiveMode
                  ? '归档视图不允许调整排序。'
                  : search.trim() || favoritesOnly
                    ? '搜索或收藏筛选是临时视图，为避免误改书架顺序，暂不允许拖拽。'
                    : '至少需要两份文档才能调整顺序。'}
          </p>
        </div>
        {sortSaving ? (
          <span className="sort-saving">
            <Loader2 className="spin" size={16} />
            保存中
          </span>
        ) : sortMessage ? (
          <span className="sort-saved">{sortMessage}</span>
        ) : null}
      </div>

      <motion.div className="document-grid" layout variants={staggerContainer} initial="hidden" animate="show">
        {searchResults.map(({ document, snippet }, index) => (
          <DocumentCard
            key={document.id}
            document={document}
            searchSnippet={snippet}
            reorderMode={canReorder}
            isDragging={draggingDocumentId === document.id}
            isFirst={index === 0}
            isLast={index === searchResults.length - 1}
            sortSaving={sortSaving}
            onDragStart={(documentId) => setDraggingDocumentId(documentId)}
            onDragEnd={() => setDraggingDocumentId(null)}
            onDropOnDocument={(targetId) => {
              if (draggingDocumentId) moveDocumentTo(draggingDocumentId, targetId)
              setDraggingDocumentId(null)
            }}
            onMoveUp={(documentId) => moveDocumentByStep(documentId, -1)}
            onMoveDown={(documentId) => moveDocumentByStep(documentId, 1)}
            onOpen={archiveMode ? undefined : onOpen}
            onFavorite={onFavorite}
            onManage={archiveMode ? undefined : setManagedDocument}
            onRestore={archiveMode ? onRestoreDocument : undefined}
          />
        ))}
      </motion.div>
      {filteredDocuments.length === 0 ? (
        <div className="empty-state">
          <Archive size={22} />
          <strong>{archiveMode ? '暂无归档文档' : '没有匹配的文档'}</strong>
          <p>{archiveMode ? '被归档的资料会显示在这里，可以随时恢复。' : '换个关键词或分类再试试。'}</p>
        </div>
      ) : null}

      <AnimatePresence>
        {managedDocument ? (
          <DocumentManagerPanel
            document={managedDocument}
            categories={payload.categories}
            onClose={() => setManagedDocument(null)}
            onSave={async (draft) => {
              await onUpdateDocument(managedDocument, draft)
              setManagedDocument(null)
            }}
            onArchive={async () => {
              await onUpdateDocument(managedDocument, { archived: true })
              setManagedDocument(null)
            }}
          />
        ) : null}
      </AnimatePresence>
    </section>
  )
}

function HtmlUploadPanel({
  categories,
  categoryId,
  items,
  uploading,
  onCategoryChange,
  onFilesChange,
  onUpload,
  onRetry,
  onCancel,
}: {
  categories: Category[]
  categoryId: string
  items: UploadQueueItem[]
  uploading: boolean
  onCategoryChange: (categoryId: string) => void
  onFilesChange: (files: File[]) => void
  onUpload: () => Promise<void>
  onRetry: (itemId: string) => Promise<void>
  onCancel: () => void
}) {
  const resolvedCount = items.filter(
    (item) => item.status === 'uploaded' || item.status === 'duplicate' || item.status === 'failed',
  ).length
  const activeItem = items.find((item) => item.status === 'uploading') ?? null
  const progressRatio =
    items.length === 0 ? 0 : Math.min(100, ((resolvedCount + (activeItem ? 0.5 : 0)) / items.length) * 100)
  const progressText = activeItem
    ? `正在处理 ${resolvedCount + 1} / ${items.length}：${activeItem.fileName}`
    : items.length > 0
      ? `已处理 ${resolvedCount} / ${items.length}`
      : '选择多个 HTML 后会逐项显示进度和结果。'

  return (
    <motion.form
      className="upload-panel"
      variants={panelMotion}
      initial="hidden"
      animate="show"
      exit="exit"
      onSubmit={(event) => {
        event.preventDefault()
        void onUpload()
      }}
    >
      <div className="upload-panel-copy">
        <strong>从本机上传 HTML</strong>
        <span>文件会进入你的私密 Storage，只写入当前登录用户的资料库。</span>
      </div>
      <label>
        分类
        <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)} disabled={uploading}>
          <option value="">未分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>
      <label className="file-picker">
        HTML 文件
        <input
          type="file"
          accept=".html,.htm,text/html"
          multiple
          disabled={uploading}
          onChange={(event) => {
            onFilesChange(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }}
        />
      </label>
      <div className="upload-actions">
        <button className="primary-button" type="submit" disabled={uploading || items.every((item) => item.status !== 'queued')}>
          {uploading ? <Loader2 className="spin" size={18} /> : <UploadCloud size={18} />}
          {items.some((item) => item.status === 'queued')
            ? `上传 ${items.filter((item) => item.status === 'queued').length} 个文件`
            : '选择文件后开始上传'}
        </button>
        <button className="ghost-button" type="button" onClick={onCancel} disabled={uploading}>
          <X size={18} />
          收起
        </button>
      </div>
      <div className="upload-progress-summary" aria-live="polite">
        <div className="upload-progress-head">
          <strong>逐项进度</strong>
          <span>{progressText}</span>
        </div>
        <div className="upload-progress-track" aria-hidden="true">
          <span style={{ width: `${progressRatio}%` }} />
        </div>
      </div>
      {items.length > 0 ? (
        <div className="upload-results" aria-live="polite">
          {items.map((item) => (
            <div className={`upload-result ${item.status}`} key={item.id}>
              <span>
                {item.status === 'uploaded' ? (
                  <Check size={16} />
                ) : item.status === 'duplicate' ? (
                  <ShieldCheck size={16} />
                ) : item.status === 'uploading' ? (
                  <Loader2 className="spin" size={16} />
                ) : item.status === 'failed' ? (
                  <X size={16} />
                ) : (
                  <UploadCloud size={16} />
                )}
              </span>
              <div className="upload-result-body">
                <div className="upload-result-head">
                  <strong>{item.fileName}</strong>
                  <span className={`upload-result-status ${item.status}`}>{getUploadStatusLabel(item.status)}</span>
                </div>
                {item.title ? <p className="upload-result-meta">文档标题：{item.title}</p> : null}
                <p>{item.message}</p>
                {item.storagePath ? <p className="upload-result-path">Storage: {item.storagePath}</p> : null}
              </div>
              <div className="upload-result-actions">
                {item.status === 'failed' ? (
                  <button
                    className="ghost-button compact"
                    type="button"
                    onClick={() => void onRetry(item.id)}
                    disabled={uploading}
                  >
                    <RefreshCcw size={16} />
                    重试
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="upload-results upload-results-empty" aria-live="polite">
          <div className="upload-result queued">
            <span>
              <UploadCloud size={16} />
            </span>
            <div className="upload-result-body">
              <div className="upload-result-head">
                <strong>尚未选择文件</strong>
                <span className="upload-result-status queued">{getUploadStatusLabel('queued')}</span>
              </div>
              <p>支持批量选择 `.html` / `.htm` 文件，上传结果会逐项展示，失败项可直接重试。</p>
            </div>
          </div>
        </div>
      )}
    </motion.form>
  )
}

function DocumentCard({
  document,
  searchSnippet,
  reorderMode = false,
  isDragging = false,
  isFirst = false,
  isLast = false,
  sortSaving = false,
  onDragStart,
  onDragEnd,
  onDropOnDocument,
  onMoveUp,
  onMoveDown,
  onOpen,
  onFavorite,
  onManage,
  onRestore,
}: {
  document: DocumentRecord
  searchSnippet?: string
  reorderMode?: boolean
  isDragging?: boolean
  isFirst?: boolean
  isLast?: boolean
  sortSaving?: boolean
  onDragStart?: (documentId: string) => void
  onDragEnd?: () => void
  onDropOnDocument?: (documentId: string) => void
  onMoveUp?: (documentId: string) => void
  onMoveDown?: (documentId: string) => void
  onOpen?: (document: DocumentRecord) => void
  onFavorite: (document: DocumentRecord, favorite: boolean) => void
  onManage?: (document: DocumentRecord) => void
  onRestore?: (document: DocumentRecord) => void
}) {
  const sourceLabel =
    document.metadata?.source === 'ai_generated'
      ? 'AI 生成'
      : document.metadata?.source === 'browser_upload'
        ? '前端上传'
        : '同步导入'
  return (
    <motion.article
      className={`document-card${reorderMode ? ' reorderable' : ''}${isDragging ? ' dragging' : ''}`}
      layout
      variants={cardMotion}
      whileHover={liftHover}
      whileTap={pressTap}
      draggable={reorderMode && !sortSaving}
      onDragStart={(event) => {
        if (!reorderMode || !('dataTransfer' in event)) return
        const dataTransfer = event.dataTransfer as DataTransfer
        dataTransfer.effectAllowed = 'move'
        dataTransfer.setData('text/plain', document.id)
        onDragStart?.(document.id)
      }}
      onDragOver={(event) => {
        if (!reorderMode || !('dataTransfer' in event)) return
        event.preventDefault()
        const dataTransfer = event.dataTransfer as DataTransfer
        dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (!reorderMode) return
        event.preventDefault()
        onDropOnDocument?.(document.id)
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className="card-topline">
        {reorderMode ? (
          <span className="drag-handle" title="拖动调整顺序" aria-label={`拖动排序 ${document.title}`}>
            <GripVertical size={17} />
          </span>
        ) : null}
        <span className="category-dot" style={{ backgroundColor: document.category?.color ?? '#64748B' }} />
        <span>{document.category?.name ?? '未分类'}</span>
        <span className="source-badge">{sourceLabel}</span>
        {onRestore ? (
          <button className="icon-button" onClick={() => onRestore(document)} title="恢复归档">
            <RotateCcw size={17} />
          </button>
        ) : (
          <button
            className={document.favorite ? 'icon-button active' : 'icon-button'}
            onClick={() => onFavorite(document, !document.favorite)}
            title={document.favorite ? '取消收藏' : '收藏'}
          >
            <Heart size={17} />
          </button>
        )}
        {onManage ? (
          <button className="icon-button" onClick={() => onManage(document)} title="管理文档">
            <Settings2 size={17} />
          </button>
        ) : null}
      </div>
      <h2>{document.title}</h2>
      <p>{document.summary ?? '等待 AI 摘要生成。'}</p>
      {searchSnippet ? (
        <div className="search-snippet">
          <Search size={14} />
          <span>{searchSnippet}</span>
        </div>
      ) : null}
      <div className="card-meta">
        <span>
          <CalendarDays size={15} />
          导入 {formatDate(document.imported_at)}
        </span>
        <span>
          <Clock3 size={15} />
          {document.reading_estimate_minutes ?? 1} 分钟
        </span>
        {document.indexed_at ? (
          <span>
            <FileText size={15} />
            {document.word_count} 字
          </span>
        ) : null}
      </div>
      <div className="progress-line" aria-label="阅读进度">
        <span style={{ width: `${Math.round((document.last_scroll ?? 0) * 100)}%` }} />
      </div>
      {onRestore ? (
        <button className="open-button restore" onClick={() => onRestore(document)}>
          <RotateCcw size={18} />
          恢复
        </button>
      ) : (
        <button className="open-button" onClick={() => onOpen?.(document)}>
          <BookOpen size={18} />
          阅读
        </button>
      )}
      {reorderMode ? (
        <div className="mobile-order-controls" aria-label={`${document.title} 排序操作`}>
          <button className="ghost-button compact" type="button" onClick={() => onMoveUp?.(document.id)} disabled={isFirst || sortSaving}>
            <ArrowUp size={16} />
            上移
          </button>
          <button className="ghost-button compact" type="button" onClick={() => onMoveDown?.(document.id)} disabled={isLast || sortSaving}>
            <ArrowDown size={16} />
            下移
          </button>
        </div>
      ) : null}
    </motion.article>
  )
}

function CategoryCreator({
  onCreate,
  onCancel,
}: {
  onCreate: (draft: Pick<Category, 'name' | 'color'>) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5B7CFF')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onCreate({ name: name.trim(), color })
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.form
      className="inline-editor"
      variants={panelMotion}
      initial="hidden"
      animate="show"
      exit="exit"
      onSubmit={submit}
    >
      <label>
        分类名称
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：论文资料" />
      </label>
      <label>
        颜色
        <input value={color} onChange={(event) => setColor(event.target.value)} type="color" />
      </label>
      <button className="primary-button" disabled={saving || !name.trim()}>
        {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
        创建
      </button>
      <button className="ghost-button" type="button" onClick={onCancel}>
        <X size={18} />
        取消
      </button>
    </motion.form>
  )
}

function DocumentManagerPanel({
  document,
  categories,
  onSave,
  onArchive,
  onClose,
}: {
  document: DocumentRecord
  categories: Category[]
  onSave: (draft: DocumentUpdateDraft) => Promise<void>
  onArchive: () => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(document.title)
  const [categoryId, setCategoryId] = useState(document.category_id ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave({
        title: title.trim() || document.title,
        category_id: categoryId || null,
      })
    } finally {
      setSaving(false)
    }
  }

  const archive = async () => {
    setSaving(true)
    try {
      await onArchive()
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div
      className="modal-backdrop"
      variants={fadeMotion}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.form
        className="document-manager"
        variants={panelMotion}
        onSubmit={submit}
      >
        <div className="panel-title">
          <span>
            <Settings2 size={17} />
            管理文档
          </span>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <label>
          标题
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          分类
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">未分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="manager-meta">
          <span>Storage: {document.storage_path}</span>
          <span>修改: {formatDate(document.source_modified_at)}</span>
        </div>
        <div className="manager-actions">
          <button className="ghost-button danger" type="button" onClick={() => void archive()} disabled={saving}>
            <X size={18} />
            归档
          </button>
          <button className="primary-button" disabled={saving}>
            {saving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}
            保存
          </button>
        </div>
      </motion.form>
    </motion.div>
  )
}

function StatsView({ payload }: { payload: LibraryPayload }) {
  const stats = payload.stats
  const fallbackProgressBuckets = [
    { label: '未开始', count: payload.documents.filter((document) => (document.last_scroll ?? 0) <= 0).length },
    {
      label: '进行中',
      count: payload.documents.filter((document) => (document.last_scroll ?? 0) > 0 && (document.last_scroll ?? 0) < 0.9).length,
    },
    { label: '已完成', count: payload.documents.filter((document) => (document.last_scroll ?? 0) >= 0.9).length },
  ]
  const fallbackBacklogDocuments = payload.documents
    .filter((document) => !document.last_read_at || document.last_scroll < 0.9)
    .slice(0, 5)
    .map((document) => ({
      id: document.id,
      title: document.title,
      reason: document.favorite && !document.last_read_at ? '收藏未读' : !document.last_read_at ? '尚未开始' : '继续阅读',
      progress: Math.min(1, Math.max(0, document.last_scroll ?? 0)),
      categoryName: document.category?.name ?? '未分类',
      categoryColor: document.category?.color ?? '#64748B',
      estimateMinutes: document.reading_estimate_minutes ?? 1,
      favorite: document.favorite,
      lastReadAt: document.last_read_at,
    }))
  const fallbackRecentDocuments = payload.documents
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
  const progressBuckets = stats.progressBuckets ?? fallbackProgressBuckets
  const backlogDocuments = stats.backlogDocuments ?? fallbackBacklogDocuments
  const recentDocuments = stats.recentDocuments ?? fallbackRecentDocuments
  const favoriteBacklogCount = backlogDocuments.filter((document) => document.favorite).length
  const statusSummary =
    stats.totalDocumentCount === 0
      ? '上传 HTML 后，这里会开始沉淀阅读趋势和资料库健康度。'
      : `本周阅读 ${stats.weeklyReadMinutes} 分钟，仍有 ${stats.unreadCount} 篇待读，完成率 ${formatPercent(stats.completionRate)}。`

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>阅读统计</h1>
          <p className="stats-summary-copy">{statusSummary}</p>
        </div>
        <div className="sync-pill">
          <Clock3 size={18} />
          今日 {stats.todayReadMinutes} 分钟
        </div>
      </div>

      <div className="metric-strip">
        <Metric label="本周阅读" value={formatDuration(stats.weeklyReadMinutes * 60)} icon={Clock3} />
        <Metric label="总文档" value={stats.totalDocumentCount.toString()} icon={Library} />
        <Metric label="完成率" value={formatPercent(stats.completionRate)} icon={Check} />
        <Metric label="待读数量" value={stats.unreadCount.toString()} icon={FileText} />
      </div>

      <Suspense fallback={<ChartFallback />}>
        <StatsCharts stats={stats} />
      </Suspense>

      <div className="stats-panel-grid">
        <section className="list-panel">
          <h2>阅读诊断</h2>
          <div className="stats-fact-grid">
            <div className="stats-fact">
              <span>日均阅读</span>
              <strong>{stats.dailyAverageMinutes} 分钟</strong>
              <p>最近 7 天平均值</p>
            </div>
            <div className="stats-fact">
              <span>最长连续</span>
              <strong>{stats.longestStreakDays} 天</strong>
              <p>按有阅读记录的日期计算</p>
            </div>
            <div className="stats-fact">
              <span>收藏待读</span>
              <strong>{favoriteBacklogCount} 篇</strong>
              <p>已收藏但还没有读完</p>
            </div>
            <div className="stats-fact">
              <span>资料字数</span>
              <strong>{formatNumber(stats.totalWordCount)}</strong>
              <p>已索引正文总量</p>
            </div>
          </div>
        </section>

        <section className="list-panel">
          <h2>阅读进度分布</h2>
          <div className="progress-bucket-list">
            {progressBuckets.map((bucket) => {
              const percent = stats.totalDocumentCount > 0 ? bucket.count / stats.totalDocumentCount : 0
              return (
                <div className="progress-bucket-row" key={bucket.label}>
                  <div>
                    <span>{bucket.label}</span>
                    <strong>{bucket.count} 篇</strong>
                  </div>
                  <div className="progress-line" aria-label={`${bucket.label}占比`}>
                    <span style={{ width: `${Math.round(percent * 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="list-panel">
          <div className="stats-panel-title">
            <h2>待读清单</h2>
            <span>{backlogDocuments.length} 项</span>
          </div>
          {backlogDocuments.length === 0 ? (
            <div className="empty-state compact">
              <Check size={22} />
              <strong>当前没有待读积压</strong>
              <p>新上传或未完成的文档会出现在这里。</p>
            </div>
          ) : (
            backlogDocuments.map((document) => (
              <button
                key={document.id}
                className="recent-row stats-document-row"
                onClick={() => navigate('reader', document.id)}
              >
                <span className="category-dot" style={{ backgroundColor: document.categoryColor }} />
                <span className="stats-row-main">
                  <strong>{document.title}</strong>
                  <em>
                    {document.reason} · {document.categoryName} · {document.estimateMinutes} 分钟
                  </em>
                </span>
                <span className="stats-row-progress">{formatPercent(document.progress)}</span>
              </button>
            ))
          )}
        </section>

        <section className="list-panel">
          <div className="stats-panel-title">
            <h2>最近阅读</h2>
            <span>{recentDocuments.length} 项</span>
          </div>
          {recentDocuments.length === 0 ? (
            <div className="empty-state compact">
              <BookOpen size={22} />
              <strong>还没有阅读记录</strong>
              <p>从资料库打开一篇文档后，最近阅读会自动更新。</p>
            </div>
          ) : (
            recentDocuments.map((document) => (
              <button
                key={document.id}
                className="recent-row stats-document-row"
                onClick={() => navigate('reader', document.id)}
              >
                <span className="category-dot" style={{ backgroundColor: document.categoryColor }} />
                <span className="stats-row-main">
                  <strong>{document.title}</strong>
                  <em>
                    {document.categoryName} · {document.estimateMinutes} 分钟 · {formatDate(document.lastReadAt)}
                  </em>
                </span>
                <span className="stats-row-progress">{formatPercent(document.progress)}</span>
              </button>
            ))
          )}
        </section>

        <section className="list-panel stats-panel-wide">
          <h2>AI 使用概况</h2>
          <div className="stats-ai-strip">
            <span>
              <Sparkles size={16} />
              AI 解析 {stats.aiRequestCount} 次
            </span>
            <span>
              <Heart size={16} />
              收藏 {stats.favoriteCount} 篇
            </span>
            <span>
              <BookOpen size={16} />
              总阅读 {formatDuration(stats.totalReadSeconds)}
            </span>
            <span>
              <Clock3 size={16} />
              预计阅读 {formatDuration(stats.totalEstimateMinutes * 60)}
            </span>
          </div>
        </section>
      </div>
    </section>
  )
}

function ChartFallback() {
  return (
    <div className="chart-grid">
      <section className="chart-panel chart-skeleton">
        <h2>最近 7 天</h2>
        <div />
      </section>
      <section className="chart-panel chart-skeleton">
        <h2>分类阅读</h2>
        <div />
      </section>
    </div>
  )
}

function DeployCenter({
  user,
  aiProfiles,
  aiRequestBreakdown,
}: {
  user: AppUser
  aiProfiles: AiProfile[]
  aiRequestBreakdown: AiRequestBreakdown
}) {
  const [result, setResult] = useState<ClientPreflightResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [aiHealth, setAiHealth] = useState<AiHealthResult | null>(null)
  const [aiHealthLoading, setAiHealthLoading] = useState(false)
  const [aiHealthError, setAiHealthError] = useState('')
  const [aiFeatureConfig, setAiFeatureConfig] = useState<AiFeatureConfigPayload | null>(null)
  const [aiFeatureLoading, setAiFeatureLoading] = useState(false)
  const [aiFeatureSaving, setAiFeatureSaving] = useState(false)
  const [aiProviderSaving, setAiProviderSaving] = useState(false)
  const [aiFeatureError, setAiFeatureError] = useState('')

  const run = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setResult(await runClientPreflight(user))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '部署检查失败。')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void run()
  }, [run])

  const runAiHealth = useCallback(async () => {
    setAiHealthLoading(true)
    setAiHealthError('')
    try {
      setAiHealth(await fetchAiHealth())
    } catch (caught) {
      setAiHealthError(caught instanceof Error ? caught.message : 'AI 健康检查失败。')
    } finally {
      setAiHealthLoading(false)
    }
  }, [])

  const loadAiFeatureConfig = useCallback(async () => {
    setAiFeatureLoading(true)
    setAiFeatureError('')
    try {
      setAiFeatureConfig(await fetchAiFeatureConfig())
    } catch (caught) {
      setAiFeatureError(caught instanceof Error ? caught.message : 'AI 功能配置加载失败。')
    } finally {
      setAiFeatureLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAiFeatureConfig()
  }, [loadAiFeatureConfig])

  const saveAiBindings = useCallback(async (bindings: AiFeatureBinding[]) => {
    setAiFeatureSaving(true)
    setAiFeatureError('')
    try {
      setAiFeatureConfig(await saveAiFeatureBindings(bindings))
    } catch (caught) {
      setAiFeatureError(caught instanceof Error ? caught.message : 'AI 功能绑定保存失败。')
    } finally {
      setAiFeatureSaving(false)
    }
  }, [])

  const saveAiProvider = useCallback(async (draft: AiUserProviderDraft) => {
    setAiProviderSaving(true)
    setAiFeatureError('')
    try {
      setAiFeatureConfig(await saveAiUserProvider(draft))
    } catch (caught) {
      setAiFeatureError(caught instanceof Error ? caught.message : 'AI API 配置保存失败。')
    } finally {
      setAiProviderSaving(false)
    }
  }, [])

  const removeAiProvider = useCallback(async (profileId: string) => {
    setAiProviderSaving(true)
    setAiFeatureError('')
    try {
      setAiFeatureConfig(await deleteAiUserProvider(profileId))
    } catch (caught) {
      setAiFeatureError(caught instanceof Error ? caught.message : 'AI API 配置删除失败。')
    } finally {
      setAiProviderSaving(false)
    }
  }, [])

  const checks = result?.checks ?? []
  const passed = checks.filter((check) => check.status === 'pass').length
  const warnings = checks.filter((check) => check.status === 'warn').length
  const failed = checks.filter((check) => check.status === 'fail').length
  const checkById = new Map(checks.map((check) => [check.id, check]))
  const healthZones: Array<{
    title: string
    status: ClientPreflightResult['checks'][number]['status']
    detail: string
    fix: string
  }> = [
    {
      title: '前端站点',
      status: mergeCheckStatus([checkById.get('demo-mode'), checkById.get('supabase-env')]),
      detail: checkById.get('supabase-env')?.detail ?? '正在检查前端配置。',
      fix: '若异常，请确认 GitHub Pages Secrets 中有 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。',
    },
    {
      title: 'Supabase 后端',
      status: mergeCheckStatus([checkById.get('auth-session')]),
      detail: checkById.get('auth-session')?.detail ?? '正在检查登录会话。',
      fix: '若异常，请重新登录，并确认 Supabase Auth 已创建该用户。',
    },
    {
      title: '私密文件',
      status: mergeCheckStatus([checkById.get('storage')]),
      detail: checkById.get('storage')?.detail ?? '正在检查 html-docs。',
      fix: 'Storage 不可访问时，请确认 html-docs bucket 和 RLS 已创建。',
    },
    {
      title: 'AI 服务',
      status: mergeCheckStatus([checkById.get('edge-functions'), checkById.get('ai-profile-config')]),
      detail: checkById.get('edge-functions')?.detail ?? '正在检查 AI 服务。',
      fix: '若异常，请确认 Edge Functions 已部署，并且 AI secrets 已配置。',
    },
  ]

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">System Health</p>
          <h1>系统体检</h1>
        </div>
        <button className="ghost-button" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          重新体检
        </button>
      </div>

      {error ? <InlineNotice tone="danger" title="检查失败" body={error} /> : null}

      <div className="metric-strip">
        <Metric label="通过" value={passed.toString()} icon={Check} />
        <Metric label="警告" value={warnings.toString()} icon={ShieldCheck} />
        <Metric label="失败" value={failed.toString()} icon={X} />
        <Metric label="模式" value={isDemoMode ? 'Demo' : 'Live'} icon={Server} />
      </div>

      <section className="deploy-grid">
        <article className="deploy-panel">
          <h2>详细状态</h2>
          <div className="check-list">
            {checks.map((check) => (
              <div className={`check-row ${check.status}`} key={check.id}>
                <span>{check.status === 'pass' ? <Check size={17} /> : check.status === 'warn' ? <ShieldCheck size={17} /> : <X size={17} />}</span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <p className="deploy-time">
            {result ? `最后检查：${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(result.generatedAt))}` : '等待检查'}
          </p>
        </article>

        <article className="deploy-panel">
          <h2>四项体检</h2>
          <div className="health-zone-list">
            {healthZones.map((zone) => (
              <section className={`health-zone ${zone.status}`} key={zone.title}>
                <div>
                  <strong>{zone.title}</strong>
                  <span>{statusText(zone.status)}</span>
                </div>
                <p>{zone.detail}</p>
                {zone.status !== 'pass' ? <em>{zone.fix}</em> : null}
              </section>
            ))}
          </div>
        </article>

        <AiConfigCenter
          profiles={aiProfiles}
          health={aiHealth}
          healthLoading={aiHealthLoading}
          healthError={aiHealthError}
          requestBreakdown={aiRequestBreakdown}
          featureConfig={aiFeatureConfig}
          featureLoading={aiFeatureLoading}
          featureSaving={aiFeatureSaving}
          providerSaving={aiProviderSaving}
          featureError={aiFeatureError}
          onRunHealth={() => void runAiHealth()}
          onReloadConfig={() => void loadAiFeatureConfig()}
          onSaveBindings={(bindings) => void saveAiBindings(bindings)}
          onSaveProvider={(draft) => void saveAiProvider(draft)}
          onDeleteProvider={(profileId) => void removeAiProvider(profileId)}
        />

        <article className="deploy-panel wide">
          <h2>安全边界</h2>
          <div className="security-grid">
            <span>
              <LockKeyhole size={17} />
              不要把 service role key 放进前端仓库
            </span>
            <span>
              <ShieldCheck size={17} />
              GitHub Pages 只托管静态前端
            </span>
            <span>
              <UploadCloud size={17} />
              私密 HTML 只进 Supabase Storage
            </span>
            <span>
              <Sparkles size={17} />
              AI API key 只放 Edge Function secrets
            </span>
          </div>
        </article>
      </section>
    </section>
  )
}

function AiConfigCenter({
  profiles,
  health,
  healthLoading,
  healthError,
  requestBreakdown,
  featureConfig,
  featureLoading,
  featureSaving,
  providerSaving,
  featureError,
  onRunHealth,
  onReloadConfig,
  onSaveBindings,
  onSaveProvider,
  onDeleteProvider,
}: {
  profiles: AiProfile[]
  health: AiHealthResult | null
  healthLoading: boolean
  healthError: string
  requestBreakdown: AiRequestBreakdown
  featureConfig: AiFeatureConfigPayload | null
  featureLoading: boolean
  featureSaving: boolean
  providerSaving: boolean
  featureError: string
  onRunHealth: () => void
  onReloadConfig: () => void
  onSaveBindings: (bindings: AiFeatureBinding[]) => void
  onSaveProvider: (draft: AiUserProviderDraft) => void
  onDeleteProvider: (profileId: string) => void
}) {
  const healthById = new Map(health?.profiles.map((profile) => [profile.id, profile]))
  const passCount = health?.profiles.filter((profile) => profile.status === 'pass').length ?? 0
  const failCount = health?.profiles.filter((profile) => profile.status === 'fail').length ?? 0
  const activeProfiles = featureConfig?.profiles.length ? featureConfig.profiles : profiles
  const providerTemplates = featureConfig?.providerTemplates ?? []
  const [bindingDraft, setBindingDraft] = useState<Record<AiFeatureId, string | null>>({} as Record<AiFeatureId, string | null>)
  const [statsMode, setStatsMode] = useState<'feature' | 'model' | 'status'>('feature')
  const [providerDraft, setProviderDraft] = useState<AiUserProviderDraft>(() => emptyProviderDraft())
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [modelDiscovery, setModelDiscovery] = useState<AiModelDiscoveryResult | null>(null)
  const [modelLoading, setModelLoading] = useState(false)
  const [modelError, setModelError] = useState('')
  const featureStats = new Map(featureConfig?.stats.byFeature.map((item) => [item.featureId, item]) ?? [])
  const discoveredModels = modelDiscovery?.models.length
    ? modelDiscovery.models
    : providerTemplates.find((template) => template.id === selectedTemplateId || template.provider === providerDraft.provider)?.models ?? []
  const dirty = Boolean(
    featureConfig?.bindings.some((binding) => (bindingDraft[binding.featureId] ?? null) !== (binding.profileId ?? null)),
  )

  useEffect(() => {
    if (!featureConfig) return
    setBindingDraft(
      featureConfig.bindings.reduce<Record<AiFeatureId, string | null>>((draft, binding) => {
        draft[binding.featureId] = binding.profileId
        return draft
      }, {} as Record<AiFeatureId, string | null>),
    )
  }, [featureConfig])

  const selectedBindings = featureConfig?.features.map((feature) => ({
    featureId: feature.id,
    profileId: bindingDraft[feature.id] ?? activeProfiles[0]?.id ?? null,
    updatedAt: featureConfig.bindings.find((binding) => binding.featureId === feature.id)?.updatedAt ?? null,
  })) ?? []

  const updateBinding = (featureId: AiFeatureId, profileId: string) => {
    setBindingDraft((current) => ({
      ...current,
      [featureId]: profileId,
    }))
  }

  const saveBindings = () => {
    onSaveBindings(selectedBindings)
  }

  const applyProviderTemplate = (templateId: string) => {
    const template = providerTemplates.find((item) => item.id === templateId)
    setSelectedTemplateId(templateId)
    setModelError('')
    if (!template) return
    const model = template.defaultModel || template.models[0]?.id || ''
    setProviderDraft((draft) => ({
      ...draft,
      label: draft.id ? draft.label : `${template.label} 个人 API`,
      provider: template.provider,
      baseUrl: template.baseUrl,
      model,
      supportsVision: template.models.some((option) => option.capabilities.includes('vision')),
      supportsHtmlGeneration: template.models.some((option) => option.capabilities.includes('html')),
      enabled: true,
    }))
    setModelDiscovery({
      generatedAt: new Date().toISOString(),
      profileId: null,
      provider: template.provider,
      baseUrlHost: template.baseUrl ? safeUiHost(template.baseUrl) : '待填写',
      models: template.models,
      cached: true,
      error: null,
    })
  }

  const loadProviderModels = async (force = false) => {
    setModelLoading(true)
    setModelError('')
    try {
      const result = await fetchAiModelOptions({
        profileId: providerDraft.id,
        providerDraft,
        force,
      })
      setModelDiscovery(result)
      if (!providerDraft.model.trim() && result.models[0]?.id) {
        setProviderDraft((draft) => ({ ...draft, model: result.models[0].id }))
      }
      if (result.error) {
        setModelError(`自动拉取失败，已显示模板/缓存模型：${result.error}`)
      }
    } catch (caught) {
      setModelError(caught instanceof Error ? caught.message : '模型列表拉取失败，可以先手动填写模型名。')
    } finally {
      setModelLoading(false)
    }
  }

  const editProvider = (profile: AiProfile) => {
    setProviderDraft({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      baseUrl: profile.baseUrl ?? (profile.baseUrlHost ? `https://${profile.baseUrlHost}` : ''),
      model: profile.model,
      apiKey: '',
      supportsVision: Boolean(profile.supportsVision),
      supportsHtmlGeneration: profile.supportsHtmlGeneration !== false,
      enabled: profile.enabled,
    })
    setSelectedTemplateId(providerTemplates.find((template) => template.provider === profile.provider)?.id ?? '')
    setModelDiscovery(null)
    setModelError('')
  }

  const submitProvider = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSaveProvider(providerDraft)
    setProviderDraft(emptyProviderDraft())
    setModelDiscovery(null)
    setSelectedTemplateId('')
  }

  return (
    <article className="deploy-panel wide ai-config-center">
      <div className="panel-title">
        <h2>
          <Sparkles size={17} />
          AI 配置中心
        </h2>
        <button className="ghost-button" type="button" onClick={onRunHealth} disabled={healthLoading}>
          {healthLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          测试 AI 连接
        </button>
      </div>

      {healthError ? <InlineNotice tone="danger" title="AI 健康检查失败" body={healthError} /> : null}
      {featureError ? <InlineNotice tone="danger" title="AI 功能配置失败" body={featureError} /> : null}

      <InlineNotice
        tone="success"
        title="密钥安全边界"
        body={
          featureConfig
            ? `${featureConfig.security.keyStorage} 托管密钥，前端只保存功能绑定，不接触 API Key。`
            : 'API Key 只允许配置在服务端 Secrets。若将来允许用户自填 Key，需要改成加密存储或本地模式。'
        }
      />

      <div className="ai-config-summary">
        <Metric label="模型配置" value={activeProfiles.length.toString()} icon={BrainCircuit} />
        <Metric label="健康通过" value={health ? passCount.toString() : '未测'} icon={Check} />
        <Metric label="健康失败" value={health ? failCount.toString() : '未测'} icon={X} />
        <Metric label="AI 失败" value={requestBreakdown.failed.toString()} icon={ShieldCheck} />
      </div>

      <section className="ai-provider-panel">
        <div className="ai-section-title">
          <div>
            <strong>我的 API 平台</strong>
            <p>先选平台模板自动带出 Base URL 和推荐模型；API Key 只提交给后端一次，加密保存，前端之后不会回显。</p>
          </div>
        </div>
        <div className="ai-provider-template-grid" aria-label="AI 平台模板">
          {providerTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              className={selectedTemplateId === template.id ? 'ai-provider-template active' : 'ai-provider-template'}
              onClick={() => applyProviderTemplate(template.id)}
            >
              <strong>{template.label}</strong>
              <span>{template.baseUrl || 'Base URL 需手动填写'}</span>
              <small>{template.notes}</small>
            </button>
          ))}
        </div>
        <form className="ai-provider-form" onSubmit={submitProvider}>
          <label>
            显示名称
            <input value={providerDraft.label} onChange={(event) => setProviderDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="例如 SiliconFlow 个人 Key" />
          </label>
          <label>
            平台
            <input value={providerDraft.provider} onChange={(event) => setProviderDraft((draft) => ({ ...draft, provider: event.target.value }))} placeholder="openai-compatible" />
          </label>
          <label>
            Base URL
            <input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft((draft) => ({ ...draft, baseUrl: event.target.value }))} placeholder="https://api.siliconflow.cn/v1" />
          </label>
          <label>
            模型
            <div className="ai-model-input-row">
              <input
                list="ai-model-options"
                value={providerDraft.model}
                onChange={(event) => setProviderDraft((draft) => ({ ...draft, model: event.target.value }))}
                placeholder="Qwen/Qwen2.5-7B-Instruct"
              />
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => void loadProviderModels(true)}
                disabled={modelLoading || !providerDraft.baseUrl.trim() || (!providerDraft.id && !providerDraft.apiKey?.trim())}
              >
                {modelLoading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                拉模型
              </button>
            </div>
            <datalist id="ai-model-options">
              {discoveredModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {modelCapabilitySummary(model)}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            API Key
            <input
              value={providerDraft.apiKey ?? ''}
              onChange={(event) => setProviderDraft((draft) => ({ ...draft, apiKey: event.target.value }))}
              placeholder={providerDraft.id ? '留空则保留原密钥' : '只提交给后端加密保存'}
              type="password"
              autoComplete="off"
            />
          </label>
          <div className="ai-provider-toggles">
            <label className="toggle-row">
              <input type="checkbox" checked={providerDraft.supportsVision} onChange={(event) => setProviderDraft((draft) => ({ ...draft, supportsVision: event.target.checked }))} />
              <span>支持图片/视觉输入</span>
            </label>
            <label className="toggle-row">
              <input type="checkbox" checked={providerDraft.supportsHtmlGeneration} onChange={(event) => setProviderDraft((draft) => ({ ...draft, supportsHtmlGeneration: event.target.checked }))} />
              <span>允许用于 HTML 生成</span>
            </label>
          </div>
          {discoveredModels.length ? (
            <div className="ai-model-chip-list">
              {discoveredModels.slice(0, 12).map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={providerDraft.model === model.id ? 'active' : undefined}
                  onClick={() => {
                    setProviderDraft((draft) => ({
                      ...draft,
                      model: model.id,
                      supportsVision: model.capabilities.includes('vision') || draft.supportsVision,
                      supportsHtmlGeneration: model.capabilities.includes('html') || draft.supportsHtmlGeneration,
                    }))
                  }}
                >
                  <strong>{model.label}</strong>
                  <span>{modelCapabilitySummary(model)}</span>
                </button>
              ))}
            </div>
          ) : null}
          {modelDiscovery ? (
            <p className="ai-model-discovery-note">
              模型来源：{modelDiscovery.cached ? '缓存/模板' : 'Provider 实时返回'} · Host：{modelDiscovery.baseUrlHost} · {formatDateTime(modelDiscovery.generatedAt)}
            </p>
          ) : null}
          {modelError ? <p className="ai-profile-error">{modelError}</p> : null}
          <div className="ai-config-actions">
            <button className="primary-button compact" type="submit" disabled={providerSaving || !providerDraft.label.trim() || !providerDraft.baseUrl.trim() || !providerDraft.model.trim() || (!providerDraft.id && !providerDraft.apiKey?.trim())}>
              {providerSaving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
              {providerDraft.id ? '保存 API' : '添加 API'}
            </button>
            {providerDraft.id ? (
              <button className="ghost-button" type="button" onClick={() => setProviderDraft(emptyProviderDraft())} disabled={providerSaving}>
                <X size={18} />
                取消编辑
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="ai-feature-panel">
        <div className="ai-section-title">
          <div>
            <strong>功能接口绑定</strong>
            <p>为每个 AI 功能指定默认接口；页面上的手动模型选择仍会优先覆盖这里。</p>
          </div>
          <div className="ai-config-actions">
            <button className="ghost-button" type="button" onClick={onReloadConfig} disabled={featureLoading}>
              {featureLoading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
              刷新配置
            </button>
            <button className="primary-button compact" type="button" onClick={saveBindings} disabled={featureSaving || !dirty || selectedBindings.length === 0}>
              {featureSaving ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
              保存并验证
            </button>
          </div>
        </div>

        {!featureConfig ? (
          <div className="empty-state compact">
            <Settings2 size={22} />
            <strong>{featureLoading ? '正在读取功能配置' : '还没有功能配置数据'}</strong>
            <p>{featureLoading ? '正在连接 ai-feature-config。' : '请确认 ai-feature-config 已部署。'}</p>
          </div>
        ) : (
          <div className="ai-feature-grid">
            {featureConfig.features.map((feature) => {
              const selectedBinding = featureConfig.bindings.find((binding) => binding.featureId === feature.id)
              const selectedProfileId = bindingDraft[feature.id] ?? selectedBinding?.profileId ?? ''
              const selectedProfile = activeProfiles.find((profile) => profile.id === selectedProfileId)
              const stats = featureStats.get(feature.requestType) ?? featureStats.get(feature.id)
              const mismatch = selectedProfile ? profileCapabilityMismatch(feature.requiredCapability, selectedProfile) : ''
              return (
                <section className={`ai-feature-card ${feature.status}`} key={feature.id}>
                  <div className="ai-feature-card-head">
                    <div>
                      <strong>{feature.label}</strong>
                      <span>{feature.description}</span>
                    </div>
                    <span className={`status-pill ${feature.status === 'available' ? 'pass' : 'fail'}`}>
                      {feature.status === 'available' ? '后端可用' : feature.status === 'not_deployed' ? '未部署' : '未配置'}
                    </span>
                  </div>
                  <label>
                    默认接口
                    <select
                      value={selectedProfileId}
                      onChange={(event) => updateBinding(feature.id, event.target.value)}
                      disabled={activeProfiles.length === 0 || feature.status === 'not_deployed'}
                    >
                      <option value="">未绑定：使用系统默认</option>
                      {activeProfiles.map((profile) => (
                        <option key={`${feature.id}-${profile.id}`} value={profile.id}>
                          {profile.label} · {profile.model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="ai-feature-meta">
                    <span>函数：{feature.functionName}</span>
                    <span>能力：{capabilityLabel(feature.requiredCapability)}</span>
                    <span>当前模型：{selectedProfile?.model ?? '未绑定'}</span>
                    <span>Host：{selectedProfile?.baseUrlHost ?? '未公开'}</span>
                    <span>验证：{validationLabel(selectedBinding)}</span>
                    <span>实用模型：{selectedBinding?.validatedModel ?? selectedProfile?.model ?? '未验证'}</span>
                    <span>最近调用：{formatDateTime(stats?.lastCalledAt ?? null)}</span>
                    <span>成功/失败：{stats ? `${stats.ok}/${stats.error}` : '0/0'}</span>
                  </div>
                  {mismatch ? <p className="ai-profile-error">{mismatch}</p> : null}
                  {selectedBinding?.validationError ? <p className="ai-profile-error">{selectedBinding.validationError}</p> : null}
                </section>
              )
            })}
          </div>
        )}
      </section>

      <div className="ai-profile-grid">
        {activeProfiles.length === 0 ? (
          <div className="empty-state compact">
            <Sparkles size={22} />
            <strong>没有读取到 AI 模型</strong>
            <p>请部署 ai-profiles 并在 Supabase Edge Function Secrets 中配置模型。</p>
          </div>
        ) : (
          activeProfiles.map((profile) => {
            const healthProfile = healthById.get(profile.id)
            const status = healthProfile?.status ?? (profile.configured === false ? 'fail' : 'idle')
            return (
              <section className={`ai-profile-card ${status}`} key={profile.id}>
                <div className="ai-profile-head">
                  <div>
                    <strong>{profile.label}</strong>
                    <span>{profile.provider}</span>
                  </div>
                  <span className={`status-pill ${status}`}>
                    {status === 'pass' ? '可用' : status === 'fail' ? '异常' : '未测试'}
                  </span>
                </div>
                <div className="ai-profile-meta">
                  <span>模型：{profile.model}</span>
                  <span>Host：{healthProfile?.baseUrlHost ?? profile.baseUrlHost ?? '未公开'}</span>
                  <span>来源：{profile.source === 'user' ? '我的 API' : '系统预设'}</span>
                  <span>密钥：{profile.source === 'user' ? profile.keyHint ?? '已加密保存' : (healthProfile?.configured ?? profile.configured ?? true) ? '已配置或待确认' : '未配置'}</span>
                  {profile.supportsVision ? <span>能力：视觉输入</span> : null}
                  {profile.supportsHtmlGeneration === false ? <span>限制：不用于 HTML 生成</span> : null}
                  {healthProfile?.latencyMs !== undefined && healthProfile.latencyMs !== null ? (
                    <span>延迟：{formatLatency(healthProfile.latencyMs)}</span>
                  ) : null}
                  {healthProfile ? <span>检查：{formatDateTime(healthProfile.checkedAt)}</span> : null}
                </div>
                {healthProfile?.error ? <p className="ai-profile-error">{healthProfile.error}</p> : null}
                {profile.source === 'user' ? (
                  <div className="ai-profile-actions">
                    <button className="ghost-button" type="button" onClick={() => editProvider(profile)} disabled={providerSaving}>
                      编辑
                    </button>
                    <button className="ghost-button danger" type="button" onClick={() => onDeleteProvider(profile.id)} disabled={providerSaving}>
                      删除
                    </button>
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </div>

      {featureConfig ? (
        <div className="ai-stats-panel">
          <div className="ai-section-title">
            <div>
              <strong>调用统计</strong>
              <p>按功能、模型和状态查看最近 {featureConfig.stats.total} 次 AI 调用。</p>
            </div>
            <div className="segmented-tabs">
              {(['feature', 'model', 'status'] as const).map((mode) => (
                <button key={mode} type="button" className={statsMode === mode ? 'active' : undefined} onClick={() => setStatsMode(mode)}>
                  {mode === 'feature' ? '按功能' : mode === 'model' ? '按模型' : '按状态'}
                </button>
              ))}
            </div>
          </div>
          <div className="ai-stat-table">
            {statsMode === 'feature'
              ? featureConfig.stats.byFeature.map((item) => (
                  <AiStatRow
                    key={item.featureId}
                    label={featureLabel(featureConfig, item.featureId)}
                    total={item.total}
                    ok={item.ok}
                    error={item.error}
                    lastCalledAt={item.lastCalledAt}
                  />
                ))
              : statsMode === 'model'
                ? featureConfig.stats.byModel.map((item) => (
                    <AiStatRow
                      key={item.model}
                      label={item.model}
                      total={item.total}
                      ok={item.ok}
                      error={item.error}
                      lastCalledAt={item.lastCalledAt}
                    />
                  ))
                : featureConfig.stats.byStatus.map((item) => (
                    <div className="ai-stat-row" key={item.status}>
                      <strong>{item.status === 'error' ? '失败' : item.status}</strong>
                      <span>次数 {item.count}</span>
                      <span />
                      <span />
                    </div>
                  ))}
          </div>
        </div>
      ) : null}

      <div className="ai-request-stats">
        <span>解释 {requestBreakdown.explain}</span>
        <span>摘要 {requestBreakdown.summarize}</span>
        <span>生成 {requestBreakdown.generateHtml}</span>
        <span>健康检查 {requestBreakdown.healthCheck}</span>
        <span>失败 {requestBreakdown.failed}</span>
      </div>
      <p className="deploy-time">
        {health ? `最后 AI 检查：${formatDateTime(health.generatedAt)}` : 'AI 连接测试只会发起一次极短真实调用，API key 不会返回前端。'}
      </p>
    </article>
  )
}

function AiStatRow({
  label,
  total,
  ok,
  error,
  lastCalledAt,
}: {
  label: string
  total: number
  ok: number
  error: number
  lastCalledAt: string | null
}) {
  return (
    <div className="ai-stat-row">
      <strong>{label}</strong>
      <span>总计 {total}</span>
      <span>成功 {ok} / 失败 {error}</span>
      <span>{formatDateTime(lastCalledAt)}</span>
    </div>
  )
}

function emptyProviderDraft(): AiUserProviderDraft {
  return {
    label: '',
    provider: 'openai-compatible',
    baseUrl: '',
    model: '',
    apiKey: '',
    supportsVision: false,
    supportsHtmlGeneration: true,
    enabled: true,
  }
}

function PersonasView({
  personas,
  aiProfiles,
  onSave,
}: {
  personas: Persona[]
  aiProfiles: AiProfile[]
  onSave: (draft: PersonaDraft, persona?: Persona) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [tone, setTone] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [modelId, setModelId] = useState<string | null>(aiProfiles[0]?.id ?? null)
  const [companionEnabled, setCompanionEnabled] = useState(true)
  const [visualConfig, setVisualConfig] = useState<CompanionVisualConfig>(() => defaultCompanionVisualConfig)
  const [saving, setSaving] = useState(false)
  const editingPersona = personas.find((persona) => persona.id === editingId)

  const resetForm = () => {
    setEditingId(null)
    setName('')
    setTone('')
    setSystemPrompt('')
    setModelId(aiProfiles[0]?.id ?? null)
    setCompanionEnabled(true)
    setVisualConfig(defaultCompanionVisualConfig)
  }

  const editPersona = (persona: Persona) => {
    setEditingId(persona.id)
    setName(persona.name)
    setTone(persona.tone)
    setSystemPrompt(persona.system_prompt)
    setModelId(persona.default_model)
    setCompanionEnabled(persona.companion_enabled)
    setVisualConfig(normalizeCompanionVisualConfig(persona.visual_config))
  }

  const patchVisualConfig = (patch: Partial<CompanionVisualConfig>) => {
    setVisualConfig((current) => normalizeCompanionVisualConfig({ ...current, ...patch }))
  }

  const patchPalette = (key: keyof CompanionVisualConfig['palette'], value: string) => {
    setVisualConfig((current) =>
      normalizeCompanionVisualConfig({
        ...current,
        palette: {
          ...current.palette,
          [key]: value,
        },
      }),
    )
  }

  const patchFeatures = (patch: Partial<CompanionVisualConfig['features']>) => {
    setVisualConfig((current) =>
      normalizeCompanionVisualConfig({
        ...current,
        features: {
          ...current.features,
          ...patch,
        },
      }),
    )
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(
        {
          name: name.trim(),
          tone: tone.trim(),
          system_prompt: systemPrompt.trim(),
          default_model: modelId,
          visual_config: normalizeCompanionVisualConfig(visualConfig),
          companion_enabled: companionEnabled,
        },
        editingPersona,
      )
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Personas</p>
          <h1>虚拟人物</h1>
        </div>
      </div>

      <div className="persona-layout persona-designer-layout">
        <form className="persona-form persona-designer" onSubmit={submit}>
          <div className="panel-title">
            <h2>{editingPersona ? '编辑人物和宠物形象' : '创建人物和宠物形象'}</h2>
            {editingPersona ? (
              <button className="ghost-button" type="button" onClick={resetForm}>
                <RotateCcw size={17} />
                新建
              </button>
            ) : null}
          </div>
          <div className="persona-editor-grid">
            <div className="persona-fields">
              <label>
                名称
                <input value={name} onChange={(event) => setName(event.target.value)} required placeholder="例如：学术导师" />
              </label>
              <label>
                语气
                <input value={tone} onChange={(event) => setTone(event.target.value)} required placeholder="清晰、耐心、直接" />
              </label>
              <label>
                系统提示词
                <textarea
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  required
                  rows={7}
                  placeholder="告诉这个人物如何解释、总结和陪你阅读。"
                />
              </label>
              <label>
                默认模型
                <select value={modelId ?? ''} onChange={(event) => setModelId(event.target.value || null)}>
                  {aiProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="persona-preview-panel">
              <CompanionPetPreview config={visualConfig} enabled={companionEnabled} label={name || '陪读宠物'} />
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={companionEnabled}
                  onChange={(event) => setCompanionEnabled(event.target.checked)}
                />
                <span>全站启用陪读宠物</span>
              </label>
            </div>
          </div>
          <div className="visual-config-grid">
            <label>
              身体形状
              <select
                value={visualConfig.bodyShape}
                onChange={(event) => patchVisualConfig({ bodyShape: event.target.value as CompanionVisualConfig['bodyShape'] })}
              >
                <option value="bean">豆豆</option>
                <option value="orb">圆球</option>
                <option value="capsule">胶囊</option>
              </select>
            </label>
            <label>
              表情
              <select
                value={visualConfig.expression}
                onChange={(event) => patchVisualConfig({ expression: event.target.value as CompanionVisualConfig['expression'] })}
              >
                <option value="curious">好奇</option>
                <option value="happy">开心</option>
                <option value="focused">专注</option>
              </select>
            </label>
            <label>
              动作速度
              <select
                value={visualConfig.motion}
                onChange={(event) => patchVisualConfig({ motion: event.target.value as CompanionVisualConfig['motion'] })}
              >
                <option value="still">安静</option>
                <option value="gentle">轻柔</option>
                <option value="lively">活泼</option>
              </select>
            </label>
            <label>
              尺寸
              <select
                value={visualConfig.size}
                onChange={(event) => patchVisualConfig({ size: event.target.value as CompanionVisualConfig['size'] })}
              >
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </label>
            <label>
              耳朵
              <select
                value={visualConfig.features.ears}
                onChange={(event) => patchFeatures({ ears: event.target.value as CompanionVisualConfig['features']['ears'] })}
              >
                <option value="none">无</option>
                <option value="soft">软耳</option>
                <option value="pointed">尖耳</option>
              </select>
            </label>
            <label>
              尾巴
              <select
                value={visualConfig.features.tail}
                onChange={(event) => patchFeatures({ tail: event.target.value as CompanionVisualConfig['features']['tail'] })}
              >
                <option value="none">无</option>
                <option value="curl">卷尾</option>
                <option value="spark">星尾</option>
              </select>
            </label>
          </div>
          <div className="color-config-grid">
            <label>
              身体主色
              <input type="color" value={visualConfig.palette.body} onChange={(event) => patchPalette('body', event.target.value)} />
            </label>
            <label>
              强调色
              <input type="color" value={visualConfig.palette.accent} onChange={(event) => patchPalette('accent', event.target.value)} />
            </label>
            <label>
              眼睛
              <input type="color" value={visualConfig.palette.eye} onChange={(event) => patchPalette('eye', event.target.value)} />
            </label>
            <label>
              腮红
              <input type="color" value={visualConfig.palette.cheek} onChange={(event) => patchPalette('cheek', event.target.value)} />
            </label>
          </div>
          <div className="feature-toggles">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={visualConfig.features.antenna}
                onChange={(event) => patchFeatures({ antenna: event.target.checked })}
              />
              <span>天线</span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={visualConfig.features.glasses}
                onChange={(event) => patchFeatures({ glasses: event.target.checked })}
              />
              <span>眼镜</span>
            </label>
          </div>
          <button className="primary-button" disabled={saving || !name.trim() || !tone.trim() || !systemPrompt.trim()}>
            {saving ? <Loader2 className="spin" size={18} /> : <UserRoundPlus size={18} />}
            {editingPersona ? '保存修改' : '保存人物'}
          </button>
        </form>

        <div className="persona-list">
          {personas.length === 0 ? (
            <div className="empty-state">
              <BrainCircuit size={22} />
              <strong>还没有虚拟人物</strong>
              <p>创建后，阅读页会用它的提示词、语气和默认模型。</p>
            </div>
          ) : (
            personas.map((persona) => (
              <article className="persona-card companion-persona-card" key={persona.id}>
                <CompanionPetPreview config={persona.visual_config} enabled={persona.companion_enabled} compact label={persona.name} />
                <div>
                  <h2>{persona.name}</h2>
                  <p>{persona.tone}</p>
                  <div className="persona-card-actions">
                    <span>{persona.default_model ?? '默认模型'}</span>
                    <button className="ghost-button" type="button" onClick={() => editPersona(persona)}>
                      编辑
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function CompanionPetPreview({
  config,
  enabled,
  compact = false,
  state = 'idle',
  label,
}: {
  config: CompanionVisualConfig
  enabled: boolean
  compact?: boolean
  state?: CompanionState
  label: string
}) {
  const normalized = normalizeCompanionVisualConfig(config)
  const classes = [
    'companion-pet',
    `shape-${normalized.bodyShape}`,
    `motion-${normalized.motion}`,
    `expression-${normalized.expression}`,
    `size-${normalized.size}`,
    `state-${state}`,
    compact ? 'compact' : '',
    enabled ? '' : 'disabled',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={classes}
      role="img"
      aria-label={`${label}的陪读宠物预览`}
      style={
        {
          '--pet-body': normalized.palette.body,
          '--pet-accent': normalized.palette.accent,
          '--pet-eye': normalized.palette.eye,
          '--pet-cheek': normalized.palette.cheek,
        } as CSSProperties
      }
    >
      {normalized.features.tail !== 'none' ? <span className={`pet-tail ${normalized.features.tail}`} /> : null}
      {normalized.features.ears !== 'none' ? (
        <>
          <span className={`pet-ear left ${normalized.features.ears}`} />
          <span className={`pet-ear right ${normalized.features.ears}`} />
        </>
      ) : null}
      {normalized.features.antenna ? <span className="pet-antenna" /> : null}
      <span className="pet-body">
        <span className="pet-eye left" />
        <span className="pet-eye right" />
        <span className="pet-cheek left" />
        <span className="pet-cheek right" />
        <span className="pet-mouth" />
        {normalized.features.glasses ? <span className="pet-glasses" /> : null}
      </span>
      <span className="pet-shadow" />
    </div>
  )
}

function CompanionDock({
  route,
  personas,
  activeDocument,
  onNavigate,
}: {
  route: RouteState
  personas: Persona[]
  activeDocument: DocumentRecord | null
  onNavigate: (view: AppView) => void
}) {
  const availablePersonas = personas.filter((persona) => persona.companion_enabled)
  const [enabled, setEnabled] = useState(() => getStoredBoolean(storageKeys.companionEnabled, true))
  const [collapsed, setCollapsed] = useState(() => getStoredBoolean(storageKeys.companionCollapsed, false))
  const [size, setSize] = useState<CompanionDockSize>(() => getStoredCompanionSize())
  const [position, setPosition] = useState<CompanionPosition>(() => getStoredCompanionPosition(getStoredCompanionSize()))
  const [selectedPersonaId, setSelectedPersonaId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.localStorage.getItem(storageKeys.companionPersona) ?? ''
  })
  const [panelOpen, setPanelOpen] = useState(false)
  const [state, setState] = useState<CompanionState>('idle')
  const [message, setMessage] = useState('我在这里，陪你读。')
  const [nearby, setNearby] = useState(false)
  const [dragging, setDragging] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; moved: boolean } | null>(null)
  const persona =
    availablePersonas.find((item) => item.id === selectedPersonaId) ??
    availablePersonas[0] ??
    personas[0] ?? {
      id: 'default-companion',
      owner_id: 'demo',
      name: '陪读伙伴',
      avatar_url: null,
      tone: '轻快、聪明、陪伴式',
      system_prompt: '',
      default_model: null,
      visual_config: defaultCompanionVisualConfig,
      companion_enabled: true,
      created_at: new Date().toISOString(),
    }

  const baseState: CompanionState = route.view === 'reader' ? (activeDocument ? 'reading' : 'idle') : 'idle'

  useEffect(() => {
    window.localStorage.setItem(storageKeys.companionEnabled, String(enabled))
  }, [enabled])

  useEffect(() => {
    window.localStorage.setItem(storageKeys.companionCollapsed, String(collapsed))
  }, [collapsed])

  useEffect(() => {
    window.localStorage.setItem(storageKeys.companionSize, size)
    setPosition((current) => clampCompanionPosition(current, size))
  }, [size])

  useEffect(() => {
    window.localStorage.setItem(storageKeys.companionPosition, JSON.stringify(position))
  }, [position])

  useEffect(() => {
    if (selectedPersonaId) window.localStorage.setItem(storageKeys.companionPersona, selectedPersonaId)
  }, [selectedPersonaId])

  useEffect(() => {
    if (!selectedPersonaId && persona.id) {
      setSelectedPersonaId(persona.id)
    }
  }, [persona.id, selectedPersonaId])

  useEffect(() => {
    const onResize = () => setPosition((current) => clampCompanionPosition(current, size))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [size])

  useEffect(() => {
    const handleStatus = (event: Event) => {
      const detail = (event as CustomEvent<CompanionStatusDetail>).detail
      if (!detail?.state) return
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      setState(detail.state)
      if (detail.message) setMessage(detail.message)
      const duration = detail.durationMs ?? (detail.state === 'thinking' ? 0 : 2600)
      if (duration > 0) {
        timeoutRef.current = window.setTimeout(() => {
          setState(baseState)
          setMessage(baseState === 'reading' && activeDocument ? `正在陪你读《${activeDocument.title}》。` : '我在这里，陪你读。')
        }, duration)
      }
    }
    window.addEventListener(companionEvents.status, handleStatus)
    return () => {
      window.removeEventListener(companionEvents.status, handleStatus)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [activeDocument, baseState])

  useEffect(() => {
    const handlePersonaChange = (event: Event) => {
      const detail = (event as CustomEvent<{ personaId: string }>).detail
      if (detail?.personaId) {
        setSelectedPersonaId(detail.personaId)
        setState('happy')
        setMessage('人物已同步，我会按这个角色陪你。')
      }
    }
    window.addEventListener(companionEvents.personaChange, handlePersonaChange)
    return () => window.removeEventListener(companionEvents.personaChange, handlePersonaChange)
  }, [])

  useEffect(() => {
    if (state === 'thinking' || state === 'selection' || state === 'success' || state === 'warning' || state === 'happy') return
    setState(baseState)
    setMessage(baseState === 'reading' && activeDocument ? `正在陪你读《${activeDocument.title}》。` : '我在这里，陪你读。')
  }, [activeDocument, baseState, route.view, state])

  const moveTo = (clientX: number, clientY: number, offsetX: number, offsetY: number) => {
    const next = clampCompanionPosition({ x: clientX - offsetX, y: clientY - offsetY }, size)
    setPosition(next)
    const avoidBottom = window.innerWidth <= 760 && next.y > window.innerHeight - 260
    setNearby(avoidBottom)
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, select')) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    setState('follow')
    setMessage('拖到顺手的位置就好。')
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.moved = true
    moveTo(event.clientX, event.clientY, drag.offsetX, drag.offsetY)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    setState('happy')
    setMessage(drag.moved ? '这里不错，我先停在这。' : '需要我帮你看这页吗？')
    window.setTimeout(() => setState(baseState), 1400)
  }

  const handlePetClick = () => {
    if (dragRef.current?.moved) return
    setPanelOpen((open) => !open)
    setState('happy')
    setMessage(route.view === 'reader' ? '选中文字后，我可以帮你解释或总结。' : '打开阅读页时，我会提示可用动作。')
  }

  const setStatusFromPanel = (nextState: CompanionState, nextMessage: string) => {
    setState(nextState)
    setMessage(nextMessage)
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => setState(baseState), 1800)
  }

  if (!enabled) {
    return (
      <button className="companion-enable-button" type="button" onClick={() => setEnabled(true)}>
        <Sparkles size={17} />
        召回陪读宠物
      </button>
    )
  }

  return createPortal(
    <div
      className={[
        'companion-dock',
        `dock-${size}`,
        `dock-state-${state}`,
        collapsed ? 'collapsed' : '',
        dragging ? 'dragging' : '',
        nearby ? 'avoid-bottom' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          '--dock-x': `${position.x}px`,
          '--dock-y': `${position.y}px`,
        } as CSSProperties
      }
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <AnimatePresence>
        {!collapsed ? (
          <motion.div className="companion-bubble" variants={panelMotion} initial="hidden" animate="show" exit="exit">
            <span>{message}</span>
            <button type="button" onClick={() => setCollapsed(true)} aria-label="折叠陪读宠物">
              <X size={14} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button className="companion-pet-button" type="button" onClick={handlePetClick} aria-label="打开陪读宠物">
        <CompanionPetPreview config={persona.visual_config} enabled={persona.companion_enabled} state={state} compact={size === 'small'} label={persona.name} />
      </button>

      <AnimatePresence>
        {panelOpen && !collapsed ? (
          <motion.div className="companion-panel" variants={panelMotion} initial="hidden" animate="show" exit="exit">
            <div className="companion-panel-head">
              <div>
                <strong>{persona.name}</strong>
                <span>{route.view === 'reader' && activeDocument ? activeDocument.title : '全站陪读中'}</span>
              </div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭宠物面板">
                <X size={15} />
              </button>
            </div>
            <label>
              人物
              <select
                value={persona.id}
                onChange={(event) => {
                  setSelectedPersonaId(event.target.value)
                  dispatchCompanionPersonaChange(event.target.value)
                }}
              >
                {personas.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              大小
              <select value={size} onChange={(event) => setSize(event.target.value as CompanionDockSize)}>
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </label>
            <div className="companion-panel-actions">
              <button type="button" onClick={() => setStatusFromPanel('happy', '今天也推进了一点点，很稳。')}>
                开心
              </button>
              <button type="button" onClick={() => setStatusFromPanel('thinking', '我先想一想。')}>
                思考
              </button>
              {route.view === 'reader' ? (
                <button
                  type="button"
                  onClick={() => {
                    dispatchQuickAction(quickActionEvents.readerHighlights)
                    setPanelOpen(false)
                  }}
                >
                  阅读助手
                </button>
              ) : null}
              <button type="button" onClick={() => onNavigate('personas')}>
                编辑
              </button>
            </div>
            <button className="companion-off-button" type="button" onClick={() => setEnabled(false)}>
              暂时关闭宠物
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {collapsed ? (
        <button
          className="companion-dot"
          type="button"
          onClick={() => {
            setCollapsed(false)
            setState('happy')
            setMessage('我回来了。')
          }}
          aria-label="展开陪读宠物"
        />
      ) : null}
    </div>,
    document.body,
  )
}

function ReaderView({
  user,
  document,
  personas,
  aiProfiles,
  onBack,
  onFavorite,
  onProgress,
}: {
  user: AppUser
  document: DocumentRecord
  personas: Persona[]
  aiProfiles: AiProfile[]
  onBack: () => void
  onFavorite: (document: DocumentRecord, favorite: boolean) => void
  onProgress: (documentId: string, lastScroll: number) => void
}) {
  const [rawHtml, setRawHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [readerError, setReaderError] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  const [highlightColor, setHighlightColor] = useState(defaultHighlightColor)
  const [textColor, setTextColor] = useState('')
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [progress, setProgress] = useState(document.last_scroll ?? 0)
  const [initialScroll, setInitialScroll] = useState(document.last_scroll ?? 0)
  const [renderMode, setRenderMode] = useState<ReaderRenderMode>('read')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [activePersonaId, setActivePersonaId] = useState(personas[0]?.id)
  const [activeModelId, setActiveModelId] = useState(personas[0]?.default_model ?? aiProfiles[0]?.id)
  const sessionId = useRef<string | null>(null)
  const startedAt = useRef(Date.now())
  const progressRef = useRef(document.last_scroll ?? 0)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const selectedTextRef = useRef('')
  const selectionLocatorRef = useRef<AnnotationLocator | null>(null)
  const highlightsRef = useRef<Highlight[]>([])
  const highlightColorRef = useRef(defaultHighlightColor)
  const textColorRef = useRef('')
  const styleOperationRef = useRef<Promise<void>>(Promise.resolve())
  const replaceHighlights = useCallback((next: Highlight[] | ((items: Highlight[]) => Highlight[])) => {
    const resolved = typeof next === 'function' ? next(highlightsRef.current) : next
    highlightsRef.current = resolved
    setHighlights(resolved)
  }, [])
  const activePersona = useMemo(
    () => personas.find((persona) => persona.id === activePersonaId) ?? personas[0],
    [activePersonaId, personas],
  )

  useEffect(() => {
    const startScroll = document.last_scroll ?? 0
    setLoading(true)
    setReaderError('')
    setSessionError('')
    setRawHtml('')
    selectedTextRef.current = ''
    selectionLocatorRef.current = null
    setSelectedText('')
    setNoteDraft('')
    highlightColorRef.current = defaultHighlightColor
    textColorRef.current = ''
    setHighlightColor(defaultHighlightColor)
    setTextColor('')
    replaceHighlights([])
    setProgress(startScroll)
    setInitialScroll(startScroll)
    setRenderMode('read')
    progressRef.current = startScroll
    void fetchDocumentHtml(document)
      .then(setRawHtml)
      .catch((error) => {
        setReaderError(error instanceof Error ? error.message : 'HTML 文件加载失败。')
      })
      .finally(() => setLoading(false))
  }, [document.id, document.storage_path, replaceHighlights])

  useEffect(() => {
    let active = true
    void fetchHighlights(document).then((items) => {
      if (active) replaceHighlights(items)
    })
    return () => {
      active = false
    }
  }, [document.id, replaceHighlights])

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  const srcDoc = useMemo(() => createReaderSrcDoc(rawHtml, initialScroll, renderMode), [initialScroll, rawHtml, renderMode])

  const postAnnotationsToReader = useCallback((items: Highlight[]) => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'html-reader-annotations', highlights: items }, '*')
  }, [])

  useEffect(() => {
    postAnnotationsToReader(highlights)
  }, [highlights, postAnnotationsToReader, srcDoc])

  useEffect(() => {
    if (!activePersonaId && personas[0]) {
      setActivePersonaId(personas[0].id)
    }
  }, [activePersonaId, personas])

  useEffect(() => {
    if (activePersona?.default_model) {
      setActiveModelId(activePersona.default_model)
    }
  }, [activePersona?.default_model, activePersona?.id])

  useEffect(() => {
    if (activePersonaId) dispatchCompanionPersonaChange(activePersonaId)
  }, [activePersonaId])

  useEffect(() => {
    const handlePersonaChange = (event: Event) => {
      const nextPersonaId = (event as CustomEvent<{ personaId: string }>).detail?.personaId
      if (nextPersonaId && personas.some((persona) => persona.id === nextPersonaId)) {
        setActivePersonaId(nextPersonaId)
      }
    }
    window.addEventListener(companionEvents.personaChange, handlePersonaChange)
    return () => window.removeEventListener(companionEvents.personaChange, handlePersonaChange)
  }, [personas])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; id?: string; text?: string; locator?: AnnotationLocator | null; scroll?: number }
      if (data.type === 'html-reader-selection' && data.text) {
        const nextText = data.text.slice(0, 1200)
        const nextLocator = data.locator ?? null
        const matchedHighlight = highlightsRef.current.find((highlight) => highlightIntersectsSelection(highlight, nextText, nextLocator))
        const nextHighlightColor = matchedHighlight?.color ?? defaultHighlightColor
        const nextTextColor = matchedHighlight?.text_color ?? ''
        selectedTextRef.current = nextText
        selectionLocatorRef.current = nextLocator
        setSelectedText(nextText)
        setNoteDraft('')
        highlightColorRef.current = nextHighlightColor
        textColorRef.current = nextTextColor
        setHighlightColor(nextHighlightColor)
        setTextColor(nextTextColor)
        setPanelOpen(true)
        dispatchCompanionStatus({ state: 'selection', message: '需要我解释这段吗？也可以直接保存笔记。' })
      }
      if (data.type === 'html-reader-annotation-click' && data.id) {
        const matchedHighlight = highlightsRef.current.find((highlight) => highlight.id === data.id)
        if (matchedHighlight) {
          const nextHighlightColor = matchedHighlight.color ?? defaultHighlightColor
          const nextTextColor = matchedHighlight.text_color ?? ''
          selectedTextRef.current = matchedHighlight.selected_text
          selectionLocatorRef.current = matchedHighlight.locator
          setSelectedText(matchedHighlight.selected_text)
          setNoteDraft('')
          highlightColorRef.current = nextHighlightColor
          textColorRef.current = nextTextColor
          setHighlightColor(nextHighlightColor)
          setTextColor(nextTextColor)
          setPanelOpen(true)
        }
      }
      if (data.type === 'html-reader-ready') {
        postAnnotationsToReader(highlightsRef.current)
      }
      if (data.type === 'html-reader-progress' && typeof data.scroll === 'number') {
        const value = Math.min(1, Math.max(0, data.scroll))
        setProgress(value)
        onProgress(document.id, value)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [document.id, onProgress, postAnnotationsToReader])

  useEffect(() => {
    startedAt.current = Date.now()
    sessionId.current = null
    let active = true

    const reportSessionError = (error: unknown) => {
      if (!active) return
      setSessionError(error instanceof Error ? error.message : '阅读会话上报失败。')
    }

    const flush = async () => {
      if (!sessionId.current) return
      const seconds = (Date.now() - startedAt.current) / 1000
      try {
        await updateReadingSession(sessionId.current, seconds, progressRef.current)
        await touchDocumentProgress(document, progressRef.current)
      } catch (error) {
        reportSessionError(error)
      }
    }

    void startReadingSession(user, document)
      .then((id) => {
        if (active) sessionId.current = id
      })
      .catch(reportSessionError)

    const interval = window.setInterval(() => {
      void flush()
    }, 15000)

    return () => {
      active = false
      window.clearInterval(interval)
      void flush()
    }
  }, [document.id, user.id])

  const explain = async () => {
    if (!selectedText) return
    setAiLoading(true)
    setAiAnswer('')
    dispatchCompanionStatus({ state: 'thinking', message: '我在解释选中的这段。', durationMs: 0 })
    try {
      const response = await askAiExplain({
        documentId: document.id,
        selectedText,
        personaId: activePersonaId,
        modelId: activeModelId,
      })
      setAiAnswer(response.answer)
      dispatchCompanionStatus({ state: 'success', message: '解释好了，我放在阅读面板里。' })
    } catch (error) {
      dispatchCompanionStatus({ state: 'warning', message: '解释失败了，稍后再试一次。' })
      throw error
    } finally {
      setAiLoading(false)
    }
  }

  const summarize = useCallback(async () => {
    setAiLoading(true)
    setAiAnswer('')
    dispatchCompanionStatus({ state: 'thinking', message: '我在总结这篇文档。', durationMs: 0 })
    try {
      const response = await requestDocumentSummary(document, {
        personaId: activePersonaId,
        modelId: activeModelId,
      })
      setAiAnswer(response.answer)
      dispatchCompanionStatus({ state: 'success', message: '摘要好了，可以快速扫一遍。' })
    } catch (error) {
      dispatchCompanionStatus({ state: 'warning', message: '摘要失败了，先检查 AI 配置。' })
      throw error
    } finally {
      setAiLoading(false)
    }
  }, [activeModelId, activePersonaId, document])

  useEffect(() => {
    const openSummary = () => {
      setPanelOpen(true)
      void summarize()
    }
    const openHighlights = () => {
      setPanelOpen(true)
    }
    window.addEventListener(quickActionEvents.readerSummary, openSummary)
    window.addEventListener(quickActionEvents.readerHighlights, openHighlights)
    return () => {
      window.removeEventListener(quickActionEvents.readerSummary, openSummary)
      window.removeEventListener(quickActionEvents.readerHighlights, openHighlights)
    }
  }, [summarize])

  const applySelectionStylePatch = async (patch: SelectionStylePatch) => {
    const currentSelectedText = selectedTextRef.current
    const selection = selectionLocatorRef.current
    if (!currentSelectedText) {
      setAiAnswer('请先选中文字。')
      return
    }

    const currentHighlights = highlightsRef.current
    const createdHighlights: Highlight[] = []
    const updates = new Map<string, Highlight | null>()
    let changed = false
    const patchHasVisibleStyle = Boolean(patch.color || patch.textColor)
    const selectionAlreadyCovered =
      isTextLocator(selection) &&
      currentHighlights.some(
        (highlight) =>
          hasVisibleHighlightStyle(highlight) &&
          isTextLocator(highlight.locator) &&
          highlight.locator.start <= selection.start &&
          highlight.locator.end >= selection.end,
      )

    const nextStyleFor = (highlight: Highlight) => ({
      color: patch.color !== undefined ? patch.color || null : highlight.color,
      textColor: patch.textColor !== undefined ? patch.textColor || null : highlight.text_color,
    })

    const patchChanges = (highlight: Highlight) => {
      const nextStyle = nextStyleFor(highlight)
      return nextStyle.color !== highlight.color || nextStyle.textColor !== highlight.text_color
    }

    const createStyleFragment = async (
      locator: AnnotationLocator | null,
      color: string | null,
      nextTextColor: string | null,
    ) => {
      if (!locator || (!color && !nextTextColor)) return
      const highlight = await saveHighlight(user, document, locator.exact, {
        color,
        textColor: nextTextColor,
        locator,
      })
      createdHighlights.push(highlight)
    }

    const updateWholeHighlight = async (highlight: Highlight) => {
      if (!patchChanges(highlight)) return
      changed = true
      const nextStyle = nextStyleFor(highlight)
      if (!hasHighlightNote(highlight) && !nextStyle.color && !nextStyle.textColor) {
        await deleteHighlight(highlight.id)
        updates.set(highlight.id, null)
        return
      }
      await updateHighlight(highlight.id, {
        color: nextStyle.color,
        textColor: nextStyle.textColor,
      })
      updates.set(highlight.id, {
        ...highlight,
        color: nextStyle.color,
        text_color: nextStyle.textColor,
      })
    }

    if (isTextLocator(selection)) {
      for (const highlight of currentHighlights) {
        if (!isTextLocator(highlight.locator) || !rangesIntersect(highlight.locator, selection) || !patchChanges(highlight)) {
          continue
        }

        changed = true
        const highlightLocator = highlight.locator
        const intersectionStart = Math.max(highlightLocator.start, selection.start)
        const intersectionEnd = Math.min(highlightLocator.end, selection.end)
        const coversWholeHighlight = selection.start <= highlightLocator.start && selection.end >= highlightLocator.end
        const nextStyle = nextStyleFor(highlight)

        if (coversWholeHighlight) {
          await updateWholeHighlight(highlight)
          continue
        }

        const leftLocator = buildLocatorFragment(highlightLocator, highlightLocator.start, intersectionStart)
        const middleLocator = buildLocatorFragment(highlightLocator, intersectionStart, intersectionEnd)
        const rightLocator = buildLocatorFragment(highlightLocator, intersectionEnd, highlightLocator.end)

        if (hasHighlightNote(highlight)) {
          await updateHighlight(highlight.id, { color: null, textColor: null })
          updates.set(highlight.id, { ...highlight, color: null, text_color: null })
        } else {
          await deleteHighlight(highlight.id)
          updates.set(highlight.id, null)
        }

        if (hasVisibleHighlightStyle(highlight)) {
          await createStyleFragment(leftLocator, highlight.color, highlight.text_color)
          await createStyleFragment(rightLocator, highlight.color, highlight.text_color)
        }
        await createStyleFragment(middleLocator, nextStyle.color, nextStyle.textColor)
      }
    } else {
      const exactMatches = currentHighlights.filter((highlight) => highlightMatchesSelection(highlight, currentSelectedText, selection))
      for (const highlight of exactMatches) {
        await updateWholeHighlight(highlight)
      }
    }

    if (patchHasVisibleStyle && (!changed || !selectionAlreadyCovered)) {
      const highlight = await saveHighlight(user, document, currentSelectedText, {
        color: patch.color ?? null,
        textColor: patch.textColor ?? null,
        locator: selection,
      })
      createdHighlights.push(highlight)
      changed = true
    }

    if (changed) {
      replaceHighlights((items) => [
        ...createdHighlights,
        ...items.flatMap((item) => {
          if (!updates.has(item.id)) return [item]
          const updated = updates.get(item.id)
          return updated ? [updated] : []
        }),
      ])
    }

    setAiAnswer(changed ? '已更新当前选区的文字样式。' : '当前选区没有可更新的文字样式。')
    if (changed) dispatchCompanionStatus({ state: 'success', message: '文字样式已更新。' })
  }

  const queueSelectionStylePatch = (patch: SelectionStylePatch) => {
    const operation = styleOperationRef.current.catch(() => undefined).then(() => applySelectionStylePatch(patch))
    styleOperationRef.current = operation.catch(() => undefined)
    return operation
  }

  const handleHighlightColorChange = (value: string) => {
    highlightColorRef.current = value
    setHighlightColor(value)
    void queueSelectionStylePatch({ color: value || null }).catch((error) => {
      setAiAnswer(error instanceof Error ? error.message : '背景色保存失败。')
    })
  }

  const handleTextColorChange = (value: string) => {
    textColorRef.current = value
    setTextColor(value)
    void queueSelectionStylePatch({ textColor: value || null }).catch((error) => {
      setAiAnswer(error instanceof Error ? error.message : '字体色保存失败。')
    })
  }

  const saveSelectionNote = async () => {
    const note = noteDraft.trim()
    const currentSelectedText = selectedTextRef.current
    const currentSelectionLocator = selectionLocatorRef.current
    if (!currentSelectedText || !note) return
    await styleOperationRef.current.catch(() => undefined)
    const currentHighlightColor = highlightColorRef.current || null
    const currentTextColor = textColorRef.current || null
    const matchedHighlight = highlightsRef.current.find((highlight) =>
      highlightMatchesSelection(highlight, currentSelectedText, currentSelectionLocator),
    )
    if (matchedHighlight) {
      await updateHighlight(matchedHighlight.id, {
        note,
        color: currentHighlightColor,
        textColor: currentTextColor,
        locator: currentSelectionLocator ?? matchedHighlight.locator,
      })
      replaceHighlights((items) =>
        items.map((item) =>
          item.id === matchedHighlight.id
            ? {
                ...item,
                note,
                color: currentHighlightColor,
                text_color: currentTextColor,
                locator: currentSelectionLocator ?? item.locator,
              }
            : item,
        ),
      )
    } else {
      const highlight = await saveHighlight(user, document, currentSelectedText, {
        note,
        color: currentHighlightColor,
        textColor: currentTextColor,
        locator: currentSelectionLocator,
      })
      replaceHighlights((items) => [highlight, ...items])
    }
    setNoteDraft('')
    setAiAnswer('已保存这条笔记。')
    dispatchCompanionStatus({ state: 'success', message: '笔记保存好了，之后可以在笔记页找回。' })
  }

  const clearSelectionStyle = async () => {
    await queueSelectionStylePatch({ color: null, textColor: null })
    highlightColorRef.current = defaultHighlightColor
    textColorRef.current = ''
    setHighlightColor(defaultHighlightColor)
    setTextColor('')
    dispatchCompanionStatus({ state: 'happy', message: '已清掉这段的额外样式。' })
  }

  const saveHighlightEdits = async (highlight: Highlight, draft: { note: string; color: string | null; textColor: string }) => {
    await updateHighlight(highlight.id, {
      note: draft.note,
      color: draft.color,
      textColor: draft.textColor || null,
    })
    replaceHighlights((items) =>
      items.map((item) =>
        item.id === highlight.id
          ? { ...item, note: draft.note || null, color: draft.color, text_color: draft.textColor || null }
          : item,
      ),
    )
    setAiAnswer('笔记已更新。')
    dispatchCompanionStatus({ state: 'success', message: '笔记已更新。' })
  }

  const removeHighlight = async (highlight: Highlight) => {
    await deleteHighlight(highlight.id)
    replaceHighlights((items) => items.filter((item) => item.id !== highlight.id))
    setAiAnswer('笔记已删除。')
    dispatchCompanionStatus({ state: 'happy', message: '这条笔记已删除。' })
  }

  const switchRenderMode = (nextMode: ReaderRenderMode) => {
    if (nextMode === renderMode) return
    const currentProgress = progressRef.current
    setInitialScroll(currentProgress)
    setProgress(currentProgress)
    setRenderMode(nextMode)
  }

  return (
    <section className="reader-shell">
      <header className="reader-header">
        <button className="ghost-button" onClick={onBack}>
          <Library size={18} />
          返回资料库
        </button>
        <div className="reader-title">
          <span>{document.category?.name ?? '未分类'}</span>
          <h1>{document.title}</h1>
        </div>
        <div className="reader-header-actions">
          <div className="segmented-control" aria-label="阅读渲染模式">
            <button
              type="button"
              className={renderMode === 'read' ? 'active' : undefined}
              aria-pressed={renderMode === 'read'}
              onClick={() => switchRenderMode('read')}
            >
              阅读模式
            </button>
            <button
              type="button"
              className={renderMode === 'interactive' ? 'active' : undefined}
              aria-pressed={renderMode === 'interactive'}
              onClick={() => switchRenderMode('interactive')}
            >
              交互模式
            </button>
          </div>
          <button className={document.favorite ? 'icon-button active' : 'icon-button'} onClick={() => onFavorite(document, !document.favorite)}>
            <Heart size={18} />
          </button>
        </div>
      </header>

      <div className="reader-progress">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      {renderMode === 'interactive' ? (
        <InlineNotice
          tone="warning"
          title="交互模式已开启"
          body="当前允许文档内部脚本和点击交互运行，请只对可信 HTML 使用。划词、笔记和阅读进度仍会保留。"
        />
      ) : null}
      {sessionError ? (
        <InlineNotice tone="warning" title="阅读会话上报失败" body={sessionError} />
      ) : null}

      <div className="iframe-wrap">
        {loading ? (
          <LoadingScreen compact />
        ) : readerError ? (
          <InlineNotice tone="danger" title="阅读文件加载失败" body={readerError} />
        ) : (
          <iframe
            key={`${document.id}-${renderMode}`}
            ref={iframeRef}
            title={document.title}
            sandbox="allow-scripts allow-forms allow-popups"
            srcDoc={srcDoc}
            onLoad={() => postAnnotationsToReader(highlights)}
          />
        )}
      </div>

      <ActionDock
        open={panelOpen}
        selectedText={selectedText}
        noteDraft={noteDraft}
        highlightColor={highlightColor}
        textColor={textColor}
        highlights={highlights}
        aiAnswer={aiAnswer}
        aiLoading={aiLoading}
        personas={personas}
        aiProfiles={aiProfiles}
        activePersonaId={activePersonaId}
        activeModelId={activeModelId}
        onToggle={() => setPanelOpen((value) => !value)}
        onClose={() => setPanelOpen(false)}
        onExplain={() => void explain()}
        onSummarize={() => void summarize()}
        onClearStyle={() => void clearSelectionStyle()}
        onSaveNote={() => void saveSelectionNote()}
        onNoteDraftChange={setNoteDraft}
        onHighlightColorChange={handleHighlightColorChange}
        onTextColorChange={handleTextColorChange}
        onSaveHighlight={(highlight, draft) => void saveHighlightEdits(highlight, draft)}
        onDeleteHighlight={(highlight) => void removeHighlight(highlight)}
        onPersonaChange={setActivePersonaId}
        onModelChange={setActiveModelId}
      />
    </section>
  )
}

function ActionDock({
  open,
  selectedText,
  noteDraft,
  highlightColor,
  textColor,
  highlights,
  aiAnswer,
  aiLoading,
  personas,
  aiProfiles,
  activePersonaId,
  activeModelId,
  onToggle,
  onClose,
  onExplain,
  onSummarize,
  onClearStyle,
  onSaveNote,
  onNoteDraftChange,
  onHighlightColorChange,
  onTextColorChange,
  onSaveHighlight,
  onDeleteHighlight,
  onPersonaChange,
  onModelChange,
}: {
  open: boolean
  selectedText: string
  noteDraft: string
  highlightColor: string
  textColor: string
  highlights: Highlight[]
  aiAnswer: string
  aiLoading: boolean
  personas: Persona[]
  aiProfiles: AiProfile[]
  activePersonaId?: string
  activeModelId?: string
  onToggle: () => void
  onClose: () => void
  onExplain: () => void
  onSummarize: () => void
  onClearStyle: () => void
  onSaveNote: () => void
  onNoteDraftChange: (value: string) => void
  onHighlightColorChange: (value: string) => void
  onTextColorChange: (value: string) => void
  onSaveHighlight: (highlight: Highlight, draft: { note: string; color: string | null; textColor: string }) => void
  onDeleteHighlight: (highlight: Highlight) => void
  onPersonaChange: (id: string) => void
  onModelChange: (id: string) => void
}) {
  const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null)
  const [editNoteDraft, setEditNoteDraft] = useState('')
  const [editHighlightColor, setEditHighlightColor] = useState(defaultHighlightColor)
  const [editTextColor, setEditTextColor] = useState('')
  const noteHighlights = highlights.filter(hasHighlightNote)

  const startHighlightEdit = (highlight: Highlight) => {
    setEditingHighlightId(highlight.id)
    setEditNoteDraft(highlight.note ?? '')
    setEditHighlightColor(highlight.color ?? defaultHighlightColor)
    setEditTextColor(highlight.text_color ?? '')
  }

  const cancelHighlightEdit = () => {
    setEditingHighlightId(null)
    setEditNoteDraft('')
    setEditHighlightColor(defaultHighlightColor)
    setEditTextColor('')
  }

  const saveHighlightEdit = (highlight: Highlight) => {
    onSaveHighlight(highlight, {
      note: editNoteDraft.trim(),
      color: editHighlightColor || null,
      textColor: editTextColor,
    })
    cancelHighlightEdit()
  }

  const dock = (
    <div className="action-dock">
      <AnimatePresence>
        {open ? (
          <motion.div
            className="action-panel"
            variants={panelMotion}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div className="panel-title">
              <span>
                <Sparkles size={17} />
                阅读助手
              </span>
              <button className="icon-button" onClick={onClose}>
                <X size={17} />
              </button>
            </div>
            <div className="panel-controls">
              <select value={activePersonaId ?? ''} onChange={(event) => onPersonaChange(event.target.value)}>
                {personas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
              <select value={activeModelId ?? ''} onChange={(event) => onModelChange(event.target.value)}>
                {aiProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="selected-text">
              {selectedText ? selectedText : '选中 HTML 中的文字后，这里会显示可解析的片段。'}
            </div>
            <textarea
              className="note-input"
              value={noteDraft}
              onChange={(event) => onNoteDraftChange(event.target.value)}
              placeholder="给这段文字补一条笔记"
              rows={3}
            />
            <div className="annotation-tools" aria-label="文字样式">
              <ColorPickerRow
                label="背景色"
                icon={<PaintBucket size={15} />}
                value={highlightColor}
                options={backgroundColorOptions}
                onChange={onHighlightColorChange}
              />
              <ColorPickerRow
                label="字体色"
                icon={<Type size={15} />}
                value={textColor}
                options={textColorOptions}
                onChange={onTextColorChange}
              />
            </div>
            <div className="dock-actions">
              <button onClick={onExplain} disabled={!selectedText || aiLoading}>
                <MessageSquareText size={17} />
                解释
              </button>
              <button onClick={onSummarize} disabled={aiLoading}>
                <NotebookPen size={17} />
                总结
              </button>
              <button onClick={onClearStyle} disabled={!selectedText || aiLoading}>
                <RotateCcw size={17} />
                清除样式
              </button>
              <button onClick={onSaveNote} disabled={!selectedText || aiLoading || !noteDraft.trim()}>
                <NotebookPen size={17} />
                添加笔记
              </button>
            </div>
            <div className="ai-answer">
              {aiLoading ? (
                <span className="inline-loading">
                  <Loader2 className="spin" size={17} />
                  正在解析
                </span>
              ) : (
                aiAnswer || 'AI 结果会显示在这里。'
              )}
            </div>
            <div className="highlight-list">
              <strong>阅读笔记</strong>
              {noteHighlights.length === 0 ? (
                <p>还没有保存的笔记。</p>
              ) : (
                noteHighlights.map((highlight) => {
                  const editing = editingHighlightId === highlight.id
                  return (
                    <article key={highlight.id}>
                      <div className="highlight-card-head">
                        <time>{formatDateTime(highlight.created_at)}</time>
                        <div className="highlight-style-preview" aria-label="笔记样式">
                          <span className={highlight.color ? undefined : 'empty'} style={{ backgroundColor: highlight.color ?? 'transparent' }} />
                          <span style={{ color: highlight.text_color ?? '#334155' }}>A</span>
                        </div>
                      </div>
                      <span>{highlight.selected_text}</span>
                      {editing ? (
                        <div className="highlight-edit-box">
                          <textarea
                            aria-label="编辑笔记"
                            value={editNoteDraft}
                            onChange={(event) => setEditNoteDraft(event.target.value)}
                            rows={2}
                          />
                          <ColorPickerRow
                            label="背景色"
                            value={editHighlightColor}
                            options={backgroundColorOptions}
                            onChange={setEditHighlightColor}
                            compact
                          />
                          <ColorPickerRow
                            label="字体色"
                            value={editTextColor}
                            options={textColorOptions}
                            onChange={setEditTextColor}
                            compact
                          />
                          <div className="highlight-actions">
                            <button type="button" onClick={() => saveHighlightEdit(highlight)}>
                              <Save size={15} />
                              保存
                            </button>
                            <button type="button" onClick={cancelHighlightEdit}>
                              <X size={15} />
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {highlight.note ? <em>{highlight.note}</em> : null}
                          <div className="highlight-actions">
                            <button type="button" onClick={() => startHighlightEdit(highlight)}>
                              <Palette size={15} />
                              编辑
                            </button>
                            <button type="button" onClick={() => onDeleteHighlight(highlight)}>
                              <Trash2 size={15} />
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  )
                })
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.button className="dock-button" onClick={onToggle} whileHover={liftHover} whileTap={pressTap} title="打开功能面板">
        {open ? <X size={24} /> : <Settings2 size={24} />}
      </motion.button>
    </div>
  )

  return typeof document === 'undefined' ? dock : createPortal(dock, document.body)
}

function ColorPickerRow({
  label,
  icon,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string
  icon?: ReactNode
  value: string
  options: readonly { label: string; value: string }[]
  onChange: (value: string) => void
  compact?: boolean
}) {
  const customColor = /^#[0-9a-f]{6}$/i.test(value) ? value : customColorFallback

  return (
    <div className={compact ? 'color-row compact' : 'color-row'}>
      <span className="color-row-label">
        {icon}
        {label}
      </span>
      <div className="color-swatch-group">
        {options.map((option) => {
          const active = value === option.value
          if (option.value === '') {
            return (
              <button
                key={`${label}-${option.label}-default`}
                type="button"
                className={active ? 'color-reset active' : 'color-reset'}
                aria-label={`${label}${option.label}`}
                aria-pressed={active}
                onClick={() => onChange(option.value)}
              >
                {option.label}
              </button>
            )
          }
          const style =
            {
              '--swatch-color': option.value,
            } as CSSProperties
          return (
            <button
              key={`${label}-${option.label}-${option.value || 'default'}`}
              type="button"
              className={active ? 'color-swatch active' : 'color-swatch'}
              style={style}
              aria-label={`${label}${option.label}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
            />
          )
        })}
        <label className="custom-color-picker">
          <input
            type="color"
            aria-label={`${label}自定义颜色`}
            value={customColor}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
          />
          自定义
        </label>
      </div>
    </div>
  )
}

function NotesView({
  documents,
  categories,
  onOpenDocument,
}: {
  documents: DocumentRecord[]
  categories: Category[]
  onOpenDocument: (documentId: string) => void
}) {
  const [notes, setNotes] = useState<HighlightWithDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [documentId, setDocumentId] = useState('all')
  const [timeRange, setTimeRange] = useState('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const refreshNotes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setNotes(await loadHighlightsWithDocuments())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '笔记加载失败。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshNotes()
  }, [refreshNotes])

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase()
    const since = timeRange === 'all' ? 0 : Date.now() - Number(timeRange) * 86400000

    return notes
      .filter((note) => (documentId === 'all' ? true : note.document_id === documentId))
      .filter((note) => (categoryId === 'all' ? true : note.document?.category_id === categoryId))
      .filter((note) => (since ? Date.parse(note.created_at) >= since : true))
      .filter((note) => {
        if (!query) return true
        return [
          note.selected_text,
          note.note ?? '',
          note.document?.title ?? '',
          note.document?.category?.name ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(query)
      })
  }, [categoryId, documentId, notes, search, timeRange])

  const startEdit = (note: HighlightWithDocument) => {
    setEditingId(note.id)
    setEditDraft(note.note ?? '')
  }

  const saveEdit = async (note: HighlightWithDocument) => {
    const nextNote = editDraft.trim()
    await updateHighlightNote(note.id, nextNote)
    setNotes((current) =>
      nextNote
        ? current.map((item) => (item.id === note.id ? { ...item, note: nextNote } : item))
        : current.filter((item) => item.id !== note.id),
    )
    setEditingId(null)
    setEditDraft('')
  }

  const removeNote = async (note: HighlightWithDocument) => {
    await deleteHighlight(note.id)
    setNotes((current) => current.filter((item) => item.id !== note.id))
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Notes</p>
          <h1>笔记中心</h1>
        </div>
        <button className="ghost-button" onClick={() => void refreshNotes()} disabled={loading}>
          {loading ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
          刷新
        </button>
      </div>

      {error ? <InlineNotice tone="danger" title="笔记加载失败" body={error} /> : null}

      <div className="metric-strip">
        <Metric label="笔记" value={notes.length.toString()} icon={NotebookPen} />
        <Metric label="当前筛选" value={filteredNotes.length.toString()} icon={Search} />
        <Metric label="来源文档" value={new Set(notes.map((note) => note.document_id)).size.toString()} icon={FileText} />
        <Metric label="本周新增" value={notes.filter((note) => Date.now() - Date.parse(note.created_at) <= 7 * 86400000).length.toString()} icon={CalendarDays} />
      </div>

      <div className="toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索笔记、来源文档" />
        </label>
        <label className="select-box">
          <Folder size={18} />
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">全部分类</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
        <label className="select-box">
          <FileText size={18} />
          <select value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
            <option value="all">全部文档</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
          <ChevronDown size={16} />
        </label>
        <label className="select-box">
          <CalendarDays size={18} />
          <select value={timeRange} onChange={(event) => setTimeRange(event.target.value)}>
            <option value="all">全部时间</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
          </select>
          <ChevronDown size={16} />
        </label>
      </div>

      {loading ? (
        <LoadingScreen compact />
      ) : filteredNotes.length === 0 ? (
        <div className="empty-state">
          <NotebookPen size={22} />
          <strong>暂无笔记</strong>
          <p>在阅读页选中文字并添加笔记后，会在这里统一管理。</p>
        </div>
      ) : (
        <motion.div className="notes-grid" layout variants={staggerContainer} initial="hidden" animate="show">
          {filteredNotes.map((note) => (
            <motion.article className="note-card" key={note.id} layout variants={cardMotion} whileHover={liftHover}>
              <div className="note-card-topline">
                <span className="category-dot" style={{ backgroundColor: note.document?.category?.color ?? '#64748B' }} />
                <span>{note.document?.category?.name ?? '未分类'}</span>
                <time>{formatDateTime(note.created_at)}</time>
              </div>
              <blockquote>{note.selected_text}</blockquote>
              {editingId === note.id ? (
                <div className="note-edit-box">
                  <textarea
                    value={editDraft}
                    onChange={(event) => setEditDraft(event.target.value)}
                    rows={3}
                    aria-label="编辑笔记"
                  />
                  <div className="note-actions">
                    <button className="ghost-button" type="button" onClick={() => setEditingId(null)}>
                      <X size={17} />
                      取消
                    </button>
                    <button className="primary-button" type="button" onClick={() => void saveEdit(note)}>
                      <Check size={17} />
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <p>{note.note || '还没有补充笔记。'}</p>
              )}
              <div className="note-footer">
                <button className="recent-row" type="button" onClick={() => onOpenDocument(note.document_id)}>
                  <BookOpen size={17} />
                  <span>{note.document?.title ?? '来源文档'}</span>
                </button>
                <div className="note-actions">
                  <button className="ghost-button" type="button" onClick={() => startEdit(note)}>
                    <NotebookPen size={17} />
                    编辑
                  </button>
                  <button className="ghost-button danger" type="button" onClick={() => void removeNote(note)}>
                    <X size={17} />
                    删除
                  </button>
                </div>
              </div>
            </motion.article>
          ))}
        </motion.div>
      )}
    </section>
  )
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: ComponentType<{ size?: number }>
}) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InlineNotice({ tone, title, body }: { tone: 'warning' | 'danger' | 'success'; title: string; body: string }) {
  return (
    <div className={`inline-notice ${tone}`}>
      <Check size={18} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  )
}

function formatDate(value: string | null) {
  if (!value) return '未知'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function formatPercent(value: number) {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatLatency(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds}ms`
  return `${(milliseconds / 1000).toFixed(1)}s`
}

function mergeCheckStatus(checks: Array<ClientPreflightResult['checks'][number] | undefined>) {
  const present = checks.filter(Boolean) as ClientPreflightResult['checks']
  if (present.some((check) => check.status === 'fail')) return 'fail'
  if (present.length === 0 || present.some((check) => check.status === 'warn')) return 'warn'
  return 'pass'
}

function statusText(status: ClientPreflightResult['checks'][number]['status']) {
  if (status === 'pass') return '正常'
  if (status === 'warn') return '需处理'
  return '无法检查'
}

function capabilityLabel(capability: 'text' | 'vision' | 'html') {
  if (capability === 'vision') return '视觉输入'
  if (capability === 'html') return 'HTML 生成'
  return '文本模型'
}

function modelCapabilitySummary(model: AiModelOption) {
  const labels = model.capabilities.map((capability) => {
    if (capability === 'vision') return '视觉'
    if (capability === 'long_context') return '长上下文'
    if (capability === 'html') return 'HTML 推荐'
    return '文本'
  })
  return labels.length ? labels.join(' / ') : '能力未知'
}

function validationLabel(binding: AiFeatureBinding | undefined) {
  if (!binding?.validationStatus || binding.validationStatus === 'unknown') return '未验证'
  const prefix = binding.validationStatus === 'pass' ? '已验证可用' : '验证失败'
  return binding.validatedAt ? `${prefix} · ${formatDateTime(binding.validatedAt)}` : prefix
}

function profileCapabilityMismatch(capability: 'text' | 'vision' | 'html', profile: AiProfile) {
  const modelCapabilities = inferUiModelCapabilities(profile.model)
  if (capability === 'vision' && !profile.supportsVision && !modelCapabilities.includes('vision')) {
    return '图片识题必须绑定支持 vision input 的模型；当前模型未标记为视觉模型。'
  }
  if (capability === 'html' && profile.supportsHtmlGeneration === false) {
    return '这个模型被标记为不用于 HTML 生成，保存后会验证失败。'
  }
  return ''
}

function inferUiModelCapabilities(model: string): Array<'text' | 'vision' | 'html' | 'long_context'> {
  const lower = model.toLowerCase()
  const capabilities: Array<'text' | 'vision' | 'html' | 'long_context'> = ['text']
  if (/(vision|vl|gpt-4o|omni|gemini|claude-3|qwen.*vl|glm-4v|image)/i.test(lower)) capabilities.push('vision')
  if (/(instruct|chat|gpt|qwen|deepseek|glm|claude|gemini|moonshot|html|mimo)/i.test(lower)) capabilities.push('html')
  if (/(128k|32k|long|1m|200k|context|deepseek|moonshot-v1-128k)/i.test(lower)) capabilities.push('long_context')
  return capabilities
}

function safeUiHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return 'invalid-url'
  }
}

function featureLabel(config: AiFeatureConfigPayload, featureId: string) {
  if (featureId === 'health_check') return '健康检查'
  return config.features.find((feature) => feature.requestType === featureId || feature.id === featureId)?.label ?? featureId
}

function buildSearchSnippet(document: DocumentRecord, query: string) {
  const fields = [
    document.title,
    document.summary ?? '',
    document.category?.name ?? '',
    document.content_text ?? '',
  ]
  const haystack = fields.join(' ')
  const lower = haystack.toLowerCase()
  const index = lower.indexOf(query)
  if (index < 0) return ''
  const start = Math.max(0, index - 42)
  const end = Math.min(haystack.length, index + query.length + 72)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < haystack.length ? '...' : ''
  return `${prefix}${haystack.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`
}

function moveDocumentBefore(documents: DocumentRecord[], sourceId: string, targetId: string) {
  const nextDocuments = [...documents]
  const sourceIndex = nextDocuments.findIndex((document) => document.id === sourceId)
  const targetIndex = nextDocuments.findIndex((document) => document.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return nextDocuments
  const [document] = nextDocuments.splice(sourceIndex, 1)
  const adjustedTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  nextDocuments.splice(adjustedTargetIndex, 0, document)
  return nextDocuments
}
