import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  AiFunctionError,
  chatCompletionWithMeta,
  errorPayload,
  encryptUserApiKey,
  getAvailableProfiles,
  getProfiles,
  inferModelCapabilities,
  listOpenAiCompatibleModels,
  maskApiKey,
  providerTemplates,
  requireUser,
  sanitizeAiError,
  toPublicProfile,
  type AiModelOption,
  type AiFeatureId,
  type AiProfile,
} from '../_shared/ai.ts'

type FeatureDefinition = {
  id: AiFeatureId
  label: string
  description: string
  requestType: string
  functionName: string
  requiredCapability: 'text' | 'vision' | 'html'
  status: 'available' | 'not_deployed' | 'not_configured'
}

type BindingRow = {
  feature_id: AiFeatureId
  profile_id: string
  updated_at: string
  validation_status?: 'pass' | 'fail' | 'unknown' | null
  validated_at?: string | null
  validated_model?: string | null
  validation_error?: string | null
}

type UserProviderRow = {
  id: string
  label: string
  provider: string
  base_url: string
  model: string
  api_key_ciphertext: string
  api_key_iv: string
  api_key_hint?: string | null
  supports_vision?: boolean | null
  supports_html_generation?: boolean | null
  enabled?: boolean | null
}

const features: FeatureDefinition[] = [
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
    status: Deno.env.get('AI_GENERATE_HTML_DISABLED') === 'true' ? 'not_deployed' : 'available',
  },
  {
    id: 'image_question',
    label: '图片识题',
    description: '把题目图片交给支持视觉输入的模型，并生成讲解 HTML。',
    requestType: 'generate_html',
    functionName: 'ai-generate-html',
    requiredCapability: 'vision',
    status: Deno.env.get('AI_GENERATE_HTML_DISABLED') === 'true' ? 'not_deployed' : 'available',
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { supabase, user } = await requireUser(req)

    if (req.method === 'POST') {
      const body = await readConfigBody(req)

      if (body.action === 'upsert_provider') {
        await upsertUserProvider(supabase, user.id, body.provider)
      } else if (body.action === 'delete_provider') {
        await deleteUserProvider(supabase, user.id, body.providerId)
      } else if (body.action === 'list_models') {
        return jsonResponse(await listModelsForRequest(supabase, user.id, body))
      } else if (body.action === 'validate_bindings') {
        return jsonResponse(await buildPayload(supabase, user.id, await validateBindings(supabase, user.id, body.bindings ?? [])))
      } else if (Object.hasOwn(body, 'bindings')) {
        const savedRows = await saveBindings(supabase, user.id, body.bindings ?? [])
        return jsonResponse(await buildPayload(supabase, user.id, await validateBindings(supabase, user.id, savedRows)))
      }
    }

    return jsonResponse(await buildPayload(supabase, user.id))
  } catch (error) {
    if (error instanceof Response) return error
    return jsonResponse(errorPayload(error), 500)
  }
})

type ConfigBody = {
        action?: string
        bindings?: Array<{ featureId?: string; profileId?: string }>
        provider?: UserProviderInput
        providerId?: string
        profileId?: string
        providerDraft?: UserProviderInput
        force?: boolean
}

async function readConfigBody(req: Request): Promise<ConfigBody> {
  const raw = await req.text().catch(() => '')
  if (!raw.trim()) return {}

  try {
    return JSON.parse(raw) as ConfigBody
  } catch {
    return {}
  }
}

type UserProviderInput = {
  id?: string
  label?: string
  provider?: string
  baseUrl?: string
  model?: string
  apiKey?: string
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
  enabled?: boolean
}

