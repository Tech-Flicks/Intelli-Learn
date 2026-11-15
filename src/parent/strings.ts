/**
 * Strings of the parent area, registered once on import. English is the source;
 * Spanish and Hindi carry the same keys. Badge names are only listed for the
 * translated languages: English falls back to the names in the badge catalogue.
 */
import { registerStrings, type StringBundle } from '@/i18n';
import { badgesEs, badgesHi } from './strings.badges';
import { en } from './strings.en';
import { es } from './strings.es';
import { hi } from './strings.hi';

export const PARENT_STRINGS: StringBundle = {
  en,
  es: { ...es, ...badgesEs },
  hi: { ...hi, ...badgesHi },
};

registerStrings(PARENT_STRINGS);
