import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  encryptUserApiKey,
  getAvailableProfiles,
  maskApiKey,
  requireUser,
  sanitizeAiError,
  toPublicProfile,
  type AiFeatureId,
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
      } else if (Object.hasOwn(body, 'bindings')) {
        await saveBindings(supabase, user.id, body.bindings ?? [])
      }
    }

    return jsonResponse(await buildPayload(supabase, user.id))
  } catch (error) {
    if (error instanceof Response) return error
    return jsonResponse({ error: sanitizeAiError(error) }, 500)
  }
})

type ConfigBody = {
        action?: string
        bindings?: Array<{ featureId?: string; profileId?: string }>
        provider?: UserProviderInput
        providerId?: string
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
  const rows = bindings
    .map((binding) => ({
      owner_id: userId,
      feature_id: String(binding.featureId ?? '').trim() as AiFeatureId,
      profile_id: String(binding.profileId ?? '').trim(),
    }))
    .filter((binding) => validFeatures.has(binding.feature_id) && profileIds.has(binding.profile_id))

  if (rows.length === 0) {
    throw new Error('No valid AI feature bindings to save.')
  }

  const { error } = await supabase.from('ai_feature_bindings').upsert(rows, {
    onConflict: 'owner_id,feature_id',
  })
  if (error) throw error
}

async function upsertUserProvider(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
  input: UserProviderInput | undefined,
) {
  const normalized = normalizeProviderInput(input)
  const existingId = input?.id ? String(input.id).replace(/^user:/, '') : ''
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

function normalizeProviderInput(input: UserProviderInput | undefined) {
  const label = String(input?.label ?? '').trim().slice(0, 80)
  const provider = String(input?.provider ?? 'openai-compatible').trim().slice(0, 80) || 'openai-compatible'
  const model = String(input?.model ?? '').trim().slice(0, 160)
  const rawBaseUrl = String(input?.baseUrl ?? '').trim().replace(/\/$/, '')
  const apiKey = String(input?.apiKey ?? '').trim()

  if (!label) throw new Error('Provider label is required.')
  if (!model) throw new Error('Model name is required.')
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
  const profiles = await Promise.all((await getAvailableProfiles(supabase, userId)).map((profile) => toPublicProfile(profile)))
  const [{ data: bindings }, { data: requestRows }] = await Promise.all([
    supabase
      .from('ai_feature_bindings')
      .select('feature_id,profile_id,updated_at')
      .eq('owner_id', userId),
    supabase
      .from('ai_requests')
      .select('request_type,provider,model,status,created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false })
      .limit(800),
  ])

  return {
    generatedAt: new Date().toISOString(),
    profiles,
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
    defaults.set(feature.id, profileIds[0] ?? null)
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
    }
  })
}

function buildStats(rows: Array<Record<string, unknown>>) {
  const byFeature = new Map<string, ReturnType<typeof createStatBucket>>()
  const byModel = new Map<string, ReturnType<typeof createStatBucket>>()
  const byStatus = new Map<string, number>()

  for (const row of rows) {
    const requestType = String(row.request_type ?? 'unknown')
    const model = String(row.model ?? 'unknown')
    const status = String(row.status ?? 'unknown')
    const createdAt = String(row.created_at ?? '')

    bumpBucket(byFeature, requestType, status, createdAt)
    bumpBucket(byModel, model, status, createdAt)
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1)
  }

  return {
    total: rows.length,
    byFeature: Array.from(byFeature, ([featureId, bucket]) => ({ featureId, ...bucket })),
    byModel: Array.from(byModel, ([model, bucket]) => ({ model, ...bucket })),
    byStatus: Array.from(byStatus, ([status, count]) => ({ status, count })),
  }
}

function createStatBucket() {
  return {
    total: 0,
    ok: 0,
    error: 0,
    lastCalledAt: null as string | null,
  }
}

function bumpBucket(map: Map<string, ReturnType<typeof createStatBucket>>, key: string, status: string, createdAt: string) {
  const bucket = map.get(key) ?? createStatBucket()
  bucket.total += 1
  if (status === 'error') bucket.error += 1
  else bucket.ok += 1
  if (createdAt && (!bucket.lastCalledAt || createdAt > bucket.lastCalledAt)) bucket.lastCalledAt = createdAt
  map.set(key, bucket)
}
