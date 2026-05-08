import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getProfiles, requireUser, sanitizeAiError, toPublicProfile } from '../_shared/ai.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    await requireUser(req)
    const profiles = getProfiles().map(toPublicProfile)
    return jsonResponse({
      profiles,
      meta: {
        profileCount: profiles.length,
        configuredCount: profiles.filter((profile) => profile.configured).length,
      },
    })
  } catch (error) {
    if (error instanceof Response) return error
    return jsonResponse({ error: sanitizeAiError(error) }, 500)
  }
})
