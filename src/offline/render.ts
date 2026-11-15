/**
 * Renderers: turn one knowledge set into a challenge of the wanted interaction kind.
 * Every renderer returns null when the set cannot make a good challenge of that kind
 * at this grade, so the caller can try another set.
 */
import type { Challenge } from '@/core/schemas';
import type { InteractionKind } from '@/core/types';
import { assemble, type InteractionInput, type Parts, type Teach } from './assemble';
import { cap, lead, listOf, say, type Ctx } from './context';
import { cardScene, pictureScene, type Card, type SceneInput } from './scene';
import { numberWords } from './speak';
import type { CatBin, CatSet, Item, KnowledgeSet, Pair, PairSet, QuizSet, SeqSet } from './sets/types';

const KIND_WORD: Record<InteractionKind, string> = {
  sort: 'Sort It',
  tap: 'Find It',
  choice: 'Pick One',
  number: 'Count It',
  match: 'Match Up',
  order: 'In Order',
  robot: 'Robot Run',
  build: 'Build It',
};

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th'] as const;

function titleOf(set: KnowledgeSet, kind: InteractionKind): string {
  const full = `${set.title}: ${KIND_WORD[kind]}`;
  return full.length <= 60 ? full : set.title;
}

/** Fits on a tappable card: a picture, or a label short enough to read at a glance. */
const fitsCard = (it: Item): boolean => it.emoji !== undefined || it.label.length <= 16;

function cardOf(it: Item, id: string, tappable: boolean): Card {
  if (it.emoji && it.wide) return { id, text: it.emoji, label: cap(it.label), wide: true, tappable };
  return it.emoji ? { id, emoji: it.emoji, label: cap(it.label), tappable } : { id, text: cap(it.label), tappable };
}

function labelled(it: Item): { label: string; emoji?: string } {
  return it.emoji ? { label: cap(it.label), emoji: it.emoji } : { label: cap(it.label) };
}

/** A picture for kinds whose answer is given in a widget: the items when they have emoji, else the set's icons. */
function illustrate(set: KnowledgeSet, shown: readonly Item[]): SceneInput {
  const withEmoji = shown.filter((it) => it.emoji !== undefined).slice(0, 8);
  if (withEmoji.length >= 2) return cardScene(set.scene, withEmoji.map((it, index) => cardOf(it, `pic${index + 1}`, false)));
  if (set.icons && set.icons.length > 0) return pictureScene(set.scene, set.icons);
  const short = shown.filter((it) => it.label.length <= 16).slice(0, 6);
  if (short.length >= 2) return cardScene(set.scene, short.map((it, index) => cardOf(it, `pic${index + 1}`, false)));
  return pictureScene(set.scene, ['💡']);
}

function base(ctx: Ctx, set: KnowledgeSet, kind: InteractionKind): Pick<Parts, 'title' | 'explanation' | 'teach' | 'funFact'> {
  void ctx;
  return { title: titleOf(set, kind), explanation: set.explain, teach: set.teach, funFact: set.fun };
}

interface Option {
  label: string;
  emoji?: string | undefined;
  misconception?: string | undefined;
}

/** A single-answer choice interaction with shuffled options. */
function choiceOf(ctx: Ctx, correct: Option, wrong: readonly Option[]): InteractionInput {
  const all = ctx.rng.shuffle([{ ...correct, right: true }, ...wrong.map((w) => ({ ...w, right: false }))]);
  const options = all.map((o, index) => ({
    id: LETTERS[index] as string,
    label: o.label,
    ...(o.emoji ? { emoji: o.emoji } : {}),
    ...(!o.right && o.misconception ? { misconception: o.misconception.slice(0, 200) } : {}),
  }));
  const correctId = LETTERS[all.findIndex((o) => o.right)] as string;
  return { kind: 'choice', multi: false, options, correctIds: [correctId] };
}

