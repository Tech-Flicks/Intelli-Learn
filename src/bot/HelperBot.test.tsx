import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_CONTROLS } from '@/core/defaults';
import type { ParentalControls } from '@/core/types';
import { db } from '@/data';
import { usePlaySession, type BotMessage, type PlaySessionState } from '@/play';
import { CHOICE, freshDevice, makeContent, makeRecord } from '@/play/testing/support';
import { voiceMock } from '@/play/testing/voiceMock';
import { HelperBot } from './HelperBot';
import { BOT, positionKey, restInset } from './geometry';

vi.mock('@/voice', () => import('@/play/testing/voiceMock'));
vi.mock('@/bot/pip', () => import('@/play/testing/pipMock'));

const CHILD = 'kid-1';
const pristine = usePlaySession.getState();
const user = userEvent.setup();

const controls = (patch: Partial<ParentalControls> = {}): ParentalControls => ({
  ...DEFAULT_CONTROLS,
  strands: { ...DEFAULT_CONTROLS.strands },
  voiceOutput: true,
  microphone: false,
  openChat: false,
  ...patch,
});

/** The helper's own actions, replaced by spies: the tests here are about what Pip asks for. */
function spies() {
  return {
    requestRead: vi.fn(),
    stopReading: vi.fn(),
    requestHint: vi.fn(async () => undefined),
    requestWalkthrough: vi.fn(async () => undefined),
    askBot: vi.fn(async (_text: string) => undefined),
    acceptOffer: vi.fn(async () => undefined),
    setMuted: vi.fn(),
    setVoiceRate: vi.fn(),
    // The real ones also work out Pip's face again; here the tests set the face themselves.
    setBotDocked: (docked: boolean) => usePlaySession.setState({ botDocked: docked }),
    setPanelOpen: (open: boolean) => usePlaySession.setState({ panelOpen: open }),
  };
}

let actions: ReturnType<typeof spies>;

/** Puts a challenge that is being answered into the play session and shows Pip. */
async function show(patch: Partial<PlaySessionState> = {}): Promise<HTMLElement> {
  actions = spies();
  usePlaySession.setState({
    childId: CHILD,
    challenge: makeRecord(CHILD, makeContent(CHOICE)),
    phase: 'answering',
    controls: controls(),
    ...actions,
    ...patch,
  });
  render(<HelperBot childId={CHILD} />);
  return screen.findByRole('button', { name: /Pip, your helper/ });
}

const face = (): string | null => within(screen.getByTestId('helper-bot')).getByTestId('pip').getAttribute('data-state');
const set = (patch: Partial<PlaySessionState>): void => act(() => usePlaySession.setState(patch));
const message = (text: string, kind: BotMessage['kind'] = 'hint', role: BotMessage['role'] = 'bot'): BotMessage => ({
  id: `m-${text}`,
  role,
  kind,
  text,
  at: 1,
});

beforeEach(async () => {
  voiceMock.reset();
  await freshDevice();
});

afterEach(() => {
  cleanup();
  usePlaySession.setState(pristine, true);
});