async function saveBindings(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  bindings: Array<{ featureId?: string; profileId?: string }>,
) {
  const profiles = await getAvailableProfiles(supabase, userId)
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const validFeatures = new Set(features.map((feature) => feature.id))
  const normalized = bindings
    .map((binding) => ({
      feature_id: String(binding.featureId ?? '').trim() as AiFeatureId,
      profile_id: String(binding.profileId ?? '').trim() || null,
    }))
    .filter((binding) => validFeatures.has(binding.feature_id))

  if (normalized.length === 0) {
    throw new Error('No valid AI feature bindings to save.')
  }

  const boundRows = normalized
    .filter((binding) => binding.profile_id && profileIds.has(binding.profile_id))
    .map((binding) => ({
      owner_id: userId,
      feature_id: binding.feature_id,
      profile_id: binding.profile_id!,
    }))
  const clearedFeatureIds = normalized
    .filter((binding) => !binding.profile_id || !profileIds.has(binding.profile_id))
    .map((binding) => binding.feature_id)

  if (clearedFeatureIds.length > 0) {
    const { error } = await supabase
      .from('ai_feature_bindings')
      .delete()
      .eq('owner_id', userId)
      .in('feature_id', clearedFeatureIds)
    if (error) throw error
  }

  if (boundRows.length > 0) {
    const { error } = await supabase.from('ai_feature_bindings').upsert(boundRows, {
      onConflict: 'owner_id,feature_id',
    })
    if (error) throw error
  }

  return normalized.map((binding) => ({ featureId: binding.feature_id, profileId: binding.profile_id }))
}

async function upsertUserProvider(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  input: UserProviderInput | undefined,
) {
  const existingId = input?.id ? String(input.id).replace(/^user:/, '') : ''
  const normalized = normalizeProviderInput(input, { allowMissingKey: Boolean(existingId) })
  let encrypted: { ciphertext: string; iv: string } | null = null
  let keyHint = ''

  if (normalized.apiKey) {
    encrypted = await encryptUserApiKey(normalized.apiKey)
    keyHint = maskApiKey(normalized.apiKey)
  } else if (!existingId) {
    throw new Error('API key is required when creating a provider.')
  }

  const payload: Record<string, unknown> = {
    owner_id: userId,
    label: normalized.label,
    provider: normalized.provider,
    base_url: normalized.baseUrl,
    base_url_host: new URL(normalized.baseUrl).host,
    model: normalized.model,
    supports_vision: normalized.supportsVision,
    supports_html_generation: normalized.supportsHtmlGeneration,
    enabled: normalized.enabled,
  }

  if (encrypted) {
    payload.api_key_ciphertext = encrypted.ciphertext
    payload.api_key_iv = encrypted.iv
    payload.api_key_hint = keyHint
  }

  const query = existingId
    ? supabase.from('ai_user_providers').update(payload).eq('owner_id', userId).eq('id', existingId)
    : supabase.from('ai_user_providers').insert(payload)

  const { error } = await query
  if (error) throw error
}

async function deleteUserProvider(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  providerId: string | undefined,
) {
  const id = String(providerId ?? '').replace(/^user:/, '')
  if (!id) throw new Error('Missing provider id.')
  await supabase.from('ai_feature_bindings').delete().eq('owner_id', userId).eq('profile_id', `user:${id}`)
  const { error } = await supabase.from('ai_user_providers').delete().eq('owner_id', userId).eq('id', id)
  if (error) throw error
}

