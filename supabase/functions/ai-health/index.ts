import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import {
  chatCompletion,
  errorPayload,
  getAvailableProfiles,
  requireUser,
  resolveRuntimeProfile,
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
    const requestedProfileId = await readRequestedProfileId(req)
    const profiles = (await getAvailableProfiles(supabase, user.id)).filter((profile) => (
      requestedProfileId ? profile.id === requestedProfileId : true
    ))

    const results = await Promise.all(
      profiles.map(async (profile): Promise<HealthProfile> => {
        const publicProfile = await toPublicProfile(profile)
        const started = Date.now()
        let runtime: Awaited<ReturnType<typeof resolveRuntimeProfile>>

        try {
          runtime = await resolveRuntimeProfile(profile)
        } catch (error) {
          const payload = errorPayload(error)
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            feature_id: 'health_check',
            provider: profile.provider,
            model: profile.model,
            used_model: profile.model,
            profile_id: profile.id,
            provider_id: profile.userProviderId ?? profile.id,
            profile_source: profile.source ?? 'server',
            status: 'error',
            error_code: payload.code,
            error_message: payload.error,
            latency_ms: Date.now() - started,
            created_at: generatedAt,
          })

          return {
            ...publicProfile,
            status: 'fail',
            latencyMs: Date.now() - started,
            checkedAt: generatedAt,
            error: payload.error,
          }
        }

        if (!runtime.configured) {
          const error = runtime.baseUrlHost === 'invalid-url'
            ? 'AI base URL is invalid.'
            : `Missing API key secret: ${runtime.apiKeyEnv}`
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            feature_id: 'health_check',
            provider: profile.provider,
            model: profile.model,
            used_model: profile.model,
            profile_id: profile.id,
            provider_id: profile.userProviderId ?? profile.id,
            profile_source: profile.source ?? 'server',
            status: 'error',
            error_code: runtime.baseUrlHost === 'invalid-url' ? 'REQUEST_INVALID' : 'PROVIDER_AUTH_FAILED',
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
            feature_id: 'health_check',
            provider: profile.provider,
            model: profile.model,
            used_model: profile.model,
            profile_id: profile.id,
            provider_id: profile.userProviderId ?? profile.id,
            profile_source: profile.source ?? 'server',
            status: 'ok',
            latency_ms: latencyMs,
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
          const payload = errorPayload(error)
          const sanitized = payload.error
          await supabase.from('ai_requests').insert({
            owner_id: user.id,
            request_type: 'health_check',
            feature_id: 'health_check',
            provider: profile.provider,
            model: profile.model,
            used_model: profile.model,
            profile_id: profile.id,
            provider_id: profile.userProviderId ?? profile.id,
            profile_source: profile.source ?? 'server',
            status: 'error',
            error_code: payload.code,
            error_message: sanitized,
            latency_ms: Date.now() - started,
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
    return jsonResponse(errorPayload(error), 500)
  }
})

async function readRequestedProfileId(req: Request) {
  if (req.method !== 'POST') return ''
  try {
    const raw = await req.text()
    if (!raw.trim()) return ''
    const parsed = JSON.parse(raw) as { profileId?: string }
    return String(parsed.profileId ?? '').trim()
  } catch {
    return ''
  }
}
