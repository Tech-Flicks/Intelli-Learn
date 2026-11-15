/**
 * Backup, restore and full reset.
 *
 * What a backup holds: the child profiles, every table in `CHILD_TABLES`, the
 * canvas library, and the settings record with its secrets removed. What it
 * never holds: the admin password hash, the API key (encrypted or not), the
 * `kv` table (device key) and the per-device AI usage counters.
 *
 * Importing treats the file as untrusted input. The whole file is validated
 * before the first write, and all writes share one transaction, so a bad file
 * changes nothing.
 */
import { z } from 'zod';
import type { ChallengeRecord, ChildProfile, LibraryItem, ParentalControls, Settings } from '@/core/types';
import {
  BackupSettingsSchema,
  CHILD_ROW_SCHEMAS,
  CHILDREN_ROW_SCHEMA,
  LIBRARY_ROW_SCHEMA,
  type ChildTableName,
} from './backupSchemas';
import { deleteChildKeyValues } from './children';
import { CHILD_TABLES, db, updateSettings } from './db';

export const BACKUP_APP = 'intelli-learn';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: 'intelli-learn';
  version: 1;
  exportedAt: number;
  tables: Record<string, unknown[]>;
}

export interface ImportResult {
  /** Child profiles written. */
  children: number;
  /** Rows written to the child data tables (profiles, library items and settings not counted). */
  records: number;
  /** Canvas library items added or updated. */
  libraryItems: number;
  /** Child data rows left out because their child is neither in the file nor on the device. */
  skipped: number;
}

type ChildRow = { childId: string };

/** A backup file after validation. */
export interface ParsedBackup {
  exportedAt: number;
  children: ChildProfile[];
  childRows: Record<ChildTableName, ChildRow[]>;
  library: LibraryItem[];
  /** Parental controls from the file's settings record, when it has one. */
  controls: ParentalControls | null;
}

/** Removes everything secret from a settings record. */
function withoutSecrets(settings: Settings): Settings {
  return { ...settings, auth: null, ai: { ...settings.ai, apiKeyCipher: null } };
}

/**
 * Builds a backup of the whole device, or of one child when `childId` is given.
 *
 * A one-child backup holds that child's profile and records, plus the library
 * canvases that child was served. Rows that belong to no existing child are
 * left out, and a library item's `seenBy` list only names exported children.
 */
export async function exportBackup(opts: { childId?: string; now?: number } = {}): Promise<BackupFile> {
  const { childId } = opts;
  const childTables = CHILD_TABLES.map((name) => db.table<ChildRow>(name));
  const tables: Record<string, unknown[]> = {};

  await db.transaction('r', [db.settings, db.children, db.library, ...childTables], async () => {
    const settings = await db.settings.get('app');
    tables.settings = settings ? [withoutSecrets(settings)] : [];

    const children =
      childId === undefined
        ? await db.children.orderBy('createdAt').toArray()
        : await db.children.where('id').equals(childId).toArray();
    if (childId !== undefined && children.length === 0) {
      throw new Error(`Child profile not found: ${childId}`);
    }
    tables.children = children;

    const childIds = new Set(children.map((child) => child.id));
    for (const table of childTables) {
      tables[table.name] =
        childId === undefined
          ? (await table.toArray()).filter((row) => childIds.has(row.childId))
          : await table.where('childId').equals(childId).toArray();
    }

    const onlySeenByExported = (item: LibraryItem): LibraryItem => ({
      ...item,
      seenBy: item.seenBy.filter((id) => childIds.has(id)),
    });
    if (childId === undefined) {
      tables.library = (await db.library.toArray()).map(onlySeenByExported);
    } else {
      const referenced = new Set<string>();
      for (const challenge of (tables.challenges ?? []) as ChallengeRecord[]) {
        if (challenge.libraryId) referenced.add(challenge.libraryId);
      }
      tables.library = (
        await db.library.filter((item) => item.seenBy.includes(childId) || referenced.has(item.id)).toArray()
      ).map(onlySeenByExported);
    }
  });

  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: opts.now ?? Date.now(), tables };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const rowList = z.array(z.unknown());

const tableShape: Record<string, z.ZodType<unknown[] | undefined>> = {
  settings: rowList.max(1, 'a backup holds at most one settings record').optional(),
  children: rowList.optional(),
  library: rowList.optional(),
};
for (const name of CHILD_TABLES) tableShape[name] = rowList.optional();

