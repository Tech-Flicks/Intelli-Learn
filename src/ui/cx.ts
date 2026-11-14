export type ClassValue = string | false | null | undefined;

/** Joins class names, skipping empty values. */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Joins id lists for `aria-describedby` / `aria-labelledby`. Returns undefined when empty. */
export function ids(...parts: (string | false | null | undefined)[]): string | undefined {
  const joined = parts.filter(Boolean).join(' ');
  return joined || undefined;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
