/**
 * Device-local database (IndexedDB through Dexie).
 *
 * Every record type is defined in `@/core/types`. Other modules may read and
 * write tables directly through `db`, and should use `useLiveQuery` from
 * `dexie-react-hooks` for reactive reads in React components.
 *
 * When changing indexes, add a new `.version(n)` block. Never edit a shipped one.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import { defaultSettings } from '@/core/defaults';
import type {
  AttemptRecord,
  ChallengeRecord,
  ChildProfile,
  HelperMessage,
  LearnerNotes,
  RewardRecord,
  SessionRecord,
  Settings,
  SkillState,
  StageChange,
  StoryRecord,
  UsageRecord,
  WeeklyReport,
} from '@/core/types';

/** Small key-value store for device secrets (e.g. the non-exportable CryptoKey). */
export interface KeyValueRecord {
  key: string;
  value: unknown;
}

export class IntelliLearnDB extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  children!: EntityTable<ChildProfile, 'id'>;
  skillStates!: EntityTable<SkillState, 'id'>;
  stageChanges!: EntityTable<StageChange, 'id'>;
  challenges!: EntityTable<ChallengeRecord, 'id'>;
  attempts!: EntityTable<AttemptRecord, 'id'>;
  messages!: EntityTable<HelperMessage, 'id'>;
  rewards!: EntityTable<RewardRecord, 'id'>;
  sessions!: EntityTable<SessionRecord, 'id'>;
  learnerNotes!: EntityTable<LearnerNotes, 'childId'>;
  usage!: EntityTable<UsageRecord, 'day'>;
  stories!: EntityTable<StoryRecord, 'id'>;
  weeklyReports!: EntityTable<WeeklyReport, 'id'>;
  kv!: Table<KeyValueRecord, string>;

  constructor(name = 'intelli-learn') {
    super(name);
    this.version(1).stores({
      settings: 'id',
      children: 'id, createdAt',
      skillStates: 'id, childId, [childId+strand], [childId+skillId], reviewDueAt',
      stageChanges: 'id, childId, [childId+strand], at',
      challenges:
        'id, childId, [childId+status], [childId+skillId], [childId+completedAt], storyId, createdAt',
      attempts: 'id, childId, challengeId, [childId+completedAt], [childId+skillId]',
      messages: 'id, childId, challengeId, [childId+at]',
      rewards: 'id, childId, [childId+kind], [childId+at]',
      sessions: 'id, childId, [childId+day], startedAt',
      learnerNotes: 'childId',
      usage: 'day',
      stories: 'id, childId, [childId+status]',
      weeklyReports: 'id, childId, [childId+weekStart]',
      kv: 'key',
    });
  }
}

export const db = new IntelliLearnDB();

/** Names of the tables that hold data about one child, keyed by `childId`. */
export const CHILD_TABLES = [
  'skillStates',
  'stageChanges',
  'challenges',
  'attempts',
  'messages',
  'rewards',
  'sessions',
  'learnerNotes',
  'stories',
  'weeklyReports',
] as const;

/** Reads the settings record, creating it with defaults on first use. */
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  const fresh = defaultSettings();
  await db.settings.put(fresh);
  return fresh;
}

/** Applies a change to the settings record and returns the saved value. */
export async function updateSettings(
  change: Partial<Settings> | ((current: Settings) => Settings),
): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const current = (await db.settings.get('app')) ?? defaultSettings();
    const next = typeof change === 'function' ? change(current) : { ...current, ...change };
    const saved: Settings = { ...next, id: 'app', updatedAt: Date.now() };
    await db.settings.put(saved);
    return saved;
  });
}
