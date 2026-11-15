/**
 * "Last AI results": what became of the latest AI requests. Every AI feature falls back
 * silently when the model fails, so without this a parent sees "AI challenges are on"
 * while every challenge comes from the built-in ones.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { recentAiResults, summarizeAiResults, type AiLogEntry, type AiResultsSummary, type AiTask } from '@/ai';
import { getUsageThisMonth, getUsageToday } from '@/data';
import { useFormat, useNow } from './hooks';
import { Note } from './parts';

/** Failed challenge builds in a row from which the parent is warned (the same number pauses generation). */
export const AI_TROUBLE_AFTER = 3;
const SHOWN_PROBLEMS = 5;

const TASK_LABEL: Record<AiTask, string> = {
  challenge: 'parent.aiResults.task.challenge',
  remix: 'parent.aiResults.task.remix',
  tutor: 'parent.aiResults.task.tutor',
  story: 'parent.aiResults.task.story',
  notes: 'parent.aiResults.task.notes',
  report: 'parent.aiResults.task.report',
};

/** The log and its summary, kept up to date. `undefined` while it loads. */
export function useAiResults(): { entries: AiLogEntry[]; summary: AiResultsSummary } | undefined {
  const entries = useLiveQuery(() => recentAiResults(), []);
  const now = useNow(60_000);
  return entries ? { entries, summary: summarizeAiResults(entries, now) } : undefined;
}

function TokensLine() {
  const fmt = useFormat();
  const usage = useLiveQuery(async () => ({ today: await getUsageToday(), month: await getUsageThisMonth() }), []);
  if (!usage || usage.month.promptTokens + usage.month.completionTokens <= 0) return null;
  return (
    <p className="text-sm text-ink-700">
      {fmt.t('parent.usage.tokens', {
        sent: fmt.number(usage.today.promptTokens),
        received: fmt.number(usage.today.completionTokens),
        monthSent: fmt.number(usage.month.promptTokens),
        monthReceived: fmt.number(usage.month.completionTokens),
      })}
    </p>
  );
}

export function AiResults() {
  const fmt = useFormat();
  const { t } = fmt;
  const results = useAiResults();
  if (!results) return null;
  const { entries, summary } = results;
  const problems = entries
    .filter((entry) => entry.outcome !== 'ok')
    .slice(-SHOWN_PROBLEMS)
    .reverse();

  return (
    <div className="flex flex-col gap-2" data-testid="ai-results">
      <TokensLine />
      <h4 className="font-bold text-ink-900">{t('parent.aiResults.title')}</h4>
      <p className="text-sm text-ink-700">
        {summary.buildsToday === 0
          ? t('parent.aiResults.noneToday')
          : t('parent.aiResults.today', { built: fmt.number(summary.builtToday), tried: fmt.number(summary.buildsToday) })}
        {summary.commonProblemCount > 0 &&
          ` ${t('parent.aiResults.common', { count: fmt.number(summary.commonProblemCount), message: summary.commonProblem })}`}
      </p>
      {summary.pause ? (
        <Note tone="warning" role="status">
          {t('parent.aiResults.paused', { count: fmt.number(summary.pause.failures), time: fmt.dateTime(summary.pause.until) })}
        </Note>
      ) : (
        summary.failuresInARow >= AI_TROUBLE_AFTER && (
          <Note tone="warning" role="status">
            {t('parent.aiResults.failing', { count: fmt.number(summary.failuresInARow) })}
          </Note>
        )
      )}
      {problems.length > 0 && (
        <details className="text-sm text-ink-700">
          <summary className="min-h-9 cursor-pointer py-1 font-bold text-brand-700">{t('parent.aiResults.details')}</summary>
          <ul className="mt-1 flex flex-col gap-2">
            {problems.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="rounded-xl border border-ink-200 bg-white px-3 py-2">
                <p className="text-xs font-semibold text-ink-500">
                  {fmt.dateTime(entry.at)} · {t(TASK_LABEL[entry.task] ?? TASK_LABEL.challenge)}
                  {entry.model ? ` · ${entry.model}` : ''}
                </p>
                <p className="break-words">{entry.message}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
