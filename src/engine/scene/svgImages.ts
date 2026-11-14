/**
 * Loads AI-written SVG as images for the canvas.
 *
 * raw svg -> sanitizeSvg -> Blob -> object URL -> <img>. The markup never
 * enters the page DOM, and an SVG loaded through <img> cannot run script or
 * fetch anything. One cache per canvas; `dispose` revokes every URL.
 */
import { sanitizeSvg, svgAspect } from '../svg';

interface Entry {
  image: HTMLImageElement | null;
  url: string | null;
  ready: boolean;
  aspect: number;
}

export class SvgImageCache {
  private entries = new Map<string, Entry>();
  private disposed = false;

  constructor(private readonly onLoad: () => void) {}

  /** The decoded image for this svg string, or null while it loads or when it is unusable. */
  get(rawSvg: string): { image: HTMLImageElement; aspect: number } | null {
    let entry = this.entries.get(rawSvg);
    if (!entry) {
      entry = this.load(rawSvg);
      this.entries.set(rawSvg, entry);
    }
    return entry.ready && entry.image ? { image: entry.image, aspect: entry.aspect } : null;
  }

  private load(rawSvg: string): Entry {
    const entry: Entry = { image: null, url: null, ready: false, aspect: 1 };
    const canLoad =
      typeof Image !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function';
    if (!canLoad) return entry;
    const clean = sanitizeSvg(rawSvg);
    if (!clean) return entry;
    try {
      entry.aspect = svgAspect(clean);
      entry.url = URL.createObjectURL(new Blob([clean], { type: 'image/svg+xml' }));
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (this.disposed) return;
        entry.ready = true;
        this.onLoad();
      };
      image.onerror = () => {
        this.release(entry);
      };
      image.src = entry.url;
      entry.image = image;
    } catch {
      this.release(entry);
    }
    return entry;
  }

  private release(entry: Entry): void {
    if (entry.url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(entry.url);
    entry.url = null;
    entry.image = null;
    entry.ready = false;
  }

  /** Drops images for svg strings that are no longer in the scene. */
  retain(inUse: ReadonlySet<string>): void {
    for (const [key, entry] of this.entries) {
      if (!inUse.has(key)) {
        this.release(entry);
        this.entries.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  /** For tests. */
  get size(): number {
    return this.entries.size;
  }
}
