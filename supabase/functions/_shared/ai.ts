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
}

export type PublicAiProfile = {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  baseUrlHost: string
}

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
    baseUrl: profile.baseUrl,
    apiKeyEnv: profile.apiKeyEnv,
    baseUrlEnv: profile.baseUrlEnv,
  }
}

export function resolveProfile(modelId?: string) {
  const profiles = getProfiles()
  return profiles.find((profile) => profile.id === modelId) ?? profiles[0]
}

export function resolveRuntimeProfile(profile: AiProfile): RuntimeProfile {
  const apiKeyEnv = profile.apiKeyEnv ?? 'AI_API_KEY'
  const baseUrl = (
    profile.baseUrl ??
    Deno.env.get(profile.baseUrlEnv ?? 'AI_BASE_URL') ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '')
  const apiKey = Deno.env.get(apiKeyEnv) ?? null
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

export function toPublicProfile(profile: AiProfile): PublicAiProfile {
  const runtime = resolveRuntimeProfile(profile)
  return {
    id: profile.id,
    label: profile.label,
    provider: profile.provider,
    model: profile.model,
    enabled: profile.enabled,
    configured: runtime.configured,
    baseUrlHost: runtime.baseUrlHost,
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
  const { apiKey, apiKeyEnv, baseUrl } = resolveRuntimeProfile(profile)
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