function normalizeProviderInput(input: UserProviderInput | undefined, options: { allowMissingModel?: boolean; allowMissingKey?: boolean } = {}) {
  const label = String(input?.label ?? '').trim().slice(0, 80)
  const provider = String(input?.provider ?? 'openai-compatible').trim().slice(0, 80) || 'openai-compatible'
  const model = String(input?.model ?? '').trim().slice(0, 160)
  const rawBaseUrl = String(input?.baseUrl ?? '').trim().replace(/\/$/, '')
  const apiKey = String(input?.apiKey ?? '').trim()

  if (!label) throw new Error('Provider label is required.')
  if (!model && !options.allowMissingModel) throw new Error('Model name is required.')
  if (!apiKey && !options.allowMissingKey) throw new Error('API key is required.')
  let baseUrl: URL
  try {
    baseUrl = new URL(rawBaseUrl)
  } catch {
    throw new Error('Base URL is invalid.')
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error('Base URL must use http or https.')

  return {
    label,
    provider,
    model,
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    apiKey,
    supportsVision: Boolean(input?.supportsVision),
    supportsHtmlGeneration: input?.supportsHtmlGeneration !== false,
    enabled: input?.enabled !== false,
  }
}

async function buildPayload(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], userId: string) {
  const profiles = await Promise.all((await loadConfigProfiles(supabase, userId)).map((profile) => toPublicProfile(profile)))
  const [{ data: bindings }, { data: requestRows }] = await Promise.all([
    supabase
      .from('ai_feature_bindings')
      .select('feature_id,profile_id,updated_at,validation_status,validated_at,validated_model,validation_error')
      .eq('owner_id', userId),
    supabase
      .from('ai_requests')
      .select('request_type,feature_id,provider,model,used_model,profile_id,profile_source,status,error_code,error_message,created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .limit(800),
  ])

  return {
    generatedAt: new Date().toISOString(),
    profiles,
    providerTemplates,
    features,
    bindings: normalizeBindings(bindings as BindingRow[] | null, profiles.map((profile) => profile.id)),
    stats: buildStats(requestRows ?? []),
    security: {
      keyStorage: 'Supabase Secrets + encrypted per-user provider keys',
      frontendKeyAccess: false,
      userKeyMode: 'encrypted-server-proxy',
    },
  }
}

function normalizeBindings(rows: BindingRow[] | null, profileIds: string[]) {
  const profileIdSet = new Set(profileIds)
  const defaults = new Map<AiFeatureId, string | null>()
  for (const feature of features) {
    defaults.set(feature.id, null)
  }

  for (const row of rows ?? []) {
    if (profileIdSet.has(row.profile_id)) defaults.set(row.feature_id, row.profile_id)
  }

  return features.map((feature) => {
    const row = rows?.find((binding) => binding.feature_id === feature.id)
    return {
      featureId: feature.id,
      profileId: defaults.get(feature.id),
      updatedAt: row?.updated_at ?? null,
      validationStatus: row?.validation_status ?? 'unknown',
      validatedAt: row?.validated_at ?? null,
      validatedModel: row?.validated_model ?? null,
      validationError: row?.validation_error ?? null,
    }
  })
}

function buildStats(rows: Array<Record<string, unknown>>) {
  const byFeature = new Map<string, ReturnType<typeof createStatBucket>>()
  const byModel = new Map<string, ReturnType<typeof createStatBucket>>()
  const byProfile = new Map<string, ReturnType<typeof createStatBucket>>()
  const byStatus = new Map<string, number>()
  const recentFailures: Array<{
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
  }> = []

  for (const row of rows) {
    const requestType = String(row.feature_id ?? row.request_type ?? 'unknown')
    const model = String(row.used_model ?? row.model ?? 'unknown')
    const profileId = String(row.profile_id ?? '').trim()
    const status = String(row.status ?? 'unknown')
    const createdAt = String(row.created_at ?? '')
    const errorCode = typeof row.error_code === 'string' ? row.error_code : null
    const errorMessage = typeof row.error_message === 'string' ? row.error_message : null

    bumpBucket(byFeature, requestType, {
      status,
      createdAt,
      usedModel: typeof row.used_model === 'string' ? row.used_model : typeof row.model === 'string' ? row.model : null,
      errorCode,
      errorMessage,
    })
    bumpBucket(byModel, model, {
      status,
      createdAt,
      usedModel: typeof row.used_model === 'string' ? row.used_model : typeof row.model === 'string' ? row.model : null,
      errorCode,
      errorMessage,
    })
    if (profileId) {
      bumpBucket(byProfile, profileId, {
        status,
        createdAt,
        usedModel: typeof row.used_model === 'string' ? row.used_model : typeof row.model === 'string' ? row.model : null,
        errorCode,
        errorMessage,
      })
    }
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1)
    if (status === 'error' && recentFailures.length < 8) {
      recentFailures.push({
        featureId: requestType,
        requestType: String(row.request_type ?? requestType),
        provider: String(row.provider ?? 'unknown'),
        model: String(row.model ?? 'unknown'),
        usedModel: typeof row.used_model === 'string' ? row.used_model : null,
        profileId: profileId || null,
        profileSource: typeof row.profile_source === 'string' ? row.profile_source : null,
        errorCode,
        errorMessage,
        createdAt,
      })
    }
  }

  return {
    total: rows.length,
    byFeature: Array.from(byFeature, ([featureId, bucket]) => ({ featureId, ...bucket })),
    byModel: Array.from(byModel, ([model, bucket]) => ({ model, ...bucket })),
    byProfile: Array.from(byProfile, ([profileId, bucket]) => ({ profileId, ...bucket })),
    byStatus: Array.from(byStatus, ([status, count]) => ({ status, count })),
    recentFailures,
  }
}

