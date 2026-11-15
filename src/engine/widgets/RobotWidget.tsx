import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { motion, Reorder, useDragControls } from 'motion/react';
import type { RobotInteraction } from '@/core/schemas';
import { cellKey, REPEAT_MAX, REPEAT_MIN, runRobotDetailed, type RobotDir } from '../robot';
import type { WidgetProps } from './ChoiceWidget';
import { cx, fill, FOCUS_RING, SrOnly, type StageLabels } from './common';
import {
  addBlock,
  countBlockTree,
  depthOf,
  expandWithSource,
  findBlock,
  makeBlock,
  MAX_BLOCK_DEPTH,
  moveBlock,
  removeBlock,
  reorderList,
  setTimes,
  toProgram,
  type Block,
  type BlockCmd,
} from './robotBlocks';

const STEP_MS = 430;
const CRASH_PAUSE_MS = 1100;

const DIR_ANGLE: Record<RobotDir, number> = { up: 0, right: 90, down: 180, left: 270 };
const DIR_DELTA: Record<RobotDir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  right: { dx: 1, dy: 0 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
};

const CMD_ORDER: BlockCmd[] = ['forward', 'left', 'right', 'repeat'];
const CMD_ICON: Record<BlockCmd, string> = { forward: '⬆️', left: '↩️', right: '↪️', repeat: '🔁' };
const CMD_STYLE: Record<BlockCmd, string> = {
  forward: 'bg-leaf-400/25 border-leaf-400',
  left: 'bg-sun-300/60 border-sun-400',
  right: 'bg-sun-300/60 border-sun-400',
  repeat: 'bg-brand-100 border-brand-300',
};

type Outcome = 'crash' | 'short' | 'gems' | 'done';

interface Sim {
  x: number;
  y: number;
  angle: number;
  collected: number[];
  /** uid of the block being run, for the highlight in the program. */
  activeUid: string | null;
  /** Set while the robot bumps into something. */
  bump: { dx: number; dy: number } | null;
  running: boolean;
}

function cmdLabel(cmd: BlockCmd, labels: StageLabels): string {
  switch (cmd) {
    case 'forward':
      return labels.forward;
    case 'left':
      return labels.turnLeft;
    case 'right':
      return labels.turnRight;
    case 'repeat':
      return labels.repeat;
  }
}

interface Ops {
  labels: StageLabels;
  disabled: boolean;
  target: string | null;
  activeUid: string | null;
  setTarget: (uid: string | null) => void;
  remove: (uid: string) => void;
  move: (uid: string, delta: -1 | 1) => void;
  times: (uid: string, times: number) => void;
  reorder: (parentUid: string | null, ordered: Block[]) => void;
}

const SMALL_BUTTON = cx(
  'flex h-14 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-brand-100 bg-white text-xl font-black text-brand-700',
  FOCUS_RING,
);
const STEPPER_BUTTON = cx(
  'flex h-14 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-brand-300 bg-white text-2xl font-black text-brand-700',
  FOCUS_RING,
);

