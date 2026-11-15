/**
 * SVG sanitizer for AI-written drawings.
 *
 * AI-written SVG is never inserted into the page. It is sanitized here and
 * then drawn onto the canvas through an <img> (see scene/svgImages.ts), which
 * browsers already sandbox (no script, no network). This sanitizer is the
 * first of the two layers: DOMPurify with the SVG profile, followed by our
 * own strict walk over what is left.
 */
import DOMPurify from 'dompurify';
import { MAX_SVG_LENGTH } from '@/core/schemas';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that are always removed, on top of what the SVG profile already drops. */
const FORBIDDEN_TAGS = [
  'script',
  'foreignObject',
  'image',
  'feImage',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'handler',
  'listener',
];
const FORBIDDEN_LOCAL_NAMES = new Set(FORBIDDEN_TAGS.map((t) => t.toLowerCase()));

const ANIMATION_TAGS = new Set(['animate', 'set', 'animatetransform', 'animatemotion', 'animatecolor']);
const DRAWABLE_SELECTOR = 'path,rect,circle,ellipse,line,polyline,polygon,text,use';
const FRAGMENT_ONLY = /^#[A-Za-z_][\w.:-]*$/;

/** Code points browsers ignore inside URLs and CSS keywords: whitespace, controls, zero-width marks. */
function isIgnorable(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0xfeff
  );
}

/** Lower-cases the value and drops every ignorable character. */
function squash(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (!isIgnorable(value.charCodeAt(i))) out += value.charAt(i);
  }
  return out.toLowerCase();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16) || 0, 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Math.min(parseInt(dec, 10) || 0, 0x10ffff)));
}

/** CSS functions that take an address without `url(`. `image(` also covers `-webkit-image-set(` by its ending. */
const CSS_LOADERS = ['image-set(', 'image(', 'src(', 'cross-fade(', 'element('];
/** An address anywhere in the text: a scheme that loads, or `//host`. A small drawing has no use for either. */
const CSS_ADDRESS = /\/\/|(?:https?|ftp|wss?|file|blob|data|javascript|vbscript):/;

/** True when the CSS text could load something or run something. */
function cssIsUnsafe(css: string): boolean {
  const flat = squash(decodeEntities(css));
  if (flat.includes('\\')) return true; // CSS escapes can hide any keyword
  if (flat.includes('<')) return true; // markup has no place inside a stylesheet
  if (flat.includes('@import') || flat.includes('expression(')) return true;
  if (flat.includes('behavior:') || flat.includes('-moz-binding')) return true;
  if (CSS_LOADERS.some((loader) => flat.includes(loader))) return true;
  if (CSS_ADDRESS.test(flat)) return true;
  return hasExternalUrl(flat);
}

