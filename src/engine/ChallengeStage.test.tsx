import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Challenge } from '@/core/schemas';
import { ChallengeStage } from './ChallengeStage';
import { EngineGallery } from './EngineGallery';
import { BUILD, CHOICE, makeChallenge, MATCH, NUMBER, ORDER, ROBOT, SORT, TAP, TAP_SCENE } from './testing/fixtures';
import type { Answer, CheckResult } from './types';

type Submit = (answer: Answer, result: CheckResult) => void;

beforeEach(() => {
  // jsdom has no canvas; the stage must work without one.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(challenge: Challenge, extra: Partial<React.ComponentProps<typeof ChallengeStage>> = {}) {
  const onSubmit = vi.fn<Submit>();
  const user = userEvent.setup();
  const view = render(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion {...extra} />);
  const check = (): HTMLElement => screen.getByRole('button', { name: /check/i });
  return { onSubmit, user, check, ...view };
}

describe('ChallengeStage: choice', () => {
  it('enables Check only once an option is picked, and submits a correct answer', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(CHOICE));
    expect(check()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Four/ }));
    expect(check()).toBeEnabled();
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(['b'], { correct: true, misconception: null, progress: 1 });
  });

  it('reports the misconception of a wrong pick and keeps the pick afterwards', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(CHOICE));
    await user.click(screen.getByRole('button', { name: /Three/ }));
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(['a'], { correct: false, misconception: 'You missed one.', progress: 0 });
    expect(screen.getByRole('button', { name: /Three/ })).toHaveAttribute('aria-pressed', 'true');
    expect(check()).toBeEnabled();
    expect(screen.queryByText(/[✗✘❌]/)).toBeNull(); // never a cross
    // Single choice: picking another option replaces the first.
    await user.click(screen.getByRole('button', { name: /Four/ }));
    expect(screen.getByRole('button', { name: /Three/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith(['b'], expect.objectContaining({ correct: true }));
  });

  it('supports multi-select and the keyboard', async () => {
    const { onSubmit, user } = setup(makeChallenge({ ...CHOICE, multi: true, correctIds: ['a', 'c'] }));
    screen.getByRole('button', { name: /Three/ }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: /Five/ }).focus();
    await user.keyboard(' ');
    screen.getByRole('button', { name: /check/i }).focus();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith(['a', 'c'], expect.objectContaining({ correct: true }));
  });

  it('clears the answer when resetKey changes, and only then', async () => {
    const challenge = makeChallenge(CHOICE);
    const { user, check, rerender, onSubmit } = setup(challenge);
    await user.click(screen.getByRole('button', { name: /Three/ }));
    rerender(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion highlightIds={['a']} />);
    expect(screen.getByRole('button', { name: /Three/ })).toHaveAttribute('aria-pressed', 'true');
    rerender(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion resetKey={1} />);
    expect(screen.getByRole('button', { name: /Three/ })).toHaveAttribute('aria-pressed', 'false');
    expect(check()).toBeDisabled();
  });

  it('starts fresh when the challenge changes', async () => {
    const { user, rerender, onSubmit, check } = setup(makeChallenge(CHOICE));
    await user.click(screen.getByRole('button', { name: /Four/ }));
    rerender(<ChallengeStage challenge={makeChallenge(NUMBER)} onSubmit={onSubmit} reducedMotion />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(check()).toBeDisabled();
  });

  it('does nothing while disabled', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(CHOICE), { disabled: true });
    await user.click(screen.getByRole('button', { name: /Four/ }));
    expect(screen.getByRole('button', { name: /Four/ })).toHaveAttribute('aria-pressed', 'false');
    expect(check()).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('uses the given labels', () => {
    setup(makeChallenge(CHOICE), { labels: { check: 'Comprobar' } });
    expect(screen.getByRole('button', { name: /Comprobar/ })).toBeInTheDocument();
  });
});

