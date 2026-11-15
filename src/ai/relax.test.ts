import { describe, expect, it } from 'vitest';
import { ChallengeSchema } from '@/core/schemas';
import { KIND_EXAMPLES } from './prompts';
import { relaxChallengeJson, toHexColor } from './relax';

function base(kind: keyof typeof KIND_EXAMPLES = 'number'): Record<string, unknown> {
  return structuredClone(KIND_EXAMPLES[kind]) as Record<string, unknown>;
}

function sceneObjects(value: Record<string, unknown>): Record<string, unknown>[] {
  return (value.scene as { objects: Record<string, unknown>[] }).objects;
}

describe('toHexColor', () => {
  it('accepts hex in several spellings and common colour names', () => {
    expect(toHexColor('#FF8800')).toBe('#ff8800');
    expect(toHexColor('#abc')).toBe('#abc');
    expect(toHexColor('ff8800')).toBe('#ff8800');
    expect(toHexColor('#ff8800cc')).toBe('#ff8800');
    expect(toHexColor('Sky Blue')).toBe('#81d4fa');
    expect(toHexColor('red')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives up on anything else', () => {
    expect(toHexColor('rgb(1,2,3)')).toBeUndefined();
    expect(toHexColor('sparkly')).toBeUndefined();
    expect(toHexColor(7)).toBeUndefined();
  });
});

describe('relaxChallengeJson', () => {
  it('leaves a valid challenge valid and its meaning untouched', () => {
    for (const raw of Object.values(KIND_EXAMPLES)) {
      const relaxed = relaxChallengeJson(structuredClone(raw) as Record<string, unknown>);
      expect(ChallengeSchema.parse(relaxed)).toEqual(ChallengeSchema.parse(raw));
    }
  });

  it('does not change its input', () => {
    const raw = { ...base(), funFact: null };
    const copy = structuredClone(raw);
    relaxChallengeJson(raw);
    expect(raw).toEqual(copy);
  });

  it('drops null in optional places, which the schema would reject', () => {
    const raw = base();
    raw.funFact = null;
    raw.teachBack = null;
    (raw.interaction as Record<string, unknown>).unit = null;
    sceneObjects(raw)[0] = { ...sceneObjects(raw)[0], color: null, label: null, anim: null };
    expect(ChallengeSchema.safeParse(raw).success).toBe(false);

    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.funFact).toBeUndefined();
    expect(parsed.teachBack).toBeUndefined();
    expect(parsed.scene.objects[0]?.anim).toBeUndefined();
  });

  it('clamps scene numbers and reads numbers written as strings', () => {
    const raw = base();
    sceneObjects(raw)[0] = { id: 'rocket', type: 'emoji', emoji: '🚀', x: 104, y: -3, size: '120', rotation: 720, opacity: 0, z: 500, anim: { kind: 'float', duration: 0, delay: -1 } };
    const object = ChallengeSchema.parse(relaxChallengeJson(raw)).scene.objects[0];
    expect(object).toMatchObject({ x: 100, y: 0, size: 80, rotation: 360, opacity: 0.1, z: 100 });
    expect(object?.anim).toMatchObject({ kind: 'float', duration: 0.2, delay: 0 });
  });

  it('repairs colours, an unknown theme, an unknown animation and overlong captions', () => {
    const raw = base();
    const scene = raw.scene as Record<string, unknown>;
    scene.theme = 'outer-space';
    scene.gradient = ['navy', 'not a colour'];
    sceneObjects(raw)[0] = { id: 'a', type: 'shape', shape: 'circle', x: 10, y: 10, color: 'Blue', label: 'A caption that is much too long to fit', anim: { kind: 'teleport' } };
    sceneObjects(raw)[1] = { id: 'b', type: 'shape', shape: 'star', x: 20, y: 20, color: 'glittery' };
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.scene.theme).toBe('plain');
    expect(parsed.scene.gradient).toBeUndefined();
    expect(parsed.scene.objects[0]?.color).toBe('#1e88e5');
    expect(parsed.scene.objects[0]?.label?.length).toBeLessThanOrEqual(24);
    expect(parsed.scene.objects[0]?.anim).toBeUndefined();
    expect(parsed.scene.objects[1]?.color).toBeUndefined();
  });

  it('keeps a valid gradient', () => {
    const raw = base();
    (raw.scene as Record<string, unknown>).gradient = ['#001133', 'skyblue'];
    expect(ChallengeSchema.parse(relaxChallengeJson(raw)).scene.gradient).toEqual(['#001133', '#81d4fa']);
  });

  it('trims a scene that is too big without losing tap targets', () => {
    const raw = base('tap');
    const extras = Array.from({ length: 40 }, (_, index) => ({ id: `extra${index}`, type: 'emoji', emoji: '🌼', x: 50, y: 50 }));
    (raw.scene as Record<string, unknown>).objects = [...extras, ...sceneObjects(raw)];
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.scene.objects).toHaveLength(30);
    const ids = parsed.scene.objects.map((object) => object.id);
    for (const target of ['flower', 'tree', 'bug']) expect(ids).toContain(target);
  });

  it('fixes number answers written as text, extra hints and string booleans', () => {
    const raw = base();
    raw.interaction = { kind: 'number', answer: '5', tolerance: -1, allowDecimal: 'false', allowNegative: 'false' };
    raw.hints = ['One.', 'Two.', 'Three.'];
    const parsed = ChallengeSchema.parse(relaxChallengeJson(raw));
    expect(parsed.interaction).toMatchObject({ kind: 'number', answer: 5, tolerance: 0, allowDecimal: false });
    expect(parsed.hints).toEqual(['One.', 'Two.']);
  });

  it('never touches texts the child reads or the answer key', () => {
    const raw = base('choice');
    raw.question = 'x'.repeat(400); // too long: must be reported, not cut
    const relaxed = relaxChallengeJson(raw);
    expect(relaxed.question).toBe(raw.question);
    expect(relaxed.interaction).toEqual(raw.interaction);
    expect(ChallengeSchema.safeParse(relaxed).success).toBe(false);
  });

  it('survives junk', () => {
    expect(relaxChallengeJson({})).toEqual({});
    expect(relaxChallengeJson({ scene: 'nope', interaction: [1, null], hints: 'x' })).toEqual({ scene: 'nope', interaction: [1], hints: 'x' });
  });
});

