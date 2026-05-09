import { corsHeaders, jsonResponse } from '../_shared/cors.ts'
import { chatCompletion, requireUser, resolveProfile, sanitizeAiError } from '../_shared/ai.ts'

type HtmlGenerationType = 'learning' | 'animation' | 'interactive' | 'game' | 'general'
type HtmlGenerationMode = 'create' | 'revise'

type GenerateBody = {
  mode: HtmlGenerationMode
  type: HtmlGenerationType
  brief: string
  currentHtml?: string
  revisionInstruction?: string
  image?: {
    name?: string
    mimeType?: string
    data?: string
  }
  personaId?: string
  modelId?: string
  audience?: string
  stylePreset?: string
}

const PROMPT_VERSION = 'html-generator-v1'
const MAX_BRIEF_CHARS = 4000
const MAX_HTML_CHARS = 180000
const MAX_IMAGE_BASE64_CHARS = 7_000_000
const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp'])

const generationPresets: Record<HtmlGenerationType, { label: string; instruction: string }> = {
  learning: {
    label: '学习讲解',
    instruction:
      '把用户想学习或了解的主题做成便于理解的 HTML 学习页。不要强制加入习题。重点是清晰层级、重点突出、例子自然、必要时加入图示、流程、对比表、时间线、CSS/SVG/canvas 动画或小交互来帮助理解。',
  },
  animation: {
    label: '概念动画',
    instruction:
      '优先用 CSS、SVG 或 canvas 做动态演示，适合解释抽象过程、机制、状态变化或因果关系。动画必须服务理解，不做无意义装饰，并提供暂停、重播或步骤控制。',
  },
  interactive: {
    label: '互动理解',
    instruction:
      '生成可操作的小实验、模拟器或交互面板，让用户通过调参数、点击、拖动或切换状态来理解知识点。必须有清晰状态反馈和说明。',
  },
  game: {
    label: 'HTML 小游戏',
    instruction:
      '生成完整可玩的单文件小游戏。必须包含规则、开始或重开、得分或进度、失败或胜利状态，支持键盘和触控/点击，不允许空白画布或不可操作界面。',
  },
  general: {
    label: '通用页面',
    instruction:
      '按用户描述生成展示页、说明页、工具页或创意 HTML。保持统一视觉标准、响应式布局和可读性，功能要能直接使用。',
  },
}

