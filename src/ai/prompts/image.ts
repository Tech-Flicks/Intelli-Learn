/** Prompt prefix for story illustrations. The style is fixed by the app; only the subject varies. */
import { oneLine } from './shared';

export const IMAGE_STYLE_PREFIX =
  "Children's picture-book illustration, soft rounded shapes, bright friendly colours, gentle and cheerful mood, simple background, no text, no letters, no logos, no real people, nothing scary. Subject: ";

export const IMAGE_SUBJECT_MAX = 300;

export function buildImagePrompt(subject: string): string {
  return `${IMAGE_STYLE_PREFIX}${oneLine(subject, IMAGE_SUBJECT_MAX)}`;
}