/** Every slip here used to cost a whole extra request, although it has exactly one sensible repair. */
describe('relaxChallengeJson: common harmless slips', () => {
  type Json = Record<string, unknown>;
  const interaction = (value: Json): Json => value.interaction as Json;
  const accepted = (value: Json) => ChallengeSchema.parse(relaxChallengeJson(value));

  it('drops optional fields that were "filled in" with an empty string', () => {
    const raw = base('choice');
    const options = interaction(raw).options as Json[];
    options[1] = { ...options[1], emoji: '', misconception: '' };
    sceneObjects(raw)[4] = { ...sceneObjects(raw)[4], emoji: '', label: '', text: '' };
    sceneObjects(raw)[0] = { ...sceneObjects(raw)[0], shape: '', svg: '' };
    const parsed = accepted(raw);
    expect(parsed.scene.objects[4]).not.toHaveProperty('emoji');
    expect(parsed.scene.objects[0]).not.toHaveProperty('shape');

    const number = base('number');
    interaction(number).unit = '';
    expect(accepted(number).interaction).not.toHaveProperty('unit');
  });

  it('turns numeric ids into text and keeps the references to them', () => {
    const raw = base('choice');
    const options = interaction(raw).options as Json[];
    options.forEach((option, index) => (option.id = index + 1));
    interaction(raw).correctIds = [2];
    const parsed = accepted(raw);
    expect(parsed.interaction).toMatchObject({ kind: 'choice', correctIds: ['2'] });
    if (parsed.interaction.kind === 'choice') expect(parsed.interaction.options.map((option) => option.id)).toEqual(['1', '2', '3', '4']);
  });

  it('rewrites ids with spaces or accents the same way wherever they are used', () => {
    const choice = base('choice');
    (interaction(choice).options as Json[])[1]!.id = 'opción 2';
    interaction(choice).correctIds = ['opción 2'];
    const parsedChoice = accepted(choice);
    expect(parsedChoice.interaction).toMatchObject({ correctIds: ['opcion-2'] });

    const sort = base('sort');
    (interaction(sort).bins as Json[])[0]!.id = 'it floats';
    for (const item of interaction(sort).items as Json[]) if (item.binId === 'float') item.binId = 'it floats';
    const parsedSort = accepted(sort);
    if (parsedSort.interaction.kind === 'sort') {
      expect(parsedSort.interaction.bins[0]?.id).toBe('it-floats');
      expect(parsedSort.interaction.items.filter((item) => item.binId === 'it-floats')).toHaveLength(2);
    }

    const tap = base('tap');
    sceneObjects(tap)[0]!.id = 'la flor';
    interaction(tap).targetIds = ['la flor', 'tree', 'bug'];
    const parsedTap = accepted(tap);
    expect(parsedTap.interaction).toMatchObject({ targetIds: ['la-flor', 'tree', 'bug'] });
    expect(parsedTap.scene.objects[0]?.id).toBe('la-flor');
  });

  it('keeps two ids apart that would become the same', () => {
    const raw = base('choice');
    const options = interaction(raw).options as Json[];
    options[0]!.id = 'opt 1';
    options[1]!.id = 'opt-1';
    interaction(raw).correctIds = ['opt-1'];
    const parsed = accepted(raw);
    if (parsed.interaction.kind === 'choice') {
      expect(new Set(parsed.interaction.options.map((option) => option.id)).size).toBe(4);
      expect(parsed.interaction.options[1]?.id).toBe(parsed.interaction.correctIds[0]);
    }
  });

  it('reads enum values in any capitalisation and under their usual other names', () => {
    const choice = base('choice');
    interaction(choice).kind = 'Multiple_Choice';
    (choice.scene as Json).theme = 'Space ';
    sceneObjects(choice)[0]!.type = 'Emoji';
    sceneObjects(choice)[4] = { ...sceneObjects(choice)[4], type: 'Shape', shape: 'Rectangle' };
    sceneObjects(choice)[5] = { ...sceneObjects(choice)[5], shape: 'ellipse', anim: { kind: 'Spin', duration: 8 } };
    const parsed = accepted(choice);
    expect(parsed.interaction.kind).toBe('choice');
    expect(parsed.scene.theme).toBe('space');
    expect(parsed.scene.objects[4]?.shape).toBe('rect');
    expect(parsed.scene.objects[5]?.shape).toBe('oval');
    expect(parsed.scene.objects[5]?.anim?.kind).toBe('spin');

    const robot = base('robot');
    (interaction(robot).start as Json).dir = 'East';
    interaction(robot).allowed = ['Forward', 'LEFT', 'right '];
    expect(accepted(robot).interaction).toMatchObject({ start: { dir: 'right' }, allowed: ['forward', 'left', 'right'] });
  });

  it('reads numbers written as text, with a percent sign, or as [x, y] pairs', () => {
    const robot = base('robot');
    Object.assign(interaction(robot), { cols: '4', rows: '3', maxCommands: '8', walls: [[1, 1], [2, 1]], gems: [{ x: '3', y: '2' }] });
    sceneObjects(robot)[0] = { ...sceneObjects(robot)[0], x: '22%', y: '60 %', size: '22' };
    const parsedRobot = accepted(robot);
    expect(parsedRobot.interaction).toMatchObject({ cols: 4, rows: 3, maxCommands: 8, walls: [{ x: 1, y: 1 }, { x: 2, y: 1 }], gems: [{ x: 3, y: 2 }] });
    expect(parsedRobot.scene.objects[0]).toMatchObject({ x: 22, y: 60, size: 22 });

    const build = base('build');
    Object.assign(interaction(build), { target: '10', budget: '8' });
    for (const part of interaction(build).parts as Json[]) Object.assign(part, { power: String(part.power), cost: String(part.cost) });
    expect(accepted(build).interaction).toMatchObject({ target: 10, budget: 8 });
  });

  it('spreads out a scene whose coordinates were written as fractions of 1', () => {
    const raw = base('choice');
    for (const object of sceneObjects(raw)) Object.assign(object, { x: (object.x as number) / 100, y: (object.y as number) / 100 });
    const parsed = accepted(raw);
    expect(parsed.scene.objects.map((object) => [object.x, object.y])).toEqual(
      (KIND_EXAMPLES.choice as { scene: { objects: { x: number; y: number }[] } }).scene.objects.map((object) => [object.x, object.y]),
    );
    // A scene that really sits in a corner is rare, but one object at (0, 0) or (1, 1) is not a fraction.
    const corner = base('choice');
    (corner.scene as Json).objects = [{ id: 'dot', type: 'emoji', emoji: '🔵', x: 1, y: 1 }];
    expect(accepted(corner).scene.objects[0]).toMatchObject({ x: 1, y: 1 });
  });

  it('fits a walkthrough of seven steps and a teach-back with four options', () => {
    const raw = base('choice');
    raw.walkthrough = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Count the cookies on one plate.'];
    (raw.teachBack as Json).options = [
      { id: 'a', label: 'I guessed.', correct: 'false' },
      { id: 'b', label: 'I made three equal groups.', correct: 'true' },
      { id: 'c', label: 'I picked the biggest number.', correct: false },
      { id: 'd', label: 'I added them.', correct: false },
    ];
    const parsed = accepted(raw);
    expect(parsed.walkthrough).toHaveLength(6);
    expect(parsed.walkthrough.join(' ')).toBe('One. Two. Three. Four. Five. Six. Count the cookies on one plate.');
    expect(parsed.walkthrough[5]).toBe('Count the cookies on one plate.');
    expect(parsed.teachBack?.options).toHaveLength(3);
    expect(parsed.teachBack?.options.filter((option) => option.correct).map((option) => option.id)).toEqual(['b']);
  });

  it('gives up a teach-back that cannot be used instead of the whole challenge', () => {
    const none = base('choice');
    (none.teachBack as Json).options = [
      { id: 'a', label: 'I guessed.', correct: false },
      { id: 'b', label: 'I counted.', correct: false },
    ];
    expect(accepted(none).teachBack).toBeUndefined();
    const both = base('choice');
    for (const option of (both.teachBack as Json).options as Json[]) option.correct = true;
    expect(accepted(both).teachBack).toBeUndefined();
    const empty = base('choice');
    empty.teachBack = { prompt: '', options: [] };
    expect(accepted(empty).teachBack).toBeUndefined();
  });

  it('drops a unit that does not fit the keypad label and clips a long title at a word', () => {
    const raw = base('number');
    interaction(raw).unit = 'square centimeters';
    raw.title = 'The Extraordinarily Long Adventure of Pilot Juno and the Missing Fuel Cells';
    const parsed = accepted(raw);
    expect(parsed.interaction).not.toHaveProperty('unit');
    // Cut after a whole word, and not after a dangling "and the".
    expect(parsed.title).toBe('The Extraordinarily Long Adventure of Pilot Juno');
  });

  it('cuts an over-long misconception at the end of a sentence, and leaves one without a sentence end to the schema', () => {
    const raw = base('choice');
    const options = interaction(raw).options as Json[];
    const first = 'Three is how many astronauts there are. ';
    options[0]!.misconception = `${first}${'Look at the plates again and count slowly. '.repeat(6)}`;
    const parsed = accepted(raw);
    if (parsed.interaction.kind === 'choice') {
      const text = parsed.interaction.options[0]?.misconception ?? '';
      expect(text.length).toBeLessThanOrEqual(200);
      expect(text.startsWith(first.trim())).toBe(true);
      expect(text.endsWith('.')).toBe(true);
    }
    options[0]!.misconception = 'x'.repeat(230);
    expect(ChallengeSchema.safeParse(relaxChallengeJson(raw)).success).toBe(false);
  });

  it('unwraps a challenge that came inside one outer key', () => {
    expect(accepted({ challenge: base('order') }).title).toBe('Butterfly Time Machine');
    // Not anything with one key: the content must look like a challenge.
    expect(relaxChallengeJson({ challenge: { note: 'no' } })).toEqual({ challenge: { note: 'no' } });
  });

  it('still leaves real mistakes to the schema', () => {
    const raw = base('choice');
    sceneObjects(raw)[4]!.shape = 'trapezoid';
    expect(ChallengeSchema.safeParse(relaxChallengeJson(raw)).success).toBe(false);
    const robot = base('robot');
    (interaction(robot).start as Json).dir = 'sideways';
    expect(ChallengeSchema.safeParse(relaxChallengeJson(robot)).success).toBe(false);
  });
});
