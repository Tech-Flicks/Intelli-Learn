/**
 * Public API of the data module. Other modules import from `@/data`.
 */
export { db, getSettings, updateSettings, CHILD_TABLES, IntelliLearnDB } from './db';
export type { KeyValueRecord } from './db';

export {
  createChild,
  updateChild,
  deleteChild,
  getChild,
  listChildren,
  cleanNickname,
  cleanInterests,
  defaultVoiceRate,
  pickCompanionSpecies,
  newEggCompanion,
  COMPANION_SPECIES,
  NICKNAME_MAX_LENGTH,
  MAX_INTERESTS,
  INTEREST_MAX_LENGTH,
} from './children';
export type { NewChildInput, CompanionSpecies } from './children';

export { recordUsage, getUsageToday, getUsageThisMonth, checkBudget } from './usage';
export type { UsageDelta, UsageTotals, BudgetVerdict } from './usage';

export { exportBackup, importBackup, parseBackup, wipeEverything, BACKUP_APP, BACKUP_VERSION } from './backup';
export type { BackupFile, ImportResult, ParsedBackup } from './backup';

export { downloadBackup, readBackupFile, backupFileName, MAX_BACKUP_FILE_BYTES } from './backupFile';
