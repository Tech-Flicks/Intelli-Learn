/** Data: export this child's records, or delete the child for good. */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ChildProfile } from '@/core/types';
import { backupFileName, db, deleteChild, downloadBackup, exportBackup } from '@/data';
import { Button, Stat, useToast } from '@/ui';
import { useGuardedNavigate } from '../guard';
import { useFormat } from '../hooks';
import { Note, Section, TypedConfirmDialog } from '../parts';

/** The word a parent types to confirm deleting a child. */
export const DELETE_WORD = 'DELETE';

export function DataTab({ child }: { child: ChildProfile }) {
  const fmt = useFormat();
  const { t } = fmt;
  const toast = useToast();
  const navigate = useGuardedNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const counts = useLiveQuery(async () => {
    const [challenges, messages, rewards, reports] = await Promise.all([
      db.challenges.where('[childId+status]').equals([child.id, 'completed']).count(),
      db.messages.where('childId').equals(child.id).count(),
      db.rewards.where('childId').equals(child.id).count(),
      db.weeklyReports.where('childId').equals(child.id).count(),
    ]);
    return { challenges, messages, rewards, reports };
  }, [child.id]);

  const exportChild = async () => {
    setExporting(true);
    try {
      const file = await exportBackup({ childId: child.id });
      downloadBackup(file, backupFileName(file).replace(/\.json$/, '-child.json'));
      toast.success(t('parent.data.exported'));
    } catch (cause) {
      toast.error(cause instanceof Error && cause.message ? cause.message : t('common.error'));
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteChild(child.id);
      toast.success(t('parent.data.deleted', { name: child.nickname }));
      navigate('/parent/children', { replace: true });
    } catch {
      toast.error(t('common.error'));
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Section emoji="📦" title={t('parent.data.stored', { name: child.nickname })} description={t('parent.data.storedHint')}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('parent.data.challenges')} value={fmt.number(counts?.challenges ?? 0)} />
          <Stat label={t('parent.data.messages')} value={fmt.number(counts?.messages ?? 0)} />
          <Stat label={t('parent.data.rewards')} value={fmt.number(counts?.rewards ?? 0)} />
          <Stat label={t('parent.data.reports')} value={fmt.number(counts?.reports ?? 0)} />
        </div>
        <p className="mt-3 text-sm text-ink-500">{t('parent.data.since', { date: fmt.date(child.createdAt) })}</p>
      </Section>

      <Section
        emoji="⬇️"
        title={t('parent.data.exportTitle')}
        description={t('parent.data.exportHint', { name: child.nickname })}
        actions={
          <Button variant="secondary" onClick={exportChild} loading={exporting}>
            {t('parent.data.export')}
          </Button>
        }
      />

      <Section
        tone="danger"
        emoji="🗑️"
        title={t('parent.data.deleteTitle', { name: child.nickname })}
        description={t('parent.data.deleteHint')}
        actions={
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t('parent.data.delete')}
          </Button>
        }
      />

      <TypedConfirmDialog
        open={confirming}
        title={t('parent.data.deleteTitle', { name: child.nickname })}
        message={t('parent.data.deleteMessage', { name: child.nickname })}
        word={DELETE_WORD}
        confirmLabel={t('parent.data.delete')}
        busy={deleting}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      >
        <Note tone="danger">{t('parent.data.deleteWarning')}</Note>
      </TypedConfirmDialog>
    </div>
  );
}
