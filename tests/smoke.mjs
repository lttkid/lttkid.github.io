import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

async function setFrameScroll(frame, progress) {
  await frame.locator('body').evaluate((body, target) => {
    const root = body.ownerDocument.scrollingElement || body.ownerDocument.documentElement
    const max = Math.max(1, root.scrollHeight - root.clientHeight)
    root.scrollTop = max * target
  }, progress)
}

async function getFrameScroll(frame) {
  return frame.locator('body').evaluate((body) => {
    const root = body.ownerDocument.scrollingElement || body.ownerDocument.documentElement
    const max = Math.max(1, root.scrollHeight - root.clientHeight)
    return root.scrollTop / max
  })
}

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor()
  await page.getByRole('button', { name: '上传 HTML' }).waitFor()

  const interactiveHtmlPath = path.join(os.tmpdir(), `html-vault-interactive-${viewport.width}.html`)
  const bodySearchToken = `upload-body-token-${viewport.width}`
  writeFileSync(
    interactiveHtmlPath,
    `<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <title>Interactive Upload Smoke ${viewport.width}</title>
          <style>
            body { font-family: sans-serif; line-height: 1.6; }
            main { max-width: 720px; margin: 0 auto; }
            .panel-body[hidden], .tab-panel[hidden] { display: none; }
            .tab-list { display: flex; gap: 12px; margin: 16px 0; }
            .spacer { height: 1200px; padding-top: 24px; }
          </style>
          <script>
            window.addEventListener('load', () => {
              const panelToggle = document.getElementById('panel-toggle');
              const panelBody = document.getElementById('panel-body');
              panelToggle.addEventListener('click', () => {
                const expanded = panelToggle.getAttribute('aria-expanded') === 'true';
                panelToggle.setAttribute('aria-expanded', String(!expanded));
                panelBody.hidden = expanded;
              });
              for (const button of document.querySelectorAll('[data-tab]')) {
                button.addEventListener('click', () => {
                  const target = button.dataset.tab;
                  for (const item of document.querySelectorAll('[data-tab]')) {
                    item.setAttribute('aria-selected', String(item === button));
                  }
                  for (const panel of document.querySelectorAll('[data-panel]')) {
                    panel.hidden = panel.dataset.panel !== target;
                  }
                  document.getElementById('tab-state').textContent = target;
                });
              }
            });
          </script>
        </head>
        <body>
          <main>
            <h1>Interactive Upload Smoke ${viewport.width}</h1>
            <p>这个页面用来验证阅读模式和交互模式切换时的稳定性。</p>
            <p>${bodySearchToken}</p>
            <button id="toggle" onclick="document.getElementById('state').textContent='clicked'">切换状态</button>
            <p id="state">idle</p>
            <section>
              <button id="panel-toggle" type="button" aria-expanded="false">切换折叠面板</button>
              <div id="panel-body" class="panel-body" hidden>折叠面板内容已展开。</div>
            </section>
            <section>
              <div class="tab-list" role="tablist" aria-label="示例标签页">
                <button id="tab-overview" type="button" data-tab="overview" aria-selected="true">概览</button>
                <button id="tab-details" type="button" data-tab="details" aria-selected="false">细节</button>
              </div>
              <p id="tab-state">overview</p>
              <div data-panel="overview" class="tab-panel">概览面板</div>
              <div data-panel="details" class="tab-panel" hidden>细节面板</div>
            </section>
            <div class="spacer">
              <p>这里放一段较长内容，用来验证切换模式后阅读位置不会明显回退。</p>
              <p>滚动到页面下半段后再切模式，应该还能停留在接近原来的位置。</p>
              <p id="tail-marker">尾部标记：如果你能看到我，说明页面高度足够做滚动稳定性测试。</p>
            </div>
            <script>document.body.dataset.script = 'ran'</script>
          </main>
        </body>
      </html>`,
  )
  await page.getByRole('button', { name: '上传 HTML' }).click()
  await page.getByLabel('HTML 文件').setInputFiles(interactiveHtmlPath)
  await page.getByRole('button', { name: '上传 1 个文件' }).click()
  await page.getByText('已写入资料库，正文搜索已可用。').waitFor()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill(bodySearchToken)
  await page.getByRole('heading', { name: `Interactive Upload Smoke ${viewport.width}` }).waitFor()
  await page.getByLabel('HTML 文件').setInputFiles(interactiveHtmlPath)
  await page.getByRole('button', { name: '上传 1 个文件' }).click()
  await page.getByText('重复文件，已保留现有文档。').waitFor()
  await page.getByRole('button', { name: '阅读' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '阅读模式' }).waitFor()
  await page.getByRole('button', { name: '交互模式' }).waitFor()

  const uploadedFrame = page.frameLocator('iframe')
  await uploadedFrame.locator('h1').waitFor()
  await uploadedFrame.locator('#toggle').click()
  assert((await uploadedFrame.locator('#state').innerText()) === 'idle', 'Read mode unexpectedly allowed inline click handlers.')
  await uploadedFrame.locator('#panel-toggle').click()
  assert(await uploadedFrame.locator('#panel-body').evaluate((node) => node.hasAttribute('hidden')), 'Read mode unexpectedly expanded the collapsible panel.')
  await uploadedFrame.locator('#tab-details').click()
  assert((await uploadedFrame.locator('#tab-state').innerText()) === 'overview', 'Read mode unexpectedly switched tabs.')
  await setFrameScroll(uploadedFrame, 0.62)
  await page.waitForTimeout(500)
  const uploadedScrollBeforeInteractive = await getFrameScroll(uploadedFrame)
  await page.getByRole('button', { name: '交互模式' }).click()
  await uploadedFrame.locator('h1').waitFor()
  await page.waitForTimeout(600)
  assert((await uploadedFrame.locator('h1').innerText()) === `Interactive Upload Smoke ${viewport.width}`, 'Reader lost the uploaded document after switching to interactive mode.')
  const uploadedScrollInInteractiveMode = await getFrameScroll(uploadedFrame)
  assert(
    Math.abs(uploadedScrollInInteractiveMode - uploadedScrollBeforeInteractive) <= 0.12,
    `Reader scroll position regressed too much after switching to interactive mode: ${uploadedScrollBeforeInteractive} -> ${uploadedScrollInInteractiveMode}.`,
  )
  await uploadedFrame.locator('#toggle').click()
  assert((await uploadedFrame.locator('#state').innerText()) === 'clicked', 'Interactive mode did not allow document click handlers.')
  await uploadedFrame.locator('#panel-toggle').click()
  assert(!(await uploadedFrame.locator('#panel-body').evaluate((node) => node.hasAttribute('hidden'))), 'Interactive mode did not expand the collapsible panel.')
  await uploadedFrame.locator('#tab-details').click()
  assert((await uploadedFrame.locator('#tab-state').innerText()) === 'details', 'Interactive mode did not switch tabs.')
  await setFrameScroll(uploadedFrame, 0.62)
  await page.waitForTimeout(500)
  const uploadedScrollBeforeReadMode = await getFrameScroll(uploadedFrame)
  await page.getByRole('button', { name: '阅读模式' }).click()
  await uploadedFrame.locator('h1').waitFor()
  await page.waitForTimeout(600)
  assert((await uploadedFrame.locator('h1').innerText()) === `Interactive Upload Smoke ${viewport.width}`, 'Reader lost the uploaded document after switching back to read mode.')
  const uploadedScrollBackInReadMode = await getFrameScroll(uploadedFrame)
  assert(
    Math.abs(uploadedScrollBackInReadMode - uploadedScrollBeforeReadMode) <= 0.12,
    `Reader scroll position regressed too much after switching back to read mode: ${uploadedScrollBeforeReadMode} -> ${uploadedScrollBackInReadMode}.`,
  )
  await uploadedFrame.locator('#toggle').click()
  assert((await uploadedFrame.locator('#state').innerText()) === 'idle', 'Read mode unexpectedly kept interactive button behavior after switching back.')
  await uploadedFrame.locator('#panel-toggle').click()
  assert(await uploadedFrame.locator('#panel-body').evaluate((node) => node.hasAttribute('hidden')), 'Read mode unexpectedly kept collapsible panel behavior after switching back.')
  await uploadedFrame.locator('#tab-details').click()
  assert((await uploadedFrame.locator('#tab-state').innerText()) === 'overview', 'Read mode unexpectedly kept tab switching behavior after switching back.')

  await page.getByRole('button', { name: '资料库', exact: true }).click()
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill('Agent 工作流设计备忘')
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
  const agentFrame = page.frameLocator('iframe')
  await setFrameScroll(agentFrame, 0.58)
  await page.waitForTimeout(500)
  const agentScrollBeforeInteractive = await getFrameScroll(agentFrame)
  await page.getByRole('button', { name: '交互模式' }).click()
  await agentFrame.locator('h1').first().waitFor()
  await page.waitForTimeout(600)
  assert((await agentFrame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader lost the original document after switching to interactive mode.')
  await page.getByText('这是测试笔记').waitFor()
  const agentScrollInInteractiveMode = await getFrameScroll(agentFrame)
  assert(
    Math.abs(agentScrollInInteractiveMode - agentScrollBeforeInteractive) <= 0.12,
    `Reader scroll position regressed on the original document after switching to interactive mode: ${agentScrollBeforeInteractive} -> ${agentScrollInInteractiveMode}.`,
  )
  await setFrameScroll(agentFrame, 0.58)
  await page.waitForTimeout(500)
  const agentScrollBeforeReadMode = await getFrameScroll(agentFrame)
  await page.getByRole('button', { name: '阅读模式' }).click()
  await agentFrame.locator('h1').first().waitFor()
  await page.waitForTimeout(600)
  assert((await agentFrame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader lost the original document after switching back to read mode.')
  await page.getByText('这是测试笔记').waitFor()
  const agentScrollBackInReadMode = await getFrameScroll(agentFrame)
  assert(
    Math.abs(agentScrollBackInReadMode - agentScrollBeforeReadMode) <= 0.12,
    `Reader scroll position regressed on the original document after switching back to read mode: ${agentScrollBeforeReadMode} -> ${agentScrollBackInReadMode}.`,
  )
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
  await page.getByRole('heading', { name: '系统体检' }).waitFor()
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