function BlockRow({ block, index, count, depth, ops }: { block: Block; index: number; count: number; depth: number; ops: Ops }): JSX.Element {
  const controls = useDragControls();
  const { labels, disabled } = ops;
  const name = cmdLabel(block.cmd, labels);
  const isTarget = ops.target === block.uid;
  const off = (flag: boolean): string => (flag ? 'opacity-30' : '');
  return (
    <Reorder.Item
      value={block}
      dragListener={false}
      dragControls={controls}
      className={cx(
        'flex flex-col gap-2 rounded-2xl border-4 p-1.5 text-lg font-bold text-ink-900',
        CMD_STYLE[block.cmd],
        ops.activeUid === block.uid && 'ring-4 ring-brand-500',
      )}
      data-block={block.cmd}
    >
      {/* On narrow screens the three controls wrap under the name instead of spilling out. */}
      <div className="flex min-h-14 flex-wrap items-center gap-1.5">
        <span
          aria-hidden="true"
          title={fill(labels.drag, { item: name })}
          onPointerDown={(event) => {
            if (!disabled) controls.start(event);
          }}
          style={{ touchAction: 'none' }}
          className="flex h-14 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-xl text-ink-500 active:cursor-grabbing"
        >
          ⠿
        </span>
        <span aria-hidden="true" className="text-2xl leading-none">
          {CMD_ICON[block.cmd]}
        </span>
        {/* A long name ("Turn right" on a phone) takes two lines rather than being cut off. */}
        <span className="min-w-16 flex-1 break-words leading-tight">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={fill(labels.moveEarlier, { item: name })}
            aria-disabled={disabled || index === 0}
            onClick={() => ops.move(block.uid, -1)}
            className={cx(SMALL_BUTTON, off(disabled || index === 0))}
          >
            <span aria-hidden="true">▲</span>
          </button>
          <button
            type="button"
            aria-label={fill(labels.moveLater, { item: name })}
            aria-disabled={disabled || index === count - 1}
            onClick={() => ops.move(block.uid, 1)}
            className={cx(SMALL_BUTTON, off(disabled || index === count - 1))}
          >
            <span aria-hidden="true">▼</span>
          </button>
          <button
            type="button"
            aria-label={fill(labels.remove, { item: name })}
            disabled={disabled}
            onClick={() => ops.remove(block.uid)}
            className={SMALL_BUTTON}
          >
            <span aria-hidden="true">🗑️</span>
          </button>
        </span>
      </div>
      {block.cmd === 'repeat' ? (
        <div className="ml-1 flex flex-col gap-2 rounded-xl border-l-4 border-brand-300 bg-white/70 p-1.5">
          <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={`${name}: ${block.times} ${labels.times}`}>
            <button
              type="button"
              aria-label={labels.fewer}
              aria-disabled={disabled || block.times <= REPEAT_MIN}
              onClick={() => ops.times(block.uid, block.times - 1)}
              className={cx(STEPPER_BUTTON, off(disabled || block.times <= REPEAT_MIN))}
            >
              <span aria-hidden="true">−</span>
            </button>
            <span className="px-1 text-center text-xl font-extrabold tabular-nums" aria-live="polite">
              {block.times} {labels.times}
            </span>
            <button
              type="button"
              aria-label={labels.more}
              aria-disabled={disabled || block.times >= REPEAT_MAX}
              onClick={() => ops.times(block.uid, block.times + 1)}
              className={cx(STEPPER_BUTTON, off(disabled || block.times >= REPEAT_MAX))}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
          <BlockList blocks={block.body} parentUid={block.uid} depth={depth + 1} ops={ops} />
          <button
            type="button"
            disabled={disabled}
            aria-pressed={isTarget}
            onClick={() => ops.setTarget(block.uid)}
            className={cx(
              'min-h-14 rounded-xl border-4 border-dashed px-2 text-base font-bold',
              isTarget ? 'border-brand-500 bg-brand-100 text-brand-700' : 'border-brand-300 bg-white text-ink-500',
              FOCUS_RING,
            )}
          >
            <span aria-hidden="true">{isTarget ? '👉 ' : '＋ '}</span>
            {labels.addHere}
          </button>
        </div>
      ) : null}
    </Reorder.Item>
  );
}

function BlockList({ blocks, parentUid, depth, ops }: { blocks: Block[]; parentUid: string | null; depth: number; ops: Ops }): JSX.Element {
  return (
    <Reorder.Group
      axis="y"
      values={blocks}
      onReorder={(next: Block[]) => ops.reorder(parentUid, next)}
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {blocks.map((block, index) => (
        <BlockRow key={block.uid} block={block} index={index} count={blocks.length} depth={depth} ops={ops} />
      ))}
    </Reorder.Group>
  );
}

/**
 * Robot Coder: a grid board, a palette of command blocks, and a program the
 * child builds top to bottom. "Run" plays the program step by step so the
 * child can see where it goes wrong before pressing Check.
 */