describe('HelperBot: floating', () => {
  it('is not there while the next challenge is loading', async () => {
    usePlaySession.setState({ childId: CHILD, challenge: null, phase: 'loading' });
    render(<HelperBot childId={CHILD} />);
    await waitFor(async () => expect(await db.kv.count()).toBe(0));
    expect(screen.queryByRole('button', { name: /Pip, your helper/ })).toBeNull();
  });

  it('sits at home below the top bar, inside the screen', async () => {
    const pip = await show();
    const bubble = screen.getByTestId('helper-bot');
    expect(bubble).toHaveAttribute('data-docked', 'true');
    const size = window.innerWidth < 640 ? BOT.sizeSmall : BOT.sizeLarge;
    expect(bubble.style.left).toBe(`${window.innerWidth - BOT.margin - size}px`);
    expect(bubble.style.top).toBe(`${BOT.topBarFallback + BOT.margin + BOT.dockDrop}px`);
    expect(bubble.style.width).toBe(`${size}px`);
    expect(size).toBeGreaterThanOrEqual(56);
    expect(pip).toHaveAccessibleDescription(/arrow keys/);
    expect(usePlaySession.getState().botDocked).toBe(true);
  });

  it('moves with the arrow keys and remembers the place for this child', async () => {
    const pip = await show();
    const bubble = screen.getByTestId('helper-bot');
    const homeLeft = Number.parseFloat(bubble.style.left);
    pip.focus();
    await user.keyboard('{ArrowLeft}{ArrowDown}');
    expect(bubble).toHaveAttribute('data-docked', 'false');
    expect(Number.parseFloat(bubble.style.left)).toBeCloseTo(homeLeft - BOT.keyStep, 0);
    expect(usePlaySession.getState().botDocked).toBe(false);
    await waitFor(async () => expect((await db.kv.get(positionKey(CHILD)))?.value).toMatchObject({ v: 1 }));
    // The panel did not open: the keys only moved him.
    expect(screen.queryByTestId('bot-panel')).toBeNull();

    // Never off the screen, however far he is sent.
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{/Shift}');
    expect(Number.parseFloat(bubble.style.left)).toBeLessThanOrEqual(homeLeft);
    expect(Number.parseFloat(bubble.style.top)).toBe(BOT.topBarFallback + BOT.margin);

    await user.keyboard('{Home}');
    expect(bubble).toHaveAttribute('data-docked', 'true');
    await waitFor(async () => expect(await db.kv.get(positionKey(CHILD))).toBeUndefined());
  });

  it('comes back to the place where he was left', async () => {
    await db.kv.put({ key: positionKey(CHILD), value: { v: 1, fx: 0, fy: 1 } });
    await db.kv.put({ key: positionKey('someone-else'), value: { v: 1, fx: 1, fy: 0 } });
    await show();
    const bubble = screen.getByTestId('helper-bot');
    expect(bubble).toHaveAttribute('data-docked', 'false');
    expect(bubble.style.left).toBe(`${BOT.margin}px`);
    const size = Number.parseFloat(bubble.style.width);
    expect(bubble.style.top).toBe(`${window.innerHeight - BOT.margin - size}px`);
  });

  it('can be dragged, and a drag does not open the panel', async () => {
    const pip = await show();
    const bubble = screen.getByTestId('helper-bot');
    const left = Number.parseFloat(bubble.style.left);
    const top = Number.parseFloat(bubble.style.top);
    fireEvent.pointerDown(pip, { pointerId: 1, button: 0, clientX: 500, clientY: 200 });
    fireEvent.pointerMove(pip, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.pointerUp(pip, { pointerId: 1, clientX: 300, clientY: 400 });
    fireEvent.click(pip);
    expect(Number.parseFloat(bubble.style.left)).toBeCloseTo(left - 200, 0);
    expect(Number.parseFloat(bubble.style.top)).toBeCloseTo(top + 200, 0);
    expect(bubble).toHaveAttribute('data-docked', 'false');
    expect(screen.queryByTestId('bot-panel')).toBeNull();
    await waitFor(async () => expect((await db.kv.get(positionKey(CHILD)))?.value).toMatchObject({ v: 1 }));

    // Dropped next to his home, he snaps back in.
    fireEvent.pointerDown(pip, { pointerId: 2, button: 0, clientX: 300, clientY: 400 });
    fireEvent.pointerMove(pip, { pointerId: 2, clientX: 490, clientY: 210 });
    fireEvent.pointerUp(pip, { pointerId: 2, clientX: 490, clientY: 210 });
    expect(bubble).toHaveAttribute('data-docked', 'true');
  });
});

describe('HelperBot: out of the way', () => {
  const rect = (top: number, height: number): DOMRect => ({ x: 0, y: top, top, left: 0, width: 300, height, right: 300, bottom: top + height, toJSON: () => ({}) });

  /** The seat the question card keeps for Pip and the Check bar, at the places the page would put them. */
  function page(seatTop: number, checkTop: number): { scrollTo: (seat: number, check: number) => void; remove: () => void } {
    const seat = document.createElement('span');
    seat.setAttribute('data-bot-seat', '');
    const bar = document.createElement('div');
    bar.setAttribute('data-check-bar', '');
    let places = { seat: seatTop, check: checkTop };
    seat.getBoundingClientRect = () => rect(places.seat, 62);
    bar.getBoundingClientRect = () => rect(places.check, 64);
    document.body.append(seat, bar);
    return {
      scrollTo: (seatAt, checkAt) => {
        places = { seat: seatAt, check: checkAt };
        act(() => {
          document.body.dispatchEvent(new Event('scroll'));
        });
      },
      remove: () => {
        seat.remove();
        bar.remove();
      },
    };
  }

  it('rests next to Check, in room the Check bar keeps for him, once the question card has scrolled away', async () => {
    const homeTop = BOT.topBarFallback + BOT.margin + BOT.dockDrop;
    const scroller = page(homeTop, window.innerHeight + 300);
    try {
      await show();
      const bubble = screen.getByTestId('helper-bot');
      const size = Number.parseFloat(bubble.style.width);
      expect(bubble).toHaveAttribute('data-spot', 'seat');
      expect(usePlaySession.getState().botInset).toBe(0);

      // The page is scrolled: the card (and the seat) are gone, Check is at the bottom of the screen.
      scroller.scrollTo(-400, window.innerHeight - 72);
      await waitFor(() => expect(bubble).toHaveAttribute('data-spot', 'check'));
      expect(bubble.style.top).toBe(`${window.innerHeight - BOT.margin - size}px`);
      expect(usePlaySession.getState().botInset).toBe(restInset(size));
      // He is still "at home": nothing was stored, and the card keeps his seat.
      expect(bubble).toHaveAttribute('data-docked', 'true');
      expect(usePlaySession.getState().botDocked).toBe(true);
      expect(await db.kv.get(positionKey(CHILD))).toBeUndefined();

      // Back at the top of the page he is back in his seat, and Check has its full width again.
      scroller.scrollTo(homeTop, window.innerHeight + 300);
      await waitFor(() => expect(bubble).toHaveAttribute('data-spot', 'seat'));
      expect(bubble.style.top).toBe(`${homeTop}px`);
      expect(usePlaySession.getState().botInset).toBe(0);
    } finally {
      scroller.remove();
    }
  });

  it('stays in his seat while Check is still below the screen', async () => {
    const scroller = page(-400, window.innerHeight + 40);
    try {
      await show();
      const bubble = screen.getByTestId('helper-bot');
      scroller.scrollTo(-420, window.innerHeight + 20);
      expect(bubble).toHaveAttribute('data-spot', 'seat');
      expect(usePlaySession.getState().botInset).toBe(0);
    } finally {
      scroller.remove();
    }
  });

  it('goes up to his seat when a sheet opens, and gives Check its room back', async () => {
    const scroller = page(-400, window.innerHeight - 72);
    try {
      await show();
      const bubble = screen.getByTestId('helper-bot');
      await waitFor(() => expect(bubble).toHaveAttribute('data-spot', 'check'));
      set({ walkthroughOpen: true });
      expect(bubble).toHaveAttribute('data-spot', 'seat');
      expect(bubble.style.top).toBe(`${BOT.topBarFallback + BOT.margin + BOT.dockDrop}px`);
      await waitFor(() => expect(usePlaySession.getState().botInset).toBe(0));
      set({ walkthroughOpen: false });
      await waitFor(() => expect(bubble).toHaveAttribute('data-spot', 'check'));
    } finally {
      scroller.remove();
    }
  });

  it('is at home while a sheet is open, wherever the child put him, and goes back afterwards', async () => {
    // Left at the bottom of the screen: that is where the sheets and their buttons are.
    await db.kv.put({ key: positionKey(CHILD), value: { v: 1, fx: 1, fy: 1 } });
    const pip = await show();
    const bubble = screen.getByTestId('helper-bot');
    const size = Number.parseFloat(bubble.style.width);
    const homeTop = `${BOT.topBarFallback + BOT.margin + BOT.dockDrop}px`;
    const lowTop = `${window.innerHeight - BOT.margin - size}px`;
    expect(bubble.style.top).toBe(lowTop);

    for (const sheet of [{ phase: 'solved' }, { phase: 'teachback' }, { phase: 'recorded' }, { walkthroughOpen: true }, { breakOpen: true }] as const) {
      set({ phase: 'answering', walkthroughOpen: false, breakOpen: false, ...sheet });
      expect(bubble.style.top).toBe(homeTop);
      // The question card keeps his seat free while he is there.
      expect(usePlaySession.getState().botDocked).toBe(true);
    }

    // He cannot be dragged down onto the sheet, and his place is not forgotten.
    fireEvent.pointerDown(pip, { pointerId: 1, button: 0, clientX: 500, clientY: 100 });
    fireEvent.pointerMove(pip, { pointerId: 1, clientX: 400, clientY: 500 });
    fireEvent.pointerUp(pip, { pointerId: 1, clientX: 400, clientY: 500 });
    expect(bubble.style.top).toBe(homeTop);
    pip.focus();
    await user.keyboard('{ArrowDown}{Home}');
    expect((await db.kv.get(positionKey(CHILD)))?.value).toMatchObject({ v: 1, fx: 1, fy: 1 });

    set({ phase: 'answering', walkthroughOpen: false, breakOpen: false });
    expect(bubble.style.top).toBe(lowTop);
    expect(usePlaySession.getState().botDocked).toBe(false);
  });

  it('sits above his own panel when the panel is a sheet at the bottom of a phone', async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    try {
      await db.kv.put({ key: positionKey(CHILD), value: { v: 1, fx: 0, fy: 1 } });
      const pip = await show();
      const bubble = screen.getByTestId('helper-bot');
      const lowTop = bubble.style.top;
      await user.click(pip);
      expect(screen.getByTestId('bot-panel')).toBeInTheDocument();
      expect(bubble.style.top).toBe(`${BOT.topBarFallback + BOT.margin + BOT.dockDrop}px`);
      await user.click(pip);
      expect(screen.queryByTestId('bot-panel')).toBeNull();
      expect(bubble.style.top).toBe(lowTop);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    }
  });
});

