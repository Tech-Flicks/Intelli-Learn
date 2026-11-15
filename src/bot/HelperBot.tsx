/**
 * Pip, the floating helper.
 *
 * He sits in a round bubble that can be dragged anywhere on the screen (or
 * moved with the arrow keys), shows what is going on with his face, speaks in
 * a speech bubble, and opens a small panel with the three ways to get help:
 * "Read it to me", "Give me a hint" and "Show me how".
 *
 * The helper has no state of its own about the challenge: it reads the play
 * session (`usePlaySession`) and calls its actions. There is no button here
 * that skips a challenge or shows its answer, and there never will be.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { db } from '@/data';
import { useT } from '@/i18n';
import { PLAY, canWalkthrough, usePlaySession, type BotMessage } from '@/play';
import { BigButton, IconButton, cx, useReducedMotion } from '@/ui';
import { cancelListening, listenOnce, stopListening, useListening, useSpeaking, voiceSupport } from '@/voice';
import {
  BOT,
  anchorBox,
  botSize,
  boundsFor,
  clampPoint,
  dockPoint,
  fromFraction,
  isNearDock,
  lineLifetimeMs,
  panelIsSheet,
  parseStoredPosition,
  pipStateFor,
  positionKey,
  restInset,
  restPoint,
  restsLow,
  toFraction,
  type Fraction,
  type Insets,
  type Point,
  type Size,
  type StoredPosition,
} from './geometry';
import { Pip, usePipMood } from './pip';
import './strings';

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

function readViewport(): Size {
  if (typeof window === 'undefined') return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

interface Room {
  viewport: Size;
  insets: Insets;
  /** Bottom edge of the top bar: Pip stays below it. */
  top: number;
  /** Right edge of the column the question card sits in (`data-bot-dock`), when there is one. */
  columnRight: number | null;
}

