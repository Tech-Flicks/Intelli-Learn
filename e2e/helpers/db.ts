/**
 * Reads and seeds the app's IndexedDB database from a test.
 *
 * These helpers talk to IndexedDB directly, not through the app, so the app only notices a
 * change after a reload. Call them only once the app has created the database (after setup).
 */
import type { Page } from '@playwright/test';
import type {
  AttemptRecord,
  ChallengeRecord,
  ChildProfile,
  HelperMessage,
  LibraryItem,
  RewardRecord,
  SessionRecord,
  Settings,
  SkillState,
  StageChange,
  StoryRecord,
  UsageRecord,
} from '../../src/core/types';

export const DB_NAME = 'intelli-learn';

export interface Tables {
  settings: Settings;
  children: ChildProfile;
  skillStates: SkillState;
  stageChanges: StageChange;
  challenges: ChallengeRecord;
  attempts: AttemptRecord;
  messages: HelperMessage;
  rewards: RewardRecord;
  sessions: SessionRecord;
  usage: UsageRecord;
  stories: StoryRecord;
  library: LibraryItem;
}

type Op =
  | { op: 'all'; store: string }
  | { op: 'put'; store: string; value: unknown }
  | { op: 'patch'; store: string; key: string; patch: Record<string, unknown> }
  | { op: 'delete'; store: string; key: string };

/** One operation, in the page. Rows that cannot be cloned out of the page (crypto keys) come back as null. */
async function run(page: Page, request: Op): Promise<unknown> {
  return page.evaluate(
    async ({ name, request }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const done = <T>(req: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      try {
        if (!database.objectStoreNames.contains(request.store)) throw new Error(`No table "${request.store}" (is the app set up?)`);
        const mode: IDBTransactionMode = request.op === 'all' ? 'readonly' : 'readwrite';
        const store = database.transaction(request.store, mode).objectStore(request.store);
        if (request.op === 'all') {
          const rows = await done(store.getAll());
          return rows.map((row) => {
            try {
              return JSON.parse(JSON.stringify(row)) as unknown;
            } catch {
              return null;
            }
          });
        }
        if (request.op === 'put') return await done(store.put(request.value));
        if (request.op === 'delete') return await done(store.delete(request.key));
        const current = (await done(store.get(request.key))) as Record<string, unknown> | undefined;
        if (!current) throw new Error(`No row "${request.key}" in "${request.store}"`);
        return await done(store.put({ ...current, ...request.patch }));
      } finally {
        database.close();
      }
    },
    { name: DB_NAME, request },
  );
}

/** Every row of a table. */
export async function rows<K extends keyof Tables>(page: Page, store: K): Promise<Tables[K][]> {
  const all = (await run(page, { op: 'all', store })) as (Tables[K] | null)[];
  return all.filter((row): row is Tables[K] => row !== null);
}

export async function putRow<K extends keyof Tables>(page: Page, store: K, value: Tables[K]): Promise<void> {
  await run(page, { op: 'put', store, value });
}

/** Shallow-merges `patch` into the row with primary key `key`. */
export async function patchRow<K extends keyof Tables>(page: Page, store: K, key: string, patch: Partial<Tables[K]>): Promise<void> {
  await run(page, { op: 'patch', store, key, patch: patch as Record<string, unknown> });
}

export async function deleteRow(page: Page, store: keyof Tables, key: string): Promise<void> {
  await run(page, { op: 'delete', store, key });
}

export async function settings(page: Page): Promise<Settings> {
  const [first] = await rows(page, 'settings');
  if (!first) throw new Error('No settings record');
  return first;
}

export async function childByNickname(page: Page, nickname: string): Promise<ChildProfile> {
  const child = (await rows(page, 'children')).find((candidate) => candidate.nickname === nickname);
  if (!child) throw new Error(`No child called ${nickname}`);
  return child;
}

export async function challengesOf(page: Page, childId: string): Promise<ChallengeRecord[]> {
  return (await rows(page, 'challenges')).filter((row) => row.childId === childId).sort((a, b) => a.createdAt - b.createdAt);
}

/** Completed challenges, in the order they were finished. */
export async function completedOf(page: Page, childId: string): Promise<ChallengeRecord[]> {
  return (await challengesOf(page, childId))
    .filter((row) => row.status === 'completed')
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
}

export async function attemptsOf(page: Page, childId: string): Promise<AttemptRecord[]> {
  return (await rows(page, 'attempts')).filter((row) => row.childId === childId).sort((a, b) => a.completedAt - b.completedAt);
}

/** The local calendar day of the page, as the app writes it (YYYY-MM-DD). */
export async function today(page: Page): Promise<string> {
  return page.evaluate(() => {
    const now = new Date();
    const two = (value: number): string => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  });
}
