/**
 * Records a solved challenge: the attempt itself, the skill state, stage
 * history, stars, the companion, the streak, badges and the session counter.
 *
 * Everything is written in one transaction, and recording the same challenge
 * twice returns the stored attempt without awarding anything again.
 */
import Dexie from 'dexie';
import { makeStage, newId } from '@/core/grades';
import { getSkill } from '@/core/skills';
import { STRANDS } from '@/core/types';
import type {
  AnswerEvent,
  AttemptRecord,
  AttemptResult,
  ChallengeRecord,
  ChildProfile,
  RewardRecord,
  SkillState,
  StageChange,
  Strand,
} from '@/core/types';
import { db } from '@/data';
import { badgeReason } from './catalog';
import { aggregateStrandStage, applyAttempt, clampToSkill, newSkillState, skillStateId } from './mastery';
import { detectFrustration, outcomeOf, wrongTries } from './outcome';
import {
  applyPlacementAttempt,
  isPlacementComplete,
  readPlacement,
  runningPlacement,
  seedPlacementStates,
  writePlacement,
} from './placement';
import {
  companionGrowthReason,
  countAttempt,
  earnedBadgeKeys,
  feedCompanion,
  grantedBadgeKeys,
  loadCounters,
  makeReward,
  nextStreak,
  saveCounters,
  starReason,
  starsFor,
  streakReason,
} from './rewards';
import { TUNING } from './tuning';

export interface RecordAttemptInput {
  challenge: ChallengeRecord;
  /** Every answer the child submitted, oldest first. Ends with the correct one. */
  answers: AnswerEvent[];
  hintsUsed: 0 | 1 | 2;
  walkthroughUsed: boolean;
  teachBackCorrect: boolean | null;
  timeMs: number;
  now?: number;
}

function strandChange(
  childId: string,
  strand: Strand,
  from: number,
  to: number,
  reason: StageChange['reason'],
  at: number,
): StageChange {
  return { id: newId('sc'), childId, skillId: null, strand, from, to, reason, at };
}

/** `base` with the rows of `changed` replacing or joining it, by skill. */
function mergeStates(base: readonly SkillState[], changed: readonly SkillState[]): SkillState[] {
  const byId = new Map(base.map((state) => [state.id, state]));
  for (const state of changed) byId.set(state.id, state);
  return [...byId.values()];
}

/** The result for a challenge that was already recorded. Nothing is written. */
async function storedResult(attempt: AttemptRecord, child: ChildProfile | undefined): Promise<AttemptResult> {
  const { childId, skillId, strand, completedAt } = attempt;
  let skillState = await db.skillStates.get(skillStateId(childId, skillId));
  if (!skillState) {
    // During placement the skill states are not stored yet: show what will be seeded.
    const placement = await readPlacement(childId);
    const preview =
      placement && child ? seedPlacementStates(placement, child, [], completedAt) : [];
    skillState =
      preview.find((state) => state.skillId === skillId) ??
      newSkillState(childId, skillId, strand, clampToSkill(getSkill(skillId), makeStage(child?.grade ?? 'K')));
  }
  // Everything an attempt writes carries the attempt's own timestamp.
  const rewards = await db.rewards.where('[childId+at]').equals([childId, completedAt]).toArray();
  const stageChanges = await db.stageChanges
    .where('childId')
    .equals(childId)
    .filter((change) => change.at === completedAt)
    .toArray();
  return {
    attempt,
    skillState,
    masteryDelta: 0,
    stageChanges,
    rewards: rewards.filter((reward) => reward.kind !== 'collectible'),
    suggestBreak: false,
  };
}

/**
 * Writes the attempt, updates skill state, stage history, rewards, streak and
 * companion, and marks the challenge completed. Idempotent per challenge.
 */
