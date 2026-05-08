import { AnimatePresence, motion } from 'framer-motion'
import {
  Archive,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Folder,
  Heart,
  Highlighter,
  Library,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageSquareText,
  NotebookPen,
  RefreshCcw,
  RotateCcw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  UserRoundPlus,
  X,
} from 'lucide-react'
import {
  type ComponentType,
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
import {
  askAiExplain,
  createCategory,
  createPersona,
  deleteHighlight,
  fetchAiHealth,
  fetchDocumentHtml,
  fetchHighlights,
  loadArchivedDocuments,
  loadHighlightsWithDocuments,
  loadLibrary,
  requestDocumentSummary,
  restoreDocument,
  runClientPreflight,
  saveHighlight,
  startReadingSession,
  toggleDocumentFavorite,
  touchDocumentProgress,
  updateHighlightNote,
  updateReadingSession,
  updateDocumentManagement,
  uploadHtmlFiles,
  type HtmlUploadResult,
} from './lib/data'
import { createReaderSrcDoc, type ReaderRenderMode } from './lib/html'
import { isDemoMode, isSupabaseConfigured, supabase } from './lib/supabase'
import type {
  AiHealthResult,
  AiProfile,
  AiRequestBreakdown,
  AppUser,
  AppView,
  Category,
  ClientPreflightResult,
  DocumentRecord,
  DocumentUpdateDraft,
  Highlight,
  HighlightWithDocument,
  LibraryPayload,
  Persona,
  SortKey,
} from './types'

const StatsCharts = lazy(() => import('./components/StatsCharts'))

type RouteState = {
  view: AppView
  documentId?: string
}

type AuthState = {
  loading: boolean
  user: AppUser | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
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

const defaultRoute: RouteState = { view: 'library' }

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

function parseHash(): RouteState {
  const [view, id] = window.location.hash.replace(/^#\/?/, '').split('/')
  if (view === 'reader' && id) return { view: 'reader', documentId: id }
  if (view === 'stats' || view === 'personas' || view === 'library' || view === 'notes' || view === 'deploy') {
    return { view }
  }
  return defaultRoute
}

function navigate(view: AppView, documentId?: string) {
  window.location.hash = view === 'reader' && documentId ? `#/reader/${documentId}` : `#/${view}`
}

function useAuth(): AuthState {
  const [loading, setLoading] = useState(!isDemoMode && isSupabaseConfigured)
  const [user, setUser] = useState<AppUser | null>(
    isDemoMode ? { id: 'demo-user', email: 'demo@html-vault.local' } : null,
  )

  useEffect(() => {
    if (isDemoMode || !supabase) {
      setLoading(false)
      return undefined
    }

    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setUser(data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email } : null)
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
        setUser({ id: 'demo-user', email: email || 'demo@html-vault.local' })
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
        setUser({ id: 'demo-user', email: 'demo@html-vault.local' })
        return
      }
      await supabase?.auth.signOut()
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
      await refresh()
    }
    return results
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

  const handleCreatePersona = async (
    draft: Pick<Persona, 'name' | 'tone' | 'system_prompt' | 'default_model'>,
  ) => {
    if (!auth.user) return
    const persona = await createPersona(auth.user, draft)
    setPayload((current) => (current ? { ...current, personas: [persona, ...current.personas] } : current))
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
      onRefresh={refresh}
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
      ) : route.view === 'notes' ? (
        <NotesView documents={payload.documents} categories={payload.categories} onOpenDocument={(id) => navigate('reader', id)} />
      ) : route.view === 'personas' ? (
        <PersonasView personas={payload.personas} aiProfiles={payload.aiProfiles} onCreate={handleCreatePersona} />
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
          onUpdateDocument={handleUpdateDocument}
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
  children,
  onNavigate,
  onSignOut,
  onRefresh,
}: {
  user: AppUser
  route: RouteState
  refreshing: boolean
  children: ReactNode
  onNavigate: (view: AppView) => void
  onSignOut: () => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const navItems = [
    { view: 'library' as AppView, label: '资料库', icon: Library },
    { view: 'notes' as AppView, label: '笔记', icon: NotebookPen },
    { view: 'stats' as AppView, label: '统计', icon: BarChart3 },
    { view: 'personas' as AppView, label: '人物', icon: BrainCircuit },
    { view: 'deploy' as AppView, label: '部署', icon: Server },
  ]

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
          <span className="user-email">{user.email ?? '已登录用户'}</span>
          <div className="sidebar-actions">
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
            initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(8px)' }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
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
  onUpdateDocument,
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
  onUpdateDocument: (document: DocumentRecord, draft: DocumentUpdateDraft) => Promise<void>
  onLoadArchived: () => Promise<void>
  onRestoreDocument: (document: DocumentRecord) => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('imported_at')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [archiveMode, setArchiveMode] = useState(false)
  const [managedDocument, setManagedDocument] = useState<DocumentRecord | null>(null)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadCategoryId, setUploadCategoryId] = useState('')
  const [uploadItems, setUploadItems] = useState<UploadQueueItem[]>([])

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
      .sort((a, b) => Date.parse(b.document[sortKey] ?? '') - Date.parse(a.document[sortKey] ?? ''))
  }, [categoryId, favoritesOnly, search, sortKey, sourceDocuments])

  const filteredDocuments = useMemo(() => {
    return searchResults.map((item) => item.document)
  }, [searchResults])

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

      <motion.div className="document-grid" layout>
        {searchResults.map(({ document, snippet }) => (
          <DocumentCard
            key={document.id}
            document={document}
            searchSnippet={snippet}
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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
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
  onOpen,
  onFavorite,
  onManage,
  onRestore,
}: {
  document: DocumentRecord
  searchSnippet?: string
  onOpen?: (document: DocumentRecord) => void
  onFavorite: (document: DocumentRecord, favorite: boolean) => void
  onManage?: (document: DocumentRecord) => void
  onRestore?: (document: DocumentRecord) => void
}) {
  const sourceLabel = document.metadata?.source === 'browser_upload' ? '前端上传' : '同步导入'
  return (
    <motion.article className="document-card" layout whileHover={{ y: -4 }} transition={{ duration: 0.2 }}>
      <div className="card-topline">
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
  const [color, setColor] = useState('#2563EB')
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
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.form
        className="document-manager"
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
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
  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Insights</p>
          <h1>阅读统计</h1>
        </div>
        <div className="sync-pill">
          <Clock3 size={18} />
          {formatDuration(payload.stats.totalReadSeconds)}
        </div>
      </div>

      <div className="metric-strip">
        <Metric label="总阅读" value={formatDuration(payload.stats.totalReadSeconds)} icon={Clock3} />
        <Metric label="资料数量" value={payload.documents.length.toString()} icon={Library} />
        <Metric label="未读积压" value={payload.stats.unreadCount.toString()} icon={FileText} />
        <Metric label="AI 解析" value={payload.stats.aiRequestCount.toString()} icon={Sparkles} />
      </div>

      <Suspense fallback={<ChartFallback />}>
        <StatsCharts stats={payload.stats} />
      </Suspense>

      <section className="list-panel">
        <h2>最近阅读</h2>
        {payload.stats.recentDocuments.map((document) => (
          <button key={document.id} className="recent-row" onClick={() => navigate('reader', document.id)}>
            <BookOpen size={17} />
            <span>{document.title}</span>
            <time>{formatDate(document.lastReadAt)}</time>
          </button>
        ))}
      </section>
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
          onRunHealth={() => void runAiHealth()}
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
  onRunHealth,
}: {
  profiles: AiProfile[]
  health: AiHealthResult | null
  healthLoading: boolean
  healthError: string
  requestBreakdown: AiRequestBreakdown
  onRunHealth: () => void
}) {
  const healthById = new Map(health?.profiles.map((profile) => [profile.id, profile]))
  const passCount = health?.profiles.filter((profile) => profile.status === 'pass').length ?? 0
  const failCount = health?.profiles.filter((profile) => profile.status === 'fail').length ?? 0

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

      <div className="ai-config-summary">
        <Metric label="模型配置" value={profiles.length.toString()} icon={BrainCircuit} />
        <Metric label="健康通过" value={health ? passCount.toString() : '未测'} icon={Check} />
        <Metric label="健康失败" value={health ? failCount.toString() : '未测'} icon={X} />
        <Metric label="AI 失败" value={requestBreakdown.failed.toString()} icon={ShieldCheck} />
      </div>

      <div className="ai-profile-grid">
        {profiles.length === 0 ? (
          <div className="empty-state compact">
            <Sparkles size={22} />
            <strong>没有读取到 AI 模型</strong>
            <p>请部署 ai-profiles 并在 Supabase Edge Function Secrets 中配置模型。</p>
          </div>
        ) : (
          profiles.map((profile) => {
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
                  <span>密钥：{(healthProfile?.configured ?? profile.configured ?? true) ? '已配置或待确认' : '未配置'}</span>
                  {healthProfile?.latencyMs !== undefined && healthProfile.latencyMs !== null ? (
                    <span>延迟：{formatLatency(healthProfile.latencyMs)}</span>
                  ) : null}
                  {healthProfile ? <span>检查：{formatDateTime(healthProfile.checkedAt)}</span> : null}
                </div>
                {healthProfile?.error ? <p className="ai-profile-error">{healthProfile.error}</p> : null}
              </section>
            )
          })
        )}
      </div>

      <div className="ai-request-stats">
        <span>解释 {requestBreakdown.explain}</span>
        <span>摘要 {requestBreakdown.summarize}</span>
        <span>健康检查 {requestBreakdown.healthCheck}</span>
        <span>失败 {requestBreakdown.failed}</span>
      </div>
      <p className="deploy-time">
        {health ? `最后 AI 检查：${formatDateTime(health.generatedAt)}` : 'AI 连接测试只会发起一次极短真实调用，API key 不会返回前端。'}
      </p>
    </article>
  )
}

