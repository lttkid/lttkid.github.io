import { spawn, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:4173/'
let serverProcess = null

function stopServer() {
  if (!serverProcess?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(serverProcess.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    serverProcess.kill()
  }
  serverProcess = null
}

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

  const parsed = new URL(baseUrl)
  serverProcess = spawn('npm', ['run', 'dev', '--', '--host', parsed.hostname, '--port', parsed.port || '4173'], {
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

async function buildReaderTextLocator(frame, text) {
  return frame.locator('body').evaluate((body, selectedText) => {
    const fullText = body.textContent || ''
    const start = fullText.indexOf(selectedText)
    if (start < 0) return null
    return {
      strategy: 'text-position-v1',
      start,
      end: start + selectedText.length,
      exact: selectedText,
      prefix: fullText.slice(Math.max(0, start - 48), start),
      suffix: fullText.slice(start + selectedText.length, start + selectedText.length + 48),
    }
  }, text)
}

async function postReaderSelection(page, text, locator) {
  assert(locator, 'Could not build a demo annotation locator.')
  await page.evaluate(
    ({ selectedText, selectionLocator }) => {
      window.postMessage({ type: 'html-reader-selection', text: selectedText, locator: selectionLocator }, '*')
    },
    { selectedText: text, selectionLocator: locator },
  )
}

async function openReaderActionPanel(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('html-vault-reader-highlights')))
  await page.locator('.action-panel').waitFor()
}

async function clickDocumentManagerArchive(page) {
  const manager = page.locator('.document-manager')
  await manager.waitFor({ state: 'visible' })
  await page.waitForTimeout(200)
  await manager.getByRole('button', { name: '归档' }).click({ force: true })
}

async function checkViewport(browser, viewport) {
  const page = await browser.newPage({ viewport })
  const consoleErrors = []
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('Failed to load resource: net::ERR_CONNECTION_REFUSED')) return
    consoleErrors.push(text)
  })

  await waitForServer(baseUrl)
  await page.goto(baseUrl, { waitUntil: 'load' })
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor()
  await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('html-vault-demo-highlights:')) window.localStorage.removeItem(key)
    }
  })
  await page.getByRole('button', { name: '上传 HTML' }).waitFor()
  await page.locator('.sidebar .user-avatar.medium').waitFor()
  await page.locator('.companion-dock').waitFor()
  await page.locator('.companion-dock .companion-pet').waitFor()
  await page.locator('.companion-pet-button').click()
  await page.locator('.companion-panel').waitFor()
  await page.locator('.companion-panel').getByLabel('大小').selectOption('small')
  await page.locator('.companion-dock.dock-small').waitFor()
  await page.locator('.companion-panel').getByRole('button', { name: '开心' }).click()
  await page.locator('.companion-dock.dock-state-happy').waitFor()
  await page.locator('.companion-panel-head').getByRole('button', { name: '关闭宠物面板' }).click()

  const profileName = `头像用户 ${viewport.width}`
  await page.locator('.account-card').click()
  await page.getByRole('dialog', { name: '编辑用户头像' }).waitFor()
  await page.getByLabel('显示名').fill(profileName)
  await page.getByLabel('选择头像颜色 #35C9D0').click({ force: true })
  await page.getByRole('button', { name: '保存头像' }).click()
  await page.getByRole('dialog', { name: '编辑用户头像' }).waitFor({ state: 'hidden' })
  await page.locator('.account-card').getByText(profileName).waitFor()

  const accountMetrics = await page.evaluate(() => {
    const accountCard = document.querySelector('.account-card')?.getBoundingClientRect()
    const actions = document.querySelector('.sidebar-actions')?.getBoundingClientRect()
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      accountInsideViewport: Boolean(accountCard && accountCard.left >= 0 && accountCard.right <= window.innerWidth + 1),
      actionsInsideViewport: Boolean(actions && actions.left >= 0 && actions.right <= window.innerWidth + 1),
    }
  })
  assert(accountMetrics.noHorizontalOverflow, `${viewport.width}px viewport has horizontal overflow around the account avatar.`)
  assert(accountMetrics.accountInsideViewport, `${viewport.width}px account avatar card is outside the viewport.`)
  assert(accountMetrics.actionsInsideViewport, `${viewport.width}px account action buttons are outside the viewport.`)

  await page.keyboard.press('Tab')
  await page.getByRole('dialog', { name: 'TAB 指挥盘' }).waitFor()
  await page.locator('.tab-command-user').getByText(profileName).waitFor()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'TAB 指挥盘' }).waitFor({ state: 'hidden' })
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').focus()
  await page.keyboard.press('Tab')
  assert((await page.getByRole('dialog', { name: 'TAB 指挥盘' }).count()) === 0, 'Tab command dock opened while a form field had focus.')
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('heading', { name: 'HTML 文件管理' }).waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await page.getByRole('button', { name: '打开 TAB 指挥盘' }).click()
  await page.getByRole('dialog', { name: 'TAB 指挥盘' }).waitFor()
  await page.locator('.tab-command-pinned').getByRole('button', { name: /上传 HTML/ }).click()
  await page.getByText('从本机上传 HTML').waitFor()
  await page.getByRole('button', { name: '收起' }).click()

  const generatorLearningToken = `generator-learning-token-${viewport.width}-${runId}`
  const generatorGameToken = `generator-game-token-${viewport.width}-${runId}`
  await page.locator('.nav-list').getByRole('button', { name: 'AI 生成' }).click()
  await page.getByRole('heading', { name: 'AI HTML 生成器' }).waitFor()
  await page.getByLabel('想生成什么').fill(`用动图讲清楚浏览器发起 HTTP 请求的过程，关键词 ${generatorLearningToken}`)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByText('Demo 生成已完成，可以预览、修改或保存。').waitFor()
  let generatorFrame = page.frameLocator('.generator-preview iframe')
  await generatorFrame.locator('h1').waitFor()
  assert((await generatorFrame.locator('body').innerText()).includes(generatorLearningToken), 'Learning generator preview did not include the requested topic.')
  await page.getByLabel('修改要求').fill('把页面改成更强调视觉演示，并说明这是修改后的版本')
  await page.getByRole('button', { name: '应用修改' }).click()
  await page.getByText('修改已应用，请检查预览。').waitFor()
  generatorFrame = page.frameLocator('.generator-preview iframe')
  await generatorFrame.locator('.revision').waitFor()

  const generatorImagePath = path.join(os.tmpdir(), `html-vault-question-${viewport.width}-${runId}.png`)
  writeFileSync(
    generatorImagePath,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  )
  await page.getByRole('button', { name: '清空' }).click()
  await page.getByLabel('题目图片').setInputFiles(generatorImagePath)
  await page.getByText('图片已读取，可以直接生成讲解 HTML。').waitFor()
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByText('Demo 生成已完成，可以预览、修改或保存。').waitFor()
  generatorFrame = page.frameLocator('.generator-preview iframe')
  await generatorFrame.locator('.image-question-card').waitFor()
  assert((await generatorFrame.locator('.image-question-card').innerText()).includes('图片识题'), 'Image generation preview did not include the image-question section.')

  await page.getByRole('button', { name: /HTML 小游戏/ }).click()
  await page.getByLabel('想生成什么').fill(`做一个点击收集能量的小游戏，关键词 ${generatorGameToken}`)
  await page.getByRole('button', { name: '生成预览' }).click()
  await page.getByText('Demo 生成已完成，可以预览、修改或保存。').waitFor()
  generatorFrame = page.frameLocator('.generator-preview iframe')
  await generatorFrame.locator('#tap').waitFor()
  await generatorFrame.locator('#tap').click()
  assert((await generatorFrame.locator('#score').innerText()) === '1', 'Generated game preview did not respond to clicks.')
  await page.getByRole('button', { name: '保存到资料库' }).click()
  await page.getByText('已保存到资料库，正文搜索已可用。').waitFor()
  await page.getByRole('button', { name: '打开阅读' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '交互模式' }).click()
  const generatedReaderFrame = page.frameLocator('iframe')
  await generatedReaderFrame.locator('#tap').waitFor()
  await generatedReaderFrame.locator('#tap').click()
  assert((await generatedReaderFrame.locator('#score').innerText()) === '1', 'Saved generated game did not run in reader interactive mode.')
  await page.getByRole('button', { name: '资料库', exact: true }).click()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill(generatorGameToken)
  await page.locator('.document-card .source-badge', { hasText: 'AI 生成' }).waitFor()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill('')

  const interactiveTitle = `Interactive Upload Smoke ${viewport.width} ${runId}`
  const interactiveHtmlPath = path.join(os.tmpdir(), `html-vault-interactive-${viewport.width}-${runId}.html`)
  const bodySearchToken = `upload-body-token-${viewport.width}-${runId}`
  writeFileSync(
    interactiveHtmlPath,
    `<!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <title>${interactiveTitle}</title>
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
            <h1>${interactiveTitle}</h1>
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
  await page.getByRole('heading', { name: interactiveTitle }).waitFor()
  await page.getByLabel('HTML 文件').setInputFiles(interactiveHtmlPath)
  await page.getByRole('button', { name: '上传 1 个文件' }).click()
  await page.getByText('重复文件，已保留现有文档。').waitFor()
  await page.getByRole('button', { name: '阅读' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '阅读模式' }).waitFor()
  await page.getByRole('button', { name: '交互模式' }).waitFor()

  let uploadedFrame = page.frameLocator('iframe')
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
  uploadedFrame = page.frameLocator('iframe')
  await uploadedFrame.locator('h1').waitFor()
  await page.waitForTimeout(600)
  assert((await uploadedFrame.locator('h1').innerText()) === interactiveTitle, 'Reader lost the uploaded document after switching to interactive mode.')
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
  uploadedFrame = page.frameLocator('iframe')
  await uploadedFrame.locator('h1').waitFor()
  await page.waitForTimeout(600)
  assert((await uploadedFrame.locator('h1').innerText()) === interactiveTitle, 'Reader lost the uploaded document after switching back to read mode.')
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
  await clickDocumentManagerArchive(page)
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

  const agentFrame = page.frameLocator('iframe')
  await agentFrame.locator('h1').first().waitFor()
  assert((await agentFrame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader iframe rendered the wrong document.')

  await openReaderActionPanel(page)
  await page.locator('.annotation-tools').waitFor()

  const fontOnlyText = '上下文应该以任务为中心，不要把所有历史都塞进模型。'
  await postReaderSelection(page, fontOnlyText, await buildReaderTextLocator(agentFrame, fontOnlyText))
  await page.locator('.companion-dock.dock-state-selection').waitFor()
  await page.getByLabel('字体色红色').click({ force: true })
  await agentFrame.locator('.html-reader-annotation').filter({ hasText: fontOnlyText }).first().waitFor({ timeout: 8000 })
  const fontOnlyStyle = await agentFrame.locator('.html-reader-annotation').filter({ hasText: fontOnlyText }).first().evaluate((node) => {
    const style = window.getComputedStyle(node)
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      text: node.textContent,
    }
  })
  assert(fontOnlyStyle.text?.includes(fontOnlyText), 'Font-only style did not wrap the selected text.')
  assert(fontOnlyStyle.backgroundColor === 'rgba(0, 0, 0, 0)', `Font-only style unexpectedly added a background: ${fontOnlyStyle.backgroundColor}`)
  assert(fontOnlyStyle.color === 'rgb(220, 38, 38)', `Unexpected font-only text color: ${fontOnlyStyle.color}`)
  assert((await page.locator('.highlight-list article').count()) === 0, 'Style-only records should not appear in the reader note list.')
  const partialClearText = '任务为中心'
  await postReaderSelection(page, partialClearText, await buildReaderTextLocator(agentFrame, partialClearText))
  await page.getByRole('button', { name: '清除样式' }).click()
  await page.waitForTimeout(500)
  const partialClearState = await agentFrame.locator('body').evaluate((clearedText) => {
    const redTexts = Array.from(document.querySelectorAll('.html-reader-annotation'))
      .filter((node) => window.getComputedStyle(node).color === 'rgb(220, 38, 38)')
      .map((node) => node.textContent || '')
    return {
      clearedStillRed: redTexts.some((text) => text.includes(clearedText)),
      leftStillRed: redTexts.some((text) => text.includes('上下文应该以')),
      rightStillRed: redTexts.some((text) => text.includes('不要把所有历史')),
    }
  }, partialClearText)
  assert(!partialClearState.clearedStillRed, 'Partial clear left the selected text colored.')
  assert(partialClearState.leftStillRed && partialClearState.rightStillRed, 'Partial clear removed style outside the selected range.')

  const crossSelection = await agentFrame.locator('body').evaluate((body) => {
    const fullText = body.textContent || ''
    const startNeedle = '当前约束和待决问题分层组织。'
    const endNeedle = '每次调用都能减少不确定性。'
    const rawStart = fullText.indexOf(startNeedle)
    const rawEnd = fullText.indexOf(endNeedle)
    if (rawStart < 0 || rawEnd < 0) return null
    const raw = fullText.slice(rawStart, rawEnd + endNeedle.length)
    const leadingWhitespace = raw.length - raw.trimStart().length
    const exact = raw.trim()
    const start = rawStart + leadingWhitespace
    return {
      text: exact,
      locator: {
        strategy: 'text-position-v1',
        start,
        end: start + exact.length,
        exact,
        prefix: fullText.slice(Math.max(0, start - 48), start),
        suffix: fullText.slice(start + exact.length, start + exact.length + 48),
      },
    }
  })
  assert(crossSelection, 'Could not build a cross-paragraph annotation locator.')
  const layoutBeforeStyle = await agentFrame.locator('body').evaluate((body) => {
    const section = document.querySelectorAll('section')[1]?.getBoundingClientRect()
    return { top: section?.top ?? 0, height: section?.height ?? 0 }
  })
  await postReaderSelection(page, crossSelection.text, crossSelection.locator)
  await page.getByLabel('背景色绿色').click({ force: true })
  await page.getByLabel('字体色默认').click({ force: true })
  await agentFrame.locator('.html-reader-annotation').filter({ hasText: '每次调用都能减少不确定性' }).first().waitFor({ timeout: 8000 })
  const crossMetrics = await agentFrame.locator('body').evaluate((body, before) => {
    const section = document.querySelectorAll('section')[1]?.getBoundingClientRect()
    const markers = Array.from(document.querySelectorAll('.html-reader-annotation'))
    return {
      emptyMarkers: markers.filter((node) => !(node.textContent || '').trim()).length,
      topDelta: Math.abs((section?.top ?? 0) - before.top),
      heightDelta: Math.abs((section?.height ?? 0) - before.height),
    }
  }, layoutBeforeStyle)
  assert(crossMetrics.emptyMarkers === 0, 'Cross-paragraph styling created empty annotation markers.')
  assert(crossMetrics.topDelta <= 1, `Cross-paragraph styling shifted text vertically: ${JSON.stringify(crossMetrics)}`)
  assert(crossMetrics.heightDelta <= 1, `Cross-paragraph styling changed section height: ${JSON.stringify(crossMetrics)}`)
  await page.getByRole('button', { name: '清除样式' }).click()
  await page.waitForTimeout(400)
  assert(
    (await agentFrame.locator('.html-reader-annotation').filter({ hasText: '每次调用都能减少不确定性' }).count()) === 0,
    'Cleared text style still renders inside the reader iframe.',
  )

  const noteText = '最后一步应该回到用户目标：结果是否可运行、是否覆盖风险、是否留下了清楚的下一步。'
  await postReaderSelection(page, noteText, await buildReaderTextLocator(agentFrame, noteText))
  await page.getByLabel('背景色粉色').click({ force: true })
  await page.getByLabel('字体色蓝色').click({ force: true })
  await page.getByPlaceholder('给这段文字补一条笔记').fill('这是测试笔记')
  await page.getByRole('button', { name: '添加笔记' }).click()
  await page.getByText('这是测试笔记').waitFor()
  await agentFrame.locator('.html-reader-annotation').filter({ hasText: noteText.slice(0, 18) }).first().waitFor({ timeout: 8000 })
  const annotationStyle = await agentFrame.locator('body').evaluate((body, expectedText) => {
    const markers = Array.from(body.ownerDocument.querySelectorAll('.html-reader-annotation'))
      .map((node) => {
        const style = window.getComputedStyle(node)
        return {
          backgroundColor: style.backgroundColor,
          color: style.color,
          text: node.textContent || '',
        }
      })
      .filter((item) => expectedText.includes(item.text.trim()))
    return {
      text: markers.map((item) => item.text).join('').replace(/\s+/g, ''),
      styled: markers.every((item) => item.backgroundColor === 'rgb(251, 207, 232)' && item.color === 'rgb(37, 99, 235)'),
      markerCount: markers.length,
    }
  }, noteText)
  assert(annotationStyle.text.includes(noteText.replace(/\s+/g, '')), 'Saved note style did not wrap the selected text.')
  assert(annotationStyle.styled, `Unexpected annotation style across ${annotationStyle.markerCount} markers.`)
  await page.locator('.action-panel .icon-button').click()
  await page.locator('.action-panel').waitFor({ state: 'hidden' })
  await setFrameScroll(agentFrame, 0.58)
  await page.waitForTimeout(500)
  const agentScrollBeforeInteractive = await getFrameScroll(agentFrame)
  await page.getByRole('button', { name: '交互模式' }).click()
  await agentFrame.locator('h1').first().waitFor()
  await page.waitForTimeout(600)
  assert((await agentFrame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader lost the original document after switching to interactive mode.')
  const agentScrollInInteractiveMode = await getFrameScroll(agentFrame)
  assert(
    agentScrollBeforeInteractive > 0.45 && agentScrollInInteractiveMode > 0.05,
    `Reader did not restore a meaningful scroll position after switching to interactive mode: ${agentScrollBeforeInteractive} -> ${agentScrollInInteractiveMode}.`,
  )
  await setFrameScroll(agentFrame, 0.58)
  await page.waitForTimeout(500)
  const agentScrollBeforeReadMode = await getFrameScroll(agentFrame)
  await page.getByRole('button', { name: '阅读模式' }).click()
  await agentFrame.locator('h1').first().waitFor()
  await page.waitForTimeout(600)
  assert((await agentFrame.locator('h1').first().innerText()) === 'Agent 工作流设计备忘', 'Reader lost the original document after switching back to read mode.')
  await openReaderActionPanel(page)
  await page.locator('.highlight-list article', { hasText: '这是测试笔记' }).waitFor()
  const agentScrollBackInReadMode = await getFrameScroll(agentFrame)
  assert(
    agentScrollBeforeReadMode > 0.45 && agentScrollBackInReadMode > 0.05,
    `Reader did not restore a meaningful scroll position after switching back to read mode: ${agentScrollBeforeReadMode} -> ${agentScrollBackInReadMode}.`,
  )
  await page.getByRole('button', { name: '总结' }).click()
  await page.getByText('梳理多步骤 AI 任务中的角色、上下文、工具调用和安全边界。').waitFor()

  const readerMetrics = await page.evaluate(() => {
    const dock = document.querySelector('.action-dock')?.getBoundingClientRect()
    const dockStyle = document.querySelector('.action-dock')
      ? window.getComputedStyle(document.querySelector('.action-dock'))
      : null
    const panel = document.querySelector('.action-panel')?.getBoundingClientRect()
    const iframe = document.querySelector('iframe')?.getBoundingClientRect()
    return {
      noHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      panelInsideViewport: Boolean(panel && panel.left >= 0 && panel.right <= window.innerWidth && panel.bottom <= window.innerHeight),
      iframeLargeEnough: Boolean(iframe && iframe.width > 280 && iframe.height > 400),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      scrollWidth: document.documentElement.scrollWidth,
      panel: panel
        ? { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom, width: panel.width, height: panel.height }
        : null,
      dock: dock
        ? { left: dock.left, right: dock.right, top: dock.top, bottom: dock.bottom, width: dock.width, height: dock.height }
        : null,
      dockStyle: dockStyle
        ? { left: dockStyle.left, right: dockStyle.right, width: dockStyle.width, transform: dockStyle.transform }
        : null,
      iframe: iframe
        ? { left: iframe.left, right: iframe.right, top: iframe.top, bottom: iframe.bottom, width: iframe.width, height: iframe.height }
        : null,
    }
  })
  assert(readerMetrics.noHorizontalOverflow, `${viewport.width}px viewport has horizontal overflow in reader: ${JSON.stringify(readerMetrics)}`)
  assert(readerMetrics.panelInsideViewport, `${viewport.width}px action panel is outside the viewport: ${JSON.stringify(readerMetrics)}`)
  assert(readerMetrics.iframeLargeEnough, `${viewport.width}px iframe is too small: ${JSON.stringify(readerMetrics)}`)

  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await page.getByRole('heading', { name: '笔记中心' }).waitFor()
  await page.getByText('这是测试笔记').waitFor()
  await page.getByPlaceholder('搜索笔记、来源文档').fill('最后一步')
  await page.getByRole('button', { name: 'Agent 工作流设计备忘' }).waitFor()
  await page.locator('.note-card', { hasText: '这是测试笔记' }).getByRole('button', { name: '编辑', exact: true }).click()
  await page.getByLabel('编辑笔记').fill('这是编辑后的测试笔记')
  await page.locator('.note-edit-box').getByRole('button', { name: '保存' }).click()
  await page.getByText('这是编辑后的测试笔记').waitFor()
  await page.getByRole('button', { name: 'Agent 工作流设计备忘' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '笔记', exact: true }).click()
  await page.getByRole('heading', { name: '笔记中心' }).waitFor()
  await page.getByPlaceholder('搜索笔记、来源文档').fill('编辑后的')
  await page.getByRole('button', { name: '删除' }).click()
  await page.getByText('暂无笔记').waitFor()

  await page.getByRole('button', { name: '统计', exact: true }).click()
  await page.getByRole('heading', { name: '阅读统计' }).waitFor()
  await page.getByText('本周阅读', { exact: true }).waitFor()
  await page.getByText('完成率', { exact: true }).waitFor()
  await page.getByRole('heading', { name: '阅读诊断' }).waitFor()
  await page.getByRole('heading', { name: '待读清单' }).waitFor()
  await page.getByRole('heading', { name: 'AI 使用概况' }).waitFor()
  await page.locator('.list-panel').filter({ hasText: '待读清单' }).getByRole('button', { name: /项目复盘 HTML 报告/ }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '人物', exact: true }).click()
  await page.getByRole('heading', { name: '虚拟人物' }).waitFor()
  const companionName = `陪读宠物 ${viewport.width}`
  await page.getByLabel('名称').fill(companionName)
  await page.getByLabel('语气').fill('轻快、聪明、陪伴式')
  await page.getByLabel('系统提示词').fill('用简洁中文陪用户阅读，先给结论，再指出可以继续深挖的问题。')
  await page.getByLabel('身体形状').selectOption('capsule')
  await page.getByLabel('表情').selectOption('happy')
  await page.getByLabel('尾巴').selectOption('curl')
  await page.getByLabel('强调色').fill('#35c9d0')
  await page.getByLabel('天线').check()
  await page.getByRole('button', { name: '保存人物' }).click()
  await page.getByRole('heading', { name: companionName }).waitFor()
  await page.locator('.companion-persona-card', { hasText: companionName }).locator('.companion-pet.shape-capsule.expression-happy').waitFor()
  await page.locator('.companion-pet-button').click()
  await page.locator('.companion-panel').getByLabel('人物').selectOption({ label: companionName })
  await page.locator('.companion-dock').getByText('人物已同步').waitFor()
  await page.locator('.companion-panel').getByRole('button', { name: '编辑' }).click()
  await page.getByRole('heading', { name: '虚拟人物' }).waitFor()
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: '人物', exact: true }).click()
  await page.getByRole('heading', { name: companionName }).waitFor()
  await page.locator('.companion-persona-card', { hasText: companionName }).locator('.pet-tail.curl').waitFor()
  await page.getByRole('button', { name: '资料库', exact: true }).click()
  await page.getByPlaceholder('搜索标题、摘要、分类、正文').fill('Agent')
  await page.getByRole('button', { name: '阅读' }).click()
  await page.locator('iframe').waitFor({ state: 'visible' })
  await openReaderActionPanel(page)
  await page.locator('.action-panel select').first().selectOption({ label: companionName })
  assert(
    (await page.locator('.action-panel select').first().locator('option:checked').innerText()) === companionName,
    'Reader AI panel did not allow switching to the newly created companion persona.',
  )
  await page.getByRole('button', { name: '部署', exact: true }).click()
  await page.getByRole('heading', { name: '系统体检' }).waitFor()
  await page.getByRole('main').getByText('Demo Mode').waitFor()
  await page.getByRole('heading', { name: 'AI 配置中心' }).waitFor()
  await page.getByText('我的 API 平台').waitFor()
  const userApiLabel = `Smoke 自定义 API ${viewport.width} ${runId}`
  await page.getByPlaceholder('例如 SiliconFlow 个人 Key').fill(userApiLabel)
  await page.getByPlaceholder('https://api.siliconflow.cn/v1').fill('https://api.example.test/v1')
  await page.getByPlaceholder('Qwen/Qwen2.5-7B-Instruct').fill(`smoke-model-${viewport.width}`)
  await page.getByPlaceholder('只提交给后端加密保存').fill(`sk-smoke-${viewport.width}-abcdef123456`)
  await page.getByLabel('支持图片/视觉输入').check()
  await page.getByRole('button', { name: '添加 API' }).click()
  const userApiCard = page.locator('.ai-profile-grid .ai-profile-card').filter({ hasText: userApiLabel }).first()
  await userApiCard.waitFor()
  assert((await userApiCard.getByText('3456').count()) >= 1, 'Custom API card did not show a masked key hint.')
  await page.getByText('功能接口绑定').waitFor()
  await page.locator('.ai-feature-card', { hasText: '阅读摘要' }).getByRole('combobox').selectOption({ label: `${userApiLabel} · smoke-model-${viewport.width}` })
  await page.getByRole('button', { name: '保存绑定' }).click()
  await page.locator('.ai-feature-card', { hasText: '虚拟人物对话' }).getByText('未部署').waitFor()
  await page.getByText('调用统计').waitFor()
  await page.getByRole('button', { name: '测试 AI 连接' }).click()
  await page.getByText('api.siliconflow.cn').waitFor()
  assert((await page.locator('.ai-profile-grid').getByText('vision.demo.local').count()) >= 1, 'AI config did not show the vision model host.')
  assert((await page.locator('.ai-profile-card.pass').count()) >= 1, 'AI health check did not mark any profile as available.')

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
  stopServer()
}
