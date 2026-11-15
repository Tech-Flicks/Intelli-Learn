/** Prompt for the weekly report a parent reads. */
import { gradeLabel } from '@/core/grades';
import type { Locale } from '@/core/types';
import type { WeeklyReportRequest } from '../types';
import { JSON_ONLY_RULE, languageSection, markerBlock, oneLine, type Prompt } from './shared';

/** Share of independent solves as a whole percentage, whether it arrives as 0..1 or 0..100. */
export function percent(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(share <= 1 ? share * 100 : share)));
}

export function buildReportPrompt(req: WeeklyReportRequest, language: Locale = req.child.locale): Prompt {
  const system = [
    markerBlock([['TASK', 'report']]),
    '# Who you are',
    'You are a warm, honest learning coach inside Intelli-Learn, a STEM learning app for children. You write a short weekly report for a parent.',
    [
      '# Rules',
      '- Use only the numbers and notes in the data. Do not invent events, scores or skills.',
      '- Lead with what went well. Be specific. Describe struggles as things the child is still learning, and say what helps.',
      '- No diagnoses, no labels, no comparisons with other children. Refer to "your child"; never use or ask for a name.',
      '- "homeActivities" are screen-free things a parent and child can do together in 5 to 10 minutes with everyday objects. They must be safe: no heat, no sharp tools, nothing that needs buying. Tie them to what the child is learning.',
      '- A quiet week is fine: say so kindly and suggest one small way to get going again.',
    ].join('\n'),
    [
      '# Output: one JSON object',
      JSON_ONLY_RULE,
      '{ "headline": string (max 160, one sentence), "highlights": string[] (1 to 5, each max 240), "struggles": string[] (0 to 4, each max 240), "homeActivities": string[] (1 to 4, each max 300) }',
    ].join('\n'),
    languageSection(language, 'parent'),
  ].join('\n\n');

  const stages = req.strandStages.map((entry) => `- ${entry.strand}: ${oneLine(entry.label, 60)}`);
  const summary = oneLine(req.learnerSummary, 500);
  const user = [
    'Write the weekly report from this data.',
    '',
    `Enrolled grade: ${gradeLabel(req.child.grade)}`,
    `Age group: ${req.child.ageGroup}`,
    `Minutes played this week: ${Math.max(0, Math.round(req.stats.minutes))}`,
    `Challenges completed: ${Math.max(0, Math.round(req.stats.completed))}`,
    `Solved without any help: ${percent(req.stats.independentShare)} percent`,
    `Stage steps gained this week: ${Math.max(0, Math.round(req.stats.stageUps))}`,
    'Current level in each strand:',
    ...(stages.length > 0 ? stages : ['- (nothing practised yet)']),
    ...(summary !== '' ? [`Learner notes: ${summary}`] : []),
  ].join('\n');
  return { system, user };
}
