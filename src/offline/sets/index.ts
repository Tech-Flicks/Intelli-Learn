import type { Strand } from '@/core/types';
import { ENGINEERING_SETS } from './engineering';
import { EXTRA_SETS } from './extra';
import { LOGIC_SETS } from './logic';
import { SCIENCE_SETS } from './science';
import { TECHNOLOGY_SETS } from './technology';
import type { KnowledgeSet } from './types';

export type { CatSet, KnowledgeSet, PairSet, QuizSet, SeqSet } from './types';

export const ALL_SETS: readonly KnowledgeSet[] = [...SCIENCE_SETS, ...TECHNOLOGY_SETS, ...ENGINEERING_SETS, ...LOGIC_SETS, ...EXTRA_SETS];

export function setsForStrand(strand: Strand): KnowledgeSet[] {
  return ALL_SETS.filter((set) => set.strand === strand);
}
