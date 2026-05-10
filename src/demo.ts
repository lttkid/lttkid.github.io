import type { AiProfile, Category, DocumentRecord, Persona, ReadingSession } from './types'

const now = new Date('2026-05-08T13:30:00.000Z')
const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86400000).toISOString()

function countWords(text: string) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return chineseChars + latinWords
}

export const demoCategories: Category[] = [
  {
    id: 'cat-ai',
    owner_id: 'demo-user',
    name: 'AI 研究',
    color: '#5B7CFF',
    sort_order: 1,
    created_at: iso(12),
  },
  {
    id: 'cat-design',
    owner_id: 'demo-user',
    name: '界面灵感',
    color: '#35C9D0',
    sort_order: 2,
    created_at: iso(10),
  },
  {
    id: 'cat-work',
    owner_id: 'demo-user',
    name: '工作资料',
    color: '#FFB45E',
    sort_order: 3,
    created_at: iso(8),
  },
]

export const demoDocuments: DocumentRecord[] = [
  {
    id: 'doc-agent',
    owner_id: 'demo-user',
    category_id: 'cat-ai',
    title: 'Agent 工作流设计备忘',
    storage_path: 'demo-user/ai/agent-workflow.html',
    file_hash: 'demo-agent',
    source_modified_at: iso(1),
    imported_at: iso(1),
    updated_at: iso(1),
    archived: false,
    favorite: true,
    summary: '梳理多步骤 AI 任务中的角色、上下文、工具调用和安全边界。',
    content_text:
      'Agent 工作流设计备忘 一个可靠的 Agent 系统通常需要把目标拆成可观察的阶段：理解意图、检索上下文、制定行动、执行工具、验证结果。上下文边界 上下文应该以任务为中心，不要把所有历史都塞进模型。更好的做法是把稳定事实、当前约束和待决问题分层组织。工具调用的关键不是数量，而是每次调用都能减少不确定性。执行型工具要有权限边界，读写路径要清晰。最后一步应该回到用户目标：结果是否可运行、是否覆盖风险、是否留下了清楚的下一步。',
    word_count: countWords(
      'Agent 工作流设计备忘 一个可靠的 Agent 系统通常需要把目标拆成可观察的阶段：理解意图、检索上下文、制定行动、执行工具、验证结果。上下文边界 上下文应该以任务为中心，不要把所有历史都塞进模型。更好的做法是把稳定事实、当前约束和待决问题分层组织。工具调用的关键不是数量，而是每次调用都能减少不确定性。执行型工具要有权限边界，读写路径要清晰。最后一步应该回到用户目标：结果是否可运行、是否覆盖风险、是否留下了清楚的下一步。',
    ),
    indexed_at: iso(1),
    reading_estimate_minutes: 7,
    last_read_at: iso(0),
    last_scroll: 0.34,
    category: demoCategories[0],
    tags: [],
  },
  {
    id: 'doc-ios',
    owner_id: 'demo-user',
    category_id: 'cat-design',
    title: 'iOS 风格毛玻璃界面参考',
    storage_path: 'demo-user/design/ios-glass.html',
    file_hash: 'demo-ios',
    source_modified_at: iso(4),
    imported_at: iso(4),
    updated_at: iso(3),
    archived: false,
    favorite: false,
    summary: '记录高级感界面的层次、留白、动效和控件密度。',
    content_text:
      'iOS 风格毛玻璃界面参考 高级感来自克制的层级：清晰文本、柔和阴影、半透明材质和稳定的交互动效。主界面保持密度，不做过度营销化的英雄区。控件使用真实功能图标和轻微弹性反馈。卡片圆角控制在工具感范围内，避免层层嵌套。',
    word_count: countWords(
      'iOS 风格毛玻璃界面参考 高级感来自克制的层级：清晰文本、柔和阴影、半透明材质和稳定的交互动效。主界面保持密度，不做过度营销化的英雄区。控件使用真实功能图标和轻微弹性反馈。卡片圆角控制在工具感范围内，避免层层嵌套。',
    ),
    indexed_at: iso(4),
    reading_estimate_minutes: 5,
    last_read_at: iso(2),
    last_scroll: 0.72,
    category: demoCategories[1],
    tags: [],
  },
  {
    id: 'doc-project',
    owner_id: 'demo-user',
    category_id: 'cat-work',
    title: '项目复盘 HTML 报告',
    storage_path: 'demo-user/work/project-review.html',
    file_hash: 'demo-project',
    source_modified_at: iso(9),
    imported_at: iso(9),
    updated_at: iso(9),
    archived: false,
    favorite: false,
    summary: '按时间线记录目标、风险、交付和后续动作。',
    content_text:
      '项目复盘 HTML 报告 本报告记录项目目标、关键风险、交付质量和后续动作。阶段 结果 后续动作 需求 范围明确 补充验收标准 实现 核心路径完成 继续补测试 发布 小流量验证 观察错误率。',
    word_count: countWords(
      '项目复盘 HTML 报告 本报告记录项目目标、关键风险、交付质量和后续动作。阶段 结果 后续动作 需求 范围明确 补充验收标准 实现 核心路径完成 继续补测试 发布 小流量验证 观察错误率。',
    ),
    indexed_at: iso(9),
    reading_estimate_minutes: 11,
    last_read_at: null,
    last_scroll: 0,
    category: demoCategories[2],
    tags: [],
  },
]