async function listModelsForRequest(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  body: ConfigBody,
) {
  const generatedAt = new Date().toISOString()
  const profile = await resolveModelDiscoveryProfile(supabase, userId, body)
  const runtimeHost = safeHost(profile.baseUrl ?? '')
  const cacheKey = modelCacheKey(profile.provider, profile.baseUrl ?? '', profile.id)
  const templateModels = fallbackModelsForProvider(profile.provider)
  const { data: cacheRow } = await supabase
    .from('ai_model_cache')
    .select('models,error_message,fetched_at,expires_at')
    .eq('owner_id', userId)
    .eq('cache_key', cacheKey)
    .maybeSingle()
  const cachedModels = cacheRow?.models
    ? (Array.isArray(cacheRow.models) ? cacheRow.models : JSON.parse(String(cacheRow.models ?? '[]'))) as AiModelOption[]
    : []

  if (!body.force) {
    if (cachedModels.length > 0 && String(cacheRow?.expires_at ?? '') > generatedAt) {
      return {
        generatedAt,
        profileId: profile.id.startsWith('draft:') ? null : profile.id,
        provider: profile.provider,
        baseUrlHost: runtimeHost,
        models: cachedModels,
        cached: true,
        source: 'cache',
        validated: false,
        error: cacheRow?.error_message ?? null,
        errorCode: null,
        suggestion: cacheRow?.error_message ? '当前显示的是缓存模型，尚未重新验证当前 API Key。' : null,
      }
    }
  }

  try {
    const models = await listOpenAiCompatibleModels(profile)
    await upsertModelCache(supabase, userId, cacheKey, profile.provider, runtimeHost, models, null)
    return {
      generatedAt,
      profileId: profile.id.startsWith('draft:') ? null : profile.id,
      provider: profile.provider,
      baseUrlHost: runtimeHost,
      models,
      cached: false,
      source: 'provider',
      validated: true,
      error: null,
      errorCode: null,
      suggestion: null,
    }
  } catch (error) {
    const payload = errorPayload(error)
    const sanitized = payload.error
    const fallbackModels = cachedModels.length > 0 ? cachedModels : templateModels
    const source = cachedModels.length > 0 ? 'cache' : 'template'
    await upsertModelCache(supabase, userId, cacheKey, profile.provider, runtimeHost, fallbackModels, sanitized)
    return {
      generatedAt,
      profileId: profile.id.startsWith('draft:') ? null : profile.id,
      provider: profile.provider,
      baseUrlHost: runtimeHost,
      models: fallbackModels,
      cached: source === 'cache',
      source,
      validated: false,
      error: sanitized,
      errorCode: payload.code,
      suggestion: source === 'cache'
        ? `实时拉取失败：${payload.suggestion} 当前显示的是缓存模型，尚未重新验证当前 API Key。`
        : `实时拉取失败：${payload.suggestion} 当前显示的是平台模板模型，尚未验证可用。`,
    }
  }
}