/** The space Pip may float in: the viewport, the safe areas and the top bar's edge. Measured again on resize. */
function useRoom(probe: RefObject<HTMLDivElement | null>, revision: string): Room {
  const [room, setRoom] = useState<Room>(() => ({ viewport: readViewport(), insets: NO_INSETS, top: BOT.topBarFallback, columnRight: null }));

  useLayoutEffect(() => {
    const measure = () => {
      const viewport = readViewport();
      let insets = NO_INSETS;
      if (probe.current) {
        const style = getComputedStyle(probe.current);
        const px = (value: string): number => Number.parseFloat(value) || 0;
        insets = { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
      }
      const bar = document.querySelector('[data-bot-keepout]');
      const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
      const top = barBottom > 0 ? barBottom : insets.top + BOT.topBarFallback;
      const column = document.querySelector('[data-bot-dock]')?.getBoundingClientRect();
      const columnRight = column && column.width > 0 ? column.right : null;
      setRoom((current) =>
        current.viewport.width === viewport.width &&
        current.viewport.height === viewport.height &&
        current.top === top &&
        current.columnRight === columnRight &&
        current.insets.top === insets.top &&
        current.insets.right === insets.right &&
        current.insets.bottom === insets.bottom &&
        current.insets.left === insets.left
          ? current
          : { viewport, insets, top, columnRight },
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [probe, revision]);

  return room;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: Point;
  moved: boolean;
}

export function HelperBot({ childId }: { childId: string }): JSX.Element | null {
  const t = useT();
  const calm = useReducedMotion();
  const speaking = useSpeaking();
  const listening = useListening();

  const session = usePlaySession(
    useShallow((s) => ({
      challengeId: s.challenge?.id ?? null,
      phase: s.phase,
      botState: s.botState,
      botLine: s.botLine,
      botLineId: s.botLineId,
      botLineSticky: s.botLineSticky,
      botOffer: s.botOffer,
      wiggle: s.wiggle,
      thinking: s.thinking,
      reading: s.reading,
      messages: s.messages,
      muted: s.muted,
      voiceRate: s.voiceRate,
      controls: s.controls,
      answers: s.answers,
      hintsUsed: s.hintsUsed,
      walkthroughUsed: s.walkthroughUsed,
      walkthroughOpen: s.walkthroughOpen,
      breakOpen: s.breakOpen,
    })),
  );
  const { phase, botLine, botLineId, botOffer, controls } = session;

  // --- where Pip is -----------------------------------------------------------
  const probeRef = useRef<HTMLDivElement>(null);
  // Measured again when the phase changes: the top bar can change height with the text size.
  const room = useRoom(probeRef, phase);
  const size = botSize(room.viewport);
  const bounds = useMemo(() => boundsFor(room.viewport, room.insets, size, room.top), [room, size]);
  const [fraction, setFraction] = useState<Fraction | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dragPoint, setDragPoint] = useState<Point | null>(null);
  const drag = useRef<DragState | null>(null);
  const skipClick = useRef(false);

  useEffect(() => {
    let live = true;
    setLoaded(false);
    db.kv.get(positionKey(childId)).then(
      (row) => {
        if (!live) return;
        setFraction(parseStoredPosition(row?.value));
        setLoaded(true);
      },
      () => {
        if (live) setLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, [childId]);

  const dock = useMemo(() => dockPoint(bounds, size, room.columnRight), [bounds, size, room.columnRight]);
  const docked = fraction === null && dragPoint === null;

  // --- the panel (its state is needed for where Pip is) -----------------------------------
  const [open, setOpenState] = useState(false);
  const narrow = panelIsSheet(room.viewport);

  // Every sheet that comes up from the bottom (the solved moment, the walkthrough, the break,
  // and on a phone Pip's own panel) is sized to end below Pip's home. While one is open he is
  // at home, wherever he was put: he is never under a sheet or on top of its button.
  const sheetOpen =
    phase === 'solved' || phase === 'teachback' || phase === 'recorded' || session.walkthroughOpen || session.breakOpen || (open && narrow);

  // At home, and the question card has scrolled away: Pip rests next to Check, where the Check
  // bar keeps room for him. Up at the top he would cover the answer area scrolling past.
  // Where the Check bar is while he rests next to it, or null while he is in his seat.
  const [resting, setResting] = useState<{ top: number; height: number } | null>(null);
  const mayRest = docked && !sheetOpen && session.challengeId !== null && loaded;
  useEffect(() => {
    if (!mayRest) {
      setResting(null);
      return;
    }
    let frame = 0;
    const boxOf = (selector: string): DOMRect | null => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      // Nothing there, or not laid out: nothing to go by.
      return box && box.width > 0 && box.height > 0 ? box : null;
    };
    const measure = () => {
      frame = 0;
      const check = boxOf('[data-check-bar]');
      const input = { seatTop: boxOf('[data-bot-seat]')?.top ?? null, dockY: dock.y, checkTop: check?.top ?? null, viewportHeight: room.viewport.height };
      setResting((current) => {
        if (!check || !restsLow(input, current !== null)) return null;
        const next = { top: Math.round(check.top), height: Math.round(check.height) };
        return current !== null && current.top === next.top && current.height === next.height ? current : next;
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    // Scroll events do not bubble; capturing on the document hears the page's own scroller.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', schedule, { capture: true });
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [mayRest, dock.y, room.viewport.height, session.challengeId, phase]);

  const low = mayRest && resting !== null;
  const home = low ? restPoint(bounds, size, room.columnRight, resting) : dock;
  // He glides from his seat to Check and back; while he goes along with the Check bar he keeps up with it.
  const wasLow = useRef(false);
  const keepingUp = low && wasLow.current;
  useEffect(() => {
    wasLow.current = low;
  }, [low]);
  const point = sheetOpen ? dock : (dragPoint ?? (fraction ? fromFraction(fraction, bounds) : home));
  // His seat in the question card is kept while he is at home, also when a sheet sent him there.
  const seated = docked || sheetOpen;
  useEffect(() => {
    usePlaySession.getState().setBotDocked(seated);
  }, [seated]);
  useEffect(() => () => usePlaySession.getState().setBotDocked(true), []);
  const inset = low ? restInset(size) : 0;
  useEffect(() => {
    if (usePlaySession.getState().botInset !== inset) usePlaySession.getState().setBotInset(inset);
  }, [inset]);
  useEffect(
    () => () => {
      if (usePlaySession.getState().botInset !== 0) usePlaySession.getState().setBotInset(0);
    },
    [],
  );

  /** Remembers where Pip was put. Dropped close to home (`snap`), he goes home. */
  const place = useCallback(
    (next: Point | 'home', snap: boolean) => {
      const clamped = next === 'home' ? null : clampPoint(next, bounds);
      if (clamped === null || (snap && isNearDock(clamped, dock))) {
        setFraction(null);
        void db.kv.delete(positionKey(childId)).catch(() => undefined);
        return;
      }
      const share = toFraction(clamped, bounds);
      setFraction(share);
      const value: StoredPosition = { v: 1, fx: share.fx, fy: share.fy };
      void db.kv.put({ key: positionKey(childId), value }).catch(() => undefined);
    },
    [bounds, dock, childId],
  );

  // --- Pip's face ---------------------------------------------------------------
  const shown = pipStateFor({
    base: session.botState,
    speaking,
    listening,
    reading: session.reading,
    story: phase === 'story',
  });
  const [pipState, react] = usePipMood(shown);
  const lastTap = useRef(0);

  const wiggle = useAnimationControls();
  const firstWiggle = useRef(session.wiggle);
  useEffect(() => {
    if (session.wiggle === firstWiggle.current) return;
    firstWiggle.current = session.wiggle;
    if (calm) return;
    void wiggle.start({ rotate: [0, -12, 10, -7, 5, 0], transition: { duration: 0.8, ease: 'easeInOut' } });
  }, [session.wiggle, calm, wiggle]);

  // --- the panel ------------------------------------------------------------------
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const moveHintId = useId();

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    usePlaySession.getState().setPanelOpen(next);
  }, []);

  const closePanel = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) buttonRef.current?.focus();
    },
    [setOpen],
  );

  // A new challenge starts with the panel closed.
  useEffect(() => {
    setOpen(false);
  }, [session.challengeId, setOpen]);
  useEffect(() => () => usePlaySession.getState().setPanelOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    first?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, setOpen]);

  const tap = useCallback(() => {
    const at = Date.now();
    if (at - lastTap.current < BOT.doubleTapMs) react('giggle', 1400);
    lastTap.current = at;
    setOpen(!open);
  }, [open, react, setOpen]);

  // --- dragging ---------------------------------------------------------------------
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    skipClick.current = false;
    // While a sheet is open Pip stays at home: a press is a tap.
    if (sheetOpen) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: point, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < BOT.tapSlop) return;
    current.moved = true;
    setDragPoint(clampPoint({ x: current.origin.x + dx, y: current.origin.y + dy }, bounds));
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!current.moved) return;
    // The click that follows a drag must not open the panel.
    skipClick.current = true;
    const end = clampPoint({ x: current.origin.x + event.clientX - current.startX, y: current.origin.y + event.clientY - current.startY }, bounds);
    setDragPoint(null);
    place(end, true);
  };
  const onClick = () => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    tap();
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? BOT.keyStepBig : BOT.keyStep;
    const moves: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (event.key === 'Home') {
      event.preventDefault();
      if (!sheetOpen) place('home', false);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closePanel(true);
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    if (sheetOpen) return;
    // No snapping here: a short step away from home has to leave home.
    place({ x: point.x + move.x, y: point.y + move.y }, false);
  };

  // --- the speech bubble ---------------------------------------------------------------
  const bubbleShown = botLine !== null && !open;
  useEffect(() => {
    if (botLine === null || session.botLineSticky) return;
    const timer = setTimeout(() => usePlaySession.getState().dismissBotLine(botLineId), lineLifetimeMs(botLine));
    return () => clearTimeout(timer);
  }, [botLine, botLineId, session.botLineSticky]);

  // The bubble lies over the page (on a phone over the picture, on a tablet over the top of the
  // answer column): touching the page puts a plain line away, so it never stays on top of what
  // the child wants to use. (An offer stays until it is answered; every line is kept in the
  // panel's conversation.)
  const bubbleRef = useRef<HTMLDivElement>(null);
  // A long line (a hint may have 300 letters) does not make the bubble grow over the question and
  // the answers: the text has a limited height and scrolls inside, and an arrow says there is more.
  const lineRef = useRef<HTMLParagraphElement>(null);
  const [lineMore, setLineMore] = useState(false);
  const measureLine = useCallback(() => {
    const el = lineRef.current;
    setLineMore(el !== null && el.scrollHeight - el.clientHeight - el.scrollTop > 8);
  }, []);
  useLayoutEffect(() => {
    measureLine();
  }, [measureLine, bubbleShown, botLine, botLineId]);
  useEffect(() => {
    if (!bubbleShown) return;
    window.addEventListener('resize', measureLine);
    return () => window.removeEventListener('resize', measureLine);
  }, [bubbleShown, measureLine]);
  const readOn = () => {
    const el = lineRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.max(48, el.clientHeight - 32), behavior: calm ? 'auto' : 'smooth' });
  };
  useEffect(() => {
    if (!bubbleShown || botOffer !== null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      usePlaySession.getState().dismissBotLine(botLineId);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [bubbleShown, botOffer, botLineId]);

  // --- talking to Pip ---------------------------------------------------------------------
  const [micNote, setMicNote] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const press = useRef({ at: 0, started: false });
  const micOn = controls?.microphone === true && voiceSupport().stt;
  const chatOn = controls?.openChat === true;

  /** The recording that is running: its number while the microphone is open for the panel, else 0. */
  const recording = useRef(0);
  const recordings = useRef(0);

  const listen = useCallback(async () => {
    setMicNote(null);
    recordings.current += 1;
    const mine = recordings.current;
    recording.current = mine;
    try {
      const heard = await listenOnce();
      // The panel was closed in the meantime: nothing that was said after that is passed on.
      if (recording.current !== mine) return;
      recording.current = 0;
      await usePlaySession.getState().askBot(heard);
    } catch (error) {
      if (recording.current !== mine) return;
      recording.current = 0;
      const code = error instanceof Error ? error.message : '';
      setMicNote(code === 'denied' || code === 'unsupported' ? 'bot.mic.denied' : 'bot.mic.again');
    }
  }, []);

  /**
   * The microphone is only open while its button is on screen. When the panel closes (the X,
   * a tap outside it, a new challenge) or Pip leaves the screen, a recording that is still
   * running ends at once and its transcript is dropped.
   */
  const releaseMic = useCallback(() => {
    if (recording.current === 0) return;
    recording.current = 0;
    press.current = { at: 0, started: false };
    cancelListening();
  }, []);
  useEffect(() => {
    if (!open) releaseMic();
  }, [open, releaseMic]);
  useEffect(() => releaseMic, [releaseMic]);

  const onMicDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (listening) {
      // A tap while listening: that was everything.
      press.current = { at: 0, started: false };
      stopListening();
      return;
    }
    // Hold to talk: the release must reach this button also when the pointer left it.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // No capture (an old browser, a pointer that is already gone): the release over the button still works.
    }
    press.current = { at: Date.now(), started: true };
    void listen();
  };
  const onMicUp = () => {
    // Hold to talk: letting go after a real hold ends the recording. A short tap keeps listening.
    if (press.current.started && Date.now() - press.current.at > 500) stopListening();
    press.current = { at: 0, started: false };
  };
  const onMicClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
    // Pointer presses were handled above; this is the keyboard (Enter or Space).
    if (event.detail !== 0) return;
    if (listening) stopListening();
    else void listen();
  };

  const onAsk = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = question.trim();
    if (text === '') return;
    setQuestion('');
    void usePlaySession.getState().askBot(text);
  };

  if (session.challengeId === null || phase === 'idle' || phase === 'loading' || !loaded) {
    return <div ref={probeRef} aria-hidden="true" className="pointer-events-none invisible fixed inset-0" style={PROBE_STYLE} />;
  }

  const actions = usePlaySession.getState();
  const helpOpen = phase === 'presenting' || phase === 'answering';
  const showHow = helpOpen && canWalkthrough({ answers: session.answers, hintsUsed: session.hintsUsed, walkthroughUsed: session.walkthroughUsed });
  const voiceOn = controls?.voiceOutput === true;
  const slow = session.voiceRate <= (PLAY.slowRate + PLAY.normalRate) / 2;
  const sheet = narrow;
  const bubbleBox = anchorBox(point, size, room.viewport, BOT.bubbleWidth);
  const panelBox = anchorBox(point, size, room.viewport, BOT.panelWidth);
  const sheetMax = Math.max(260, room.viewport.height - (room.top + size + BOT.margin * 3) - room.insets.bottom);
  const log = session.messages.filter((message) => message.kind !== 'read');

  return (
    <>
      <div ref={probeRef} aria-hidden="true" className="pointer-events-none invisible fixed inset-0" style={PROBE_STYLE} />

      <motion.div
        // Between his seat and his place next to Check he glides; under a finger he follows at once.
        className={cx('fixed z-40', dragPoint === null && !calm && !keepingUp && 'transition-[left,top] duration-300 ease-out')}
        style={{ left: point.x, top: point.y, width: size, height: size }}
        initial={calm ? false : { scale: 0.3, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 20 }}
        data-testid="helper-bot"
        data-docked={docked ? 'true' : 'false'}
        data-spot={sheetOpen ? 'seat' : !docked ? 'free' : low ? 'check' : 'seat'}
      >
        <motion.div animate={wiggle} className="h-full w-full">
          <button
            ref={buttonRef}
            type="button"
            aria-label={open ? t('bot.close') : t('bot.open')}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-describedby={moveHintId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={onClick}
            onKeyDown={onKeyDown}
            className={cx(
              'relative block h-full w-full touch-none select-none rounded-full border-4 bg-white shadow-lift',
              'transition-[border-color,transform] duration-150 active:scale-95',
              open || botOffer !== null ? 'border-sun-400' : 'border-brand-300',
              dragPoint !== null && 'cursor-grabbing',
            )}
          >
            <span className="pointer-events-none absolute inset-[5%] block">
              <Pip state={pipState} talking={speaking} size="100%" lookAt={calm ? null : 'pointer'} />
            </span>
          </button>
        </motion.div>
        <span id={moveHintId} className="sr-only">
          {t('bot.move')}
        </span>
      </motion.div>

      <AnimatePresence>
        {bubbleShown && (
          <motion.div
            key={botLineId}
            ref={bubbleRef}
            data-testid="bot-bubble"
            className="fixed z-40 rounded-3xl border-4 border-brand-300 bg-white px-4 py-3 text-ink-900 shadow-lift"
            style={{
              left: bubbleBox.left,
              width: bubbleBox.width,
              ...(bubbleBox.top !== null ? { top: bubbleBox.top } : { bottom: bubbleBox.bottom ?? 0 }),
            }}
            initial={calm ? false : { opacity: 0, scale: 0.9, y: bubbleBox.side === 'below' ? -8 : 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={calm ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
          >
            <span
              aria-hidden="true"
              className={cx(
                'absolute h-4 w-4 rotate-45 border-brand-300 bg-white',
                bubbleBox.side === 'below' ? '-top-2.5 border-l-4 border-t-4' : '-bottom-2.5 border-b-4 border-r-4',
              )}
              style={{ left: bubbleBox.tailLeft - 8 }}
            />
            <div className="relative flex items-start gap-1">
              <p
                ref={lineRef}
                role="status"
                onScroll={measureLine}
                className="max-h-[max(9rem,30dvh)] min-w-0 flex-1 overflow-y-auto overscroll-contain break-words py-1 text-lg font-bold leading-snug"
              >
                {botLine}
              </p>
              {lineMore && (
                <>
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-white/0" />
                  <button
                    type="button"
                    data-line-more=""
                    aria-label={t('bot.line.more')}
                    onClick={readOn}
                    className="absolute -right-2 -bottom-2 flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand-300 bg-white text-xl font-bold text-brand-700 shadow-card"
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                </>
              )}
              <IconButton
                aria-label={t('bot.line.close')}
                size="lg"
                onClick={() => actions.dismissBotLine(botLineId)}
                className="-mr-3 -mt-2 text-base text-ink-500"
              >
                ✕
              </IconButton>
            </div>
            {botOffer !== null && (
              <div className="mt-2 flex flex-wrap gap-3">
                {/* A label never breaks in two: when both do not fit side by side, the second button goes below. */}
                <BigButton tone="sun" size="md" className="flex-1 whitespace-nowrap px-3!" onClick={() => void actions.acceptOffer()}>
                  {t('bot.offer.yes')}
                </BigButton>
                <BigButton tone="white" size="md" className="flex-1 whitespace-nowrap px-3!" onClick={() => actions.dismissBotLine(botLineId)}>
                  {t('bot.offer.no')}
                </BigButton>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          data-testid="bot-panel"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            closePanel(true);
          }}
          className={cx(
            'fixed z-[45] flex flex-col gap-3 overflow-hidden rounded-[2rem] border-4 border-brand-300 bg-white p-4 text-ink-900 shadow-lift',
            sheet && 'inset-x-2',
          )}
          style={
            sheet
              ? { bottom: room.insets.bottom + BOT.margin, maxHeight: sheetMax }
              : {
                  left: panelBox.left,
                  width: panelBox.width,
                  maxHeight: panelBox.maxHeight,
                  ...(panelBox.top !== null ? { top: panelBox.top } : { bottom: panelBox.bottom ?? 0 }),
                }
          }
          initial={calm ? false : { opacity: 0, y: sheet ? 24 : 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18 }}
        >
          <div className="flex items-center gap-2">
            <h2 id={titleId} className="min-w-0 flex-1 font-display text-2xl font-bold leading-tight">
              {t('bot.panel.title')}
            </h2>
            <IconButton aria-label={t('bot.panel.close')} variant="soft" size="lg" onClick={() => closePanel(true)}>
              ✕
            </IconButton>
          </div>

          {(voiceOn || helpOpen) && (
            <div className="flex shrink-0 gap-2">
              {voiceOn &&
                (speaking ? (
                  <BigButton tone="coral" size="md" emoji="⏹️" className={ACTION_TILE} data-autofocus="" onClick={() => actions.stopReading()}>
                    {t('bot.stop')}
                  </BigButton>
                ) : (
                  <BigButton tone="sky" size="md" emoji="🔊" className={ACTION_TILE} data-autofocus="" onClick={() => actions.requestRead()}>
                    {t('bot.read')}
                  </BigButton>
                ))}
              {helpOpen && (
                <BigButton
                  tone="sun"
                  size="md"
                  emoji="💡"
                  className={ACTION_TILE}
                  disabled={session.thinking || session.walkthroughOpen}
                  {...(voiceOn ? {} : { 'data-autofocus': '' })}
                  onClick={() => {
                    closePanel(true);
                    void actions.requestHint();
                  }}
                >
                  {t('bot.hint')}
                </BigButton>
              )}
              {showHow && (
                <BigButton
                  tone="leaf"
                  size="md"
                  emoji="🪜"
                  className={ACTION_TILE}
                  disabled={session.thinking}
                  onClick={() => {
                    closePanel(true);
                    void actions.requestWalkthrough();
                  }}
                >
                  {t('bot.showHow')}
                </BigButton>
              )}
            </div>
          )}

          <div className="min-h-20 flex-1 overflow-y-auto pr-1">
            <Conversation messages={log} thinking={session.thinking} />
          </div>

          {(micOn || chatOn) && (
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-center gap-2">
                {micOn && (
                  <button
                    type="button"
                    aria-label={listening ? t('bot.mic.listening') : t('bot.mic')}
                    aria-pressed={listening}
                    onPointerDown={onMicDown}
                    onPointerUp={onMicUp}
                    onPointerCancel={onMicUp}
                    onClick={onMicClick}
                    className={cx(
                      'flex h-14 w-14 shrink-0 touch-none select-none items-center justify-center rounded-full text-2xl leading-none shadow-card',
                      listening ? 'animate-pulse bg-coral-400 text-ink-900' : 'bg-brand-500 text-white',
                    )}
                  >
                    <span aria-hidden="true">🎤</span>
                  </button>
                )}
                {chatOn && (
                  <form onSubmit={onAsk} className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="text"
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      maxLength={PLAY.chatMaxLength}
                      aria-label={t('bot.ask.label')}
                      placeholder={t('bot.ask.placeholder')}
                      autoComplete="off"
                      enterKeyHint="send"
                      className="min-h-14 min-w-0 flex-1 rounded-2xl border-2 border-brand-200 bg-white px-4 text-lg font-semibold text-ink-900 focus:border-brand-500"
                    />
                    <IconButton type="submit" aria-label={t('bot.ask.send')} variant="solid" size="lg" disabled={question.trim() === ''}>
                      ➤
                    </IconButton>
                  </form>
                )}
                {micOn && !chatOn && (
                  <span className="text-base font-bold text-ink-700" aria-hidden="true">
                    {listening ? t('bot.mic.listening') : t('bot.mic')}
                  </span>
                )}
              </div>
              {micNote !== null && (
                <p role="status" className="text-base font-semibold text-ink-700">
                  {t(micNote)}
                </p>
              )}
            </div>
          )}

          {voiceOn && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t-2 border-ink-100 pt-3">
              <button
                type="button"
                aria-pressed={!session.muted}
                aria-label={t('bot.voice.label')}
                onClick={() => actions.setMuted(!session.muted)}
                className={cx(
                  'inline-flex min-h-14 items-center gap-2 rounded-2xl border-2 px-4 font-display text-lg font-bold',
                  session.muted ? 'border-ink-200 bg-ink-50 text-ink-700' : 'border-leaf-400 bg-leaf-100 text-ink-900',
                )}
              >
                <span aria-hidden="true">{session.muted ? '🔇' : '🔈'}</span>
                <span aria-hidden="true">{session.muted ? t('bot.voice.off') : t('bot.voice.on')}</span>
              </button>
              <div role="radiogroup" aria-label={t('bot.speed')} className="ml-auto inline-flex rounded-2xl border-2 border-brand-200 bg-brand-50 p-1">
                <SpeedOption label={t('bot.speed.slow')} emoji="🐢" selected={slow} onSelect={() => actions.setVoiceRate(PLAY.slowRate)} />
                <SpeedOption label={t('bot.speed.normal')} emoji="🐇" selected={!slow} onSelect={() => actions.setVoiceRate(PLAY.normalRate)} />
              </div>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}

/** The three ways to get help sit side by side, so they are always in view above the conversation. */
const ACTION_TILE = 'min-w-0 flex-1 basis-0 flex-col! gap-1! px-2! py-2! text-base! sm:text-lg!';

const PROBE_STYLE = {
  paddingTop: 'env(safe-area-inset-top, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
} as const;

function SpeedOption({ label, emoji, selected, onSelect }: { label: string; emoji: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={cx(
        'inline-flex min-h-12 min-w-14 items-center justify-center gap-1 rounded-xl px-3 font-display text-base font-bold',
        selected ? 'bg-brand-500 text-white shadow-card' : 'text-ink-700',
      )}
    >
      <span aria-hidden="true" className="text-xl leading-none">
        {emoji}
      </span>
      <span aria-hidden="true" className="hidden min-[400px]:inline">
        {label}
      </span>
    </button>
  );
}

/** The conversation on this challenge, as short bubbles: Pip on the left, the child on the right. */
function Conversation({ messages, thinking }: { messages: BotMessage[]; thinking: boolean }) {
  const t = useT();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages.length, thinking]);

  return (
    <div role="log" aria-label={t('bot.log')} className="flex min-h-16 flex-col gap-2 rounded-3xl bg-brand-50 p-3">
      {messages.length === 0 && !thinking && <p className="py-2 text-center text-base font-semibold text-ink-700">{t('bot.log.empty')}</p>}
      {messages.map((message) => (
        <p
          key={message.id}
          data-role={message.role}
          className={cx(
            'max-w-[88%] break-words rounded-2xl px-3 py-2 text-base font-semibold leading-snug',
            message.role === 'bot' ? 'self-start rounded-bl-md bg-white text-ink-900 shadow-card' : 'self-end rounded-br-md bg-sun-300 text-ink-900',
          )}
        >
          <span className="sr-only">{message.role === 'bot' ? `${t('bot.pip')}: ` : `${t('bot.you')}: `}</span>
          {message.text}
        </p>
      ))}
      {thinking && (
        <p className="self-start rounded-2xl rounded-bl-md bg-white px-3 py-2 text-base font-semibold text-ink-700 shadow-card">{t('bot.thinking')}</p>
      )}
      <div ref={endRef} />
    </div>
  );
}
