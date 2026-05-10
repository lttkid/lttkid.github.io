import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { getAvailableProfiles, requireUser, sanitizeAiError, toPublicProfile } from '../_shared/ai.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { supabase, user } = await requireUser(req)
    const profiles = await Promise.all((await getAvailableProfiles(supabase, user.id)).map(toPublicProfile))
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