export const demoPersonas: Persona[] = [
  {
    id: 'persona-mentor',
    owner_id: 'demo-user',
    name: '冷静导师',
    avatar_url: null,
    tone: '清晰、克制、像资深研究员',
    system_prompt: '用结构化中文解释概念，先给结论，再给必要背景。',
    default_model: 'default',
    visual_config: {
      version: 1,
      bodyShape: 'bean',
      palette: {
        body: '#F8FAFC',
        accent: '#5B7CFF',
        eye: '#111827',
        cheek: '#F59E9E',
      },
      features: {
        ears: 'soft',
        antenna: false,
        tail: 'none',
        glasses: false,
      },
      expression: 'curious',
      motion: 'gentle',
      size: 'medium',
    },
    companion_enabled: true,
    created_at: iso(7),
  },
  {
    id: 'persona-editor',
    owner_id: 'demo-user',
    name: '编辑伙伴',
    avatar_url: null,
    tone: '敏锐、温和、注重表达',
    system_prompt: '帮助用户把复杂内容改写得更好读，指出表达和逻辑问题。',
    default_model: 'default',
    visual_config: {
      version: 1,
      bodyShape: 'capsule',
      palette: {
        body: '#ECFDF5',
        accent: '#35C9D0',
        eye: '#0F172A',
        cheek: '#FDBA74',
      },
      features: {
        ears: 'none',
        antenna: true,
        tail: 'curl',
        glasses: true,
      },
      expression: 'focused',
      motion: 'gentle',
      size: 'medium',
    },
    companion_enabled: true,
    created_at: iso(5),
  },
]

export const demoAiProfiles: AiProfile[] = [
  {
    id: 'siliconflow-qwen',
    label: 'SiliconFlow Qwen',
    provider: 'siliconflow',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    enabled: true,
    configured: true,
    baseUrlHost: 'api.siliconflow.cn',
  },
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    provider: 'openai-compatible',
    model: 'deepseek-chat',
    enabled: true,
    configured: true,
    baseUrlHost: 'api.deepseek.com',
  },
  {
    id: 'vision-demo',
    label: '视觉识题模型',
    provider: 'openai-compatible',
    model: 'vision-demo-model',
    enabled: true,
    configured: true,
    baseUrlHost: 'vision.demo.local',
  },
]

export const demoSessions: ReadingSession[] = [
  {
    id: 'session-1',
    owner_id: 'demo-user',
    document_id: 'doc-agent',
    started_at: iso(0),
    ended_at: iso(0),
    duration_seconds: 2260,
    last_scroll: 0.34,
  },
  {
    id: 'session-2',
    owner_id: 'demo-user',
    document_id: 'doc-ios',
    started_at: iso(2),
    ended_at: iso(2),
    duration_seconds: 1320,
    last_scroll: 0.72,
  },
  {
    id: 'session-3',
    owner_id: 'demo-user',
    document_id: 'doc-agent',
    started_at: iso(5),
    ended_at: iso(5),
    duration_seconds: 980,
    last_scroll: 0.18,
  },
]