function distinctBy<T>(list: readonly T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((entry) => {
    const k = key(entry);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const lookOf = (it: Item): string => `${it.emoji ?? ''}|${it.label.toLowerCase()}`;

// ---------------------------------------------------------------------------
// Category sets
// ---------------------------------------------------------------------------

function catSort(ctx: Ctx, set: CatSet): Challenge | null {
  const usable = set.bins.filter((b) => b.items.length > 0);
  if (usable.length < 2) return null;
  const binCount = Math.min(usable.length, ctx.young ? 2 : ctx.band === 1 ? 3 : 4);
  const chosen = ctx.rng.sample(usable, binCount);
  const bins = set.bins.filter((b) => chosen.includes(b));
  const total = ctx.young ? 4 : ctx.band === 1 ? ctx.rng.int(5, 6) : ctx.rng.int(6, 8);
  const pools = bins.map((b) => ctx.rng.shuffle(b.items));
  const picked: { it: Item; bin: number }[] = [];
  for (let round = 0; picked.length < total; round += 1) {
    let added = false;
    pools.forEach((pool, binIndex) => {
      const it = pool[round];
      if (it && picked.length < total) {
        picked.push({ it, bin: binIndex });
        added = true;
      }
    });
    if (!added) break;
  }
  const unique = distinctBy(picked, (p) => lookOf(p.it));
  if (unique.length < 3 || new Set(unique.map((p) => p.bin)).size < 2) return null;
  const order = ctx.rng.shuffle(unique);
  const first = bins[0] as CatBin;
  const second = bins[1] as CatBin;
  return assemble(ctx, {
    ...base(ctx, set, 'sort'),
    intro: say(lead(ctx), set.intro),
    question: ctx.young ? 'Put each one in the right group.' : 'Sort each one into the right group.',
    interaction: {
      kind: 'sort',
      bins: bins.map((b, index) => ({ id: `bin${index + 1}`, label: b.label, ...(b.emoji ? { emoji: b.emoji } : {}) })),
      items: order.map((p, index) => ({ id: `it${index + 1}`, ...labelled(p.it), binId: `bin${p.bin + 1}` })),
    },
    hints: [set.hint, ctx.young ? first.rule : say(first.rule, second.rule)],
    walkthrough: bins.map((b, index) => {
      const names = order.filter((p) => p.bin === index).map((p) => p.it.label);
      if (names.length === 0) return '';
      return ctx.young
        ? `${cap(listOf(names))} ${names.length > 1 ? 'go' : 'goes'} in ${b.label}.`
        : `${b.label}: ${listOf(names)}. ${b.rule}`;
    }),
    scene: illustrate(set, order.map((p) => p.it)),
  });
}

/**
 * A group that is defined by what its items are not ("a sum that does not make 5"). A Pre-K or
 * Kindergarten child sorts into such a group, but is never asked to find it: "tap the ones that
 * do not ..." asks for the idea and its negation at once.
 */
const negated = (b: CatBin): boolean => /\b(not|never)\b/i.test(b.one);
const askable = (ctx: Ctx, b: CatBin): boolean => !(ctx.young && negated(b));

function catChoice(ctx: Ctx, set: CatSet): Challenge | null {
  const wrongCount = ctx.young ? 2 : 3;
  const targets = set.bins.filter((b) => {
    const others = set.bins.filter((o) => o !== b).reduce((sum, o) => sum + o.items.length, 0);
    return b.items.length > 0 && others >= wrongCount && askable(ctx, b);
  });
  if (targets.length === 0) return null;
  const target = ctx.rng.pick(targets);
  const correct = ctx.rng.pick(target.items);
  const wrongPool = set.bins.filter((b) => b !== target).flatMap((b) => b.items.map((it) => ({ it, own: b })));
  const wrong = distinctBy(ctx.rng.shuffle(wrongPool), (w) => lookOf(w.it))
    .filter((w) => lookOf(w.it) !== lookOf(correct))
    .slice(0, wrongCount);
  if (wrong.length < 2) return null;
  return assemble(ctx, {
    ...base(ctx, set, 'choice'),
    intro: say(lead(ctx), set.intro),
    question: `Which one is ${target.one}?`,
    interaction: choiceOf(
      ctx,
      labelled(correct),
      wrong.map((w) => ({
        ...labelled(w.it),
        misconception: ctx.young ? `${cap(w.it.label)} goes with ${w.own.label}.` : `${cap(w.it.label)} goes in the group "${w.own.label}". ${w.own.rule}`,
      })),
    ),
    hints: [set.hint, target.rule],
    walkthrough: ctx.young
      ? [target.rule, 'Look at each one.', `${cap(correct.label)} is ${target.one}.`]
      : [target.rule, 'Check each choice against that idea.', `${cap(correct.label)} fits, so it is ${target.one}.`],
    scene: illustrate(set, ctx.rng.shuffle([correct, ...wrong.map((w) => w.it)])),
  });
}

/** Picks a target group and a mix of fitting and non-fitting items that all fit on cards. */
function catPickForScene(ctx: Ctx, set: CatSet): { target: CatBin; hits: Item[]; misses: Item[] } | null {
  const bins = set.bins
    .map((b) => ({ b, ok: distinctBy(b.items.filter(fitsCard), lookOf) }))
    .filter((entry) => entry.ok.length > 0);
  const targets = bins.filter((entry) => askable(ctx, entry.b) && bins.filter((o) => o !== entry).reduce((sum, o) => sum + o.ok.length, 0) >= 2);
  if (targets.length === 0) return null;
  const chosen = ctx.rng.pick(targets);
  const hitCount = Math.min(chosen.ok.length, ctx.young ? ctx.rng.int(2, 3) : ctx.rng.int(2, 4));
  const hits = ctx.rng.sample(chosen.ok, hitCount);
  const hitLooks = new Set(hits.map(lookOf));
  const missPool = distinctBy(
    bins.filter((entry) => entry !== chosen).flatMap((entry) => entry.ok),
    lookOf,
  ).filter((it) => !hitLooks.has(lookOf(it)));
  const misses = ctx.rng.sample(missPool, ctx.young ? ctx.rng.int(2, 3) : ctx.rng.int(3, 5));
  if (misses.length < 2) return null;
  return { target: chosen.b, hits, misses };
}

function catTap(ctx: Ctx, set: CatSet): Challenge | null {
  const pick = catPickForScene(ctx, set);
  if (!pick) return null;
  const { target, hits, misses } = pick;
  const cards = ctx.rng.shuffle([...hits.map((it) => ({ it, hit: true })), ...misses.map((it) => ({ it, hit: false }))]);
  const ids = cards.map((_c, index) => `t${index + 1}`);
  const n = hits.length;
  return assemble(ctx, {
    ...base(ctx, set, 'tap'),
    intro: say(lead(ctx), set.intro),
    question: n === 1 ? `Tap the one that is ${target.one}.` : `Tap all the ${target.many}.`,
    interaction: { kind: 'tap', targetIds: ids.filter((_id, index) => cards[index]?.hit === true) },
    hints: [
      set.hint,
      ctx.young ? `Find ${numberWords(n)} of them.` : `${target.rule} There ${n === 1 ? 'is' : 'are'} ${numberWords(n)} to find.`,
    ],
    walkthrough: [
      target.rule,
      ctx.young ? 'Look at each picture.' : 'Check each card against that idea.',
      `Tap ${listOf(hits.map((it) => it.label))}.`,
    ],
    scene: cardScene(set.scene, cards.map((c, index) => cardOf(c.it, ids[index] as string, true))),
  });
}

function catCount(ctx: Ctx, set: CatSet): Challenge | null {
  const pick = catPickForScene(ctx, set);
  if (!pick) return null;
  const { target, hits, misses } = pick;
  const cards = ctx.rng.shuffle([...hits, ...misses]);
  const n = hits.length;
  return assemble(ctx, {
    ...base(ctx, set, 'number'),
    intro: say(lead(ctx), set.intro),
    question: `How many ${target.many} can you see?`,
    interaction: { kind: 'number', answer: n, tolerance: 0 },
    hints: [set.hint, ctx.young ? 'Count only the ones that fit.' : say(target.rule, 'Count only the ones that fit.')],
    walkthrough: ctx.young
      ? [target.rule, `${cap(listOf(hits.map((it) => it.label)))} ${n === 1 ? 'fits' : 'fit'}.`, `That makes ${n}.`]
      : [target.rule, `The ones that fit: ${listOf(hits.map((it) => it.label))}.`, `Count them. That makes ${n}.`],
    scene: cardScene(set.scene, cards.map((it, index) => cardOf(it, `pic${index + 1}`, false))),
  });
}

function catMatch(ctx: Ctx, set: CatSet): Challenge | null {
  const usable = set.bins.filter((b) => b.items.length > 0);
  if (usable.length < 2) return null;
  // With only two groups a match is too thin for older children.
  if (usable.length === 2 && ctx.band >= 2) return null;
  const bins = ctx.rng.sample(usable, Math.min(usable.length, ctx.young ? 3 : 4));
  const chosen = bins.map((b) => ({ b, it: ctx.rng.pick(b.items) }));
  if (new Set(chosen.map((c) => lookOf(c.it))).size !== chosen.length) return null;
  return assemble(ctx, {
    ...base(ctx, set, 'match'),
    intro: say(lead(ctx), set.intro),
    question: ctx.young ? 'Match each one to its group.' : 'Match each one to the group it belongs to.',
    interaction: {
      kind: 'match',
      pairs: chosen.map((c, index) => ({
        id: `p${index + 1}`,
        left: labelled(c.it),
        right: { label: c.b.label, ...(c.b.emoji ? { emoji: c.b.emoji } : {}) },
      })),
    },
    hints: [set.hint, (chosen[0] as { b: CatBin }).b.rule],
    walkthrough: chosen.map((c) => (ctx.young ? `${cap(c.it.label)} goes with ${c.b.label}.` : `${cap(c.it.label)} goes with ${c.b.label}. ${c.b.rule}`)),
    scene: illustrate(set, chosen.map((c) => c.it)),
  });
}

const ODD_TEACH: Teach = [
  'How do you find the odd one out?',
  'Find what most of them share, then spot the one without it.',
  'Pick the biggest one.',
  'Pick the first one you see.',
];

function catOdd(ctx: Ctx, set: CatSet, kind: 'choice' | 'tap'): Challenge | null {
  const need = (b: CatBin): Item[] => distinctBy(kind === 'tap' ? b.items.filter(fitsCard) : b.items, lookOf);
  // "X is not a sum that does not make 3" is no explanation: the three that belong together share a positive idea.
  const majors = set.bins.filter((b) => need(b).length >= 3 && askable(ctx, b));
  if (majors.length === 0) return null;
  const major = ctx.rng.pick(majors);
  const minors = set.bins.filter((b) => b !== major && need(b).length >= 1);
  if (minors.length === 0) return null;
  const minor = ctx.rng.pick(minors);
  const same = ctx.rng.sample(need(major), 3);
  const sameLooks = new Set(same.map(lookOf));
  const oddPool = need(minor).filter((it) => !sameLooks.has(lookOf(it)));
  if (oddPool.length === 0) return null;
  const odd = ctx.rng.pick(oddPool);
  const cards = ctx.rng.shuffle([...same.map((it) => ({ it, odd: false })), { it: odd, odd: true }]);
  const ids = cards.map((_c, index) => `t${index + 1}`);
  const interaction: InteractionInput =
    kind === 'tap'
      ? { kind: 'tap', targetIds: [ids[cards.findIndex((c) => c.odd)] as string] }
      : choiceOf(
          ctx,
          labelled(odd),
          same.map((it) => ({ ...labelled(it), misconception: `${cap(it.label)} is one of the ${major.many}.` })),
        );
  return assemble(ctx, {
    title: `Odd One Out: ${set.title}`.length <= 60 ? `Odd One Out: ${set.title}` : 'Odd One Out',
    intro: ctx.young ? 'One of these is different.' : say(lead(ctx), 'Three of these belong together. One does not.'),
    question: kind === 'tap' ? 'Tap the one that does not belong.' : 'Which one does not belong?',
    interaction,
    hints: ['Look for what three of them share.', ctx.young ? `Three are ${major.many}.` : `Three of them are ${major.many}. ${major.rule}`],
    walkthrough: [
      `${cap(listOf(same.map((it) => it.label)))} are all ${major.many}.`,
      `${cap(odd.label)} is ${minor.one}.`,
      `So ${odd.label} does not belong.`,
    ],
    explanation: ctx.young
      ? negated(minor) ? `${cap(odd.label)} is not ${major.one}.` : `${cap(odd.label)} is ${minor.one}.`
      : `Three of them are ${major.many}. ${cap(odd.label)} is ${minor.one}, so it is the odd one out.`,
    teach: ODD_TEACH,
    funFact: set.fun,
    scene:
      kind === 'tap'
        ? cardScene(set.scene, cards.map((c, index) => cardOf(c.it, ids[index] as string, true)))
        : illustrate(set, cards.map((c) => c.it)),
  });
}

// ---------------------------------------------------------------------------
// Pair sets
// ---------------------------------------------------------------------------

const fill = (template: string, x: string): string => template.replace('{x}', x);

/** Pairs whose left sides and right sides all look different, in random order. */
function distinctPairs(ctx: Ctx, set: PairSet): Pair[] {
  return distinctBy(distinctBy(ctx.rng.shuffle(set.pairs), (p) => lookOf(p.left)), (p) => lookOf(p.right));
}

function pairMatch(ctx: Ctx, set: PairSet): Challenge | null {
  const want = ctx.young ? 3 : ctx.band === 1 ? 4 : 5;
  const chosen = distinctPairs(ctx, set).slice(0, want);
  if (chosen.length < 3) return null;
  return assemble(ctx, {
    ...base(ctx, set, 'match'),
    intro: say(lead(ctx), set.intro),
    question: set.ask,
    interaction: {
      kind: 'match',
      pairs: chosen.map((p, index) => ({ id: `p${index + 1}`, left: labelled(p.left), right: labelled(p.right) })),
    },
    hints: [set.hint, ctx.young ? 'Start with one you know.' : 'Start with a pair you are sure about, then see what is left.'],
    walkthrough: chosen.map((p) => (ctx.young || !p.why ? `${cap(p.left.label)} goes with ${p.right.label}.` : `${cap(p.left.label)} goes with ${p.right.label}. ${p.why}`)),
    scene: illustrate(set, chosen.flatMap((p) => [p.left, p.right])),
  });
}

function pairPick(ctx: Ctx, set: PairSet, needCards: boolean): { asked: Pair; wrong: Pair[] } | null {
  const pool = distinctPairs(ctx, set).filter((p) => !needCards || (ctx.young ? p.right.emoji !== undefined : fitsCard(p.right)));
  const wrongCount = ctx.young ? 2 : 3;
  if (pool.length < 3) return null;
  const [asked, ...rest] = pool;
  if (!asked) return null;
  return { asked, wrong: rest.slice(0, wrongCount) };
}

function pairSteps(ctx: Ctx, asked: Pair): string[] {
  const link = `${cap(asked.left.label)} goes with ${asked.right.label}.`;
  if (asked.why && !ctx.young) return [asked.why, `So the answer is ${asked.right.label}.`];
  return [`Look for what goes with ${asked.left.label}.`, link];
}

function pairChoice(ctx: Ctx, set: PairSet): Challenge | null {
  const pick = pairPick(ctx, set, false);
  if (!pick) return null;
  const { asked, wrong } = pick;
  return assemble(ctx, {
    ...base(ctx, set, 'choice'),
    intro: say(lead(ctx), set.intro),
    question: fill(set.q, asked.left.label),
    interaction: choiceOf(
      ctx,
      labelled(asked.right),
      wrong.map((w) => ({ ...labelled(w.right), misconception: `${cap(w.right.label)} goes with ${w.left.label}.` })),
    ),
    hints: [set.hint, ctx.young ? `It is not "${(wrong[0] as Pair).right.label}".` : `One wrong answer is "${(wrong[0] as Pair).right.label}". Cross it out and look at the rest.`],
    walkthrough: pairSteps(ctx, asked),
    scene: illustrate(set, asked.left.emoji ? [asked.left, ...ctx.rng.shuffle([asked.right, ...wrong.map((w) => w.right)])] : ctx.rng.shuffle([asked.right, ...wrong.map((w) => w.right)])),
  });
}

function pairTap(ctx: Ctx, set: PairSet): Challenge | null {
  const pick = pairPick(ctx, set, true);
  if (!pick) return null;
  const { asked, wrong } = pick;
  const cards = ctx.rng.shuffle([{ p: asked, hit: true }, ...wrong.map((p) => ({ p, hit: false }))]);
  const ids = cards.map((_c, index) => `t${index + 1}`);
  return assemble(ctx, {
    ...base(ctx, set, 'tap'),
    intro: say(lead(ctx), set.intro),
    question: fill(set.tapQ, asked.left.label),
    interaction: { kind: 'tap', targetIds: [ids[cards.findIndex((c) => c.hit)] as string] },
    hints: [set.hint, ctx.young ? `It is not "${(wrong[0] as Pair).right.label}".` : `One wrong answer is "${(wrong[0] as Pair).right.label}". Cross it out and look at the rest.`],
    walkthrough: pairSteps(ctx, asked),
    scene: cardScene(set.scene, cards.map((c, index) => cardOf(c.p.right, ids[index] as string, true))),
  });
}

function pairAnalogy(ctx: Ctx, set: PairSet): Challenge | null {
  if (!set.link) return null;
  const pool = distinctPairs(ctx, set);
  if (pool.length < 4) return null;
  const [model, asked, ...rest] = pool;
  if (!model || !asked) return null;
  const wrong = rest.slice(0, ctx.young ? 2 : 3);
  const modelLine = `${cap(model.left.label)} goes with ${model.right.label}.`;
  return assemble(ctx, {
    title: `${set.title}: Same Link`.length <= 60 ? `${set.title}: Same Link` : set.title,
    intro: ctx.young ? modelLine : say(lead(ctx), modelLine),
    question: ctx.young ? `What goes with ${asked.left.label}?` : `In the same way, what goes with ${asked.left.label}?`,
    interaction: choiceOf(
      ctx,
      labelled(asked.right),
      wrong.map((w) => ({ ...labelled(w.right), misconception: `${cap(w.right.label)} goes with ${w.left.label}.` })),
    ),
    hints: [`How are ${model.left.label} and ${model.right.label} linked?`, `The link is ${set.link}.`],
    walkthrough: [
      `${cap(model.left.label)} and ${model.right.label} are ${set.link}.`,
      `Find the same link for ${asked.left.label}.`,
      `${cap(asked.left.label)} goes with ${asked.right.label}.`,
    ],
    explanation: ctx.young
      ? `${cap(asked.left.label)} goes with ${asked.right.label}.`
      : `Both pairs share one link: ${set.link}. So ${asked.left.label} goes with ${asked.right.label}.`,
    teach: ['How do you solve a puzzle like this?', 'Find the link in the first pair and use it again.', 'Pick the longest word.', 'Pick any two things that look alike.'],
    funFact: set.fun,
    scene: illustrate(set, [model.left, model.right, asked.left]),
  });
}

// ---------------------------------------------------------------------------
// Sequence sets
// ---------------------------------------------------------------------------

function windowOf(ctx: Ctx, set: SeqSet, atLeast = 3): Item[] {
  const byGrade = ctx.g === 0 ? 3 : ctx.g === 1 ? ctx.rng.int(3, 4) : ctx.band === 1 ? 4 : ctx.band === 2 ? 5 : ctx.rng.int(6, 7);
  const want = Math.max(atLeast, byGrade);
  const n = set.whole ? set.items.length : Math.min(set.items.length, want, 7);
  const start = set.whole ? 0 : ctx.rng.int(0, set.items.length - n);
  return set.items.slice(start, start + n);
}

const byTime = (set: SeqSet): boolean => set.rel === undefined;

/** "smallest" -> "the smallest one"; "closest to the Sun" -> "the one that is closest to the Sun". */
function endPhrase(word: string): string {
  if (word.startsWith('one ')) return `the ${word}`;
  return word.includes(' ') ? `the one that is ${word}` : `the ${word} one`;
}
const withArticle = (set: SeqSet, label: string): string => {
  const article = set.article ?? 'the';
  if (article === '') return label;
  // "an hour", "an ant", but "a unit".
  const an = article === 'a' && (/^(?:[aeio]|hour|honest|u(?![ns]i|se))/i.test(label));
  return `${an ? 'an' : article} ${label}`;
};

function seqOrder(ctx: Ctx, set: SeqSet): Challenge | null {
  const win = windowOf(ctx, set);
  if (win.length < 3) return null;
  const [start, end] = set.ends;
  const steps = win.map((it, index) => {
    if (index === 0) return `${cap(start)}: ${it.label}.`;
    if (index === win.length - 1) return `${cap(end)}: ${it.label}.`;
    return `Then: ${it.label}.`;
  });
  const findEnds = byTime(set)
    ? ctx.young
      ? `Find what comes ${start}.`
      : `Find what comes ${start} and what comes ${end}. Then fill in the middle.`
    : ctx.young
      ? `Find ${endPhrase(start)}.`
      : `Find ${endPhrase(start)} and ${endPhrase(end)}. Then fill in the middle.`;
  return assemble(ctx, {
    ...base(ctx, set, 'order'),
    intro: say(lead(ctx), set.intro),
    question: set.ask,
    interaction: {
      kind: 'order',
      items: win.map((it, index) => ({ id: `o${index + 1}`, ...labelled(it) })),
      startLabel: start,
      endLabel: end,
    },
    hints: [set.hint, findEnds],
    walkthrough: steps,
    scene: illustrate(set, ctx.rng.shuffle(win)),
  });
}

function seqChoice(ctx: Ctx, set: SeqSet): Challenge | null {
  const win = windowOf(ctx, set, 4);
  if (win.length < 3) return null;
  const wrongCount = ctx.young ? 2 : 3;
  if (byTime(set)) {
    const at = ctx.rng.int(0, win.length - 2);
    const asked = win[at] as Item;
    const correct = win[at + 1] as Item;
    const wrong = ctx.rng
      .shuffle(win.map((it, index) => ({ it, index })).filter((w) => w.index !== at && w.index !== at + 1))
      .slice(0, wrongCount);
    if (wrong.length < 1) return null;
    return assemble(ctx, {
      ...base(ctx, set, 'choice'),
      intro: say(lead(ctx), set.intro),
      question: `What comes right after "${asked.label}"?`,
      interaction: choiceOf(
        ctx,
        labelled(correct),
        wrong.map((w) => ({
          ...labelled(w.it),
          misconception: w.index < at ? `${cap(w.it.label)} comes before, not after.` : `${cap(w.it.label)} comes later.`,
        })),
      ),
      hints: [set.hint, `It is not "${(wrong[0] as { it: Item }).it.label}".`],
      walkthrough: [`Think of the whole order: ${win.map((it) => it.label).join(', ')}.`, `Right after "${asked.label}" comes "${correct.label}".`],
      scene: illustrate(set, ctx.rng.shuffle(win)),
    });
  }
  // Orders by size or amount: ask for one end of a few items.
  const useStart = ctx.rng.chance(0.5);
  const shown = ctx.rng.sample(win.map((it, index) => ({ it, index })), wrongCount + 1).sort((a, b) => a.index - b.index);
  if (shown.length < 3) return null;
  const correct = (useStart ? shown[0] : shown[shown.length - 1]) as { it: Item; index: number };
  const wrong = shown.filter((s) => s !== correct);
  const endWord = useStart ? set.ends[0] : set.ends[1];
  return assemble(ctx, {
    ...base(ctx, set, 'choice'),
    intro: say(lead(ctx), set.intro),
    question: `Which of these is ${endPhrase(endWord)}?`,
    interaction: choiceOf(
      ctx,
      labelled(correct.it),
      wrong.map((w) => ({
        ...labelled(w.it),
        misconception: `${cap(withArticle(set, correct.it.label))} is ${useStart ? set.rel?.[0] : set.rel?.[1]} ${withArticle(set, w.it.label)}.`,
      })),
    ),
    hints: [set.hint, `It is not ${withArticle(set, (ctx.rng.pick(wrong)).it.label)}.`],
    walkthrough: [
      `Put them in order: ${shown.map((s) => s.it.label).join(', ')}.`,
      `So ${endPhrase(endWord)} is ${withArticle(set, correct.it.label)}.`,
    ],
    scene: illustrate(set, ctx.rng.shuffle(shown.map((s) => s.it))),
  });
}

function seqTap(ctx: Ctx, set: SeqSet): Challenge | null {
  const win = windowOf(ctx, set).filter(fitsCard);
  if (win.length < 3 || (ctx.young && win.some((it) => it.emoji === undefined))) return null;
  const useStart = ctx.rng.chance(0.5);
  const target = (useStart ? win[0] : win[win.length - 1]) as Item;
  const endWord = useStart ? set.ends[0] : set.ends[1];
  const cards = ctx.rng.shuffle(win);
  const ids = cards.map((_c, index) => `t${index + 1}`);
  const others = win.filter((it) => it !== target);
  return assemble(ctx, {
    ...base(ctx, set, 'tap'),
    intro: say(lead(ctx), set.intro),
    question: byTime(set) ? `Tap what comes ${endWord}.` : `Tap ${endPhrase(endWord)}.`,
    interaction: { kind: 'tap', targetIds: [ids[cards.indexOf(target)] as string] },
    hints: [set.hint, `It is not ${byTime(set) ? `"${ctx.rng.pick(others).label}"` : withArticle(set, ctx.rng.pick(others).label)}.`],
    walkthrough: [
      `Think of the whole order: ${win.map((it) => it.label).join(', ')}.`,
      byTime(set) ? `"${cap(target.label)}" comes ${endWord}.` : `${cap(withArticle(set, target.label))} is ${endPhrase(endWord)}.`,
    ],
    scene: cardScene(set.scene, cards.map((it, index) => cardOf(it, ids[index] as string, true))),
  });
}

function seqSort(ctx: Ctx, set: SeqSet): Challenge | null {
  const win = windowOf(ctx, set, 5);
  if (win.length < 4) return null;
  const pivotAt = ctx.rng.int(1, win.length - 2);
  const pivot = win[pivotAt] as Item;
  const before = win.slice(0, pivotAt);
  const after = win.slice(pivotAt + 1);
  const labels: [string, string] = byTime(set)
    ? [`Before "${pivot.label}"`, `After "${pivot.label}"`]
    : [`${cap(set.rel?.[0] ?? 'before')} ${withArticle(set, pivot.label)}`, `${cap(set.rel?.[1] ?? 'after')} ${withArticle(set, pivot.label)}`];
  if (labels.some((l) => l.length > 80)) return null;
  const itemsOut = ctx.rng.shuffle([...before.map((it) => ({ it, bin: 'bin1' })), ...after.map((it) => ({ it, bin: 'bin2' }))]);
  return assemble(ctx, {
    ...base(ctx, set, 'sort'),
    intro: say(lead(ctx), set.intro),
    question: ctx.young ? 'Put each one in the right group.' : byTime(set) ? `Sort each one: does it come before or after "${pivot.label}"?` : 'Sort each one into the right group.',
    interaction: {
      kind: 'sort',
      bins: [
        { id: 'bin1', label: labels[0] },
        { id: 'bin2', label: labels[1] },
      ],
      items: itemsOut.map((entry, index) => ({ id: `it${index + 1}`, ...labelled(entry.it), binId: entry.bin })),
    },
    hints: [set.hint, 'Think of the whole order first.'],
    walkthrough: [
      `The order is: ${win.map((it) => it.label).join(', ')}.`,
      `${labels[0]}: ${listOf(before.map((it) => it.label))}.`,
      `${labels[1]}: ${listOf(after.map((it) => it.label))}.`,
    ],
    scene: illustrate(set, ctx.rng.shuffle(win)),
  });
}

function seqMatch(ctx: Ctx, set: SeqSet): Challenge | null {
  const win = windowOf(ctx, set).slice(0, 5);
  if (win.length < 3) return null;
  const [start, end] = set.ends;
  return assemble(ctx, {
    ...base(ctx, set, 'match'),
    intro: say(lead(ctx), set.intro),
    question: ctx.young ? 'Match each one to its place.' : `Match each one to its place in the order. 1st is ${byTime(set) ? `the ${start}` : endPhrase(start)} and ${PLACES[win.length - 1] as string} is ${byTime(set) ? `the ${end}` : endPhrase(end)}.`,
    interaction: {
      kind: 'match',
      pairs: win.map((it, index) => ({ id: `p${index + 1}`, left: labelled(it), right: { label: PLACES[index] as string } })),
    },
    hints: [set.hint, byTime(set) ? `Find what comes ${start}.` : `Find ${endPhrase(start)}.`],
    walkthrough: win.map((it, index) => `${cap(it.label)} is ${PLACES[index] as string}.`),
    scene: illustrate(set, ctx.rng.shuffle(win)),
  });
}

function seqCount(ctx: Ctx, set: SeqSet): Challenge | null {
  if (ctx.young || set.items.length > 6 || set.items.length < 3) return null;
  const all = set.items;
  const at = ctx.rng.int(1, all.length - 1);
  const asked = all[at] as Item;
  const [start] = set.ends;
  return assemble(ctx, {
    ...base(ctx, set, 'number'),
    intro: say(lead(ctx), set.intro),
    question: byTime(set)
      ? `Put these in order in your head: ${ctx.rng.shuffle(all).map((it) => it.label).join(', ')}. Counting from the first, what number is "${asked.label}"?`
      : `Put these in order in your head: ${ctx.rng.shuffle(all).map((it) => it.label).join(', ')}. Counting from the ${start}, what number is ${withArticle(set, asked.label)}?`,
    interaction: { kind: 'number', answer: at + 1, tolerance: 0 },
    hints: [set.hint, 'Put them all in order first. Then count along.'],
    walkthrough: [`The order is: ${all.map((it) => it.label).join(', ')}.`, `Count along. "${cap(asked.label)}" is number ${at + 1}.`],
    scene: illustrate(set, ctx.rng.shuffle(all)),
  });
}

// ---------------------------------------------------------------------------
// Quiz sets
// ---------------------------------------------------------------------------

function quizChoice(ctx: Ctx, set: QuizSet): Challenge | null {
  const wrong = ctx.rng.shuffle(set.wrong).slice(0, 3);
  if (wrong.length < 2) return null;
  return assemble(ctx, {
    title: set.title,
    intro: say(lead(ctx), set.intro),
    question: set.q,
    interaction: choiceOf(
      ctx,
      { label: set.right.label, emoji: set.right.emoji },
      wrong.map((w) => ({ label: w.label, emoji: w.emoji, misconception: w.why })),
    ),
    hints: [set.hint, set.hint2],
    walkthrough: set.steps,
    explanation: set.explain,
    teach: set.teach,
    funFact: set.fun,
    scene: pictureScene(set.scene, set.icons ?? ['💡']),
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface Variant {
  /** Relative chance of being tried first. */
  weight: number;
  make: (ctx: Ctx) => Challenge | null;
  /** True when the content belongs to the mode's framing, not to the plan's skill (a fix-the-bot item for a math skill). */
  borrowed?: boolean;
}

/** The ways one set can become a challenge of the given kind. */
export function variantsOf(set: KnowledgeSet, kind: InteractionKind): Variant[] {
  switch (set.type) {
    case 'cat':
      switch (kind) {
        case 'sort':
          return [{ weight: 4, make: (ctx) => catSort(ctx, set) }];
        case 'choice':
          return [
            { weight: 3, make: (ctx) => catChoice(ctx, set) },
            { weight: 1, make: (ctx) => catOdd(ctx, set, 'choice') },
          ];
        case 'tap':
          return [
            { weight: 3, make: (ctx) => catTap(ctx, set) },
            { weight: 1, make: (ctx) => catOdd(ctx, set, 'tap') },
          ];
        case 'number':
          return [{ weight: 2, make: (ctx) => catCount(ctx, set) }];
        case 'match':
          return [{ weight: 1, make: (ctx) => catMatch(ctx, set) }];
        default:
          return [];
      }
    case 'pair':
      switch (kind) {
        case 'match':
          return [{ weight: 4, make: (ctx) => pairMatch(ctx, set) }];
        case 'choice':
          return [
            { weight: 3, make: (ctx) => pairChoice(ctx, set) },
            { weight: 1, make: (ctx) => pairAnalogy(ctx, set) },
          ];
        case 'tap':
          return [{ weight: 2, make: (ctx) => pairTap(ctx, set) }];
        default:
          return [];
      }
    case 'seq':
      switch (kind) {
        case 'order':
          return [{ weight: 4, make: (ctx) => seqOrder(ctx, set) }];
        case 'choice':
          return [{ weight: 2, make: (ctx) => seqChoice(ctx, set) }];
        case 'tap':
          return [{ weight: 1, make: (ctx) => seqTap(ctx, set) }];
        case 'sort':
          return [{ weight: 1, make: (ctx) => seqSort(ctx, set) }];
        case 'match':
          return [{ weight: 1, make: (ctx) => seqMatch(ctx, set) }];
        case 'number':
          return [{ weight: 1, make: (ctx) => seqCount(ctx, set) }];
        default:
          return [];
      }
    case 'quiz':
      return kind === 'choice' ? [{ weight: 3, make: (ctx) => quizChoice(ctx, set) }] : [];
  }
}

/** Renderers that suit the odd-one-out and analogy skill especially well. */
export function reasoningVariants(set: KnowledgeSet, kind: InteractionKind): Variant[] {
  if (set.type === 'cat' && (kind === 'choice' || kind === 'tap')) return [{ weight: 6, make: (ctx) => catOdd(ctx, set, kind) }];
  if (set.type === 'pair' && kind === 'choice') return [{ weight: 6, make: (ctx) => pairAnalogy(ctx, set) }];
  return [];
}
