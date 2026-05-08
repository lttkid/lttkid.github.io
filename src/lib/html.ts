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

export function createReaderSrcDoc(rawHtml: string, initialScroll = 0) {
  const sanitized = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'object', 'embed', 'applet'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'autofocus'],
  })

  const restoreScript = `
    <script>
      window.addEventListener('load', () => {
        const root = document.scrollingElement || document.documentElement;
        const max = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop = max * ${Number.isFinite(initialScroll) ? initialScroll : 0};
      });
    </script>
  `

  const withReaderStyle = /<\/head>/i.test(sanitized)
    ? sanitized.replace(/<\/head>/i, `${readerStyle}</head>`)
    : sanitized.replace(/<body[^>]*>/i, (match) => `${match}${readerStyle}`)

  if (/<\/body>/i.test(withReaderStyle)) {
    return withReaderStyle.replace(/<\/body>/i, `${bridgeScript}${restoreScript}</body>`)
  }

  return `<!doctype html><html><head><meta charset="utf-8" />${readerStyle}</head><body>${withReaderStyle}${bridgeScript}${restoreScript}</body></html>`
}

export function estimateReadMinutesFromHtml(html: string) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latinWords = text.replace(/[\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.ceil(chineseChars / 450 + latinWords / 220 || 1))
}

export function extractTitleFromHtml(html: string, fallback: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = match?.[1]?.replace(/\s+/g, ' ').trim()
  return title || fallback
}
