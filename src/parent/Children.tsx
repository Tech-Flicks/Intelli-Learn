/** Children: every profile on the device, and "add a child". */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { INTEREST_SUGGESTIONS } from '@/core/defaults';
import type { ChildProfile } from '@/core/types';
import { createChild } from '@/data';
import { ageGroupName, gradeName, hasString, type Translate } from '@/i18n';
import { Badge, Button, EmptyState, Modal, StarCount, useToast } from '@/ui';
import { ChildForm, childDraftToInput, emptyChildDraft, sameChildDraft, validateChildDraft, type ChildDraft, type ChildDraftErrors } from './forms/ChildForm';
import { GuardedLink, useLeaveGuard, useUnsavedChanges } from './guard';
import { useChildren, useFormat } from './hooks';
import { Avatar, PageHeader, PanelLoading } from './parts';

/** An interest in the interface language when it is one of the built-in suggestions, else as typed. */
export function interestLabel(interest: string, t: Translate): string {
  const key = `parent.interest.${interest}`;
  return (INTEREST_SUGGESTIONS as readonly string[]).includes(interest) && hasString(key) ? t(key) : interest;
}

export function NoChildren({ onAdd }: { onAdd: () => void }) {
  const { t } = useFormat();
  return (
    <div className="rounded-3xl border border-ink-200 bg-white shadow-card">
      <EmptyState
        emoji="🧒"
        title={t('parent.children.emptyTitle')}
        description={t('parent.children.emptyText')}
        action={<Button onClick={onAdd}>{t('parent.children.add')}</Button>}
      />
    </div>
  );
}

function AddChildModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useFormat();
  const toast = useToast();
  const leave = useLeaveGuard();
  const [draft, setDraft] = useState<ChildDraft>(emptyChildDraft);
  const [errors, setErrors] = useState<ChildDraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(emptyChildDraft());
      setErrors({});
      setFailure(null);
    }
  }, [open]);

  const dirty = open && !sameChildDraft(draft, emptyChildDraft());
  useUnsavedChanges(dirty);

  const save = async () => {
    const problems = validateChildDraft(draft, t);
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const child = await createChild(childDraftToInput(draft));
      toast.success(t('parent.children.added', { name: child.nickname }));
      onClose();
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => leave(onClose)}
      size="lg"
      title={t('parent.children.addTitle')}
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={() => leave(onClose)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('parent.children.addSave')}
          </Button>
        </>
      }
    >
      <ChildForm
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          setErrors({});
        }}
        errors={errors}
        disabled={busy}
      />
      {failure !== null && (
        <p role="alert" className="mt-3 text-sm font-semibold text-coral-700">
          {failure}
        </p>
      )}
    </Modal>
  );
}

function ChildRow({ child }: { child: ChildProfile }) {
  const { t } = useFormat();
  return (
    <li className="flex flex-col gap-3 rounded-3xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex items-center gap-3">
        <Avatar emoji={child.avatar} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl font-bold leading-tight">{child.nickname}</h2>
          <p className="text-sm text-ink-700">
            {gradeName(child.grade)} · {ageGroupName(child.ageGroup)}
          </p>
        </div>
        <StarCount count={child.totalStars} size="sm" />
      </div>
      {child.interests.length > 0 ? (
        <ul aria-label={t('parent.child.interests')} className="flex flex-wrap gap-1.5">
          {child.interests.map((interest) => (
            <li key={interest}>
              <Badge tone="neutral">{interestLabel(interest, t)}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-500">{t('parent.children.noInterests')}</p>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <GuardedLink
          to={`/parent/child/${child.id}`}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-brand-500 px-4 font-bold text-white hover:bg-brand-600"
        >
          {t('parent.children.progress', { name: child.nickname })}
        </GuardedLink>
        <GuardedLink
          to={`/parent/child/${child.id}?tab=profile`}
          className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-brand-300 bg-white px-4 font-bold text-brand-700 hover:bg-brand-50"
        >
          {t('parent.children.edit')}
        </GuardedLink>
      </div>
    </li>
  );
}

export function ChildrenPage() {
  const { t } = useFormat();
  const children = useChildren();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);

  // "Add a child" from the overview arrives as /parent/children?add=1.
  useEffect(() => {
    if (params.get('add') === '1') {
      setAdding(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div>
      <PageHeader
        title={t('parent.children.title')}
        subtitle={t('parent.children.subtitle')}
        actions={
          <Button icon="➕" onClick={() => setAdding(true)}>
            {t('parent.children.add')}
          </Button>
        }
      />
      {children === undefined ? (
        <PanelLoading />
      ) : children.length === 0 ? (
        <NoChildren onAdd={() => setAdding(true)} />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {children.map((child) => (
            <ChildRow key={child.id} child={child} />
          ))}
        </ul>
      )}
      <AddChildModal open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
