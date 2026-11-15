/**
 * Translations for every text the challenge engine shows or reads to a screen reader.
 *
 * The engine (`@/engine`) depends on core only and therefore cannot call `t()` itself: it
 * takes its texts through the `labels` prop of `ChallengeStage`. This file holds those texts
 * in every language, under the keys `engine.<label>`, and `stageLabels()` hands them over in
 * the shape the prop expects:
 *
 *   const labels = useStageLabels();
 *   <ChallengeStage labels={labels} ... />
 *
 * The `{n}`, `{max}`, `{item}`, `{bin}`, `{total}` and `{goal}` placeholders are filled in by
 * the engine and must stay in every translation (a test checks this, and that the keys match
 * the engine's `StageLabels` exactly).
 */
import { useMemo } from 'react';
import { registerStrings, t, useT } from './core';

export const STAGE_LABEL_KEYS = [
  'check',
  'clear',
  'run',
  'stop',
  'pickOne',
  'pickMany',
  'tapHint',
  'selected',
  'sortHint',
  'sortTray',
  'sortPicked',
  'putIn',
  'takeOut',
  'matchHint',
  'matchLeft',
  'matchRight',
  'matched',
  'orderHint',
  'moveEarlier',
  'moveLater',
  'position',
  'yourAnswer',
  'backspace',
  'decimalPoint',
  'minus',
  'robotBoard',
  'palette',
  'program',
  'blocksUsed',
  'forward',
  'turnLeft',
  'turnRight',
  'repeat',
  'times',
  'more',
  'fewer',
  'addHere',
  'addToEnd',
  'remove',
  'drag',
  'emptyProgram',
  'robotCrash',
  'robotShort',
  'robotGems',
  'robotDone',
  'gems',
  'buildGoal',
  'needMore',
  'enough',
  'overBudget',
  'withinBudget',
  'picked',
] as const;

export type StageLabelKey = (typeof STAGE_LABEL_KEYS)[number];
/** Structurally the same as `StageLabels` in `@/engine`. */
export type StageLabelStrings = Record<StageLabelKey, string>;

const en: StageLabelStrings = {
  check: 'Check',
  clear: 'Clear',
  run: 'Run',
  stop: 'Stop',
  pickOne: 'Pick one.',
  pickMany: 'Pick all that fit.',
  tapHint: 'Tap the picture to choose.',
  selected: '{n} selected',
  sortHint: 'Drag each card into its box. Or tap a card, then tap a box.',
  sortTray: 'Cards to sort',
  sortPicked: 'Holding {item}. Now choose a box.',
  putIn: 'Put in {bin}',
  takeOut: 'Back to the cards',
  matchHint: 'Tap one on the left, then its partner on the right.',
  matchLeft: 'Left side',
  matchRight: 'Right side',
  matched: 'matched with {item}',
  orderHint: 'Drag the cards or tap the arrows to put them in order.',
  moveEarlier: 'Move {item} earlier',
  moveLater: 'Move {item} later',
  position: 'Position {n} of {total}',
  yourAnswer: 'Your answer',
  backspace: 'Delete',
  decimalPoint: 'Decimal point',
  minus: 'Minus',
  robotBoard: 'Robot map',
  palette: 'Blocks',
  program: 'Your program',
  blocksUsed: '{n} of {max} blocks',
  forward: 'Forward',
  turnLeft: 'Turn left',
  turnRight: 'Turn right',
  repeat: 'Repeat',
  times: 'times',
  more: 'More times',
  fewer: 'Fewer times',
  addHere: 'Add blocks here',
  addToEnd: 'Add blocks to the end',
  remove: 'Remove {item}',
  drag: 'Drag to move {item}',
  emptyProgram: 'Tap a block to start your program.',
  robotCrash: 'Bonk! The robot bumped into something. Change your blocks and try again.',
  robotShort: 'Not there yet. Where should the robot go next?',
  robotGems: 'So close! There are still gems to collect.',
  robotDone: 'The robot made it! Press Check.',
  gems: 'Gems: {n} of {total}',
  buildGoal: 'Goal: {goal}',
  needMore: 'Need {n} more',
  enough: 'Enough!',
  overBudget: '{n} too many',
  withinBudget: '{n} left',
  picked: 'picked',
};

const es: StageLabelStrings = {
  check: 'Comprobar',
  clear: 'Borrar todo',
  run: 'Ejecutar',
  stop: 'Parar',
  pickOne: 'Elige una.',
  pickMany: 'Elige todas las que sirvan.',
  tapHint: 'Toca el dibujo para elegir.',
  selected: '{n} elegidos',
  sortHint: 'Arrastra cada tarjeta a su caja. O toca una tarjeta y luego una caja.',
  sortTray: 'Tarjetas para clasificar',
  sortPicked: 'Tienes {item}. Ahora elige una caja.',
  putIn: 'Poner en {bin}',
  takeOut: 'Volver a las tarjetas',
  matchHint: 'Toca una de la izquierda y luego su pareja de la derecha.',
  matchLeft: 'Lado izquierdo',
  matchRight: 'Lado derecho',
  matched: 'unido con {item}',
  orderHint: 'Arrastra las tarjetas o toca las flechas para ponerlas en orden.',
  moveEarlier: 'Mover {item} antes',
  moveLater: 'Mover {item} después',
  position: 'Posición {n} de {total}',
  yourAnswer: 'Tu respuesta',
  backspace: 'Borrar el último',
  decimalPoint: 'Punto decimal',
  minus: 'Menos',
  robotBoard: 'Mapa del robot',
  palette: 'Bloques',
  program: 'Tu programa',
  blocksUsed: '{n} de {max} bloques',
  forward: 'Avanzar',
  turnLeft: 'Girar a la izquierda',
  turnRight: 'Girar a la derecha',
  repeat: 'Repetir',
  times: 'veces',
  more: 'Más veces',
  fewer: 'Menos veces',
  addHere: 'Añadir bloques aquí',
  addToEnd: 'Añadir bloques al final',
  remove: 'Quitar {item}',
  drag: 'Arrastra para mover {item}',
  emptyProgram: 'Toca un bloque para empezar tu programa.',
  robotCrash: '¡Pum! El robot chocó con algo. Cambia tus bloques e inténtalo otra vez.',
  robotShort: 'Todavía no llega. ¿Adónde debe ir el robot ahora?',
  robotGems: '¡Casi! Todavía quedan gemas por recoger.',
  robotDone: '¡El robot llegó! Pulsa Comprobar.',
  gems: 'Gemas: {n} de {total}',
  buildGoal: 'Meta: {goal}',
  needMore: 'Faltan {n}',
  enough: '¡Suficiente!',
  overBudget: 'Sobran {n}',
  withinBudget: 'Quedan {n}',
  picked: 'elegido',
};