/** True when the value has a url(...) that is not a same-document #fragment. */
function hasExternalUrl(flatValue: string): boolean {
  let index = flatValue.indexOf('url(');
  while (index !== -1) {
    const close = flatValue.indexOf(')', index);
    if (close === -1) return true;
    const target = flatValue.slice(index + 4, close).replace(/^['"]|['"]$/g, '');
    if (!FRAGMENT_ONLY.test(target)) return true;
    index = flatValue.indexOf('url(', close);
  }
  return false;
}

function attributeIsUnsafe(el: Element, name: string, value: string): 'remove-attribute' | 'remove-element' | null {
  const lower = name.toLowerCase();
  const local = lower.includes(':') ? lower.slice(lower.indexOf(':') + 1) : lower;
  if (lower.startsWith('on')) return 'remove-attribute';
  if (local === 'href' || lower === 'src' || lower === 'action' || lower === 'formaction' || lower === 'data') {
    if (FRAGMENT_ONLY.test(value.trim())) return null;
    return el.localName.toLowerCase() === 'use' ? 'remove-element' : 'remove-attribute';
  }
  const flat = squash(value);
  if (lower === 'style') return cssIsUnsafe(value) ? 'remove-attribute' : null;
  if (flat.includes('javascript:') || flat.includes('vbscript:') || flat.includes('data:')) return 'remove-attribute';
  if (flat.includes('url(') && hasExternalUrl(flat)) return 'remove-attribute';
  return null;
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return [minX, minY, width, height];
}

function parseLength(value: string | null): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(value);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Well-formed XML with the SVG namespace declared exactly once, so it can load as an image. */
function serialize(root: Element): string {
  if (typeof XMLSerializer !== 'undefined') {
    try {
      // The serializer writes xmlns itself from the element's namespace.
      const xml = new XMLSerializer().serializeToString(root);
      if (/^<svg[^>]*\sxmlns=/.test(xml)) return xml;
    } catch {
      // fall through to outerHTML
    }
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
  return root.outerHTML;
}

/**
 * Returns a safe, self-contained `<svg>` string, or null when the input is not
 * one single SVG drawing or nothing safe is left of it.
 *
 * Removed: scripts, foreignObject, embedded images, event handler attributes,
 * links and references that leave the document, styles that load anything,
 * and animations that rewrite links.
 */
export function sanitizeSvg(svg: string): string | null {
  if (typeof svg !== 'string') return null;
  const input = svg.trim();
  if (input.length === 0 || input.length > MAX_SVG_LENGTH) return null;
  if (!/<svg[\s>]/i.test(input)) return null;
  if (typeof document === 'undefined' || !DOMPurify.isSupported) return null;

  let body: Node;
  try {
    body = DOMPurify.sanitize(input, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ADD_TAGS: ['use'],
      FORBID_TAGS: FORBIDDEN_TAGS,
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false,
      RETURN_DOM: true,
    });
  } catch {
    return null;
  }

  // Exactly one root element, an <svg>, and no loose text around it.
  let root: Element | null = null;
  for (const node of Array.from(body.childNodes)) {
    if (node.nodeType === 1) {
      if (root) return null;
      root = node as Element;
    } else if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') {
      return null;
    }
  }
  if (!root || root.localName.toLowerCase() !== 'svg') return null;

  const doomed: Element[] = [];
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    const local = el.localName.toLowerCase();
    if (el !== root && (FORBIDDEN_LOCAL_NAMES.has(local) || local === 'svg')) {
      // Nested <svg> documents are not needed for small drawings and widen the attack surface.
      doomed.push(el);
      continue;
    }
    if (local === 'style' && cssIsUnsafe(el.textContent ?? '')) {
      doomed.push(el);
      continue;
    }
    if (ANIMATION_TAGS.has(local)) {
      const target = squash(el.getAttribute('attributeName') ?? '');
      if (target === 'href' || target.endsWith(':href') || target.startsWith('on') || target === 'src') {
        doomed.push(el);
        continue;
      }
    }
    for (const attr of Array.from(el.attributes)) {
      const verdict = attributeIsUnsafe(el, attr.name, attr.value);
      if (verdict === 'remove-element' && el !== root) {
        doomed.push(el);
        break;
      }
      if (verdict) el.removeAttribute(attr.name);
    }
  }
  for (const el of doomed) el.remove();

  if (!root.querySelector(DRAWABLE_SELECTOR)) return null;

  let viewBox = parseViewBox(root.getAttribute('viewBox'));
  const width = parseLength(root.getAttribute('width'));
  const height = parseLength(root.getAttribute('height'));
  if (!viewBox) {
    if (width === null || height === null) return null;
    viewBox = [0, 0, width, height];
    root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  // Explicit pixel sizes make every browser able to draw the picture onto a canvas.
  if (width === null || height === null) {
    root.setAttribute('width', String(viewBox[2]));
    root.setAttribute('height', String(viewBox[3]));
  }
  const out = serialize(root);
  if (out.length === 0 || out.length > MAX_SVG_LENGTH) return null;
  return out;
}

/** Intrinsic aspect ratio (width / height) of a sanitized svg string, 1 when unknown. */
export function svgAspect(sanitized: string): number {
  const match = /viewBox\s*=\s*["']([^"']+)["']/i.exec(sanitized);
  const box = parseViewBox(match?.[1] ?? null);
  return box ? box[2] / box[3] : 1;
}