describe('ChallengeStage: number', () => {
  it('types on the keypad and submits a number', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(NUMBER));
    expect(check()).toBeDisabled();
    expect(screen.getByText('apples')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '1' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByRole('textbox')).toHaveValue('12');
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(12, { correct: true, misconception: null, progress: 1 });
  });

  it('accepts a hardware keyboard without focusing anything', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(NUMBER));
    await user.keyboard('1x3{Backspace}5');
    expect(screen.getByRole('textbox')).toHaveValue('15');
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(15, { correct: false, misconception: null, progress: 0 });
    expect(screen.getByRole('textbox')).toHaveValue('15'); // the wrong try stays to be fixed
  });

  it('accepts typing in the answer field and Enter to check', async () => {
    const { onSubmit, user } = setup(makeChallenge(NUMBER));
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('1a2{Enter}');
    expect(screen.getByRole('textbox')).toHaveValue('12');
    expect(onSubmit).toHaveBeenCalledWith(12, expect.objectContaining({ correct: true }));
  });

  it('offers decimal and minus keys only when allowed', async () => {
    const { user, onSubmit, check, unmount } = setup(makeChallenge(NUMBER));
    expect(screen.queryByRole('button', { name: 'Decimal point' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Minus' })).toBeNull();
    await user.keyboard('-.');
    expect(screen.getByRole('textbox')).toHaveValue('');
    unmount();

    const second = setup(makeChallenge({ kind: 'number', answer: -2.5, allowDecimal: true, allowNegative: true }));
    await second.user.click(screen.getByRole('button', { name: '2' }));
    await second.user.click(screen.getByRole('button', { name: 'Decimal point' }));
    await second.user.click(screen.getByRole('button', { name: '5' }));
    await second.user.click(screen.getByRole('button', { name: 'Minus' }));
    expect(screen.getByRole('textbox')).toHaveValue('-2.5');
    await second.user.click(second.check());
    expect(second.onSubmit).toHaveBeenCalledWith(-2.5, expect.objectContaining({ correct: true }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(check).toBeDefined();
  });
});

describe('ChallengeStage: number keypad layout', () => {
  it('lays every key out as a cell of the keypad grid, also the decimal point of a negative decimal', () => {
    setup(makeChallenge({ kind: 'number', answer: -2.5, allowDecimal: true, allowNegative: true }));
    const point = screen.getByRole('button', { name: 'Decimal point' });
    const keypad = screen.getByRole('button', { name: '7' }).parentElement;
    // A button inside a wrapper shrinks to the width of its "." (16 px): it has to be a grid item itself.
    expect(point.parentElement).toBe(keypad);
    expect(point).toHaveClass('col-span-3');
    expect(screen.getByRole('button', { name: 'Minus' }).parentElement).toBe(keypad);
  });
});

describe('ChallengeStage: order', () => {
  function shownOrder(): string[] {
    return screen.getAllByRole('listitem').map((item) => item.getAttribute('aria-label')?.split('.')[0] ?? '');
  }

  it('never starts solved, and reorders with the arrow buttons', async () => {
    const correct = ['Egg', 'Caterpillar', 'Cocoon', 'Butterfly'];
    const { onSubmit, user, check } = setup(makeChallenge(ORDER));
    expect(shownOrder().slice().sort()).toEqual(correct.slice().sort());
    expect(shownOrder()).not.toEqual(correct);
    expect(check()).toBeEnabled(); // an arrangement is always a complete answer

    // Put each card in its place, front to back.
    for (let target = 0; target < correct.length; target += 1) {
      const name = correct[target] as string;
      while (shownOrder().indexOf(name) > target) {
        await user.click(screen.getByRole('button', { name: `Move ${name} earlier` }));
      }
    }
    expect(shownOrder()).toEqual(correct);
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(['o1', 'o2', 'o3', 'o4'], { correct: true, misconception: null, progress: 1 });
  });

  it('reorders with the arrow keys and reports partial progress', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(ORDER));
    const before = shownOrder();
    const first = before[0] as string;
    screen.getByRole('button', { name: `Move ${first} later` }).focus();
    await user.keyboard('{ArrowDown}');
    expect(shownOrder()[1]).toBe(first);
    await user.keyboard('{ArrowUp}');
    expect(shownOrder()).toEqual(before);
    // Moving the first card up does nothing.
    await user.click(screen.getByRole('button', { name: `Move ${first} earlier` }));
    expect(shownOrder()).toEqual(before);
    await user.click(check());
    const [answer, result] = onSubmit.mock.calls[0] as [string[], CheckResult];
    expect(answer).toHaveLength(4);
    expect(result.correct).toBe(false);
    expect(result.progress).toBeLessThan(1);
  });

  it('shows the start and end labels', () => {
    setup(makeChallenge({ ...ORDER, startLabel: 'smallest', endLabel: 'biggest' }));
    expect(screen.getByText(/smallest/)).toBeInTheDocument();
    expect(screen.getByText(/biggest/)).toBeInTheDocument();
  });
});

describe('ChallengeStage: sort', () => {
  it('sorts by tapping a card and then a box, and submits the placement', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(SORT));
    expect(check()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Fish' }));
    expect(screen.getByRole('button', { name: 'Fish' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Put in Water/ }));
    await user.click(screen.getByRole('button', { name: 'Cow' }));
    await user.click(screen.getByRole('button', { name: /Put in Land/ }));
    expect(check()).toBeDisabled(); // the whale is still waiting
    await user.click(screen.getByRole('button', { name: 'Whale' }));
    await user.click(screen.getByRole('button', { name: /Put in Water/ }));
    expect(within(screen.getByRole('group', { name: 'Water' })).getByRole('button', { name: 'Whale' })).toBeInTheDocument();
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(
      { fish: 'water', cow: 'land', whale: 'water' },
      { correct: true, misconception: null, progress: 1 },
    );
  });

  it('works with the keyboard, lets a card move again, and gives partial progress', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(SORT));
    const place = async (item: string, bin: RegExp): Promise<void> => {
      screen.getByRole('button', { name: item }).focus();
      await user.keyboard('{Enter}');
      screen.getByRole('button', { name: bin }).focus();
      await user.keyboard('{Enter}');
    };
    await place('Fish', /Land/);
    await place('Cow', /Land/);
    await place('Whale', /Water/);
    await user.click(check());
    const [answer, result] = onSubmit.mock.calls[0] as [Record<string, string>, CheckResult];
    expect(answer).toEqual({ fish: 'land', cow: 'land', whale: 'water' });
    expect(result.correct).toBe(false);
    expect(result.progress).toBeCloseTo(2 / 3);

    // The work is kept; fix the one wrong card.
    await place('Fish', /Water/);
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith({ fish: 'water', cow: 'land', whale: 'water' }, expect.objectContaining({ correct: true }));
  });

  it('can put a card back with the cards to sort', async () => {
    const { user, check } = setup(makeChallenge(SORT));
    for (const name of ['Fish', 'Cow', 'Whale']) {
      await user.click(screen.getByRole('button', { name }));
      await user.click(screen.getByRole('button', { name: /Put in Water/ }));
    }
    expect(check()).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cow' }));
    await user.click(screen.getByRole('button', { name: 'Back to the cards' }));
    expect(within(screen.getByRole('group', { name: 'Cards to sort' })).getByRole('button', { name: 'Cow' })).toBeInTheDocument();
    expect(check()).toBeDisabled();
  });
});

