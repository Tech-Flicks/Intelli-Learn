/**
 * Fingerprint of a canvas: a stable hash of what makes two challenges "the same
 * question": the question text, the kind of interaction and the answer key.
 *
 * Titles, intros, hints, the scene's theme and its decoration are left out on
 * purpose, so the same question drawn in a different scene is one library item.
 * Ids are left out too: the AI numbers options freely ("a", "opt-1", ...), so
 * the key is built from what the child reads, not from how it is labelled inside.
 */
import type { Challenge, Interaction, Scene } from '@/core/schemas';

/** Lower case, compatibility-normalized, single spaces. Keeps every symbol, so "3 + 4" and "3 - 4" stay different. */
function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The question as a child would say it: like `normalizeText`, and without the
 * punctuation that changes nothing ("How many?" equals "how many"). A point,
 * comma or colon between two digits belongs to a number or a time and stays.
 */
function normalizeQuestion(text: string): string {
  const isDigit = (char: string | undefined): boolean => char !== undefined && char >= '0' && char <= '9';
  return normalizeText(
    text
      .normalize('NFKC')
      .replace(/["'“”‘’«»¿¡!?;…।]/g, ' ')
      .replace(/[.,:]/g, (mark, offset: number, whole: string) =>
        isDigit(whole[offset - 1]) && isDigit(whole[offset + 1]) ? mark : ' ',
      ),
  );
}

/** A number without floating-point noise. */
function num(value: number): string {
  return String(Number(value.toFixed(6)));
}

function labelled(item: { label: string; emoji?: string | undefined }): string {
  return `${normalizeText(item.label)}~${item.emoji?.trim() ?? ''}`;
}

/** What a tap target shows: its picture, text or shape. Position, size and animation are decoration. */
function tapTarget(scene: Scene, id: string): string {
  const object = scene.objects.find((candidate) => candidate.id === id);
  if (!object) return `?${id}`;
  const face =
    object.type === 'emoji'
      ? (object.emoji?.trim() ?? '')
      : object.type === 'text'
        ? normalizeText(object.text ?? '')
        : object.type === 'shape'
          ? `${object.shape ?? ''}/${object.color?.toLowerCase() ?? ''}`
          : `svg/${fnv1a(object.svg ?? '', FNV_OFFSET_A)}`;
  return `${object.type}:${face}:${normalizeText(object.label ?? '')}`;
}

const cellKey = (cell: { x: number; y: number }): string => `${cell.x},${cell.y}`;

/** The answer key in a canonical text form: independent of ids and of the order things were listed in. */
export function answerKeyOf(interaction: Interaction, scene: Scene): string {
  switch (interaction.kind) {
    case 'choice': {
      const correct = new Set(interaction.correctIds);
      return interaction.options
        .filter((option) => correct.has(option.id))
        .map(labelled)
        .sort()
        .join('|');
    }
    case 'tap':
      return interaction.targetIds
        .map((id) => tapTarget(scene, id))
        .sort()
        .join('|');
    case 'sort': {
      const bins = new Map(interaction.bins.map((bin) => [bin.id, labelled(bin)]));
      return interaction.items
        .map((item) => `${labelled(item)}>${bins.get(item.binId) ?? item.binId}`)
        .sort()
        .join('|');
    }
    case 'match':
      return interaction.pairs
        .map((pair) => `${labelled(pair.left)}=${labelled(pair.right)}`)
        .sort()
        .join('|');
    case 'order':
      // The schema lists the items in the correct order, so the order is the answer.
      return interaction.items.map(labelled).join('>');
    case 'number':
      return `${num(interaction.answer)}±${num(interaction.tolerance)}${normalizeText(interaction.unit ?? '')}`;
    case 'robot':
      return [
        `${interaction.cols}x${interaction.rows}`,
        `${cellKey(interaction.start)}${interaction.start.dir}`,
        cellKey(interaction.goal),
        interaction.walls.map(cellKey).sort().join(';'),
        interaction.gems.map(cellKey).sort().join(';'),
        [...interaction.allowed].sort().join(','),
        String(interaction.maxCommands),
      ].join('|');
    case 'build':
      return [
        num(interaction.target),
        num(interaction.budget),
        ...interaction.parts.map((part) => `${labelled(part)}:${num(part.power)}:${num(part.cost)}`).sort(),
      ].join('|');
  }
}

const FNV_OFFSET_A = 0x811c9dc5;
/** A second, unrelated start value: two passes give 64 bits, so a chance collision is out of the question on one device. */
const FNV_OFFSET_B = 0x9747b28c;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over the UTF-16 code units (both bytes of each unit), as 8 hex digits. */
function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME);
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable 16-digit hex fingerprint of a challenge. Equal for two challenges that
 * ask the same question, in the same way, with the same answer.
 */
export function fingerprintOf(content: Challenge): string {
  const { interaction } = content;
  const basis = [normalizeQuestion(content.question), interaction.kind, answerKeyOf(interaction, content.scene)].join('␟');
  return fnv1a(basis, FNV_OFFSET_A) + fnv1a(basis, FNV_OFFSET_B);
}