async function resolveModelDiscoveryProfile(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  body: ConfigBody,
): Promise<AiProfile> {
  if (body.profileId) {
    const profiles = await loadConfigProfiles(supabase, userId)
    const profile = profiles.find((item) => item.id === body.profileId)
    if (profile) return profile
  }

  const normalized = normalizeProviderInput(body.providerDraft, {
    allowMissingModel: true,
    allowMissingKey: false,
  })
  return {
    id: `draft:${normalized.provider}:${normalized.baseUrl}:${normalized.model}`,
    label: normalized.label,
    provider: normalized.provider,
    model: normalized.model || fallbackModelsForProvider(normalized.provider)[0]?.id || 'model',
    enabled: true,
    source: 'user',
    baseUrl: normalized.baseUrl,
    apiKeyCiphertext: '',
    apiKeyIv: '',
    apiKeyHint: normalized.apiKey ? maskApiKey(normalized.apiKey) : null,
    supportsVision: normalized.supportsVision,
    supportsHtmlGeneration: normalized.supportsHtmlGeneration,
    apiKeyOverride: normalized.apiKey,
  } as AiProfile
}

function modelCacheKey(provider: string, baseUrl: string, profileId: string) {
  return `${profileId}|${provider}|${safeHost(baseUrl)}`
}

async function upsertModelCache(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  cacheKey: string,
  provider: string,
  baseUrlHost: string,
  models: AiModelOption[],
  errorMessage: string | null,
) {
  await supabase.from('ai_model_cache').upsert({
    owner_id: userId,
    cache_key: cacheKey,
      provider,
      base_url_host: baseUrlHost,
      models: JSON.stringify(models),
      error_message: errorMessage,
    fetched_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: 'owner_id,cache_key' })
}

function fallbackModelsForProvider(provider: string): AiModelOption[] {
  const normalized = provider.toLowerCase()
  const template = providerTemplates.find((item) => item.provider.toLowerCase() === normalized || item.id === normalized)
  return template?.models ?? [{
    id: '',
    label: '手动输入模型',
    source: 'manual',
    capabilities: ['text'],
    htmlRecommended: false,
  }]
}

async function validateBindings(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  bindings: Array<{ featureId?: string; profileId?: string }>,
) {
  const now = new Date().toISOString()
  const profiles = await getAvailableProfiles(supabase, userId)
  const results = []

  for (const binding of bindings) {
    const featureId = String(binding.featureId ?? '').trim() as AiFeatureId
    const profileId = String(binding.profileId ?? '').trim()
    const feature = features.find((item) => item.id === featureId)
    const profile = profiles.find((item) => item.id === profileId)
    if (!feature || !profile) continue

    const started = Date.now()
    let status: 'pass' | 'fail' = 'pass'
    let error: string | null = null
    let usedModel: string | null = profile.model
    let latencyMs: number | null = null

    try {
      assertProfileCapability(feature, profile)
      const meta = await chatCompletionWithMeta({
        profile,
        temperature: 0,
        maxTokens: 16,
        timeoutMs: 20000,
        messages: [
          { role: 'system', content: 'Return only OK.' },
          { role: 'user', content: `Validate feature binding: ${feature.label}.` },
        ],
      })
      usedModel = meta.usedModel
      latencyMs = Date.now() - started
      await supabase.from('ai_requests').insert({
        owner_id: userId,
        request_type: 'binding_validation',
        feature_id: feature.id,
        provider: profile.provider,
        model: profile.model,
        used_model: usedModel,
        profile_id: profile.id,
        provider_id: profile.userProviderId ?? profile.id,
        profile_source: profile.source ?? 'server',
        status: 'ok',
        latency_ms: latencyMs,
        created_at: now,
      })
    } catch (caught) {
      const payload = errorPayload(caught)
      status = 'fail'
      error = payload.error
      latencyMs = Date.now() - started
      await supabase.from('ai_requests').insert({
        owner_id: userId,
        request_type: 'binding_validation',
        feature_id: feature.id,
        provider: profile.provider,
        model: profile.model,
        used_model: usedModel,
        profile_id: profile.id,
        provider_id: profile.userProviderId ?? profile.id,
        profile_source: profile.source ?? 'server',
        status: 'error',
        error_code: payload.code,
        error_message: payload.error,
        latency_ms: latencyMs,
        created_at: now,
      })
    }

    await supabase
      .from('ai_feature_bindings')
      .update({
        validation_status: status,
        validated_at: now,
        validated_model: usedModel,
        validation_error: error,
      })
      .eq('owner_id', userId)
      .eq('feature_id', feature.id)

    results.push({
      featureId: feature.id,
      profileId: profile.id,
      status,
      checkedAt: now,
      usedModel,
      latencyMs,
      error,
    })
  }

  return results
}

