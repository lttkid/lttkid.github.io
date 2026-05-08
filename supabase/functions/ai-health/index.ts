import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  chatCompletion,
  getProfiles,
  requireUser,
  resolveRuntimeProfile,
  sanitizeAiError,
  toPublicProfile,
} from '../_shared/ai.ts'

type HealthProfile = {
  id: string
  label: string
  provider: string
  model: string
  enabled: boolean
  configured: boolean
  baseUrlHost: string
  status: 'pass' | 'fail'
  latencyMs: number | null
  checkedAt: string
  error: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const generatedAt = new Date().toISOString()
  try {
    const { supabase, user } = await requireUser(req)
    const profiles = getProfiles()

    const results = await Promise.all(
      profiles.map(async (profile): Promise<HealthProfile> => {
        const publicProfile = toPublicProfile(profile)
        const runtime = resolveRuntimeProfile(profile)
        const started = Date.now()

        if (!runtime.configured) {
          const error = runtime.baseUrlHost === 'invalid-url'
            ? 'AI base URL is invalid.'
            : `Missing API key secret: ${runtime.apiKeyEnv}`
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            provider: profile.provider,
            model: profile.model,
            status: 'error',
            error_message: error,
            created_at: generatedAt,
          })

          return {
            ...publicProfile,
            status: 'fail',
            latencyMs: null,
            checkedAt: generatedAt,
            error,
          }
        }

        try {
          await chatCompletion({
            profile,
            temperature: 0,
            maxTokens: 8,
            timeoutMs: 15000,
            messages: [
              {
                role: 'system',
                content: 'Return only OK.',
              },
              {
                role: 'user',
                content: 'Health check.',
              },
            ],
          })

          const latencyMs = Date.now() - started
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            provider: profile.provider,
            model: profile.model,
            status: 'ok',
            created_at: generatedAt,
          })

          return {
            ...publicProfile,
            status: 'pass',
            latencyMs,
            checkedAt: generatedAt,
            error: null,
          }
        } catch (error) {
          const sanitized = sanitizeAiError(error)
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            provider: profile.provider,
            model: profile.model,
            status: 'error',
            error_message: sanitized,
            created_at: generatedAt,
          })

          return {
            ...publicProfile,
            status: 'fail',
            latencyMs: Date.now() - started,
            checkedAt: generatedAt,
            error: sanitized,
          }
        }
      }),
    )

    return jsonResponse({ generatedAt, profiles: results })
  } catch (error) {
    if (error instanceof Response) return error
    return jsonResponse({ error: sanitizeAiError(error) }, 500)
  }
})
