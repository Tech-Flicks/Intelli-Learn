/**
 * Checks that hold on every screen: controls have accessible names, nothing makes the page
 * scroll sideways, and no raw translation key is shown.
 */
import { expect, type Page } from '@playwright/test';

export interface ScreenReport {
  unnamed: string[];
  overflow: string[];
  rawKeys: string[];
  smallTargets: string[];
}

export interface AuditOptions {
  /** Smallest allowed width and height of a touch target, in CSS pixels. 0 = not checked. */
  minTarget?: number;
  /** CSS selector of controls that may be smaller (the small lock that is meant for grown-ups). */
  smallAllowed?: string;
}

export async function inspectScreen(page: Page, options: AuditOptions = {}): Promise<ScreenReport> {
  return page.evaluate(({ minTarget, smallAllowed }) => {
    const visible = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      return !element.closest('[aria-hidden="true"], [hidden], [inert]');
    };
    const textOf = (ids: string | null): string =>
      (ids ?? '')
        .split(/\s+/)
        .map((id) => (id ? (document.getElementById(id)?.textContent ?? '') : ''))
        .join(' ')
        .trim();
    const nameOf = (element: Element): string => {
      const labelled = textOf(element.getAttribute('aria-labelledby'));
      if (labelled) return labelled;
      const label = element.getAttribute('aria-label')?.trim();
      if (label) return label;
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const fromLabels = Array.from(element.labels ?? [])
          .map((entry) => entry.textContent ?? '')
          .join(' ')
          .trim();
        if (fromLabels) return fromLabels;
        if (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button')) return element.value.trim();
        return (element.getAttribute('title') ?? element.getAttribute('placeholder') ?? '').trim();
      }
      // Text content, without parts hidden from assistive technology, plus image alternatives.
      const clone = element.cloneNode(true) as Element;
      clone.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      const alt = Array.from(clone.querySelectorAll('img[alt], [role="img"][aria-label], svg[aria-label]'))
        .map((image) => image.getAttribute('alt') ?? image.getAttribute('aria-label') ?? '')
        .join(' ');
      return `${clone.textContent ?? ''} ${alt} ${element.getAttribute('title') ?? ''}`.trim();
    };
    const describe = (element: Element): string => {
      const html = element.outerHTML.replace(/\s+/g, ' ');
      return html.length > 160 ? `${html.slice(0, 160)}…` : html;
    };

    const controls = Array.from(
      document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], [role="slider"], [role="spinbutton"]'),
    ).filter(visible);
    const unnamed = controls.filter((element) => nameOf(element) === '').map(describe);

    const width = document.documentElement.clientWidth;
    const overflow: string[] = [];
    if (document.documentElement.scrollWidth > width + 1) overflow.push(`the page is ${document.documentElement.scrollWidth}px wide in a ${width}px window`);
    if (document.body.scrollWidth > width + 1) overflow.push(`the body is ${document.body.scrollWidth}px wide in a ${width}px window`);
    // Inner panels that scroll sideways without meaning to (wide tables and tab strips declare overflow-x themselves).
    for (const element of Array.from(document.querySelectorAll('main, [role="dialog"], [role="alertdialog"], section, article'))) {
      if (!visible(element)) continue;
      const style = getComputedStyle(element);
      if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
        overflow.push(`sideways scrolling inside ${describe(element)}`);
      }
    }
    // Controls that stick out of the window to the right or left.
    for (const element of controls) {
      const box = element.getBoundingClientRect();
      const scrollsSideways = element.closest('[data-scroll-x], [role="tablist"]') !== null;
      if (!scrollsSideways && (box.right > width + 1 || box.left < -1)) overflow.push(`outside the window: ${describe(element)}`);
    }

    const rawKeys: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const keyLike = /\b(common|child|parent|play|bot|pip|engine|grade|step|strand|age|mode)\.[a-z][A-Za-z]*(\.[A-Za-z0-9-]+)+\b/;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (keyLike.test(text) && node.parentElement && visible(node.parentElement)) rawKeys.push(text.trim().slice(0, 120));
    }
    for (const element of Array.from(document.querySelectorAll('[aria-label], [title], [placeholder]'))) {
      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        const value = element.getAttribute(attribute) ?? '';
        if (keyLike.test(value)) rawKeys.push(`${attribute}="${value}"`);
      }
    }

    const smallTargets: string[] = [];
    if (minTarget > 0) {
      for (const element of Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="radio"], [role="switch"]')).filter(visible)) {
        if ((element as HTMLButtonElement).disabled) continue;
        if (smallAllowed !== '' && element.matches(smallAllowed)) continue;
        // A see-through keyboard target over a picture is as big as what it covers.
        if (getComputedStyle(element).pointerEvents === 'none') continue;
        const box = element.getBoundingClientRect();
        if (box.width < minTarget - 0.5 || box.height < minTarget - 0.5) {
          smallTargets.push(`${Math.round(box.width)}x${Math.round(box.height)}: ${describe(element)}`);
        }
      }
    }
    return { unnamed, overflow, rawKeys, smallTargets };
  }, { minTarget: options.minTarget ?? 0, smallAllowed: options.smallAllowed ?? '' });
}

/**
 * Fails with the name of the screen when a control has no accessible name, the page
 * scrolls sideways, or a translation key is shown as text. With `minTarget`, every
 * touch target must be at least that many pixels wide and tall (child area).
 */
export async function auditScreen(page: Page, name: string, options: AuditOptions = {}): Promise<void> {
  const report = await inspectScreen(page, options);
  expect(report, `screen "${name}"`).toEqual({ unnamed: [], overflow: [], rawKeys: [], smallTargets: [] });
}