const BackupFileSchema = z.strictObject({
  app: z.literal(BACKUP_APP),
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.number().min(0),
  tables: z.strictObject(tableShape),
});

function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}

/** Turns zod issues into one readable sentence. Shows the first few problems only. */
function invalid(error: z.ZodError, prefix: readonly PropertyKey[] = []): Error {
  const shown = error.issues.slice(0, 3).map((issue) => {
    const where = formatPath([...prefix, ...issue.path]);
    return where ? `${where}: ${issue.message}` : issue.message;
  });
  const more = error.issues.length - shown.length;
  const suffix = more > 0 ? ` (and ${more} more)` : '';
  return new Error(`This backup file is not valid. ${shown.join('; ')}${suffix}`);
}

function parseRows<T>(
  table: string,
  rows: unknown[] | undefined,
  schema: z.ZodType<T>,
  keyOf: (row: T) => string,
): T[] {
  const parsed: T[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of (rows ?? []).entries()) {
    const result = schema.safeParse(raw);
    if (!result.success) throw invalid(result.error, ['tables', table, index]);
    const key = keyOf(result.data);
    if (seen.has(key)) {
      throw new Error(`This backup file is not valid. tables.${table}[${index}]: duplicate record "${key}"`);
    }
    seen.add(key);
    parsed.push(result.data);
  }
  return parsed;
}

/**
 * Validates a backup file. Pure: reads nothing and writes nothing.
 * Throws an Error with a readable message for anything that is not a backup
 * this version of the app wrote: wrong app marker, other version, unknown
 * tables (including `kv`), unknown top-level fields, or a row of the wrong shape.
 */
