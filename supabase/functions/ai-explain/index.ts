import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { chatCompletion, requireUser, resolveProfile, resolveProfileForFeature, sanitizeAiError } from '../_shared/ai.ts'

type ExplainBody = {
  documentId: string
  selectedText: string
  personaId?: string
  modelId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = new Date().toISOString()
  let supabaseForLog: Awaited<ReturnType<typeof requireUser>>['supabase'] | null = null
  let userId: string | null = null
  let bodyForLog: Partial<ExplainBody> = {}
  let profileForLog: Awaited<ReturnType<typeof resolveProfile>> | null = null
  try {
    const { supabase, user } = await requireUser(req)
    supabaseForLog = supabase
    userId = user.id
    const body = (await req.json()) as ExplainBody
    bodyForLog = body
    const profile = await resolveProfileForFeature(supabase, user.id, 'explain', body.modelId)
    profileForLog = profile
    if (!profile) return jsonResponse({ error: 'No AI profile configured.' }, 500)
    if (!body.documentId || !body.selectedText?.trim()) return jsonResponse({ error: 'Missing documentId or selectedText.' }, 400)

    const [{ data: document, error: documentError }, { data: persona }] = await Promise.all([
      supabase.from('documents').select('id,title,summary').eq('id', body.documentId).single(),
      body.personaId ? supabase.from('personas').select('*').eq('id', body.personaId).single() : Promise.resolve({ data: null }),
    ])
    if (documentError) throw documentError

    const systemPrompt =
      persona?.system_prompt ??
      '你是一个帮助用户阅读 HTML 文档的中文助手。解释时先给结论，再给上下文，避免编造文档外事实。'
    const answer = await chatCompletion({
      profile,
      timeoutMs: 75000,
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\n语气要求：${persona?.tone ?? '清晰、准确、简洁'}`,
        },
        {
          role: 'user',
          content: [
            `文档标题：${document?.title ?? '未知文档'}`,
            `文档摘要：${document?.summary ?? '暂无摘要'}`,
            `选中文本：${body.selectedText.slice(0, 4000)}`,
            '请解释这段内容，并指出它在文档中的可能作用。',
          ].join('\n'),
        },
      ],
    })

    await supabase.from('ai_requests').insert({
      owner_id: user.id,
      document_id: body.documentId,
      persona_id: body.personaId ?? null,
      request_type: 'explain',
      provider: profile.provider,
      model: profile.model,
      selected_text: body.selectedText.slice(0, 2000),
      status: 'ok',
      created_at: started,
    })

    return jsonResponse({ answer, model: profile.model })
  } catch (error) {
    if (error instanceof Response) return error
    const sanitized = sanitizeAiError(error)
    if (supabaseForLog && userId && profileForLog) {
      await supabaseForLog.from('ai_requests').insert({
        owner_id: userId,
        document_id: bodyForLog.documentId ?? null,
        persona_id: bodyForLog.personaId ?? null,
        request_type: 'explain',
        provider: profileForLog.provider,
        model: profileForLog.model,
        selected_text: bodyForLog.selectedText?.slice(0, 2000) ?? null,
        status: 'error',
        error_message: sanitized,
        created_at: started,
      })
    }
    return jsonResponse({ error: sanitized }, 500)
  }
})