export async function recordAttempt(input: RecordAttemptInput): Promise<AttemptResult> {
  const now = input.now ?? Date.now();
  const { challenge } = input;
  const { childId, skillId } = challenge;

  return db.transaction(
    'rw',
    [db.children, db.skillStates, db.stageChanges, db.challenges, db.attempts, db.rewards, db.sessions, db.kv],
    async (): Promise<AttemptResult> => {
      const child = await db.children.get(childId);
      const already = await db.attempts.where('challengeId').equals(challenge.id).first();
      if (already) return storedResult(already, child);
      if (!child) throw new Error(`Child profile not found: ${childId}`);

      const skill = getSkill(skillId);
      const strand = skill?.strand ?? challenge.strand;
      const outcome = outcomeOf(input);
      const stars = starsFor(outcome, input.teachBackCorrect);
      const attempt: AttemptRecord = {
        id: newId('att'),
        challengeId: challenge.id,
        childId,
        skillId,
        strand,
        answers: input.answers,
        hintsUsed: input.hintsUsed,
        walkthroughUsed: input.walkthroughUsed,
        teachBackCorrect: input.teachBackCorrect,
        outcome,
        timeMs: Number.isFinite(input.timeMs) ? Math.max(0, Math.round(input.timeMs)) : 0,
        starsEarned: stars,
        completedAt: now,
      };

      // ---- read everything before the first write ------------------------
      const statesBefore = await db.skillStates.where('childId').equals(childId).toArray();
      const storedPlacement = await readPlacement(childId);
      const countersBefore = await loadCounters(childId);
      const granted = await grantedBadgeKeys(childId);
      const earlier = await db.attempts
        .where('[childId+completedAt]')
        .between([childId, Dexie.minKey], [childId, Dexie.maxKey])
        .reverse()
        .limit(TUNING.frustration.walkthroughRun - 1)
        .toArray();
      const storedChallenge = await db.challenges.get(challenge.id);
      const strandHistory = await db.stageChanges
        .where('[childId+strand]')
        .equals([childId, strand])
        .filter((change) => change.skillId === null)
        .sortBy('at');
      const loggedStrandStage = strandHistory[strandHistory.length - 1]?.to ?? null;

      // ---- skill state and stages ----------------------------------------
      const stageChanges: StageChange[] = [];
      const stateWrites: SkillState[] = [];
      let skillState: SkillState;
      let masteryDelta = 0;
      let checkPassed = false;
      let skillSteppedUp = false;
      let strandMove: { from: number; to: number } | null = null;
      let placementFinished = false;

      if (challenge.purpose === 'placement' && !child.placementDone) {
        const placement = applyPlacementAttempt(
          runningPlacement(storedPlacement),
          child.grade,
          { skillId, strand, interaction: challenge.interaction },
          outcome,
        );
        await writePlacement(childId, placement);
        const seeded = seedPlacementStates(placement, child, statesBefore, now);
        skillState =
          seeded.find((state) => state.skillId === skillId) ??
          newSkillState(childId, skillId, strand, clampToSkill(skill, makeStage(child.grade)));
        if (isPlacementComplete(placement)) {
          placementFinished = true;
          stateWrites.push(...seeded);
          const after = mergeStates(statesBefore, seeded);
          for (const placed of STRANDS) {
            const from = placement.start[placed];
            const to = aggregateStrandStage(after, placed).stage;
            if (from === undefined || to === null) continue;
            stageChanges.push(strandChange(childId, placed, from, to, 'placement', now));
          }
        }
      } else {
        const strandBefore = aggregateStrandStage(statesBefore, strand).stage;
        const startStage = strandBefore ?? storedPlacement?.estimates[strand] ?? makeStage(child.grade, 'starting');
        const previous =
          statesBefore.find((state) => state.skillId === skillId) ??
          newSkillState(childId, skillId, strand, clampToSkill(skill, startStage));
        const update = applyAttempt(previous, skill, {
          purpose: challenge.purpose,
          outcome,
          teachBackCorrect: input.teachBackCorrect,
          interaction: challenge.interaction,
          now,
        });
        skillState = update.state;
        masteryDelta = update.masteryDelta;
        checkPassed = update.checkPassed;
        stateWrites.push(update.state);
        if (update.stageChange) {
          skillSteppedUp = update.stageChange.to > update.stageChange.from;
          stageChanges.push({
            id: newId('sc'),
            childId,
            skillId,
            strand,
            from: update.stageChange.from,
            to: update.stageChange.to,
            reason: update.stageChange.reason,
            at: now,
          });
        }
        // A strand-level change is written when a skill moved and took the strand's aggregate with it.
        // The weighted mean also drifts by a step when an easier or harder skill is simply practised
        // more; that is not progress or a step back, so it is folded into the next real change: the
        // history continues from the last level that was written down for the strand.
        const strandAfter = aggregateStrandStage(mergeStates(statesBefore, [update.state]), strand).stage;
        const baseline = loggedStrandStage ?? strandBefore;
        if (update.stageChange && baseline !== null && strandAfter !== null) {
          const skillWentUp = update.stageChange.to > update.stageChange.from;
          if (skillWentUp ? strandAfter > baseline : strandAfter < baseline) {
            strandMove = { from: baseline, to: strandAfter };
            stageChanges.push(
              strandChange(childId, strand, baseline, strandAfter, update.stageChange.reason, now),
            );
          }
        }
      }

      // ---- stars, companion, streak, badges ------------------------------
      const rewards: RewardRecord[] = [
        makeReward(childId, 'star', '', stars, starReason(outcome, input.teachBackCorrect), now),
      ];
      const fed = feedCompanion(child.companion, stars);
      if (fed.grew) {
        rewards.push(
          makeReward(childId, 'companion', fed.companion.species, 0, companionGrowthReason(fed.companion), now),
        );
      }
      const streak = nextStreak(child, now);
      if (streak.milestone !== null) {
        rewards.push(makeReward(childId, 'streak', String(streak.milestone), 0, streakReason(streak.milestone), now));
      }
      const counters = countAttempt(countersBefore, {
        strand,
        outcome,
        teachBackCorrect: input.teachBackCorrect,
        mode: challenge.mode,
        interaction: challenge.interaction,
        purpose: challenge.purpose,
      });
      const badgeKeys = earnedBadgeKeys({
        counters,
        outcome,
        purpose: challenge.purpose,
        strand,
        wrongTries: wrongTries(input.answers),
        now,
        skillSteppedUp,
        strandMove,
        checkPassed,
        placementFinished,
      });
      for (const key of badgeKeys) {
        if (!granted.has(key)) rewards.push(makeReward(childId, 'badge', key, 0, badgeReason(key), now));
      }

      // ---- should the child be offered a calmer pace? --------------------
      const walkthroughRun =
        outcome === 'walkthrough' &&
        earlier.length >= TUNING.frustration.walkthroughRun - 1 &&
        earlier.every((row) => row.outcome === 'walkthrough');
      const suggestBreak = detectFrustration(input.answers) || walkthroughRun;

      // ---- write -----------------------------------------------------------
      await db.attempts.add(attempt);
      if (stateWrites.length > 0) await db.skillStates.bulkPut(stateWrites);
      if (stageChanges.length > 0) await db.stageChanges.bulkAdd(stageChanges);
      await db.rewards.bulkAdd(rewards);
      await saveCounters(childId, counters);
      await db.children.put({
        ...child,
        stars: child.stars + stars,
        totalStars: child.totalStars + stars,
        companion: fed.companion,
        streakDays: streak.streakDays,
        lastPlayedDay: streak.lastPlayedDay,
        placementDone: child.placementDone || placementFinished,
      });
      const base = storedChallenge ?? challenge;
      await db.challenges.put({
        ...base,
        status: 'completed',
        startedAt: base.startedAt ?? now - attempt.timeMs,
        completedAt: now,
      });
      const openSessions = await db.sessions
        .where('childId')
        .equals(childId)
        .filter((session) => session.endedAt === null)
        .sortBy('startedAt');
      const current = openSessions[openSessions.length - 1];
      if (current) await db.sessions.update(current.id, { itemsCompleted: current.itemsCompleted + 1 });

      return { attempt, skillState, masteryDelta, stageChanges, rewards, suggestBreak };
    },
  );
}