describe('ChallengeStage: sort by touch', () => {
  /** Makes `document.elementsFromPoint` answer with the box called `name`, as if the pointer were over it. */
  function pointerOver(name: string): () => void {
    const zone = screen.getByRole('group', { name });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [zone] });
    return () => Reflect.deleteProperty(document, 'elementsFromPoint');
  }
  const inWater = (): string[] => within(screen.getByRole('group', { name: 'Water' })).queryAllByRole('button', { pressed: false }).map((b) => b.textContent ?? '');

  it('leaves a swipe that starts on a card to the page: nothing is picked up or moved', () => {
    vi.useFakeTimers();
    setup(makeChallenge(SORT));
    const restore = pointerOver('Water');
    try {
      const fish = screen.getByRole('button', { name: /Fish/ });
      // The finger moves on at once: the browser scrolls the page and cancels the pointer.
      fireEvent.pointerDown(fish, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 300 });
      fireEvent.pointerMove(fish, { pointerId: 1, pointerType: 'touch', clientX: 52, clientY: 260 });
      act(() => void vi.advanceTimersByTime(500));
      fireEvent.pointerMove(fish, { pointerId: 1, pointerType: 'touch', clientX: 52, clientY: 200 });
      fireEvent.pointerUp(fish, { pointerId: 1, pointerType: 'touch', clientX: 52, clientY: 200 });
      expect(inWater().join(' ')).not.toMatch(/Fish/);
      expect(within(screen.getByRole('group', { name: 'Cards to sort' })).getByRole('button', { name: /Fish/ })).toBeInTheDocument();
      // The card leaves vertical panning to the browser.
      expect(fish.style.touchAction).toBe('pan-y');
    } finally {
      restore();
    }
  });

  it('picks a card up after a short hold and drops it into the box under the finger', () => {
    vi.useFakeTimers();
    setup(makeChallenge(SORT));
    const restore = pointerOver('Water');
    try {
      const fish = screen.getByRole('button', { name: /Fish/ });
      fireEvent.pointerDown(fish, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 300 });
      act(() => void vi.advanceTimersByTime(200));
      // Once it is picked up, the finger's moves do not scroll the page any more.
      const move = new Event('touchmove', { bubbles: true, cancelable: true });
      fish.dispatchEvent(move);
      expect(move.defaultPrevented).toBe(true);
      fireEvent.pointerMove(fish, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 380 });
      fireEvent.pointerUp(fish, { pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 380 });
      expect(inWater().join(' ')).toMatch(/Fish/);
    } finally {
      restore();
    }
  });

  it('does not hold the page still under a finger that has not picked anything up', () => {
    setup(makeChallenge(SORT));
    const fish = screen.getByRole('button', { name: /Fish/ });
    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    fish.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(false);
  });

  it('lets a mouse drag a card at once', () => {
    setup(makeChallenge(SORT));
    const restore = pointerOver('Water');
    try {
      const fish = screen.getByRole('button', { name: /Fish/ });
      fireEvent.pointerDown(fish, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 300 });
      fireEvent.pointerMove(fish, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 380 });
      fireEvent.pointerUp(fish, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 380 });
      expect(inWater().join(' ')).toMatch(/Fish/);
    } finally {
      restore();
    }
  });
});