export function parseBackup(file: unknown): ParsedBackup {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    throw new Error('This is not an Intelli-Learn backup file.');
  }
  const header = file as { app?: unknown; version?: unknown };
  if (header.app !== BACKUP_APP) {
    throw new Error('This is not an Intelli-Learn backup file.');
  }
  if (header.version !== BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a different version of Intelli-Learn (backup version ${String(header.version)}, expected ${BACKUP_VERSION}).`,
    );
  }
  const shape = BackupFileSchema.safeParse(file);
  if (!shape.success) throw invalid(shape.error);
  const tables = shape.data.tables;

  const children = parseRows('children', tables.children, CHILDREN_ROW_SCHEMA, (row) => row.id);

  const childRows = {} as Record<ChildTableName, ChildRow[]>;
  for (const name of CHILD_TABLES) {
    childRows[name] = parseRows(name, tables[name], CHILD_ROW_SCHEMAS[name], (row) =>
      // learnerNotes is keyed by childId, every other child table by id.
      'id' in row && typeof row.id === 'string' ? row.id : row.childId,
    );
  }

  const library = parseRows('library', tables.library, LIBRARY_ROW_SCHEMA, (row) => row.id);

  let controls: ParentalControls | null = null;
  const settingsRow = tables.settings?.[0];
  if (settingsRow !== undefined) {
    const result = BackupSettingsSchema.safeParse(settingsRow);
    if (!result.success) throw invalid(result.error, ['tables', 'settings', 0]);
    controls = result.data.controls;
  }

  return { exportedAt: shape.data.exportedAt, children, childRows, library, controls };
}

// ---------------------------------------------------------------------------
// Import and reset
// ---------------------------------------------------------------------------

function union(a: readonly string[], b: readonly string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

/**
 * Writes the file's library items. The library is shared by all children, so
 * it is always merged, never cleared. Runs inside the import transaction.
 *
 * An incoming item whose canvas is already on the device under another id
 * (same fingerprint) is not stored twice: the device's item is kept and the
 * returned map sends the incoming id to it. `seenBy` lists are combined, so a
 * child is not served a canvas again just because of an import.
 */
async function mergeLibrary(
  incoming: LibraryItem[],
  knownChildIds: ReadonlySet<string>,
): Promise<{ written: number; remap: Map<string, string> }> {
  const known = (ids: readonly string[]) => ids.filter((id) => knownChildIds.has(id));
  const remap = new Map<string, string>();
  if (incoming.length === 0) return { written: 0, remap };

  const sameId = new Map<string, LibraryItem>();
  for (const item of await db.library.bulkGet(incoming.map((item) => item.id))) {
    if (item) sameId.set(item.id, item);
  }
  const sameFingerprint = new Map<string, LibraryItem>();
  const fingerprints = Array.from(new Set(incoming.map((item) => item.fingerprint)));
  for (const item of await db.library.where('fingerprint').anyOf(fingerprints).toArray()) {
    if (!sameFingerprint.has(item.fingerprint)) sameFingerprint.set(item.fingerprint, item);
  }

  const toWrite = new Map<string, LibraryItem>();
  for (const item of incoming) {
    const onDevice = sameId.get(item.id);
    const twinOnDevice = onDevice ? undefined : sameFingerprint.get(item.fingerprint);
    if (twinOnDevice) {
      const twin = toWrite.get(twinOnDevice.id) ?? twinOnDevice;
      remap.set(item.id, twin.id);
      toWrite.set(twin.id, { ...twin, seenBy: union(known(twin.seenBy), known(item.seenBy)) });
    } else {
      const seenSoFar = (toWrite.get(item.id) ?? onDevice)?.seenBy ?? [];
      toWrite.set(item.id, { ...item, seenBy: union(known(seenSoFar), known(item.seenBy)) });
    }
  }
  await db.library.bulkPut(Array.from(toWrite.values()));
  return { written: toWrite.size, remap };
}

/**
 * Restores a backup.
 *
 * - `merge`: upserts every row by primary key. Children and records that are
 *   only on the device stay. Settings are left alone.
 * - `replace`: removes all child profiles and child data first, then writes
 *   the file's rows and takes over its parental controls.
 *
 * The canvas library is merged in both modes (see `mergeLibrary`). The admin
 * password, the AI settings and the API key on the device are never touched,
 * whatever the file contains.
 */
export async function importBackup(file: unknown, mode: 'merge' | 'replace'): Promise<ImportResult> {
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error(`Unknown import mode: ${String(mode)}`);
  }
  const backup = parseBackup(file);
  const childTables = CHILD_TABLES.map((name) => db.table<ChildRow>(name));

  return db.transaction('rw', [db.settings, db.children, db.library, db.kv, ...childTables], async () => {
    if (mode === 'replace') {
      // Cached per-child state (placement estimates, badge counters) belongs to the data that is removed.
      await deleteChildKeyValues(await db.children.toCollection().primaryKeys());
      await db.children.clear();
      for (const table of childTables) await table.clear();
    }

    const knownChildIds = new Set(backup.children.map((child) => child.id));
    if (mode === 'merge') {
      for (const id of await db.children.toCollection().primaryKeys()) knownChildIds.add(id);
    } else {
      // The removed children must not linger in the library's "seen by" lists.
      await db.library
        .filter((item) => item.seenBy.some((id) => !knownChildIds.has(id)))
        .modify((item) => {
          item.seenBy = item.seenBy.filter((id) => knownChildIds.has(id));
        });
    }
    await db.children.bulkPut(backup.children);

    const library = await mergeLibrary(backup.library, knownChildIds);
    const libraryIds = new Set(await db.library.toCollection().primaryKeys());

    let records = 0;
    let skipped = 0;
    for (const table of childTables) {
      const all = backup.childRows[table.name as ChildTableName];
      let rows = all.filter((row) => knownChildIds.has(row.childId));
      if (table.name === 'challenges') {
        // Point each challenge at the library item that is really on the device, or at none.
        rows = (rows as ChallengeRecord[]).map((challenge) => {
          if (challenge.libraryId === null) return challenge;
          const libraryId = library.remap.get(challenge.libraryId) ?? challenge.libraryId;
          return { ...challenge, libraryId: libraryIds.has(libraryId) ? libraryId : null };
        });
      }
      await table.bulkPut(rows);
      records += rows.length;
      skipped += all.length - rows.length;
    }

    const controls = backup.controls;
    if (mode === 'replace' && controls) {
      await updateSettings((current) => ({ ...current, controls }));
    }

    return { children: backup.children.length, records, libraryItems: library.written, skipped };
  });
}

/**
 * Full reset: empties every table, including settings (password, API key),
 * the canvas library, usage counters and the device key in `kv`. The next
 * `getSettings()` call creates fresh defaults, so the app starts at first-run
 * setup again.
 */
export async function wipeEverything(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}