function assertProfileCapability(feature: FeatureDefinition, profile: AiProfile) {
  if (feature.status !== 'available') {
    throw new AiFunctionError('FUNCTION_NOT_DEPLOYED', `${feature.label} 后端尚未部署，不能验证绑定。`, 404)
  }
  if (feature.requiredCapability === 'vision' && !profile.supportsVision && !inferModelCapabilities(profile.model).includes('vision')) {
    throw new AiFunctionError('MODEL_NOT_CONFIGURED', '当前模型未标记为支持视觉输入，图片识题不能绑定它。', 400)
  }
  if (feature.requiredCapability === 'html' && profile.supportsHtmlGeneration === false) {
    throw new AiFunctionError('MODEL_NOT_CONFIGURED', '当前模型被标记为不用于 HTML 生成。', 400)
  }
}

function safeHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return 'invalid-url'
  }
}

function createStatBucket() {
  return {
    total: 0,
    ok: 0,
    error: 0,
    lastCalledAt: null as string | null,
    lastUsedModel: null as string | null,
    lastErrorCode: null as string | null,
    lastErrorMessage: null as string | null,
  }
}

function bumpBucket(
  map: Map<string, ReturnType<typeof createStatBucket>>,
  key: string,
  details: {
    status: string
    createdAt: string
    usedModel: string | null
    errorCode: string | null
    errorMessage: string | null
  },
) {
  const bucket = map.get(key) ?? createStatBucket()
  bucket.total += 1
  if (details.status === 'error') bucket.error += 1
  else bucket.ok += 1
  if (details.createdAt && (!bucket.lastCalledAt || details.createdAt > bucket.lastCalledAt)) {
    bucket.lastCalledAt = details.createdAt
    bucket.lastUsedModel = details.usedModel
  }
  if (details.status === 'error' && !bucket.lastErrorCode && !bucket.lastErrorMessage) {
    bucket.lastErrorCode = details.errorCode
    bucket.lastErrorMessage = details.errorMessage
  }
  map.set(key, bucket)
}

async function loadConfigProfiles(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
): Promise<AiProfile[]> {
  const [{ data: userRows }, serverProfiles] = await Promise.all([
    supabase
      .from('ai_user_providers')
      .select('id,label,provider,base_url,model,api_key_ciphertext,api_key_iv,api_key_hint,supports_vision,supports_html_generation,enabled')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false }),
    Promise.resolve(getProfiles()),
  ])

  const userProfiles = (userRows ?? []).map((row) => mapUserProviderRow(row as unknown as UserProviderRow, userId))
  return [...userProfiles, ...serverProfiles]
}

function mapUserProviderRow(row: UserProviderRow, userId: string): AiProfile {
  return {
    id: `user:${row.id}`,
    label: String(row.label ?? '用户自定义 API'),
    provider: String(row.provider ?? 'openai-compatible'),
    model: String(row.model ?? ''),
    enabled: Boolean(row.enabled ?? true),
    source: 'user',
    userProviderId: String(row.id),
    baseUrl: String(row.base_url ?? ''),
    apiKeyCiphertext: String(row.api_key_ciphertext ?? ''),
    apiKeyIv: String(row.api_key_iv ?? ''),
    apiKeyHint: typeof row.api_key_hint === 'string' ? row.api_key_hint : null,
    ownerId: userId,
    supportsVision: Boolean(row.supports_vision),
    supportsHtmlGeneration: Boolean(row.supports_html_generation ?? true),
  }
}