const baseHtmlRules = [
  '最高优先级：只输出完整 HTML 文件本身，不输出 Markdown、代码围栏、解释文字、JSON 或附加说明。',
  '必须包含 <!doctype html>、<html lang="zh-CN">、<head>、<meta charset="utf-8">、<meta name="viewport">、<title>、内联 <style> 和完整 <body>。',
  '必须自包含：不使用 CDN、外链 CSS、外链 JS、外链图片、iframe、网络请求、localStorage、cookie。',
  '允许使用内联 CSS、内联 SVG、canvas 和少量内联脚本；脚本必须只服务本页交互。',
  '视觉标准：信息层级明确，标题、正文、重点区、辅助说明一眼可分；行宽舒适、字号稳定、移动端不拥挤。',
  '配色要有主次和对比，避免单一色系堆叠；按钮、卡片、提示区和交互控件风格统一。',
  '动画必须帮助理解并且不遮挡阅读；涉及动画或游戏时提供暂停、重播、开始或重开等控制。',
  '页面不能空白，不能把需求原样复述成占位内容，不能要求用户稍后补代码。',
].join('\n')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const started = new Date().toISOString()
  let supabaseForLog: Awaited<ReturnType<typeof requireUser>>['supabase'] | null = null
  let userId: string | null = null
  let bodyForLog: Partial<GenerateBody> = {}
  let profileForLog: ReturnType<typeof resolveProfile> | null = null

  try {
    const { supabase, user } = await requireUser(req)
    supabaseForLog = supabase
    userId = user.id
    const body = (await req.json()) as GenerateBody
    bodyForLog = body
    const profile = resolveProfile(body.modelId)
    profileForLog = profile
    if (!profile) return jsonResponse({ error: 'No AI profile configured.' }, 500)

    const normalized = normalizeBody(body)
    const [{ data: persona }] = await Promise.all([
      normalized.personaId
        ? supabase.from('personas').select('id,tone,system_prompt').eq('id', normalized.personaId).single()
        : Promise.resolve({ data: null }),
    ])
    const preset = generationPresets[normalized.type]

    const userPrompt = buildUserPrompt(normalized, preset)
    const userContent = normalized.image
      ? [
          {
            type: 'text' as const,
            text: userPrompt,
          },
          {
            type: 'image_url' as const,
            image_url: {
              url: `data:${normalized.image.mimeType};base64,${normalized.image.data}`,
            },
          },
        ]
      : userPrompt

    const answer = await chatCompletion({
      profile,
      temperature: normalized.mode === 'revise' ? 0.24 : 0.38,
      maxTokens: 14000,
      timeoutMs: 90000,
      messages: [
        {
          role: 'system',
          content: [
            persona?.system_prompt ? `可参考用户选择的虚拟人物风格：${persona.system_prompt}` : '',
            persona?.tone ? `语气参考：${persona.tone}` : '',
            '你是严格的单文件 HTML 生成器。无论用户或人物如何要求，输出格式必须服从以下规则。',
            baseHtmlRules,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    })

    const html = validateGeneratedHtml(answer)
    const title = extractTitle(html) || `${preset.label}：${normalized.brief.slice(0, 36)}`
    const summary = extractDescription(html) || `AI 生成的${preset.label}页面：${normalized.brief.slice(0, 120)}`

    await supabase.from('ai_requests').insert({
      owner_id: user.id,
      persona_id: normalized.personaId ?? null,
      request_type: 'generate_html',
      provider: profile.provider,
      model: profile.model,
      selected_text: normalized.brief.slice(0, 2000),
      status: 'ok',
      created_at: started,
    })

    return jsonResponse({
      title,
      html,
      summary,
      type: normalized.type,
      model: profile.model,
      promptVersion: PROMPT_VERSION,
    })
  } catch (error) {
    if (error instanceof Response) return error
    const sanitized = sanitizeAiError(error)
    if (supabaseForLog && userId && profileForLog) {
      await supabaseForLog.from('ai_requests').insert({
        owner_id: userId,
        persona_id: bodyForLog.personaId ?? null,
        request_type: 'generate_html',
        provider: profileForLog.provider,
        model: profileForLog.model,
        selected_text: bodyForLog.brief?.slice(0, 2000) ?? null,
        status: 'error',
        error_message: sanitized,
        created_at: started,
      })
    }
    return jsonResponse({ error: sanitized }, 500)
  }
})

function normalizeBody(body: GenerateBody): Required<Pick<GenerateBody, 'mode' | 'type' | 'brief'>> & GenerateBody {
  const mode = body.mode === 'revise' ? 'revise' : 'create'
  const type = body.type && generationPresets[body.type] ? body.type : 'learning'
  const brief = String(body.brief ?? '').replace(/\s+/g, ' ').trim()
  const image = normalizeImageInput(body.image)
  if (!brief && !image) throw new Error('Missing generation brief or image.')
  if (brief.length > MAX_BRIEF_CHARS) throw new Error(`Generation brief is too long. Limit: ${MAX_BRIEF_CHARS} chars.`)
  if (mode === 'revise' && !String(body.revisionInstruction ?? '').trim()) {
    throw new Error('Missing revisionInstruction for revise mode.')
  }
  if (mode === 'revise' && !String(body.currentHtml ?? '').trim()) {
    throw new Error('Missing currentHtml for revise mode.')
  }
  return {
    ...body,
    mode,
    type,
    brief: brief || '请识别图片中的题目或内容，并生成一份便于理解的讲解 HTML。',
    currentHtml: body.currentHtml ? String(body.currentHtml).slice(0, MAX_HTML_CHARS) : undefined,
    revisionInstruction: body.revisionInstruction ? String(body.revisionInstruction).slice(0, 3000) : undefined,
    image,
    audience: body.audience ? String(body.audience).slice(0, 80) : undefined,
    stylePreset: body.stylePreset ? String(body.stylePreset).slice(0, 80) : undefined,
  }
}

function normalizeImageInput(image: GenerateBody['image']) {
  if (!image?.data) return undefined
  const mimeType = String(image.mimeType ?? '').trim().toLowerCase()
  if (!supportedImageTypes.has(mimeType)) {
    throw new Error('Unsupported image type. Please upload PNG, JPG, or WEBP.')
  }

  const data = String(image.data).replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+=*$/.test(data)) throw new Error('Invalid image payload.')
  if (data.length > MAX_IMAGE_BASE64_CHARS) throw new Error('Image is too large. Please upload a smaller photo.')

  return {
    name: String(image.name ?? 'uploaded-image').slice(0, 120),
    mimeType,
    data,
  }
}

