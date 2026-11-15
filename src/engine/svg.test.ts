import { describe, expect, it } from 'vitest';
import { MAX_SVG_LENGTH } from '@/core/schemas';
import { sanitizeSvg, svgAspect } from './svg';

const GOOD = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff8800"/></svg>';

function parse(svg: string): Element {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc.documentElement;
}

describe('sanitizeSvg', () => {
  it('keeps a simple drawing and returns well-formed XML with a namespace', () => {
    const out = sanitizeSvg(GOOD);
    expect(out).not.toBeNull();
    const root = parse(out as string);
    expect(root.localName).toBe('svg');
    expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(root.querySelector('circle')?.getAttribute('fill')).toBe('#ff8800');
    expect(root.getAttribute('width')).toBe('100');
    expect(root.getAttribute('height')).toBe('100');
  });

  it('is idempotent', () => {
    const once = sanitizeSvg(GOOD) as string;
    expect(sanitizeSvg(once)).toBe(once);
  });

  it('keeps gradients referenced by same-document url(#id)', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>',
    ) as string;
    const root = parse(out);
    expect(root.querySelector('rect')?.getAttribute('fill')).toBe('url(#g)');
    expect(root.querySelector('linearGradient')).not.toBeNull();
  });

  it('keeps <use> with a same-document reference', () => {
    const out = sanitizeSvg(
      '<svg viewBox="0 0 10 10"><defs><circle id="dot" r="2"/></defs><use href="#dot" x="5" y="5"/></svg>',
    ) as string;
    expect(parse(out).querySelector('use')?.getAttribute('href')).toBe('#dot');
  });

  it('adds a viewBox when only width and height are given', () => {
    const out = sanitizeSvg('<svg width="40" height="20px"><rect width="40" height="20"/></svg>') as string;
    expect(parse(out).getAttribute('viewBox')).toBe('0 0 40 20');
    expect(svgAspect(out)).toBe(2);
  });

  it('rejects a drawing with neither viewBox nor size', () => {
    expect(sanitizeSvg('<svg><rect width="40" height="20"/></svg>')).toBeNull();
    expect(sanitizeSvg('<svg width="100%" height="100%"><rect width="40" height="20"/></svg>')).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 0 10"><rect width="40" height="20"/></svg>')).toBeNull();
  });

  it('rejects input that is not one single svg root', () => {
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('hello')).toBeNull();
    expect(sanitizeSvg('<div>hi</div>')).toBeNull();
    expect(sanitizeSvg(`${GOOD}${GOOD}`)).toBeNull();
    expect(sanitizeSvg(`look: ${GOOD}`)).toBeNull();
    expect(sanitizeSvg(`${GOOD}<p>after</p>`)).toBeNull();
    // @ts-expect-error wrong type on purpose
    expect(sanitizeSvg(null)).toBeNull();
  });

  it('enforces MAX_SVG_LENGTH', () => {
    const big = `<svg viewBox="0 0 10 10"><path d="${'M0 0L1 1'.repeat(MAX_SVG_LENGTH / 4)}"/></svg>`;
    expect(big.length).toBeGreaterThan(MAX_SVG_LENGTH);
    expect(sanitizeSvg(big)).toBeNull();
  });

  it('returns null when nothing drawable is left', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 10 10"></svg>')).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>')).toBeNull();
    expect(sanitizeSvg('<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/></svg>')).toBeNull();
  });

  describe('attack strings', () => {
    const attacks: [string, string][] = [
      ['onload on the root', '<svg viewBox="0 0 10 10" onload="alert(1)"><rect width="5" height="5"/></svg>'],
      ['onclick on a shape', '<svg viewBox="0 0 10 10"><rect width="5" height="5" onclick="alert(1)" onmouseover="x()"/></svg>'],
      ['script element', '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="5" height="5"/></svg>'],
      ['script with href', '<svg viewBox="0 0 10 10"><script href="https://evil.example/x.js"/><rect width="5" height="5"/></svg>'],
      ['javascript: link', '<svg viewBox="0 0 10 10"><a href="javascript:alert(1)"><rect width="5" height="5"/></a></svg>'],
      ['javascript: xlink', '<svg viewBox="0 0 10 10" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="java&#x09;script:alert(1)"><rect width="5" height="5"/></a></svg>'],
      ['external link', '<svg viewBox="0 0 10 10"><a href="https://evil.example/"><rect width="5" height="5"/></a></svg>'],
      ['external image', '<svg viewBox="0 0 10 10"><image href="https://evil.example/track.png" width="5" height="5"/><rect width="5" height="5"/></svg>'],
      ['data image', '<svg viewBox="0 0 10 10"><image xlink:href="data:image/svg+xml;base64,PHN2Zy8+" width="5" height="5"/><rect width="5" height="5"/></svg>'],
      ['external use', '<svg viewBox="0 0 10 10"><use href="https://evil.example/sprite.svg#a"/><rect width="5" height="5"/></svg>'],
      ['data use', '<svg viewBox="0 0 10 10"><use xlink:href="data:image/svg+xml,%3Csvg%3E#x"/><rect width="5" height="5"/></svg>'],
      ['foreignObject', '<svg viewBox="0 0 10 10"><foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"></iframe><img src=x onerror=alert(1)></body></foreignObject><rect width="5" height="5"/></svg>'],
      ['style with @import', '<svg viewBox="0 0 10 10"><style>@import url("https://evil.example/x.css");</style><rect width="5" height="5"/></svg>'],
      ['style with url()', '<svg viewBox="0 0 10 10"><style>rect{fill:url(https://evil.example/p.svg#a)}</style><rect width="5" height="5"/></svg>'],
      ['style with escapes', '<svg viewBox="0 0 10 10"><style>rect{background:\\75rl(https://evil.example/)}</style><rect width="5" height="5"/></svg>'],
      ['style attribute url', '<svg viewBox="0 0 10 10"><rect width="5" height="5" style="fill:url(https://evil.example/a.svg#b)"/></svg>'],
      ['style with image-set()', '<svg viewBox="0 0 10 10"><style>rect{background:image-set(\'https://evil.example/a.png\' 1x)}</style><rect width="5" height="5"/></svg>'],
      ['style with a prefixed image-set()', '<svg viewBox="0 0 10 10"><style>rect{background:-webkit-image-set("//evil.example/a.png" 1x)}</style><rect width="5" height="5"/></svg>'],
      ['style with image()', '<svg viewBox="0 0 10 10"><style>rect{background:image("https://evil.example/a.png")}</style><rect width="5" height="5"/></svg>'],
      ['style with a quoted address', '<svg viewBox="0 0 10 10"><style>rect{content:"https://evil.example/a.png"}</style><rect width="5" height="5"/></svg>'],
      ['style attribute image-set()', '<svg viewBox="0 0 10 10"><rect width="5" height="5" style="background:image-set(\'https://evil.example/a.png\' 1x)"/></svg>'],
      ['fill with external url', '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="url( \'https://evil.example/a.svg#b\' )"/></svg>'],
      ['animate targeting href', '<svg viewBox="0 0 10 10"><a href="#ok"><animate attributeName="href" values="javascript:alert(1)"/><rect width="5" height="5"/></a></svg>'],
      ['set targeting xlink:href', '<svg viewBox="0 0 10 10"><a><set attributeName="xlink:href" to="javascript:alert(1)"/><rect width="5" height="5"/></a></svg>'],
      ['iframe and object', '<svg viewBox="0 0 10 10"><iframe src="https://evil.example"></iframe><object data="x"></object><rect width="5" height="5"/></svg>'],
      ['img onerror smuggled', '<svg viewBox="0 0 10 10"><rect width="5" height="5"/><img src=x onerror=alert(1)></svg>'],
      ['feImage', '<svg viewBox="0 0 10 10"><filter id="f"><feImage href="https://evil.example/x.png"/></filter><rect width="5" height="5" filter="url(#f)"/></svg>'],
      ['mXSS style breakout', '<svg viewBox="0 0 10 10"><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style><rect width="5" height="5"/></svg>'],
    ];

    it.each(attacks)('neutralizes %s', (_name, attack) => {
      const out = sanitizeSvg(attack);
      if (out === null) return; // refusing the whole drawing is always safe
      const lower = out.toLowerCase();
      expect(lower).not.toContain('<script');
      expect(lower).not.toContain('javascript');
      expect(lower).not.toContain('evil.example');
      expect(lower).not.toContain('foreignobject');
      expect(lower).not.toContain('<image');
      expect(lower).not.toContain('<iframe');
      expect(lower).not.toContain('<img');
      expect(lower).not.toContain('@import');
      expect(lower).not.toContain('data:');
      expect(lower).not.toMatch(/\son[a-z]+\s*=/);
      const root = parse(out);
      for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
          if (attr.localName === 'href') expect(attr.value.startsWith('#')).toBe(true);
        }
        expect(['script', 'foreignObject', 'image', 'iframe', 'img']).not.toContain(el.localName);
      }
    });

    it('still keeps the harmless shape next to a removed attack', () => {
      const out = sanitizeSvg(
        '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><rect width="5" height="5" fill="#00ff00"/></svg>',
      ) as string;
      expect(out).not.toBeNull();
      expect(parse(out).querySelector('rect')?.getAttribute('fill')).toBe('#00ff00');
    });

    it('removes an animate that rewrites a link but keeps a harmless animation', () => {
      const out = sanitizeSvg(
        '<svg viewBox="0 0 10 10"><circle r="2"><animate attributeName="r" values="2;4;2" dur="1s" repeatCount="indefinite"/><animate attributeName="href" to="javascript:alert(1)"/></circle></svg>',
      ) as string;
      const root = parse(out);
      const animates = Array.from(root.querySelectorAll('animate'));
      expect(animates.every((a) => a.getAttribute('attributeName') === 'r')).toBe(true);
    });
  });
});