export function RobotWidget({ interaction, value, onChange, disabled, reducedMotion, labels }: WidgetProps<RobotInteraction, Block[]>): JSX.Element {
  const [targetRaw, setTarget] = useState<string | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [bumpCount, setBumpCount] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // The target repeat may have been removed since it was chosen.
  const target = targetRaw !== null && findBlock(value, targetRaw)?.cmd === 'repeat' ? targetRaw : null;
  const used = countBlockTree(value);
  const full = used >= interaction.maxCommands;
  const allowed = useMemo(() => CMD_ORDER.filter((cmd) => interaction.allowed.includes(cmd)), [interaction.allowed]);
  const repeatFits = target === null || depthOf(value, target) + 1 < MAX_BLOCK_DEPTH;

  const stop = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => stop, [stop]);

  /** Any change to the program ends the current run and puts the robot back. */
  const edit = useCallback(
    (next: Block[]) => {
      stop();
      setSim(null);
      setOutcome(null);
      onChange(next);
    },
    [onChange, stop],
  );

  const add = (cmd: BlockCmd): void => {
    if (disabled || full) return;
    if (cmd === 'repeat' && !repeatFits) return;
    const block = makeBlock(cmd);
    edit(addBlock(value, target, block));
    // The next blocks go inside the new repeat: tap Repeat, then what to repeat.
    if (cmd === 'repeat') setTarget(block.uid);
  };

  const ops: Ops = {
    labels,
    disabled,
    target,
    activeUid: sim?.activeUid ?? null,
    setTarget,
    remove: (uid) => edit(removeBlock(value, uid)),
    move: (uid, delta) => {
      if (!disabled) edit(moveBlock(value, uid, delta));
    },
    times: (uid, times) => {
      if (!disabled && times >= REPEAT_MIN && times <= REPEAT_MAX) edit(setTimes(value, uid, times));
    },
    reorder: (parentUid, ordered) => {
      if (!disabled) edit(reorderList(value, parentUid, ordered));
    },
  };

  const run = (): void => {
    if (value.length === 0) return;
    stop();
    setOutcome(null);
    const detail = runRobotDetailed(interaction, toProgram(value));
    const sources = expandWithSource(value);
    const startCollected: number[] = [];
    interaction.gems.forEach((gem, index) => {
      if (gem.x === interaction.start.x && gem.y === interaction.start.y) startCollected.push(index);
    });
    let state: Sim = {
      x: interaction.start.x,
      y: interaction.start.y,
      angle: DIR_ANGLE[interaction.start.dir],
      collected: startCollected,
      activeUid: null,
      bump: null,
      running: true,
    };
    setSim(state);

    const finish = (): void => {
      const onGoal = state.x === interaction.goal.x && state.y === interaction.goal.y;
      setSim({ ...state, activeUid: null, running: false });
      setOutcome(detail.reached ? 'done' : onGoal && detail.gems < new Set(interaction.gems.map((g) => cellKey(g.x, g.y))).size ? 'gems' : 'short');
    };

    const step = (k: number): void => {
      const entry = detail.trace[k];
      if (!entry) {
        finish();
        return;
      }
      const activeUid = sources[k]?.uid ?? null;
      if (entry.crashed) {
        const d = DIR_DELTA[entry.from.dir];
        state = { ...state, activeUid, bump: { dx: d.dx, dy: d.dy } };
        setSim(state);
        setBumpCount((n) => n + 1);
        setOutcome('crash');
        timers.current.push(
          setTimeout(() => {
            setSim(null); // back to the start
          }, CRASH_PAUSE_MS),
        );
        return;
      }
      const turn = entry.cmd === 'left' ? -90 : entry.cmd === 'right' ? 90 : 0;
      state = {
        ...state,
        x: entry.to.x,
        y: entry.to.y,
        angle: state.angle + turn,
        collected: entry.gemIndex === null ? state.collected : [...state.collected, entry.gemIndex],
        activeUid,
      };
      setSim(state);
      timers.current.push(setTimeout(() => step(k + 1), STEP_MS));
    };
    timers.current.push(setTimeout(() => step(0), reducedMotion ? 0 : 200));
  };

  const halt = (): void => {
    stop();
    setSim(null);
    setOutcome(null);
  };

  const { cols, rows } = interaction;
  const walls = useMemo(() => new Set(interaction.walls.map((w) => cellKey(w.x, w.y))), [interaction.walls]);
  const gemAt = useMemo(() => {
    const map = new Map<string, number>();
    interaction.gems.forEach((gem, index) => {
      if (!map.has(cellKey(gem.x, gem.y))) map.set(cellKey(gem.x, gem.y), index);
    });
    return map;
  }, [interaction.gems]);

  const robotX = sim?.x ?? interaction.start.x;
  const robotY = sim?.y ?? interaction.start.y;
  const robotAngle = sim?.angle ?? DIR_ANGLE[interaction.start.dir];
  const collected = new Set(sim?.collected ?? []);
  const running = sim?.running === true;
  const moveTransition = reducedMotion ? { duration: 0 } : { duration: (STEP_MS - 80) / 1000, ease: 'easeInOut' as const };

  const boardLabel = `${labels.robotBoard}: ${cols} × ${rows}. ${interaction.robotEmoji} ${interaction.start.x + 1}, ${interaction.start.y + 1} (${interaction.start.dir}). ${interaction.goalEmoji} ${interaction.goal.x + 1}, ${interaction.goal.y + 1}. 🧱 ${walls.size}. 💎 ${gemAt.size}.`;

  const outcomeText =
    outcome === 'crash' ? labels.robotCrash : outcome === 'short' ? labels.robotShort : outcome === 'gems' ? labels.robotGems : outcome === 'done' ? labels.robotDone : '';

  const cells: JSX.Element[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = cellKey(x, y);
      const isWall = walls.has(key);
      const isGoal = interaction.goal.x === x && interaction.goal.y === y;
      const gemIndex = gemAt.get(key);
      const hasGem = gemIndex !== undefined && !collected.has(gemIndex);
      cells.push(
        <div
          key={key}
          className={cx(
            'flex items-center justify-center rounded-[18%] leading-none',
            isWall ? 'bg-ink-700 shadow-inner' : (x + y) % 2 === 0 ? 'bg-brand-50' : 'bg-brand-100',
            isGoal && 'bg-sun-300',
          )}
        >
          {isWall ? '🧱' : isGoal ? interaction.goalEmoji : hasGem ? '💎' : ''}
        </div>,
      );
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative mx-auto w-full max-w-md rounded-2xl bg-white p-1 shadow-sm [container-type:inline-size]"
        role="img"
        aria-label={boardLabel}
      >
        <div className="relative w-full" style={{ aspectRatio: `${cols} / ${rows}`, fontSize: `${Math.round(620 / cols) / 10}cqw` }}>
          <div
            className="absolute inset-0 grid gap-[2%]"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
          >
            {cells}
          </div>
          <motion.div
            className="pointer-events-none absolute flex items-center justify-center"
            style={{ width: `${100 / cols}%`, height: `${100 / rows}%` }}
            initial={false}
            animate={{ left: `${(robotX * 100) / cols}%`, top: `${(robotY * 100) / rows}%` }}
            transition={moveTransition}
          >
            <motion.div
              key={bumpCount}
              className="relative flex h-full w-full items-center justify-center leading-none"
              animate={
                sim?.bump && !reducedMotion
                  ? { x: [0, sim.bump.dx * 14, -sim.bump.dx * 6, sim.bump.dx * 4, 0], y: [0, sim.bump.dy * 14, -sim.bump.dy * 6, sim.bump.dy * 4, 0], rotate: [0, -8, 8, -4, 0] }
                  : { x: 0, y: 0, rotate: 0 }
              }
              transition={{ duration: 0.5 }}
            >
              <motion.span
                className="absolute inset-0"
                initial={false}
                animate={{ rotate: robotAngle }}
                transition={moveTransition}
                aria-hidden="true"
              >
                {/* Pointer on the edge the robot is facing. */}
                <span className="absolute top-[2%] left-1/2 h-0 w-0 -translate-x-1/2 border-x-[0.22em] border-b-[0.3em] border-x-transparent border-b-coral-600" />
              </motion.span>
              <span className="relative">{interaction.robotEmoji}</span>
              {sim?.bump ? <span className="absolute -top-[10%] -right-[10%] text-[0.6em]">💥</span> : null}
            </motion.div>
          </motion.div>
        </div>
      </div>

      <p className="min-h-6 text-center text-base font-bold text-brand-700" role="status" aria-live="polite">
        {outcomeText}
      </p>
      {interaction.gems.length > 0 ? (
        <p className="text-center text-base font-bold text-ink-700">
          <span aria-hidden="true">💎 </span>
          {fill(labels.gems, { n: collected.size, total: gemAt.size })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={labels.palette}>
        {allowed.map((cmd) => {
          const blocked = disabled || full || (cmd === 'repeat' && !repeatFits);
          return (
            <motion.button
              key={cmd}
              type="button"
              whileTap={blocked ? undefined : { scale: 0.94 }}
              disabled={blocked}
              onClick={() => add(cmd)}
              className={cx(
                'flex min-h-14 items-center justify-center gap-2 rounded-2xl border-4 px-2 text-lg font-extrabold text-ink-900 shadow-sm disabled:opacity-40',
                CMD_STYLE[cmd],
                FOCUS_RING,
              )}
            >
              <span aria-hidden="true" className="text-2xl leading-none">
                {CMD_ICON[cmd]}
              </span>
              {cmdLabel(cmd, labels)}
            </motion.button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-3xl bg-white p-2 shadow-sm">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="m-0 text-lg font-extrabold text-ink-900">{labels.program}</h3>
          <span
            className={cx('rounded-full px-3 py-1 text-base font-extrabold tabular-nums', full ? 'bg-sun-300 text-ink-900' : 'bg-brand-50 text-brand-700')}
            role="status"
          >
            {fill(labels.blocksUsed, { n: used, max: interaction.maxCommands })}
          </span>
        </div>
        {value.length === 0 ? (
          <p className="rounded-2xl border-4 border-dashed border-brand-100 p-4 text-center text-base font-semibold text-ink-500">
            {labels.emptyProgram}
          </p>
        ) : (
          <BlockList blocks={value} parentUid={null} depth={0} ops={ops} />
        )}
        {target !== null ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setTarget(null)}
            className={cx('min-h-14 rounded-xl border-4 border-dashed border-brand-300 bg-white px-3 text-base font-bold text-ink-500', FOCUS_RING)}
          >
            <span aria-hidden="true">＋ </span>
            {labels.addToEnd}
          </button>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={disabled || value.length === 0}
            onClick={running ? halt : run}
            className={cx(
              'min-h-14 flex-1 rounded-2xl bg-brand-500 px-4 text-xl font-extrabold text-white shadow-sm disabled:opacity-40',
              FOCUS_RING,
            )}
          >
            <span aria-hidden="true">{running ? '⏹ ' : '▶ '}</span>
            {running ? labels.stop : labels.run}
          </button>
          <button
            type="button"
            disabled={disabled || value.length === 0}
            onClick={() => {
              setTarget(null);
              edit([]);
            }}
            className={cx('min-h-14 rounded-2xl border-4 border-brand-100 bg-white px-4 text-lg font-bold text-ink-700 disabled:opacity-40', FOCUS_RING)}
          >
            {labels.clear}
          </button>
        </div>
      </div>
      <SrOnly live>{sim?.activeUid ? cmdLabel(findBlock(value, sim.activeUid)?.cmd ?? 'forward', labels) : ''}</SrOnly>
    </div>
  );
}