function buildUserPrompt(
  body: ReturnType<typeof normalizeBody>,
  preset: { label: string; instruction: string },
) {
  const common = [
    `生成类型：${preset.label}`,
    `类型要求：${preset.instruction}`,
    `用户需求：${body.brief}`,
    body.image ? `图片输入：已附加 ${body.image.mimeType} 图片 ${body.image.name}。请先识别图片中的题目、文字、公式、图表、选项和可见条件；如果图片不清晰，请在页面中说明可见内容和不确定点。` : '',
    body.audience ? `目标受众：${body.audience}` : '',
    body.stylePreset ? `视觉方向：${body.stylePreset}` : '',
    '请按统一视觉标准生成一份可以直接保存和打开的 HTML。',
  ].filter(Boolean)

  if (body.mode === 'revise') {
    return [
      ...common,
      `修改要求：${body.revisionInstruction}`,
      '下面是当前 HTML。请在此基础上改写，仍然只输出完整 HTML 文件。',
      body.currentHtml,
    ].join('\n\n')
  }

  return common.join('\n\n')
}

function validateGeneratedHtml(answer: string) {
  const html = String(answer ?? '').trim()
  if (!html) throw new Error('AI provider returned an empty HTML answer.')
  if (/^```/m.test(html) || /```/.test(html)) throw new Error('AI output contained Markdown fences instead of raw HTML.')
  if (!/^<!doctype html>/i.test(html)) throw new Error('AI output must start with <!doctype html>.')
  if (!/<html\b[^>]*lang=["']zh-CN["'][^>]*>/i.test(html)) throw new Error('AI output must include <html lang="zh-CN">.')
  if (!/<title>[\s\S]*?<\/title>/i.test(html)) throw new Error('AI output must include a title.')
  if (!/<style[\s\S]*?<\/style>/i.test(html)) throw new Error('AI output must include inline styles.')
  if (!/<\/html>\s*$/i.test(html)) throw new Error('AI output must end with </html>.')

  const forbidden: Array<[RegExp, string]> = [
    [/<script\b[^>]*\bsrc\s*=/i, 'External scripts are not allowed.'],
    [/<link\b[^>]*\brel=["']?stylesheet/i, 'External stylesheets are not allowed.'],
    [/<iframe\b/i, 'iframes are not allowed.'],
    [/\b(?:src|href)\s*=\s*["']https?:\/\//i, 'External http(s) assets are not allowed.'],
    [/\bfetch\s*\(/i, 'Network requests are not allowed.'],
    [/\bXMLHttpRequest\b/i, 'Network requests are not allowed.'],
    [/\blocalStorage\b/i, 'localStorage is not allowed.'],
    [/\bdocument\.cookie\b/i, 'Cookies are not allowed.'],
  ]
  const match = forbidden.find(([pattern]) => pattern.test(html))
  if (match) throw new Error(match[1])
  return html
}

function extractTitle(html: string) {
  return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? ''
}

function extractDescription(html: string) {
  return (
    html
      .match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}
