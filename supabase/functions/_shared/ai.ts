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
  apiKeyOverride?: string
  apiKeyHint?: string | null
  ownerId?: string
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
}

export type AiModelCapability = 'text' | 'vision' | 'long_context' | 'html'

export type AiModelOption = {
  id: string
  label: string
  ownedBy?: string | null
  capabilities: AiModelCapability[]
  source: 'provider' | 'preset' | 'manual'
  contextWindow?: number | null
  htmlRecommended?: boolean
}

export type AiProviderTemplate = {
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

export type PublicAiProfile = {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  baseUrl?: string
  baseUrlHost: string
  source: 'server' | 'user'
  userProviderId?: string
  keyHint?: string | null
  supportsVision?: boolean
  supportsHtmlGeneration?: boolean
  configurationError?: string | null
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

export const providerTemplates: AiProviderTemplate[] = [
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    provider: 'siliconflow',
    icon: '/provider-icons/siliconflow.svg',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiType: 'openai-compatible',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    docsUrl: 'https://docs.siliconflow.cn/',
    keyHint: '通常以 sk- 开头',
    notes: '适合接入 Qwen、DeepSeek、视觉模型等 OpenAI-compatible 模型。',
    models: [
      modelOption('Qwen/Qwen2.5-7B-Instruct', ['text', 'html']),
      modelOption('Qwen/Qwen2.5-14B-Instruct', ['text', 'html']),
      modelOption('deepseek-ai/DeepSeek-V3', ['text', 'long_context', 'html']),
      modelOption('Qwen/Qwen2-VL-72B-Instruct', ['text', 'vision', 'html']),
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'deepseek',
    icon: '/provider-icons/deepseek.svg',
    baseUrl: 'https://api.deepseek.com',
    apiType: 'openai-compatible',
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://api-docs.deepseek.com/',
    keyHint: 'DeepSeek API Key',
    notes: '适合文本解释、摘要、长文推理；视觉输入请绑定其他 vision 模型。',
    models: [
      modelOption('deepseek-chat', ['text', 'long_context', 'html']),
      modelOption('deepseek-reasoner', ['text', 'long_context']),
    ],
  },
  {
    id: 'dashscope',
    label: '通义千问 / DashScope',
    provider: 'dashscope',
    icon: '/provider-icons/dashscope.svg',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiType: 'openai-compatible',
    defaultModel: 'qwen-plus',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    keyHint: 'DashScope API Key',
    notes: '兼容 OpenAI SDK，适合摘要、解释、HTML 生成；视觉任务选择 qwen-vl 系列。',
    models: [
      modelOption('qwen-plus', ['text', 'long_context', 'html']),
      modelOption('qwen-turbo', ['text', 'html']),
      modelOption('qwen-max', ['text', 'long_context', 'html']),
      modelOption('qwen-vl-plus', ['text', 'vision', 'html']),
    ],
  },
  {
    id: 'mimo',
    label: '小米 MiMo',
    provider: 'mimo',
    icon: '/provider-icons/mimo.svg',
    baseUrl: '',
    apiType: 'openai-compatible',
    defaultModel: 'MiMo-7B-RL',
    docsUrl: 'https://github.com/XiaomiMiMo/MiMo',
    keyHint: '请以服务商控制台为准',
    notes: 'MiMo 生态接口仍需按你实际服务商控制台填写 Base URL；这里先提供模型能力占位。',
    models: [
      modelOption('MiMo-7B-RL', ['text']),
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    provider: 'openrouter',
    icon: '/provider-icons/openrouter.svg',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiType: 'openai-compatible',
    defaultModel: 'openai/gpt-4o-mini',
    docsUrl: 'https://openrouter.ai/docs',
    keyHint: 'OpenRouter API Key',
    notes: '聚合多家模型，模型名称通常带 provider 前缀。',
    models: [
      modelOption('openai/gpt-4o-mini', ['text', 'vision', 'html']),
      modelOption('anthropic/claude-3.5-sonnet', ['text', 'vision', 'long_context', 'html']),
      modelOption('google/gemini-flash-1.5', ['text', 'vision', 'long_context', 'html']),
    ],
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    provider: 'zhipu',
    icon: '/provider-icons/zhipu.svg',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiType: 'openai-compatible',
    defaultModel: 'glm-4-flash',
    docsUrl: 'https://docs.bigmodel.cn/',
    keyHint: '智谱 API Key',
    notes: '适合文本和多模态任务；视觉能力请确认所选 GLM 模型支持图片输入。',
    models: [
      modelOption('glm-4-flash', ['text', 'html']),
      modelOption('glm-4-plus', ['text', 'long_context', 'html']),
      modelOption('glm-4v', ['text', 'vision', 'html']),
    ],
  },
  {
    id: 'volcengine',
    label: '火山方舟',
    provider: 'volcengine',
    icon: '/provider-icons/volcengine.svg',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiType: 'openai-compatible',
    defaultModel: '',
    docsUrl: 'https://www.volcengine.com/docs/82379',
    keyHint: '火山方舟 API Key',
    notes: '模型 ID 通常来自方舟控制台 Endpoint，请优先从 /models 拉取或手动粘贴。',
    models: [
      modelOption('请从控制台选择 endpoint/model', ['text']),
    ],
  },
  {
    id: 'moonshot',
    label: '月之暗面 Kimi',
    provider: 'moonshot',
    icon: '/provider-icons/moonshot.svg',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiType: 'openai-compatible',
    defaultModel: 'moonshot-v1-8k',
    docsUrl: 'https://platform.moonshot.cn/docs',
    keyHint: 'Moonshot API Key',
    notes: '适合文本阅读、摘要和长上下文；视觉输入请绑定其他模型。',
    models: [
      modelOption('moonshot-v1-8k', ['text', 'html']),
      modelOption('moonshot-v1-32k', ['text', 'long_context', 'html']),
      modelOption('moonshot-v1-128k', ['text', 'long_context', 'html']),
    ],
  },
  {
    id: 'custom-openai',
    label: 'OpenAI-compatible 自定义',
    provider: 'openai-compatible',
    icon: '/provider-icons/openai-compatible.svg',
    baseUrl: 'https://api.openai.com/v1',
    apiType: 'openai-compatible',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/docs',
    keyHint: '服务商 API Key',
    notes: '适合任何兼容 /chat/completions 和 /models 的服务。',
    models: [
      modelOption('gpt-4o-mini', ['text', 'vision', 'html']),
      modelOption('gpt-4.1-mini', ['text', 'vision', 'long_context', 'html']),
    ],
  },
]

function modelOption(
  id: string,
  capabilities: AiModelCapability[],
  options: Partial<AiModelOption> = {},
): AiModelOption {
  return {
    id,
    label: id,
    source: 'preset',
    capabilities,
    htmlRecommended: capabilities.includes('html'),
    ...options,
  }
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
    supportsVision: Boolean(profile.supportsVision),
    supportsHtmlGeneration: profile.supportsHtmlGeneration !== false,
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

  const profiles = await getAvailableProfiles(supabase, userId)
  const { data } = await supabase
    .from('ai_feature_bindings')
    .select('profile_id')
    .eq('owner_id', userId)
    .eq('feature_id', featureId)
    .maybeSingle()

  if (data?.profile_id) {
    return profiles.find((profile) => profile.id === String(data.profile_id)) ?? null
  }

  // When a feature is unbound, prefer the server default instead of the newest user Provider.
  // This matches the UI copy: "未绑定：使用系统默认".
  return (
    profiles.find((profile) => profile.id === 'default') ??
    profiles.find((profile) => profile.source !== 'user') ??
    profiles[0] ??
    null
  )
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
  let apiKey: string | null = null

  if (profile.apiKeyOverride) {
    apiKey = profile.apiKeyOverride
  } else if (profile.source === 'user') {
    try {
      apiKey = await decryptUserApiKey(String(profile.apiKeyCiphertext ?? ''), String(profile.apiKeyIv ?? ''))
    } catch {
      throw new AiFunctionError(
        'PROVIDER_AUTH_FAILED',
        'Unable to decrypt saved Provider API key. Please edit this Provider and save the API key again.',
        400,
      )
    }
  } else {
    apiKey = Deno.env.get(apiKeyEnv) ?? null
  }

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
  try {
    const runtime = await resolveRuntimeProfile(profile)
    return {
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      model: profile.model,
      enabled: profile.enabled,
      configured: runtime.configured,
      baseUrl: runtime.baseUrl,
      baseUrlHost: runtime.baseUrlHost,
      source: profile.source ?? 'server',
      userProviderId: profile.userProviderId,
      keyHint: profile.source === 'user' ? profile.apiKeyHint ?? null : null,
      supportsVision: profile.supportsVision,
      supportsHtmlGeneration: profile.supportsHtmlGeneration,
      configurationError: null,
    }
  } catch (error) {
    const baseUrl = (
      profile.baseUrl ??
      Deno.env.get(profile.baseUrlEnv ?? 'AI_BASE_URL') ??
      'https://api.openai.com/v1'
    ).replace(/\/$/, '')
    let baseUrlHost = 'invalid-url'

    try {
      baseUrlHost = new URL(baseUrl).host
    } catch {
      baseUrlHost = 'invalid-url'
    }

    console.warn(`AI profile ${profile.id} is not configurable: ${sanitizeAiError(error)}`)
    return {
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      model: profile.model,
      enabled: profile.enabled,
      configured: false,
      baseUrl,
      baseUrlHost,
      source: profile.source ?? 'server',
      userProviderId: profile.userProviderId,
      keyHint: profile.source === 'user' ? profile.apiKeyHint ?? null : null,
      supportsVision: profile.supportsVision,
      supportsHtmlGeneration: profile.supportsHtmlGeneration,
      configurationError: sanitizeAiError(error),
    }
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

export type AiErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_OUTPUT_INVALID'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_NOT_CONFIGURED'
  | 'FUNCTION_NOT_DEPLOYED'
  | 'REQUEST_INVALID'
  | 'UNKNOWN'

export class AiFunctionError extends Error {
  code: AiErrorCode
  status: number
  details?: Record<string, unknown>

  constructor(code: AiErrorCode, message: string, status = 500, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AiFunctionError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function classifyAiError(error: unknown): AiErrorCode {
  if (error instanceof AiFunctionError) return error.code
  const message = sanitizeAiError(error).toLowerCase()
  if (message.includes('missing api key') || message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
    return 'PROVIDER_AUTH_FAILED'
  }
  if (message.includes('abort') || message.includes('timeout') || message.includes('timed out')) return 'MODEL_TIMEOUT'
  if (
    message.includes('markdown fences') ||
    message.includes('must start with <!doctype html>') ||
    message.includes('must include') ||
    message.includes('not allowed') ||
    message.includes('empty html')
  ) {
    return 'MODEL_OUTPUT_INVALID'
  }
  if (message.includes('no ai profile') || message.includes('model') && message.includes('required')) return 'MODEL_NOT_CONFIGURED'
  if (message.includes('provider error 429') || message.includes('provider error 5')) return 'PROVIDER_UNAVAILABLE'
  if (message.includes('empty answer')) return 'MODEL_OUTPUT_INVALID'
  return 'UNKNOWN'
}

export function errorPayload(error: unknown, fallbackStatus = 500) {
  const code = classifyAiError(error)
  const status = error instanceof AiFunctionError ? error.status : fallbackStatus
  return {
    error: sanitizeAiError(error),
    code,
    suggestion: errorSuggestion(code),
  }
}

export function errorSuggestion(code: AiErrorCode) {
  const suggestions: Record<AiErrorCode, string> = {
    PROVIDER_AUTH_FAILED: 'API Key 认证失败。请检查当前平台是否正确、Key 是否来自该平台、Base URL 是否匹配、Key 是否过期，以及该平台是否支持兼容的 /models 接口。',
    MODEL_TIMEOUT: '模型响应超时。可以换更快的模型、缩短需求，或稍后重试。',
    MODEL_OUTPUT_INVALID: '模型返回空内容或不合规的 HTML。可能原因：模型不支持长输出、API 余额不足、内容被安全过滤。建议：1) 检查 API 余额；2) 换更强的模型；3) 简化需求后重试。',
    PROVIDER_UNAVAILABLE: '模型服务暂时不可用或被限流。请稍后重试，或切换到其他 Provider。',
    MODEL_NOT_CONFIGURED: '没有可用模型配置。请到部署中心绑定一个已验证的模型。',
    FUNCTION_NOT_DEPLOYED: '请确认对应 Supabase Edge Function 已部署，且前端 Supabase URL 与 anon key 正确。',
    REQUEST_INVALID: '请求内容不完整或格式不支持，请检查输入后重试。',
    UNKNOWN: '请查看部署中心的 AI 健康检查和 ai_requests 日志定位原因。',
  }
  return suggestions[code]
}

export function inferModelCapabilities(modelId: string): AiModelCapability[] {
  const lower = modelId.toLowerCase()
  const capabilities = new Set<AiModelCapability>(['text'])
  if (/(vision|vl|gpt-4o|omni|gemini|claude-3|qwen.*vl|glm-4v|image)/i.test(lower)) capabilities.add('vision')
  if (/(128k|32k|long|1m|200k|context|deepseek|qwen-plus|qwen-max|moonshot-v1-128k|moonshot-v1-32k)/i.test(lower)) capabilities.add('long_context')
  if (/(html|instruct|chat|gpt|qwen|deepseek|glm|claude|gemini|moonshot|mimo)/i.test(lower)) capabilities.add('html')
  return Array.from(capabilities)
}

export async function listOpenAiCompatibleModels(profile: AiProfile, timeoutMs = 15000): Promise<AiModelOption[]> {
  const { apiKey, apiKeyEnv, baseUrl } = await resolveRuntimeProfile(profile)
  if (!apiKey) throw new AiFunctionError('PROVIDER_AUTH_FAILED', `Missing API key secret: ${apiKeyEnv}`, 400)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  try {
    response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AiFunctionError('MODEL_TIMEOUT', 'Timed out while fetching model list.', 504)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const text = sanitizeAiError(await response.text())
    const code = response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_UNAVAILABLE'
    throw new AiFunctionError(code, `AI provider models error ${response.status}: ${text}`, response.status)
  }

  const payload = await response.json()
  const rawModels = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
  return rawModels
    .map((model: Record<string, unknown>) => normalizeModelOption(model))
    .filter((model: AiModelOption | null): model is AiModelOption => Boolean(model))
    .slice(0, 200)
}

function normalizeModelOption(model: Record<string, unknown>): AiModelOption | null {
  const id = String(model.id ?? model.name ?? '').trim()
  if (!id) return null
  const capabilities = inferModelCapabilities(id)
  return {
    id,
    label: String(model.display_name ?? model.name ?? id),
    ownedBy: typeof model.owned_by === 'string' ? model.owned_by : null,
    source: 'provider',
    capabilities,
    htmlRecommended: capabilities.includes('html'),
    contextWindow: typeof model.context_window === 'number' ? model.context_window : null,
  }
}

export type ChatMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >

type ChatCompletionArgs = {
  profile: AiProfile
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: ChatMessageContent }>
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
}

function extractChatAnswer(data: unknown): string {
  const message = (data as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]?.message
  if (!message) return ''
  const content = message.content
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const value = (part as { text?: unknown }).text
          if (typeof value === 'string') return value
        }
        return ''
      })
      .join('')
    if (text.trim()) return text
  }
  const reasoning = message.reasoning_content
  if (typeof reasoning === 'string' && reasoning.trim()) return reasoning
  return ''
}

export async function chatCompletion(args: ChatCompletionArgs) {
  return (await chatCompletionWithMeta(args)).answer
}

export async function chatCompletionWithMeta({
  profile,
  messages,
  temperature = 0.3,
  maxTokens,
  timeoutMs = 45000,
}: ChatCompletionArgs) {
  const { apiKey, apiKeyEnv, baseUrl } = await resolveRuntimeProfile(profile)
  if (!apiKey) {
    throw new AiFunctionError('PROVIDER_AUTH_FAILED', `Missing API key secret: ${apiKeyEnv}`, 400)
  }

  const RETRYABLE_CODES: Set<AiErrorCode> = new Set(['MODEL_OUTPUT_INVALID', 'PROVIDER_UNAVAILABLE'])
  const MAX_ATTEMPTS = 2

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AiFunctionError('MODEL_TIMEOUT', 'The AI provider request timed out.', 504)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const text = sanitizeAiError(await response.text())
      const code = response.status === 401 || response.status === 403
        ? 'PROVIDER_AUTH_FAILED'
        : response.status === 429 || response.status >= 500
          ? 'PROVIDER_UNAVAILABLE'
          : 'UNKNOWN'
      const err = new AiFunctionError(code, `AI provider error ${response.status}: ${text}`, response.status)
      if (attempt < MAX_ATTEMPTS && RETRYABLE_CODES.has(code)) {
        console.warn(`[AI] Retryable error (attempt ${attempt}): ${code} — retrying in 1s`)
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      throw err
    }

    const data = await response.json()
    const answer = extractChatAnswer(data)
    if (!answer) {
      const snippet = JSON.stringify(data).slice(0, 300)
      const finishReason = data?.choices?.[0]?.finish_reason ?? 'unknown'
      console.error(`[AI] Empty answer from ${profile.provider}/${profile.model} (finish_reason=${finishReason}). Response: ${snippet}`)
      const message = finishReason === 'length'
        ? `AI provider returned an empty answer because output was truncated by max_tokens (finish_reason=length). 请增大模型的 max_tokens 或更换非思考型模型。`
        : `AI provider returned an empty answer (finish_reason=${finishReason}). Response: ${JSON.stringify(data).slice(0, 200)}`
      const err = new AiFunctionError('MODEL_OUTPUT_INVALID', message)
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[AI] Empty answer (attempt ${attempt}) — retrying in 1s`)
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      throw err
    }

    return {
      answer: String(answer),
      usedModel: String(data.model ?? profile.model),
      provider: profile.provider,
      profileId: profile.id,
      source: profile.source ?? 'server',
    }
  }

  throw new AiFunctionError('MODEL_OUTPUT_INVALID', 'AI provider failed after retries.', 502)
}

export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
