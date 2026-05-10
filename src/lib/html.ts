import DOMPurify from 'dompurify'

const bridgeScript = `
  <script>
    (() => {
      const annotationClass = 'html-reader-annotation';
      const excludedTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'OBJECT', 'EMBED', 'APPLET']);

      const hasExcludedAncestor = (node) => {
        let current = node.parentElement;
        while (current && current !== document.body) {
          if (excludedTags.has(current.tagName)) return true;
          current = current.parentElement;
        }
        return false;
      };

      const collectTextNodes = () => {
        const root = document.body;
        if (!root) return { nodes: [], text: '' };
        const nodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue || hasExcludedAncestor(node)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return { nodes, text: nodes.map((node) => node.nodeValue || '').join('') };
      };

      const unwrapAnnotations = () => {
        document.querySelectorAll('.' + annotationClass).forEach((node) => {
          const parent = node.parentNode;
          if (!parent) return;
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
          parent.normalize();
        });
      };

      const sanitizeColor = (value, fallback = '') => {
        const color = String(value || '').trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
      };

      const normalizeTextWithMap = (text) => {
        let normalized = '';
        const map = [];
        let inWhitespace = false;
        for (let index = 0; index < text.length; index += 1) {
          const char = text[index];
          if (/\\s/.test(char)) {
            if (!inWhitespace) {
              normalized += ' ';
              map.push(index);
              inWhitespace = true;
            }
          } else {
            normalized += char;
            map.push(index);
            inWhitespace = false;
          }
        }
        return { text: normalized, map };
      };

      const normalizeText = (text) => String(text || '').replace(/\\s+/g, ' ').trim();

      const locateNormalizedText = (exact, state, approximateStart = 0) => {
        const normalizedExact = normalizeText(exact);
        if (!normalizedExact) return null;
        const normalizedState = normalizeTextWithMap(state.text);
        const searchStart = normalizedState.map.findIndex((index) => index >= Math.max(0, approximateStart - 20));
        const matchStart = normalizedState.text.indexOf(normalizedExact, Math.max(0, searchStart));
        if (matchStart < 0) return null;
        const mapStart = matchStart;
        const mapEnd = matchStart + normalizedExact.length - 1;
        const start = normalizedState.map[mapStart];
        const last = normalizedState.map[mapEnd];
        if (!Number.isFinite(start) || !Number.isFinite(last)) return null;
        return { start, end: last + 1 };
      };

      const locateText = (annotation, state) => {
        const locator = annotation.locator && typeof annotation.locator === 'object' ? annotation.locator : null;
        const exact = String(locator?.exact || annotation.selected_text || '');
        if (!exact) return null;
        const start = Number(locator?.start);
        const end = Number(locator?.end);
        if (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          start >= 0 &&
          end > start &&
          end <= state.text.length &&
          state.text.slice(start, end) === exact
        ) {
          return { start, end };
        }
        const prefix = String(locator?.prefix || '');
        const suffix = String(locator?.suffix || '');
        let searchFrom = 0;
        while (searchFrom <= state.text.length) {
          const matchStart = state.text.indexOf(exact, searchFrom);
          if (matchStart < 0) break;
          const matchEnd = matchStart + exact.length;
          const prefixOk = !prefix || state.text.slice(Math.max(0, matchStart - prefix.length), matchStart) === prefix;
          const suffixOk = !suffix || state.text.slice(matchEnd, matchEnd + suffix.length) === suffix;
          if (prefixOk && suffixOk) return { start: matchStart, end: matchEnd };
          searchFrom = matchStart + Math.max(1, exact.length);
        }
        const fallbackStart = state.text.indexOf(exact);
        if (fallbackStart >= 0) return { start: fallbackStart, end: fallbackStart + exact.length };
        return locateNormalizedText(exact, state, Number.isFinite(start) ? start : 0);
      };

      const textSlicesFromOffsets = (nodes, start, end) => {
        const slices = [];
        let cursor = 0;
        for (const node of nodes) {
          const length = (node.nodeValue || '').length;
          const nodeStart = cursor;
          const nodeEnd = cursor + length;
          const sliceStart = Math.max(start, nodeStart);
          const sliceEnd = Math.min(end, nodeEnd);
          if (sliceStart < sliceEnd) {
            slices.push({
              node,
              start: sliceStart - nodeStart,
              end: sliceEnd - nodeStart,
            });
          }
          cursor = nodeEnd;
        }
        return slices;
      };

      const getAnnotationStyle = (annotation) => {
        const backgroundColor = sanitizeColor(annotation.color, '');
        const textColor = sanitizeColor(annotation.text_color, '');
        if (!backgroundColor && !textColor) return null;
        return { backgroundColor, textColor };
      };

      const createMarker = (annotation, style) => {
        const marker = document.createElement('span');
        marker.className = annotationClass;
        marker.dataset.highlightId = String(annotation.id || '');
        marker.title = '点击编辑样式';
        if (style.backgroundColor) marker.style.backgroundColor = style.backgroundColor;
        if (style.textColor) marker.style.color = style.textColor;
        return marker;
      };

      const wrapTextSlice = (slice, annotation, style) => {
        const source = slice.node.nodeValue || '';
        let start = slice.start;
        let end = slice.end;
        while (start < end && /\\s/.test(source[start])) start += 1;
        while (end > start && /\\s/.test(source[end - 1])) end -= 1;
        if (end <= start) return false;

        const range = document.createRange();
        range.setStart(slice.node, start);
        range.setEnd(slice.node, end);
        if (range.collapsed) return false;

        const marker = createMarker(annotation, style);
        try {
          marker.appendChild(range.extractContents());
          range.insertNode(marker);
          return true;
        } catch {
          marker.remove();
          return false;
        }
      };

      const renderAnnotations = (items) => {
        unwrapAnnotations();
        const state = collectTextNodes();
        const ranges = (Array.isArray(items) ? items : [])
          .map((annotation) => ({ annotation, location: locateText(annotation, state), style: getAnnotationStyle(annotation) }))
          .filter((item) => item.location && item.style)
          .sort((a, b) => b.location.start - a.location.start);

        for (const item of ranges) {
          const currentState = collectTextNodes();
          const slices = textSlicesFromOffsets(currentState.nodes, item.location.start, item.location.end);
          for (const slice of slices.reverse()) {
            wrapTextSlice(slice, item.annotation, item.style);
          }
        }
      };

      const createLocator = (selection) => {
        if (!selection || selection.rangeCount === 0) return null;
        const raw = String(selection.toString() || '');
        const exact = raw.trim();
        if (!exact) return null;
        const range = selection.getRangeAt(0);
        const leadingWhitespace = raw.length - raw.trimStart().length;
        const body = document.body;
        if (!body) return null;
        const before = document.createRange();
        before.selectNodeContents(body);
        before.setEnd(range.startContainer, range.startOffset);
        const textState = collectTextNodes();
        const approximateStart = Math.max(0, String(before.toString() || '').length + leadingWhitespace);
        let start = textState.text.indexOf(exact, Math.max(0, approximateStart - 20));
        if (start < 0 || Math.abs(start - approximateStart) > 200) start = textState.text.indexOf(exact);
        let end = start + exact.length;
        if (start < 0) {
          const normalizedLocation = locateNormalizedText(exact, textState, approximateStart);
          if (!normalizedLocation) return null;
          start = normalizedLocation.start;
          end = normalizedLocation.end;
        }
        return {
          strategy: 'text-position-v1',
          start,
          end,
          exact,
          prefix: textState.text.slice(Math.max(0, start - 48), start),
          suffix: textState.text.slice(end, end + 48),
        };
      };

      const postSelection = () => {
        const selection = window.getSelection ? window.getSelection() : null;
        const text = String(selection || '').trim();
        if (text) {
          window.parent.postMessage({ type: 'html-reader-selection', text, locator: createLocator(selection) }, '*');
        }
      };
      const postAnnotationClick = (event) => {
        const target = event.target instanceof Element ? event.target.closest('.' + annotationClass) : null;
        if (!target) return;
        event.stopPropagation();
        window.parent.postMessage({
          type: 'html-reader-annotation-click',
          id: target.dataset.highlightId || '',
          text: String(target.textContent || '').trim(),
        }, '*');
      };
      const postProgress = () => {
        const root = document.scrollingElement || document.documentElement;
        const scroll = root.scrollHeight > root.clientHeight
          ? root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight)
          : 0;
        window.parent.postMessage({ type: 'html-reader-progress', scroll }, '*');
      };
      let ticking = false;
      window.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'html-reader-annotations') {
          window.setTimeout(() => renderAnnotations(data.highlights || []), 0);
        }
      });
      document.addEventListener('mouseup', postSelection);
      document.addEventListener('keyup', postSelection);
      document.addEventListener('click', postAnnotationClick);
      document.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        window.setTimeout(() => {
          ticking = false;
          postProgress();
        }, 250);
      }, { passive: true });
      window.addEventListener('load', () => {
        postProgress();
        window.parent.postMessage({ type: 'html-reader-ready' }, '*');
      });
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
    .html-reader-annotation {
      display: inline;
      border: 0;
      margin: 0;
      padding: 0;
      line-height: inherit;
      font: inherit;
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
  const safeInitialScroll = Number.isFinite(initialScroll) ? Math.min(1, Math.max(0, initialScroll)) : 0
  const restoreScript = `
    <script>
      window.addEventListener('load', () => {
        const target = ${safeInitialScroll};
        const restore = () => {
          const root = document.scrollingElement || document.documentElement;
          const max = Math.max(0, root.scrollHeight - root.clientHeight);
          root.scrollTop = max * target;
          window.parent.postMessage({ type: 'html-reader-progress', scroll: target }, '*');
        };
        window.requestAnimationFrame(restore);
        window.setTimeout(restore, 80);
        window.setTimeout(restore, 320);
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