describe("HelperBot: Pip's face", () => {
  it('mirrors the play session, talking and listening', async () => {
    await show({ botState: 'curious' });
    expect(face()).toBe('curious');
    set({ botState: 'teaching' });
    expect(face()).toBe('teaching');
    set({ botState: 'celebrating' });
    expect(face()).toBe('celebrating');
    voiceMock.speaking = true;
    set({ botState: 'idle' });
    expect(face()).toBe('talking');
    expect(within(screen.getByTestId('helper-bot')).getByTestId('pip')).toHaveAttribute('data-talking', 'true');
    set({ reading: true });
    expect(face()).toBe('reading');
    voiceMock.listening = true;
    set({ botState: 'waiting' });
    expect(face()).toBe('listening');
  });

  it('never shows an angry face', async () => {
    await show({ botState: 'angry' });
    expect(face()).toBe('curious');
  });

  it('giggles on a double tap', async () => {
    const pip = await show();
    await user.dblClick(pip);
    expect(face()).toBe('giggle');
  });
});

describe('HelperBot: the speech bubble', () => {
  it('shows what Pip says and can be closed', async () => {
    await show({ botLine: 'Look closely at the picture.', botLineId: 3, botLineSticky: true });
    const bubble = screen.getByTestId('bot-bubble');
    expect(within(bubble).getByRole('status')).toHaveTextContent('Look closely at the picture.');
    await user.click(within(bubble).getByRole('button', { name: 'Close message' }));
    await waitFor(() => expect(screen.queryByTestId('bot-bubble')).toBeNull());
    expect(usePlaySession.getState().botLine).toBeNull();
  });

  describe('a long line', () => {
    const LONG = 'Look at the picture very slowly and count every single star that you can find. '.repeat(4).trim();

    /** jsdom lays nothing out: the text is given the sizes a phone gives it (a 192 px window on 380 px of text). */
    function layOut(text: HTMLElement, scrollTop = 0): void {
      Object.defineProperty(text, 'clientHeight', { configurable: true, value: 192 });
      Object.defineProperty(text, 'scrollHeight', { configurable: true, value: 380 });
      Object.defineProperty(text, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
    }

    it('does not grow over the question: the text has a limited height and scrolls inside the bubble', async () => {
      await show({ botLine: LONG, botLineId: 4, botLineSticky: true });
      const text = within(screen.getByTestId('bot-bubble')).getByRole('status');
      expect(text).toHaveTextContent(LONG);
      // Measured in a browser at 360x640: the bubble was 387 px tall and lay on the question and the picture.
      expect(text.className).toMatch(/\bmax-h-\[max\(9rem,30dvh\)\]/);
      expect(text.className.split(' ')).toContain('overflow-y-auto');
    });

    it('shows that there is more, and a tap on the arrow scrolls on', async () => {
      await show({ botLine: LONG, botLineId: 4, botLineSticky: true });
      const bubble = screen.getByTestId('bot-bubble');
      const text = within(bubble).getByRole('status');
      expect(within(bubble).queryByRole('button', { name: 'There is more below' })).toBeNull();
      layOut(text);
      const scrolled = vi.fn();
      text.scrollBy = scrolled;
      fireEvent.scroll(text);
      await user.click(await within(bubble).findByRole('button', { name: 'There is more below' }));
      expect(scrolled).toHaveBeenCalledTimes(1);
      // The line is still there: scrolling on is not closing.
      expect(usePlaySession.getState().botLine).toBe(LONG);
      // At the end of the text the arrow goes away.
      layOut(text, 188);
      fireEvent.scroll(text);
      await waitFor(() => expect(within(bubble).queryByRole('button', { name: 'There is more below' })).toBeNull());
    });

    it('has no arrow for a short line', async () => {
      await show({ botLine: 'Look closely at the picture.', botLineId: 3, botLineSticky: true });
      expect(within(screen.getByTestId('bot-bubble')).queryByRole('button', { name: 'There is more below' })).toBeNull();
    });
  });

  it('offers help with two big buttons, and only offers', async () => {
    await show({ botLine: 'Want a hint?', botLineId: 1, botLineSticky: true, botOffer: 'hint', helpOffered: true });
    const bubble = screen.getByTestId('bot-bubble');
    await user.click(within(bubble).getByRole('button', { name: 'Yes please!' }));
    expect(actions.acceptOffer).toHaveBeenCalledTimes(1);
    await user.click(within(bubble).getByRole('button', { name: 'Not yet' }));
    expect(usePlaySession.getState().botOffer).toBeNull();
    expect(actions.requestHint).not.toHaveBeenCalled();
  });

  it('puts a plain line away when the child touches the page, on a wide screen too', async () => {
    expect(window.innerWidth).toBeGreaterThanOrEqual(BOT.sheetBelow);
    await show({ botLine: 'Have another go!', botLineId: 5, botLineSticky: false });
    // Touching the bubble itself keeps it.
    fireEvent.pointerDown(screen.getByTestId('bot-bubble'));
    expect(usePlaySession.getState().botLine).toBe('Have another go!');
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByTestId('bot-bubble')).toBeNull());
    expect(usePlaySession.getState().botLine).toBeNull();
  });

  it('keeps an offer on screen when the child touches the page', async () => {
    await show({ botLine: 'Want a hint?', botLineId: 6, botLineSticky: true, botOffer: 'hint', helpOffered: true });
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('bot-bubble')).toBeInTheDocument();
    expect(usePlaySession.getState().botOffer).toBe('hint');
  });
});

