/**
 * Canvas library: every AI-built challenge kept on the device. Parents can find, replay,
 * rate, retire and delete canvases, and see how children did on them.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSkill } from '@/core/skills';
import { GRADES, INTERACTION_KINDS, MODES, STRANDS, type Grade, type InteractionKind, type LibraryItem, type Mode, type Strand } from '@/core/types';
import { gradeName, modeName, strandName, tn } from '@/i18n';
import { deleteLibraryItem, libraryStats, listLibrary, rateLibraryItem, setRetired, type LibraryFilter } from '@/library';
import { Badge, Button, ConfirmDialog, EmptyState, Field, Modal, Select, Stat, TextInput, useToast } from '@/ui';
import { interestLabel } from './Children';
import { STRAND_EMOJI } from './forms/ControlsForm';
import { useLeaveGuard, useUnsavedChanges } from './guard';
import { useChildren, useFormat } from './hooks';
import { Fact, Note, PageHeader, PanelLoading, RatingEditor, RatingStars, ReplayModal } from './parts';

type RatingChoice = '' | 'unrated' | 'low' | 'high';
type RetiredChoice = 'all' | 'active' | 'retired';

export interface LibraryFilterState {
  strand: Strand | '';
  grade: Grade | '';
  interaction: InteractionKind | '';
  mode: Mode | '';
  rating: RatingChoice;
  retired: RetiredChoice;
  search: string;
}

export const EMPTY_LIBRARY_FILTER: LibraryFilterState = { strand: '', grade: '', interaction: '', mode: '', rating: '', retired: 'all', search: '' };

/** The form's state as the filter `listLibrary` takes. */
export function toLibraryFilter(state: LibraryFilterState): LibraryFilter {
  const filter: LibraryFilter = {};
  if (state.strand !== '') filter.strand = state.strand;
  if (state.grade !== '') filter.grade = state.grade;
  if (state.interaction !== '') filter.interaction = state.interaction;
  if (state.mode !== '') filter.mode = state.mode;
  if (state.rating !== '') filter.rating = state.rating;
  if (state.retired !== 'all') filter.retired = state.retired === 'retired';
  if (state.search.trim() !== '') filter.search = state.search.trim();
  return filter;
}

function isFiltering(state: LibraryFilterState): boolean {
  return Object.keys(toLibraryFilter(state)).length > 0;
}

const PAGE_SIZE = 12;

interface CardProps {
  item: LibraryItem;
  original: LibraryItem | undefined;
  childNames: ReadonlyMap<string, string>;
  onPreview: (item: LibraryItem) => void;
  onRate: (item: LibraryItem) => void;
  onDelete: (item: LibraryItem) => void;
}

