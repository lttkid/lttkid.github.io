import DOMPurify from 'dompurify'

const bridgeScript = `
  <script>
    (() => {
      const postSelection = () => {
        const text = String(window.getSelection ? window.getSelection() : '').trim();
        if (text) {
          window.parent.postMessage({ type: 'html-reader-selection', text }, '*');
        }
      };
      const postProgress = () => {
        const root = document.scrollingElement || document.documentElement;
        const scroll = root.scrollHeight > root.clientHeight
          ? root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight)
          : 0;
        window.parent.postMessage({ type: 'html-reader-progress', scroll }, '*');
      };
      let ticking = false;
      document.addEventListener('mouseup', postSelection);
      document.addEventListener('keyup', postSelection);
      document.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        window.setTimeout(() => {
          ticking = false;
          postProgress();
        }, 250);
      }, { passive: true });
      window.addEventListener('load', postProgress);
    })();
  </script>
`

const readerStyle = `
  <style id="html-vault-reader-style">
    html, body {
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    img, video, canvas, svg {
      max-width: 100%;
      height: auto;
    }
    table {
      max-width: 100%;
    }
    @media (max-width: 720px) {
      body {
        padding-left: min(24px, 6vw) !important;
        padding-right: min(24px, 6vw) !important;
      }
      table {
        display: block;
        overflow-x: auto;
      }
    }
  </style>
`

export type ReaderRenderMode = 'read' | 'interactive'

function injectReaderShell(html: string, initialScroll: number) {
  const restoreScript = `
    <script>
      window.addEventListener('load', () => {
        const root = document.scrollingElement || document.documentElement;
        const max = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop = max * ${Number.isFinite(initialScroll) ? initialScroll : 0};
      });
    </script>
  `

  const withReaderStyle = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${readerStyle}</head>`)
    : html.replace(/<body[^>]*>/i, (match) => `${match}${readerStyle}`)

  if (/<\/body>/i.test(withReaderStyle)) {
    return withReaderStyle.replace(/<\/body>/i, `${bridgeScript}${restoreScript}</body>`)
  }

  return `<!doctype html><html><head><meta charset="utf-8" />${readerStyle}</head><body>${withReaderStyle}${bridgeScript}${restoreScript}</body></html>`
}

export function createReaderSrcDoc(rawHtml: string, initialScroll = 0, mode: ReaderRenderMode = 'read') {
  if (mode === 'interactive') {
    return injectReaderShell(rawHtml, initialScroll)
  }

  const sanitized = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'object', 'embed', 'applet'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus'],
  })

  return injectReaderShell(sanitized, initialScroll)
}

export function extractPlainTextFromHtml(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove())
  return (doc.body?.textContent ?? doc.documentElement.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function estimateReadMinutesFromHtml(html: string) {
  const text = extractPlainTextFromHtml(html)

  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(chineseChars / 450 + latinWords / 220 || 1))
}

export function extractTitleFromHtml(html: string, fallback: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = doc.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim()
  const h1 = doc.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim()
  return title || h1 || fallback
}