describe('ChallengeStage: order by touch', () => {
  it('has a grip to drag a card by, and leaves the rest of the card to the page', () => {
    setup(makeChallenge(ORDER));
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      const grip = card.querySelector<HTMLElement>('[data-order-grip]');
      expect(grip).not.toBeNull();
      expect(grip?.style.touchAction).toBe('none');
      // The card itself does not claim the finger: a swipe on it scrolls.
      expect(card.style.touchAction).toBe('');
    }
  });
});

describe('ChallengeStage: long words', () => {
  const LONG = 'Pneumonoultramicroscopicsilicovolcano';

  it('gives an option with a long word a card across the phone screen, and lets the word break inside it', () => {
    setup(makeChallenge({ ...CHOICE, options: [{ id: 'a', label: 'Photosynthesis' }, { id: 'b', label: 'Four' }, { id: 'c', label: LONG }] }));
    const card = screen.getByRole('button', { name: /Photosynthesis/ });
    expect(card.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    expect(card).toHaveClass('min-w-0');
    expect(within(card).getByText('Photosynthesis')).toHaveClass('max-w-full', 'wrap-anywhere');
  });

  it('keeps short options in two columns', () => {
    setup(makeChallenge(CHOICE));
    expect(screen.getByRole('button', { name: /Four/ }).parentElement).toHaveClass('grid-cols-2');
  });

  it('does the same for the parts of a build challenge', () => {
    setup(makeChallenge({ ...BUILD, parts: BUILD.parts.map((part, index) => (index === 0 ? { ...part, label: LONG } : part)) }));
    const card = screen.getByRole('button', { name: new RegExp(LONG) });
    expect(card.parentElement).toHaveClass('grid-cols-1', 'sm:grid-cols-2');
    expect(within(card).getByText(LONG)).toHaveClass('max-w-full', 'wrap-anywhere');
  });
});

describe('ChallengeStage: match labels', () => {
  it('puts the number of a connection on the corner of the card, where it takes no room from the label', async () => {
    const { user } = setup(makeChallenge(MATCH));
    await user.click(screen.getByRole('button', { name: /^Dog/ }));
    await user.click(screen.getByRole('button', { name: /^Puppy/ }));
    const badges = document.querySelectorAll('[data-match-badge]');
    expect(badges).toHaveLength(2);
    for (const badge of badges) expect(badge).toHaveClass('absolute');
  });
});

describe('ChallengeStage: Check', () => {
  it('stays in view at the bottom of the screen while the answer area is on it', () => {
    const { check } = setup(makeChallenge(ORDER));
    expect(check().parentElement).toHaveClass('sticky');
    expect(check().parentElement).toHaveAttribute('data-check-bar');
  });
});

describe('ChallengeStage: build', () => {
  it('toggles parts, shows live meters, and submits the selection', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(BUILD));
    expect(check()).toBeDisabled();
    expect(screen.getByRole('meter', { name: 'strength' })).toHaveAttribute('aria-valuenow', '0');
    await user.click(screen.getByRole('button', { name: /^Wood/ }));
    await user.click(screen.getByRole('button', { name: /^Steel/ }));
    expect(screen.getByRole('meter', { name: 'strength' })).toHaveAttribute('aria-valuetext', '12 / 10. Enough!');
    expect(screen.getByRole('meter', { name: 'coins' })).toHaveAttribute('aria-valuetext', '9 / 8. 1 too many');
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith(['wood', 'steel'], expect.objectContaining({ correct: false }));

    // Swap wood for rope: still strong enough and inside the budget.
    await user.click(screen.getByRole('button', { name: /^Wood/ }));
    await user.click(screen.getByRole('button', { name: /^Rope/ }));
    expect(screen.getByRole('meter', { name: 'coins' })).toHaveAttribute('aria-valuetext', '7 / 8. 1 left');
    expect(screen.getByRole('button', { name: /^Steel/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Wood/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith(['steel', 'rope'], { correct: true, misconception: null, progress: 1 });
  });
});

describe('ChallengeStage: tap', () => {
  it('selects scene objects, counts them, clears them, and submits', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(TAP, { scene: TAP_SCENE }));
    expect(check()).toBeDisabled();
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '🍎 1' }));
    fireEvent.click(screen.getByRole('button', { name: '🍐' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🍐' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '🍐' })); // tap again to unselect
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '🍎 2' }));
    fireEvent.click(screen.getByRole('button', { name: '🍎 1' }));
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(['apple2', 'apple1'], { correct: true, misconception: null, progress: 1 });
  });

  it('shows the scene as a plain picture for other kinds', () => {
    setup(makeChallenge(CHOICE, { scene: TAP_SCENE }));
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '🍎 1' })).toBeNull();
  });
});