describe('HelperBot: the panel', () => {
  it('opens on a tap with the ways to get help, and nothing that skips', async () => {
    const pip = await show({ messages: [message('Look closely at the picture.'), message('The whole question', 'read')] });
    expect(pip).toHaveAttribute('aria-expanded', 'false');
    await user.click(pip);
    const panel = screen.getByRole('dialog', { name: 'How can I help?' });
    expect(pip).toHaveAttribute('aria-expanded', 'true');
    expect(usePlaySession.getState().panelOpen).toBe(true);
    expect(within(panel).getByRole('button', { name: 'Read it to me' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Give me a hint' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Show me how' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /skip|answer|solve/i })).toBeNull();
    expect(panel.textContent).not.toMatch(/skip/i);
    // The conversation so far; what was only read aloud is not repeated here.
    const log = within(panel).getByRole('log');
    expect(log).toHaveTextContent('Look closely at the picture.');
    expect(log).not.toHaveTextContent('The whole question');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pip).toHaveFocus();
    expect(usePlaySession.getState().panelOpen).toBe(false);
  });

  it('asks for a hint and gets out of the way', async () => {
    await user.click(await show());
    await user.click(screen.getByRole('button', { name: 'Give me a hint' }));
    expect(actions.requestHint).toHaveBeenCalledTimes(1);
    expect(actions.requestWalkthrough).not.toHaveBeenCalled();
    expect(screen.queryByTestId('bot-panel')).toBeNull();
  });

  it('has "Show me how" after the strong hint', async () => {
    await user.click(await show({ hintsUsed: 2, hintLevel: 2 }));
    await user.click(screen.getByRole('button', { name: 'Show me how' }));
    expect(actions.requestWalkthrough).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('bot-panel')).toBeNull();
  });

  it('has "Show me how" after three wrong tries, not after two', async () => {
    const miss = { at: 1, answer: ['a'], correct: false, misconception: null };
    const pip = await show({ answers: [miss, miss], wrongTries: 2 });
    await user.click(pip);
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull();
    set({ answers: [miss, miss, miss], wrongTries: 3 });
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeInTheDocument();
  });

  it('offers no help buttons once the challenge is solved', async () => {
    await user.click(await show({ phase: 'solved', hintsUsed: 2 }));
    expect(screen.queryByRole('button', { name: 'Give me a hint' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Read it to me' })).toBeInTheDocument();
  });

  it('reads aloud, and the button becomes "Stop" while Pip speaks', async () => {
    await user.click(await show());
    await user.click(screen.getByRole('button', { name: 'Read it to me' }));
    expect(actions.requestRead).toHaveBeenCalledTimes(1);

    voiceMock.speaking = true;
    set({ reading: true });
    expect(screen.queryByRole('button', { name: 'Read it to me' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(actions.stopReading).toHaveBeenCalledTimes(1);
  });

  it('has a mute switch and a speed control', async () => {
    await user.click(await show({ voiceRate: 1 }));
    const voice = screen.getByRole('button', { name: 'Pip talks out loud' });
    expect(voice).toHaveAttribute('aria-pressed', 'true');
    await user.click(voice);
    expect(actions.setMuted).toHaveBeenCalledWith(true);

    const speed = screen.getByRole('radiogroup', { name: 'Talking speed' });
    expect(within(speed).getByRole('radio', { name: 'Normal' })).toBeChecked();
    await user.click(within(speed).getByRole('radio', { name: 'Slow' }));
    expect(actions.setVoiceRate).toHaveBeenCalledWith(0.75);
    set({ voiceRate: 0.75, muted: true });
    expect(within(speed).getByRole('radio', { name: 'Slow' })).toBeChecked();
    expect(voice).toHaveAttribute('aria-pressed', 'false');
  });

  it('has nothing to do with voice when voice output is switched off', async () => {
    await user.click(await show({ controls: controls({ voiceOutput: false }) }));
    const panel = screen.getByTestId('bot-panel');
    expect(within(panel).queryByRole('button', { name: 'Read it to me' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Pip talks out loud' })).toBeNull();
    expect(within(panel).queryByRole('radiogroup')).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Give me a hint' })).toBeInTheDocument();
  });
});

describe('HelperBot: talking to Pip', () => {
  it('hides the microphone and the text box unless the parent switched them on', async () => {
    await user.click(await show());
    const panel = screen.getByTestId('bot-panel');
    expect(within(panel).queryByRole('button', { name: 'Talk to Pip' })).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('shows the microphone only when it is switched on and the browser can listen', async () => {
    await user.click(await show({ controls: controls({ microphone: true }) }));
    expect(screen.getByRole('button', { name: 'Talk to Pip' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    cleanup();

    voiceMock.support = { tts: true, stt: false };
    await user.click(await show({ controls: controls({ microphone: true }) }));
    expect(screen.queryByRole('button', { name: 'Talk to Pip' })).toBeNull();
  });

  it('passes on what it heard', async () => {
    voiceMock.listenOnce.mockResolvedValue('why is the sky blue');
    await user.click(await show({ controls: controls({ microphone: true }) }));
    await user.click(screen.getByRole('button', { name: 'Talk to Pip' }));
    await waitFor(() => expect(actions.askBot).toHaveBeenCalledWith('why is the sky blue'));
    expect(voiceMock.listenOnce).toHaveBeenCalledTimes(1);
  });

  describe('the microphone closes with the panel', () => {
    /** A recording that goes on until the test ends it (a short tap keeps listening). */
    function openRecording(): { say: (text: string) => void } {
      let settle: (text: string) => void = () => undefined;
      voiceMock.listenOnce.mockImplementation(() => new Promise<string>((resolve) => (settle = resolve)));
      return { say: (text) => settle(text) };
    }

    it('stops listening when the panel is closed, and drops what was heard afterwards', async () => {
      const recording = openRecording();
      await user.click(await show({ controls: controls({ microphone: true }) }));
      await user.click(screen.getByRole('button', { name: 'Talk to Pip' }));
      expect(voiceMock.listenOnce).toHaveBeenCalledTimes(1);
      expect(voiceMock.cancelListening).not.toHaveBeenCalled();

      // A tap anywhere outside the panel closes it.
      await user.click(document.body);
      await waitFor(() => expect(screen.queryByTestId('bot-panel')).toBeNull());
      expect(voiceMock.cancelListening).toHaveBeenCalled();

      // Whatever the room said after that never reaches the tutor.
      await act(async () => {
        recording.say('something said in the room after Pip was put away');
        await Promise.resolve();
      });
      expect(actions.askBot).not.toHaveBeenCalled();
    });

    it('stops listening when the next challenge arrives', async () => {
      const recording = openRecording();
      await user.click(await show({ controls: controls({ microphone: true }) }));
      await user.click(screen.getByRole('button', { name: 'Talk to Pip' }));
      set({ challenge: makeRecord(CHILD, makeContent(CHOICE)) });
      await waitFor(() => expect(screen.queryByTestId('bot-panel')).toBeNull());
      expect(voiceMock.cancelListening).toHaveBeenCalled();
      await act(async () => {
        recording.say('too late');
        await Promise.resolve();
      });
      expect(actions.askBot).not.toHaveBeenCalled();
    });

    it('stops listening when Pip leaves the screen', async () => {
      openRecording();
      await user.click(await show({ controls: controls({ microphone: true }) }));
      await user.click(screen.getByRole('button', { name: 'Talk to Pip' }));
      cleanup();
      expect(voiceMock.cancelListening).toHaveBeenCalled();
    });

    it('does not touch the microphone when nothing is being recorded', async () => {
      await user.click(await show({ controls: controls({ microphone: true }) }));
      await user.click(document.body);
      await waitFor(() => expect(screen.queryByTestId('bot-panel')).toBeNull());
      cleanup();
      expect(voiceMock.cancelListening).not.toHaveBeenCalled();
    });

    it('keeps the pointer on the mic button while it is held, so letting go anywhere ends the recording', async () => {
      openRecording();
      await user.click(await show({ controls: controls({ microphone: true }) }));
      const mic = screen.getByRole('button', { name: 'Talk to Pip' });
      const capture = vi.fn();
      mic.setPointerCapture = capture;
      fireEvent.pointerDown(mic, { pointerId: 7, pointerType: 'mouse', button: 0 });
      expect(capture).toHaveBeenCalledWith(7);
    });
  });

  it('says so kindly when it could not hear', async () => {
    voiceMock.listenOnce.mockRejectedValue(new Error('denied'));
    await user.click(await show({ controls: controls({ microphone: true }) }));
    await user.click(screen.getByRole('button', { name: 'Talk to Pip' }));
    expect(await screen.findByText(/I cannot hear you/)).toBeInTheDocument();
    expect(actions.askBot).not.toHaveBeenCalled();
  });

  it('shows the text box only with open chat, and sends the question', async () => {
    await user.click(await show({ controls: controls({ openChat: true }) }));
    expect(screen.queryByRole('button', { name: 'Talk to Pip' })).toBeNull();
    const box = screen.getByRole('textbox', { name: 'Ask Pip a question' });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(box, 'Why do apples fall?{Enter}');
    expect(actions.askBot).toHaveBeenCalledWith('Why do apples fall?');
    expect(box).toHaveValue('');
  });

  it('shows the answer in the conversation', async () => {
    await user.click(await show({ controls: controls({ openChat: true }) }));
    set({ messages: [message('Why do apples fall?', 'chat', 'child'), message('Gravity pulls them down.', 'chat')], thinking: true });
    const log = screen.getByRole('log');
    expect(log).toHaveTextContent('You: Why do apples fall?');
    expect(log).toHaveTextContent('Pip: Gravity pulls them down.');
    expect(log).toHaveTextContent('Pip is thinking...');
  });
});