function LibraryCard({ item, original, childNames, onPreview, onRate, onDelete }: CardProps) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const skill = getSkill(item.skillId);
  const headingId = `library-${item.id}`;
  const seenNames = item.seenBy.map((id) => childNames.get(id)).filter((name): name is string => name !== undefined);
  const unknownSeen = item.seenBy.length - seenNames.length;

  const toggleRetired = async () => {
    try {
      await setRetired(item.id, !item.retired);
      toast.success(item.retired ? t('parent.library.restored') : t('parent.library.retiredToast'));
    } catch {
      toast.error(t('common.error'));
    }
  };

  return (
    <li>
      <article
        aria-labelledby={headingId}
        className={`flex h-full flex-col gap-3 rounded-3xl border bg-white p-4 shadow-card sm:p-5 ${item.retired ? 'border-ink-400 border-dashed' : 'border-ink-200'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={headingId} className="min-w-0 flex-1 font-display text-xl font-bold leading-tight">
            {item.content.title}
          </h2>
          {item.retired && <Badge tone="danger">{t('parent.library.retired')}</Badge>}
          {!item.retired && item.rating !== null && item.rating >= 4 && <Badge tone="success">{t('parent.library.preferred')}</Badge>}
        </div>
        <p className="line-clamp-3 text-sm text-ink-700">{item.content.question}</p>

        <div className="flex flex-wrap gap-1.5">
          <Badge tone="brand" emoji={STRAND_EMOJI[item.strand]}>
            {skill?.name ?? item.skillId}
          </Badge>
          <Badge tone="neutral">{gradeName(item.grade)}</Badge>
          <Badge tone="neutral">{t(`parent.kind.${item.interaction}`)}</Badge>
          <Badge tone="neutral">{modeName(item.mode)}</Badge>
          <Badge tone="neutral" emoji="🎨">
            {interestLabel(item.theme, t)}
          </Badge>
        </div>

        <p className="text-sm text-ink-700">
          {item.origin === 'remix' ? (
            original ? (
              <>
                {t('parent.library.remixOf')}{' '}
                <button type="button" className="font-bold text-brand-700 underline underline-offset-2 hover:text-brand-800" onClick={() => onPreview(original)}>
                  {original.content.title}
                </button>
              </>
            ) : (
              t('parent.library.remixOrphan')
            )
          ) : (
            t('parent.library.originAi')
          )}
          {' · '}
          {t('parent.library.created', { date: fmt.date(item.createdAt) })}
        </p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Fact label={t('parent.library.uses')}>{fmt.number(item.uses)}</Fact>
          <Fact label={t('parent.library.solves')}>
            {t('parent.library.solvesValue', { alone: fmt.number(item.independentSolves), helped: fmt.number(item.assistedSolves) })}
          </Fact>
          <div className="col-span-2">
            <Fact label={tn('parent.library.seenBy.one', 'parent.library.seenBy.other', item.seenBy.length)}>
              {item.seenBy.length === 0
                ? t('parent.library.seenByNobody')
                : [...seenNames, ...(unknownSeen > 0 ? [tn('parent.library.seenUnknown.one', 'parent.library.seenUnknown.other', unknownSeen)] : [])].join(', ')}
            </Fact>
          </div>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <RatingStars rating={item.rating} />
          {item.ratingNote !== '' && <span className="min-w-0 flex-1 truncate text-sm italic text-ink-700">“{item.ratingNote}”</span>}
        </div>

        <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-200 pt-3">
          <Button size="sm" icon="▶️" onClick={() => onPreview(item)} aria-label={t('parent.library.previewOf', { title: item.content.title })}>
            {t('parent.library.preview')}
          </Button>
          <Button size="sm" variant="secondary" icon="⭐" onClick={() => onRate(item)} aria-label={t('parent.library.rateOf', { title: item.content.title })}>
            {t('parent.library.rate')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleRetired}
            aria-label={t(item.retired ? 'parent.library.restoreOf' : 'parent.library.retireOf', { title: item.content.title })}
          >
            {item.retired ? t('parent.library.restore') : t('parent.library.retire')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(item)} aria-label={t('parent.library.deleteOf', { title: item.content.title })}>
            {t('common.delete')}
          </Button>
        </div>
      </article>
    </li>
  );
}

function RateModal({ item, onClose }: { item: LibraryItem | null; onClose: () => void }) {
  const { t } = useFormat();
  const toast = useToast();
  const leave = useLeaveGuard();
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(item !== null && dirty);
  if (!item) return null;
  const close = () => leave(onClose);
  return (
    <Modal open onClose={close} title={t('parent.library.rateTitle')} description={item.content.title} size="md">
      <Note tone="info" className="mb-4">
        {t('parent.library.rateExplain')}
      </Note>
      <RatingEditor
        rating={item.rating}
        note={item.ratingNote}
        libraryBacked
        onDirtyChange={setDirty}
        onSave={async (rating, note) => {
          const saved = await rateLibraryItem(item.id, rating, note);
          toast.success(saved.retired && rating !== null && rating <= 2 ? t('parent.library.ratedRetired') : t('parent.rating.saved'));
          setDirty(false);
          onClose();
        }}
      />
    </Modal>
  );
}

export function LibraryPage() {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const [state, setState] = useState<LibraryFilterState>(EMPTY_LIBRARY_FILTER);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filter = useMemo(() => toLibraryFilter(state), [state]);
  const filterKey = JSON.stringify(filter);
  const items = useLiveQuery(async () => ({ key: filterKey, rows: await listLibrary(filter) }), [filterKey]);
  const everything = useLiveQuery(() => listLibrary(), []);
  const stats = useLiveQuery(() => libraryStats(), []);
  const children = useChildren();

  const byId = useMemo(() => new Map((everything ?? []).map((item) => [item.id, item])), [everything]);
  const childNames = useMemo(() => new Map((children ?? []).map((child) => [child.id, child.nickname])), [children]);

  const set = (patch: Partial<LibraryFilterState>) => {
    setState((current) => ({ ...current, ...patch }));
    setShown(PAGE_SIZE);
  };

  const preview = previewId ? byId.get(previewId) : undefined;
  const rateItem = rateId ? (byId.get(rateId) ?? null) : null;
  const previewSkill = preview ? getSkill(preview.skillId) : undefined;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLibraryItem(deleteTarget.id);
      toast.success(t('parent.library.deleted'));
      setDeleteTarget(null);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setDeleting(false);
    }
  };

  const all = { value: '', label: t('parent.filter.all') };
  const rows = items?.rows;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <PageHeader title={t('parent.library.title')} subtitle={t('parent.library.subtitle')} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('parent.library.stat.total')} value={fmt.number(stats?.total ?? 0)} emoji="🖼️" />
          <Stat label={t('parent.library.stat.rated')} value={fmt.number(stats?.rated ?? 0)} emoji="⭐" />
          <Stat label={t('parent.library.stat.retired')} value={fmt.number(stats?.retired ?? 0)} emoji="🚫" />
          <Stat label={t('parent.library.stat.reused')} value={fmt.number(stats?.reusedServes ?? 0)} emoji="♻️" hint={t('parent.library.stat.reusedHint')} />
        </div>
        <Note tone="info" className="mt-4">
          <p>{t('parent.library.explainReuse')}</p>
          <p className="mt-1">{t('parent.library.explainRemix')}</p>
          <p className="mt-1">{t('parent.library.explainRating')}</p>
        </Note>
      </div>

      <section aria-label={t('parent.library.filters')} className="rounded-3xl border border-ink-200 bg-white p-4 shadow-card">
        <Field label={t('parent.library.search')}>
          <TextInput
            type="search"
            value={state.search}
            onValueChange={(search) => set({ search })}
            placeholder={t('parent.library.searchPlaceholder')}
            autoComplete="off"
          />
        </Field>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label={t('parent.filter.strand')}>
            <Select
              value={state.strand}
              onValueChange={(value) => set({ strand: value as Strand | '' })}
              options={[all, ...STRANDS.map((strand) => ({ value: strand, label: strandName(strand) }))]}
            />
          </Field>
          <Field label={t('parent.filter.grade')}>
            <Select
              value={state.grade}
              onValueChange={(value) => set({ grade: value as Grade | '' })}
              options={[all, ...GRADES.map((grade) => ({ value: grade, label: gradeName(grade) }))]}
            />
          </Field>
          <Field label={t('parent.filter.kind')}>
            <Select
              value={state.interaction}
              onValueChange={(value) => set({ interaction: value as InteractionKind | '' })}
              options={[all, ...INTERACTION_KINDS.map((kind) => ({ value: kind, label: t(`parent.kind.${kind}`) }))]}
            />
          </Field>
          <Field label={t('parent.filter.mode')}>
            <Select
              value={state.mode}
              onValueChange={(value) => set({ mode: value as Mode | '' })}
              options={[all, ...MODES.map((mode) => ({ value: mode, label: modeName(mode) }))]}
            />
          </Field>
          <Field label={t('parent.filter.rating')}>
            <Select
              value={state.rating}
              onValueChange={(value) => set({ rating: value as RatingChoice })}
              options={[
                all,
                { value: 'unrated', label: t('parent.filter.rating.unrated') },
                { value: 'low', label: t('parent.filter.rating.low') },
                { value: 'high', label: t('parent.filter.rating.high') },
              ]}
            />
          </Field>
          <Field label={t('parent.filter.retired')}>
            <Select
              value={state.retired}
              onValueChange={(value) => set({ retired: value as RetiredChoice })}
              options={[
                { value: 'all', label: t('parent.filter.all') },
                { value: 'active', label: t('parent.filter.retired.active') },
                { value: 'retired', label: t('parent.filter.retired.retired') },
              ]}
            />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p role="status" className="text-sm font-semibold text-ink-700">
            {rows === undefined ? t('common.loading') : tn('parent.library.count.one', 'parent.library.count.other', rows.length)}
          </p>
          {isFiltering(state) && (
            <Button variant="ghost" size="sm" onClick={() => set(EMPTY_LIBRARY_FILTER)}>
              {t('parent.filter.clear')}
            </Button>
          )}
        </div>
      </section>

      {rows === undefined ? (
        <PanelLoading />
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-ink-200 bg-white shadow-card">
          {isFiltering(state) ? (
            <EmptyState emoji="🔎" title={t('parent.library.noMatchTitle')} description={t('parent.library.noMatchText')} />
          ) : (
            <EmptyState emoji="🖼️" title={t('parent.library.emptyTitle')} description={t('parent.library.emptyText')} />
          )}
        </div>
      ) : (
        <>
          <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {rows.slice(0, shown).map((item) => (
              <LibraryCard
                key={item.id}
                item={item}
                original={item.remixOf ? byId.get(item.remixOf) : undefined}
                childNames={childNames}
                onPreview={(target) => setPreviewId(target.id)}
                onRate={(target) => setRateId(target.id)}
                onDelete={setDeleteTarget}
              />
            ))}
          </ul>
          {rows.length > shown && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                {t('parent.history.showMore', { count: Math.min(PAGE_SIZE, rows.length - shown) })}
              </Button>
            </div>
          )}
        </>
      )}

      <ReplayModal
        challenge={preview?.content ?? null}
        onClose={() => setPreviewId(null)}
        subtitle={preview ? `${previewSkill?.name ?? preview.skillId} · ${gradeName(preview.grade)}` : undefined}
      />
      <RateModal item={rateItem} onClose={() => setRateId(null)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={t('parent.library.deleteTitle')}
        message={t('parent.library.deleteMessage', { title: deleteTarget?.content.title ?? '' })}
        confirmLabel={t('common.delete')}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