export const demoHtmlByPath: Record<string, string> = {
  'demo-user/ai/agent-workflow.html': `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>Agent 工作流设计备忘</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif; margin: 0; padding: 56px; color: #111827; background: linear-gradient(180deg, #f8fafc, #ffffff); line-height: 1.8; }
          main { max-width: 820px; margin: 0 auto; }
          h1 { font-size: 40px; letter-spacing: 0; line-height: 1.1; }
          section { border-top: 1px solid #e5e7eb; padding-top: 28px; margin-top: 28px; }
          code { background: #eef2ff; padding: 2px 6px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <main>
          <h1>Agent 工作流设计备忘</h1>
          <p>一个可靠的 Agent 系统通常需要把目标拆成可观察的阶段：理解意图、检索上下文、制定行动、执行工具、验证结果。</p>
          <section>
            <h2>上下文边界</h2>
            <p>上下文应该以任务为中心，不要把所有历史都塞进模型。更好的做法是把稳定事实、当前约束和待决问题分层组织。</p>
          </section>
          <section>
            <h2>工具调用</h2>
            <p>工具调用的关键不是数量，而是每次调用都能减少不确定性。执行型工具要有权限边界，读写路径要清晰。</p>
          </section>
          <section>
            <h2>验证</h2>
            <p>最后一步应该回到用户目标：结果是否可运行、是否覆盖风险、是否留下了清楚的下一步。</p>
          </section>
        </main>
      </body>
    </html>`,
  'demo-user/design/ios-glass.html': `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>iOS 风格毛玻璃界面参考</title>
        <style>
          body { min-height: 100vh; margin: 0; padding: 48px; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif; background: radial-gradient(circle at 20% 10%, #dbeafe, transparent 28%), radial-gradient(circle at 80% 20%, #ccfbf1, transparent 24%), #f8fafc; color: #172033; }
          article { max-width: 760px; margin: auto; background: rgba(255,255,255,.72); border: 1px solid rgba(255,255,255,.7); border-radius: 28px; padding: 36px; box-shadow: 0 30px 90px rgba(15,23,42,.14); backdrop-filter: blur(28px); }
          h1 { margin-top: 0; font-size: 36px; }
          li { margin: 12px 0; }
        </style>
      </head>
      <body>
        <article>
          <h1>iOS 风格毛玻璃界面参考</h1>
          <p>高级感来自克制的层级：清晰文本、柔和阴影、半透明材质和稳定的交互动效。</p>
          <ul>
            <li>主界面保持密度，不做过度营销化的英雄区。</li>
            <li>控件使用真实功能图标和轻微弹性反馈。</li>
            <li>卡片圆角控制在工具感范围内，避免层层嵌套。</li>
          </ul>
        </article>
      </body>
    </html>`,
  'demo-user/work/project-review.html': `<!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>项目复盘 HTML 报告</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; margin: 0; padding: 48px; color: #1f2937; background: #f9fafb; }
          main { max-width: 900px; margin: auto; }
          table { border-collapse: collapse; width: 100%; background: white; border-radius: 14px; overflow: hidden; }
          th, td { border-bottom: 1px solid #e5e7eb; padding: 14px 16px; text-align: left; }
          th { background: #f3f4f6; }
        </style>
      </head>
      <body>
        <main>
          <h1>项目复盘 HTML 报告</h1>
          <p>本报告记录项目目标、关键风险、交付质量和后续动作。</p>
          <table>
            <thead><tr><th>阶段</th><th>结果</th><th>后续动作</th></tr></thead>
            <tbody>
              <tr><td>需求</td><td>范围明确</td><td>补充验收标准</td></tr>
              <tr><td>实现</td><td>核心路径完成</td><td>继续补测试</td></tr>
              <tr><td>发布</td><td>小流量验证</td><td>观察错误率</td></tr>
            </tbody>
          </table>
        </main>
      </body>
    </html>`,
}
