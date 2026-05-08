import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173/'
let serverProcess = null

async function isReachable(url) {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url) {
  const started = Date.now()
  while (Date.now() - started < 20000) {
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function ensureServer() {
  if (await isReachable(baseUrl)) return

  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4173'], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      VITE_DEMO_MODE: 'true',
    },
  })
  await waitForServer(baseUrl)
}

function assert(value, message) {
  if (!value) throw new Error(message)
}

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor()
  await page.getByRole('button', { name: '新建分类' }).click()
  await page.getByLabel('分类名称').fill('测试分类')
  await page.getByRole('button', { name: '创建' }).click()
  await page.getByRole('button', { name: '新建分类' }).waitFor()
  await page.getByRole('button', { name: '管理文档' }).first().click()
  await page.getByText('Storage: demo-user/ai/agent-workflow.html').waitFor()
  await page.locator('.document-manager').getByRole('button', { name: '归档' }).click()
  await page.locator('.document-manager').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '归档' }).click()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '归档' }).click()
  await page.getByRole('heading', { name: 'Agent 工作流设计备忘' }).waitFor()
  await page.getByRole('button', { name: '管理文档' }).first().click()
  await page.getByText('Storage: demo-user/ai/agent-workflow.html').waitFor()
  await page.locator('.document-manager .icon-button').click()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill('权限边界')
  await page.getByText('读写路径要清晰').waitFor()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill('Agent')
  await page.getByRole('button', { name: '阅读' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })

  const frame = page.frames().find((item) => item.url().startsWith('about:srcdoc'))
  assert(frame, 'Reader iframe did not create an about:srcdoc frame.')
  assert((await frame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader iframe rendered the wrong document.')

  await page.getByRole('button', { name: '打开功能面板' }).click()
  await page.evaluate(() => {
    window.postMessage({ type: 'html-reader-selection', text: '上下文应该以任务为中心，不要把所有历史都塞进模型。' }, '*')
  })
  await page.getByPlaceholder('给这段高亮补一条笔记').fill('这是测试笔记')
  await page.getByRole('button', { name: '高亮' }).click()
  await page.getByText('这是测试笔记').waitFor()
  await page.getByRole('button', { name: '总结' }).click()
  await page.getByText('梳理多步骤 AI 任务中的角色、上下文、工具调用和安全边界。').waitFor()

  const readerMetrics = await page.evaluate(() => {
    const panel = document.querySelector('.action-panel')?.getBoundingClientRect()
    const iframe = document.querySelector('iframe')?.getBoundingClientRect()
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      panelInsideViewport: Boolean(panel && panel.left >= 0 && panel.right <= window.innerWidth && panel.bottom <= window.innerHeight),
      iframeLargeEnough: Boolean(iframe && iframe.width > 280 && iframe.height > 400),
    }
  })
  assert(readerMetrics.noHorizontalOverflow, `${viewport.width}px viewport has horizontal overflow in reader.`)
  assert(readerMetrics.panelInsideViewport, `${viewport.width}px action panel is outside the viewport.`)
  assert(readerMetrics.iframeLargeEnough, `${viewport.width}px iframe is too small.`)

  await page.getByRole('button', { name: '笔记' }).click()
  await page.getByRole('heading', { name: '笔记中心' }).waitFor()
  await page.getByText('这是测试笔记').waitFor()
  await page.getByPlaceholder('搜索高亮、笔记、来源文档').fill('上下文')
  await page.getByRole('button', { name: 'Agent 工作流设计备忘' }).waitFor()
  await page.getByRole('button', { name: '编辑' }).click()
  await page.getByLabel('编辑笔记').fill('这是编辑后的测试笔记')
  await page.locator('.note-edit-box').getByRole('button', { name: '保存' }).click()
  await page.getByText('这是编辑后的测试笔记').waitFor()
  await page.getByRole('button', { name: 'Agent 工作流设计备忘' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '笔记' }).click()
  await page.getByRole('heading', { name: '笔记中心' }).waitFor()
  await page.getByPlaceholder('搜索高亮、笔记、来源文档').fill('编辑后的')
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByText('暂无笔记').waitFor()

  await page.getByRole('button', { name: '统计' }).click()
  await page.getByRole('heading', { name: '阅读统计' }).waitFor()
  await page.getByRole('button', { name: '人物' }).click()
  await page.getByRole('heading', { name: '虚拟人物' }).waitFor()
  await page.getByRole('button', { name: '部署' }).click()
  await page.getByRole('heading', { name: '部署中心' }).waitFor()
  await page.getByRole('main').getByText('Demo Mode').waitFor()
  await page.getByRole('heading', { name: 'AI 配置中心' }).waitFor()
  await page.getByRole('button', { name: '测试 AI 连接' }).click()
  await page.getByText('demo.local').waitFor()
  await page.getByText('可用').waitFor()

  assert(consoleErrors.length === 0, `Console errors found: ${consoleErrors.join('\n')}`)
  await page.close()
}

await ensureServer()

const browser = await chromium.launch({ headless: true })
try {
  await checkViewport(browser, { width: 1440, height: 900 })
  await checkViewport(browser, { width: 390, height: 844 })
  console.log('Smoke tests passed.')
} finally {
  await browser.close()
  if (serverProcess) {
    serverProcess.kill()
  }
}