const hi: StageLabelStrings = {
  check: 'जाँचो',
  clear: 'सब मिटाओ',
  run: 'चलाओ',
  stop: 'रोको',
  pickOne: 'एक चुनो।',
  pickMany: 'जो-जो सही हों, सब चुनो।',
  tapHint: 'चुनने के लिए चित्र पर टैप करो।',
  selected: '{n} चुने गए',
  sortHint: 'हर कार्ड को उसके डिब्बे में खींचो। या कार्ड पर टैप करो, फिर डिब्बे पर।',
  sortTray: 'छाँटने वाले कार्ड',
  sortPicked: '{item} हाथ में है। अब एक डिब्बा चुनो।',
  putIn: '{bin} में रखो',
  takeOut: 'वापस कार्डों में',
  matchHint: 'बाईं ओर एक पर टैप करो, फिर दाईं ओर उसके जोड़ीदार पर।',
  matchLeft: 'बाईं ओर',
  matchRight: 'दाईं ओर',
  matched: '{item} से जोड़ा गया',
  orderHint: 'कार्डों को खींचो या तीरों पर टैप करके उन्हें क्रम में लगाओ।',
  moveEarlier: '{item} को पहले ले जाओ',
  moveLater: '{item} को बाद में ले जाओ',
  position: 'स्थान {n}, कुल {total}',
  yourAnswer: 'तुम्हारा उत्तर',
  backspace: 'पिछला मिटाओ',
  decimalPoint: 'दशमलव बिंदु',
  minus: 'ऋण चिह्न',
  robotBoard: 'रोबोट का नक्शा',
  palette: 'ब्लॉक',
  program: 'तुम्हारा प्रोग्राम',
  blocksUsed: '{max} में से {n} ब्लॉक',
  forward: 'आगे',
  turnLeft: 'बाएँ मुड़ो',
  turnRight: 'दाएँ मुड़ो',
  repeat: 'दोहराओ',
  times: 'बार',
  more: 'ज़्यादा बार',
  fewer: 'कम बार',
  addHere: 'यहाँ ब्लॉक जोड़ो',
  addToEnd: 'अंत में ब्लॉक जोड़ो',
  remove: '{item} हटाओ',
  drag: '{item} को हिलाने के लिए खींचो',
  emptyProgram: 'अपना प्रोग्राम शुरू करने के लिए किसी ब्लॉक पर टैप करो।',
  robotCrash: 'धड़ाम! रोबोट किसी चीज़ से टकरा गया। अपने ब्लॉक बदलो और फिर कोशिश करो।',
  robotShort: 'अभी नहीं पहुँचा। रोबोट को अब कहाँ जाना चाहिए?',
  robotGems: 'बस थोड़ा और! अभी कुछ रत्न बाकी हैं।',
  robotDone: 'रोबोट पहुँच गया! जाँचो दबाओ।',
  gems: 'रत्न: {total} में से {n}',
  buildGoal: 'लक्ष्य: {goal}',
  needMore: '{n} और चाहिए',
  enough: 'काफ़ी है!',
  overBudget: '{n} ज़्यादा',
  withinBudget: '{n} बचे',
  picked: 'चुना गया',
};

const prefixed = (labels: StageLabelStrings): Record<string, string> =>
  Object.fromEntries(STAGE_LABEL_KEYS.map((key) => [`engine.${key}`, labels[key]]));

/** The engine texts in every language, keyed `engine.<label>`. */
export const STAGE_LABEL_STRINGS = { en: prefixed(en), es: prefixed(es), hi: prefixed(hi) };

registerStrings(STAGE_LABEL_STRINGS);

/**
 * The engine's texts in the active language, for the `labels` prop of `ChallengeStage`.
 * Placeholders such as `{n}` are left in place for the engine to fill.
 */
export function stageLabels(): StageLabelStrings {
  return Object.fromEntries(STAGE_LABEL_KEYS.map((key) => [key, t(`engine.${key}`)])) as StageLabelStrings;
}

/** `stageLabels()` for React components: a stable object that changes only with the language. */
export function useStageLabels(): StageLabelStrings {
  const translate = useT();
  // `translate` gets a new identity when the language changes or strings are registered,
  // which is exactly when the labels have to be read again.
  return useMemo(() => stageLabels(), [translate]);
}
