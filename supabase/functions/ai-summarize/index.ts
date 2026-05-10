import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { chatCompletion, requireUser, resolveProfile, resolveProfileForFeature, sanitizeAiError, stripHtml } from '../_shared/ai.ts'

type SummaryBody = {
  documentId: string
  personaId?: string
  modelId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = new Date().toISOString()
  let supabaseForLog: Awaited<ReturnType<typeof requireUser>>['supabase'] | null = null
  let userId: string | null = null
  let bodyForLog: Partial<SummaryBody> = {}
  let profileForLog: Awaited<ReturnType<typeof resolveProfile>> | null = null
  try {
    const { supabase, user } = await requireUser(req)
    supabaseForLog = supabase
    userId = user.id
    const body = (await req.json()) as SummaryBody
    bodyForLog = body
    const profile = await resolveProfileForFeature(supabase, user.id, 'summarize', body.modelId)
    profileForLog = profile
    if (!profile) return jsonResponse({ error: 'No AI profile configured.' }, 500)
    if (!body.documentId) return jsonResponse({ error: 'Missing documentId.' }, 400)

    const [{ data: document, error: documentError }, { data: persona }] = await Promise.all([
      supabase
        .from('documents')
        .select('id,title,storage_path')
        .eq('id', body.documentId)
        .single(),
      body.personaId ? supabase.from('personas').select('id,tone,system_prompt').eq('id', body.personaId).single() : Promise.resolve({ data: null }),
    ])
    if (documentError) throw documentError

    const { data: file, error: fileError } = await supabase.storage.from('html-docs').download(document.storage_path)
    if (fileError) throw fileError

    const text = stripHtml(await file.text()).slice(0, 12000)
    const answer = await chatCompletion({
      profile,
      messages: [
        {
          role: 'system',
          content: [
            persona?.system_prompt ?? '你是一个中文阅读助手。请输出 120 字以内摘要，并附上 3 到 6 个关键词。',
            `语气要求：${persona?.tone ?? '清晰、准确、简洁'}`,
          ].join('\n'),
        },
        {
          role: 'user',
          content: `文档标题：${document.title}\n正文：${text}`,
        },
      ],
    })

    await Promise.all([
      supabase.from('documents').update({ summary: answer }).eq('id', body.documentId),
      supabase.from('ai_requests').insert({
        owner_id: user.id,
        document_id: body.documentId,
        persona_id: body.personaId ?? null,
        request_type: 'summarize',
        provider: profile.provider,
        model: profile.model,
        status: 'ok',
      }),
    ])

    return jsonResponse({ answer, model: profile.model })
  } catch (error) {
    if (error instanceof Response) return error
    const sanitized = sanitizeAiError(error)
    if (supabaseForLog && userId && profileForLog) {
      await supabaseForLog.from('ai_requests').insert({
        owner_id: userId,
        document_id: bodyForLog.documentId ?? null,
        persona_id: bodyForLog.personaId ?? null,
        request_type: 'summarize',
        provider: profileForLog.provider,
        model: profileForLog.model,
        status: 'error',
        error_message: sanitized,
        created_at: started,
      })
    }
    return jsonResponse({ error: sanitized }, 500)
  }
})
