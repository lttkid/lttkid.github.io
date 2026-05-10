import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type AiProfile = {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  baseUrl?: string
  apiKeyEnv?: string
  baseUrlEnv?: string
  source?: 'server' | 'user'
  userProviderId?: string
  apiKeyCiphertext?: string
  apiKeyIv?: string
  apiKeyHint?: string | null
  ownerId?: string
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
}

export type PublicAiProfile = {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  baseUrlHost: string
  source: 'server' | 'user'
  userProviderId?: string
  keyHint?: string | null
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
}

export type AiFeatureId = 'summarize' | 'explain' | 'generate_html' | 'image_question' | 'persona_chat'

type RuntimeProfile = {
  profile: AiProfile
  apiKey: string | null
  apiKeyEnv: string
  baseUrl: string
  baseUrlHost: string
  configured: boolean
}

export function getSupabaseForRequest(req: Request) {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY.')
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: req.headers.get('Authorization') ?? '',
      },
    },
  })
}

export async function requireUser(req: Request) {
  const supabase = getSupabaseForRequest(req)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Content-Type': 'application/json',
      },
    })
  }
  return { supabase, user: data.user }
}

export function getProfiles(): AiProfile[] {
  const raw = Deno.env.get('AI_PROFILES_JSON')
  if (raw) {
    const parsed = JSON.parse(raw) as Partial<AiProfile>[]
    return parsed
      .map((profile, index) => normalizeProfile(profile, index))
      .filter((profile): profile is AiProfile => Boolean(profile?.enabled))
  }

  return [
    {
      id: 'default',
      label: Deno.env.get('AI_PROFILE_LABEL') ?? '默认服务端模型',
      provider: Deno.env.get('AI_PROVIDER') ?? 'openai-compatible',
      model: Deno.env.get('AI_MODEL') ?? 'server-configured-model',
      enabled: true,
      source: 'server',
      baseUrl: Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1',
      apiKeyEnv: 'AI_API_KEY',
    },
  ]
}

function normalizeProfile(profile: Partial<AiProfile>, index: number): AiProfile | null {
  const model = String(profile.model ?? '').trim()
  if (!model) return null

  return {
    id: String(profile.id ?? `profile-${index + 1}`),
    label: String(profile.label ?? model),
    provider: String(profile.provider ?? 'openai-compatible'),
    model,
    enabled: profile.enabled !== false,
    source: 'server',
    baseUrl: profile.baseUrl,
    apiKeyEnv: profile.apiKeyEnv,
    baseUrlEnv: profile.baseUrlEnv,
  }
}

export async function getAvailableProfiles(supabase?: ReturnType<typeof getSupabaseForRequest>, userId?: string): Promise<AiProfile[]> {
  const serverProfiles = getProfiles()
  if (!supabase || !userId) return serverProfiles

  const { data } = await supabase
    .from('ai_user_providers')
    .select('id,label,provider,base_url,base_url_host,model,api_key_ciphertext,api_key_iv,api_key_hint,supports_vision,supports_html_generation,enabled')
    .eq('owner_id', userId)
    .eq('enabled', true)
    .order('updated_at', { ascending: false })

  const userProfiles = (data ?? []).map((row: Record<string, unknown>): AiProfile => ({
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
  }))

  return [...userProfiles, ...serverProfiles]
}

export async function resolveProfile(
  modelId?: string,
  supabase?: ReturnType<typeof getSupabaseForRequest>,
  userId?: string,
) {
  const profiles = await getAvailableProfiles(supabase, userId)
  return profiles.find((profile) => profile.id === modelId) ?? profiles[0]
}

export async function resolveProfileForFeature(
  supabase: ReturnType<typeof getSupabaseForRequest>,
  userId: string,
  featureId: AiFeatureId,
  explicitModelId?: string,
) {
  if (explicitModelId) return resolveProfile(explicitModelId, supabase, userId)

  const { data } = await supabase
    .from('ai_feature_bindings')
    .select('profile_id')
    .eq('owner_id', userId)
    .eq('feature_id', featureId)
    .maybeSingle()

  return resolveProfile(String(data?.profile_id ?? ''), supabase, userId)
}

async function importEncryptionKey(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function getUserKeyEncryptionSecret() {
  return Deno.env.get('AI_USER_KEY_ENCRYPTION_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
}

export async function encryptUserApiKey(apiKey: string) {
  const secret = getUserKeyEncryptionSecret()
  if (!secret) throw new Error('Missing AI_USER_KEY_ENCRYPTION_SECRET.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importEncryptionKey(secret)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(apiKey))
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
  }
}

export async function decryptUserApiKey(ciphertext: string, iv: string) {
  const secret = getUserKeyEncryptionSecret()
  if (!secret) throw new Error('Missing AI_USER_KEY_ENCRYPTION_SECRET.')
  const key = await importEncryptionKey(secret)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  )
  return new TextDecoder().decode(plaintext)
}

export function maskApiKey(apiKey: string) {
  const trimmed = apiKey.trim()
  if (trimmed.length <= 8) return '已保存'
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`
}

export async function resolveRuntimeProfile(profile: AiProfile): Promise<RuntimeProfile> {
  const apiKeyEnv = profile.apiKeyEnv ?? 'AI_API_KEY'
  const baseUrl = (
    profile.baseUrl ??
    Deno.env.get(profile.baseUrlEnv ?? 'AI_BASE_URL') ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '')
  const apiKey = profile.source === 'user'
    ? await decryptUserApiKey(String(profile.apiKeyCiphertext ?? ''), String(profile.apiKeyIv ?? ''))
    : Deno.env.get(apiKeyEnv) ?? null
  let baseUrlHost = 'invalid-url'

  try {
    baseUrlHost = new URL(baseUrl).host
  } catch {
    baseUrlHost = 'invalid-url'
  }

  return {
    profile,
    apiKey,
    apiKeyEnv,
    baseUrl,
    baseUrlHost,
    configured: Boolean(apiKey && profile.model && baseUrlHost !== 'invalid-url'),
  }
}

export async function toPublicProfile(profile: AiProfile): Promise<PublicAiProfile> {
  const runtime = await resolveRuntimeProfile(profile)
  return {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    model: profile.model,
    enabled: profile.enabled,
    configured: runtime.configured,
    baseUrlHost: runtime.baseUrlHost,
    source: profile.source ?? 'server',
    userProviderId: profile.userProviderId,
    keyHint: profile.source === 'user' ? profile.apiKeyHint ?? null : null,
    supportsVision: profile.supportsVision,
    supportsHtmlGeneration: profile.supportsHtmlGeneration,
  }
}

export function sanitizeAiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/Bearer\s+[\w.-]+/gi, 'Bearer [redacted]')
    .replace(/sk-[\w-]+/gi, '[redacted-key]')
    .replace(/api[_-]?key["':=\s]+[\w.-]+/gi, 'api_key=[redacted]')
    .slice(0, 700)
}

export type ChatMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

export async function chatCompletion({
  profile,
  messages,
  temperature = 0.3,
  maxTokens,
  timeoutMs = 45000,
}: {
  profile: AiProfile
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }>
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}) {
  const { apiKey, apiKeyEnv, baseUrl } = await resolveRuntimeProfile(profile)
  if (!apiKey) {
    throw new Error(`Missing API key secret: ${apiKeyEnv}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        temperature,
        ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
      }),
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`AI provider error ${response.status}: ${sanitizeAiError(await response.text())}`)
  }

  const data = await response.json()
  const answer = data.choices?.[0]?.message?.content
  if (!answer) throw new Error('AI provider returned an empty answer.')
  return String(answer)
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