function PersonasView({
  personas,
  aiProfiles,
  onCreate,
}: {
  personas: Persona[]
  aiProfiles: AiProfile[]
  onCreate: (draft: Pick<Persona, 'name' | 'tone' | 'system_prompt' | 'default_model'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [tone, setTone] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [modelId, setModelId] = useState<string | null>(aiProfiles[0]?.id ?? null)
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onCreate({
        name,
        tone,
        system_prompt: systemPrompt,
        default_model: modelId,
      })
      setName('')
      setTone('')
      setSystemPrompt('')
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

      <div className="persona-layout">
        <form className="persona-form" onSubmit={submit}>
          <h2>创建人物</h2>
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
          <button className="primary-button" disabled={saving || !name || !tone || !systemPrompt}>
            {saving ? <Loader2 className="spin" size={18} /> : <UserRoundPlus size={18} />}
            保存人物
          </button>
        </form>

        <div className="persona-list">
          {personas.map((persona) => (
            <article className="persona-card" key={persona.id}>
              <div className="persona-avatar">{persona.name.slice(0, 1)}</div>
              <div>
                <h2>{persona.name}</h2>
                <p>{persona.tone}</p>
                <span>{persona.default_model ?? '默认模型'}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
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
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [progress, setProgress] = useState(document.last_scroll ?? 0)
  const [initialScroll, setInitialScroll] = useState(document.last_scroll ?? 0)
  const [renderMode, setRenderMode] = useState<ReaderRenderMode>('read')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [activePersonaId, setActivePersonaId] = useState(personas[0]?.id)
  const [activeModelId, setActiveModelId] = useState(aiProfiles[0]?.id)
  const sessionId = useRef<string | null>(null)
  const startedAt = useRef(Date.now())
  const progressRef = useRef(document.last_scroll ?? 0)

  useEffect(() => {
    const startScroll = document.last_scroll ?? 0
    setLoading(true)
    setReaderError('')
    setSessionError('')
    setRawHtml('')
    setSelectedText('')
    setNoteDraft('')
    setHighlights([])
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
  }, [document.id, document.storage_path])

  useEffect(() => {
    let active = true
    void fetchHighlights(document).then((items) => {
      if (active) setHighlights(items)
    })
    return () => {
      active = false
    }
  }, [document.id])

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; text?: string; scroll?: number }
      if (data.type === 'html-reader-selection' && data.text) {
        setSelectedText(data.text.slice(0, 1200))
        setPanelOpen(true)
      }
      if (data.type === 'html-reader-progress' && typeof data.scroll === 'number') {
        const value = Math.min(1, Math.max(0, data.scroll))
        setProgress(value)
        onProgress(document.id, value)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [document.id, onProgress])

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

  const srcDoc = useMemo(() => createReaderSrcDoc(rawHtml, initialScroll, renderMode), [initialScroll, rawHtml, renderMode])

  const explain = async () => {
    if (!selectedText) return
    setAiLoading(true)
    setAiAnswer('')
    try {
      const response = await askAiExplain({
        documentId: document.id,
        selectedText,
        personaId: activePersonaId,
        modelId: activeModelId,
      })
      setAiAnswer(response.answer)
    } finally {
      setAiLoading(false)
    }
  }

  const summarize = async () => {
    setAiLoading(true)
    setAiAnswer('')
    try {
      const response = await requestDocumentSummary(document, activeModelId)
      setAiAnswer(response.answer)
    } finally {
      setAiLoading(false)
    }
  }

  const persistHighlight = async () => {
    if (!selectedText) return
    const highlight = await saveHighlight(user, document, selectedText, noteDraft.trim())
    setHighlights((items) => [highlight, ...items])
    setNoteDraft('')
    setAiAnswer('已保存这段高亮和笔记。')
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
          <iframe key={`${document.id}-${renderMode}`} title={document.title} sandbox="allow-scripts allow-forms allow-popups" srcDoc={srcDoc} />
        )}
      </div>

      <ActionDock
        open={panelOpen}
        selectedText={selectedText}
        noteDraft={noteDraft}
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
        onHighlight={() => void persistHighlight()}
        onNoteDraftChange={setNoteDraft}
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
  onHighlight,
  onNoteDraftChange,
  onPersonaChange,
  onModelChange,
}: {
  open: boolean
  selectedText: string
  noteDraft: string
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
  onHighlight: () => void
  onNoteDraftChange: (value: string) => void
  onPersonaChange: (id: string) => void
  onModelChange: (id: string) => void
}) {
  return (
    <div className="action-dock">
      <AnimatePresence>
        {open ? (
          <motion.div
            className="action-panel"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22 }}
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
              placeholder="给这段高亮补一条笔记"
              rows={3}
            />
            <div className="dock-actions">
              <button onClick={onExplain} disabled={!selectedText || aiLoading}>
                <MessageSquareText size={17} />
                解释
              </button>
              <button onClick={onSummarize} disabled={aiLoading}>
                <NotebookPen size={17} />
                总结
              </button>
              <button onClick={onHighlight} disabled={!selectedText || aiLoading}>
                <Highlighter size={17} />
                高亮
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
              <strong>高亮笔记</strong>
              {highlights.length === 0 ? (
                <p>还没有保存的高亮。</p>
              ) : (
                highlights.map((highlight) => (
                  <article key={highlight.id}>
                    <time>{formatDateTime(highlight.created_at)}</time>
                    <span>{highlight.selected_text}</span>
                    {highlight.note ? <em>{highlight.note}</em> : null}
                  </article>
                ))
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <motion.button className="dock-button" onClick={onToggle} whileTap={{ scale: 0.94 }} title="打开功能面板">
        {open ? <X size={24} /> : <Settings2 size={24} />}
      </motion.button>
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
    await updateHighlightNote(note.id, editDraft.trim())
    setNotes((current) =>
      current.map((item) => (item.id === note.id ? { ...item, note: editDraft.trim() } : item)),
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
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索高亮、笔记、来源文档" />
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
          <p>在阅读页选中文字并保存高亮后，会在这里统一管理。</p>
        </div>
      ) : (
        <motion.div className="notes-grid" layout>
          {filteredNotes.map((note) => (
            <motion.article className="note-card" key={note.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
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

function InlineNotice({ tone, title, body }: { tone: 'warning' | 'danger'; title: string; body: string }) {
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