describe('ChallengeStage: match', () => {
  it('connects left to right, undoes on a second tap, and submits the links', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(MATCH));
    const connect = async (left: string, right: string): Promise<void> => {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${left}`) }));
      await user.click(screen.getByRole('button', { name: new RegExp(`^${right}`) }));
    };
    await connect('Dog', 'Kitten');
    expect(screen.getByRole('button', { name: 'Dog, matched with Kitten' })).toBeInTheDocument();
    await connect('Cat', 'Puppy');
    expect(check()).toBeDisabled();
    await connect('Cow', 'Calf');
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith({ p1: 'p2', p2: 'p1', p3: 'p3' }, expect.objectContaining({ correct: false }));

    // Tap a connected right card to undo, then reconnect properly.
    await user.click(screen.getByRole('button', { name: /^Kitten/ }));
    expect(screen.getByRole('button', { name: 'Dog' })).toBeInTheDocument();
    expect(check()).toBeDisabled();
    await connect('Dog', 'Puppy'); // steals Puppy from Cat
    await connect('Cat', 'Kitten');
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith({ p1: 'p1', p2: 'p2', p3: 'p3' }, { correct: true, misconception: null, progress: 1 });
  });
});

describe('ChallengeStage: match by touch', () => {
  it('takes the next tap on a left card after a touch drag, which is followed by no click', () => {
    setup(makeChallenge(MATCH));
    const dog = screen.getByRole('button', { name: /^Dog/ });
    const kitten = screen.getByRole('button', { name: /^Kitten/ });
    const elementsFromPoint = vi.fn(() => [kitten]);
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: elementsFromPoint });
    try {
      // A finger drags from "Dog" to "Kitten". The browser sends no click after a touch drag.
      fireEvent.pointerDown(dog, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerMove(dog, { pointerId: 1, pointerType: 'touch', clientX: 120, clientY: 40 });
      fireEvent.pointerUp(dog, { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 40 });
      expect(screen.getByRole('button', { name: 'Dog, matched with Kitten' })).toBeInTheDocument();

      // The very next tap on another left card picks it.
      const cat = screen.getByRole('button', { name: /^Cat/ });
      fireEvent.pointerDown(cat, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 90 });
      fireEvent.pointerUp(cat, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 90 });
      fireEvent.click(cat);
      expect(cat).toHaveAttribute('aria-pressed', 'true');
    } finally {
      Reflect.deleteProperty(document, 'elementsFromPoint');
    }
  });

  it('still ignores the click that a mouse sends at the end of a drag', () => {
    setup(makeChallenge(MATCH));
    const dog = screen.getByRole('button', { name: /^Dog/ });
    fireEvent.pointerDown(dog, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(dog, { pointerId: 1, pointerType: 'mouse', clientX: 60, clientY: 40 });
    fireEvent.pointerUp(dog, { pointerId: 1, pointerType: 'mouse', clientX: 12, clientY: 12 });
    fireEvent.click(dog);
    expect(dog).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ChallengeStage: robot', () => {
  it('builds a program from blocks, counts them, and submits it', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(ROBOT));
    expect(check()).toBeDisabled();
    expect(screen.getByText('0 of 6 blocks')).toBeInTheDocument();
    for (let n = 0; n < 3; n += 1) await user.click(screen.getByRole('button', { name: /^Forward/ }));
    expect(screen.getByText('3 of 6 blocks')).toBeInTheDocument();
    await user.click(check());
    expect(onSubmit).toHaveBeenCalledWith(
      [{ cmd: 'forward' }, { cmd: 'forward' }, { cmd: 'forward' }],
      { correct: true, misconception: null, progress: 1 },
    );
  });

  it('fills a repeat block, changes its count, and removes and reorders blocks', async () => {
    const { onSubmit, user, check } = setup(makeChallenge(ROBOT));
    await user.click(screen.getByRole('button', { name: /^Repeat/ }));
    await user.click(screen.getByRole('button', { name: /^Forward/ })); // goes inside the repeat
    await user.click(screen.getByRole('button', { name: 'More times' }));
    await user.click(screen.getByRole('button', { name: 'Add blocks to the end' }));
    await user.click(screen.getByRole('button', { name: /^Turn left/ }));
    expect(screen.getByText('3 of 6 blocks')).toBeInTheDocument();
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith(
      [{ cmd: 'repeat', times: 3, body: [{ cmd: 'forward' }] }, { cmd: 'left' }],
      expect.objectContaining({ correct: true }),
    );

    await user.click(screen.getByRole('button', { name: 'Move Turn left earlier' }));
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith(
      [{ cmd: 'left' }, { cmd: 'repeat', times: 3, body: [{ cmd: 'forward' }] }],
      expect.objectContaining({ correct: false }),
    );

    await user.click(screen.getByRole('button', { name: 'Remove Turn left' }));
    await user.click(screen.getByRole('button', { name: 'Fewer times' }));
    await user.click(check());
    expect(onSubmit).toHaveBeenLastCalledWith([{ cmd: 'repeat', times: 2, body: [{ cmd: 'forward' }] }], expect.objectContaining({ correct: false }));
  });

  it('stops adding blocks at maxCommands and offers only allowed blocks', async () => {
    const { user } = setup(makeChallenge({ ...ROBOT, allowed: ['forward', 'left'], maxCommands: 2 }));
    expect(screen.queryByRole('button', { name: /^Repeat/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Turn right/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Forward/ }));
    await user.click(screen.getByRole('button', { name: /^Forward/ }));
    expect(screen.getByRole('button', { name: /^Forward/ })).toBeDisabled();
    expect(screen.getByText('2 of 2 blocks')).toBeInTheDocument();
  });

  it('runs the program step by step and reports how it went', async () => {
    const { user } = setup(makeChallenge(ROBOT));
    for (let n = 0; n < 3; n += 1) await user.click(screen.getByRole('button', { name: /^Forward/ }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    expect(screen.getByRole('button', { name: /Stop/ })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText(/The robot made it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run/ })).toBeInTheDocument();
  });

  it('bumps on a crash and sends the robot back to the start', async () => {
    const { user } = setup(makeChallenge(ROBOT));
    await user.click(screen.getByRole('button', { name: /^Turn left/ }));
    await user.click(screen.getByRole('button', { name: /^Forward/ }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText(/Bonk/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run/ })).toBeInTheDocument();
  });

  it('says when the robot stops short', async () => {
    const { user } = setup(makeChallenge(ROBOT));
    await user.click(screen.getByRole('button', { name: /^Forward/ }));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /Run/ }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText(/Not there yet/)).toBeInTheDocument();
  });
});

describe('EngineGallery', () => {
  it('renders one sample of every interaction kind', () => {
    render(<EngineGallery />);
    for (const kind of ['choice', 'tap', 'sort', 'match', 'order', 'number', 'robot', 'build']) {
      expect(screen.getByRole('heading', { name: new RegExp(`^${kind}:`) })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /check/i })).toHaveLength(8);
  });
});
