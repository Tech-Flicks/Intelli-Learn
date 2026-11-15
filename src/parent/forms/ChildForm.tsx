/**
 * The child profile fields, shared by the setup wizard, "add a child" and the profile tab.
 * Controlled: the caller owns the draft and decides when to save.
 */
import { useState } from 'react';
import { AVATARS, INTEREST_SUGGESTIONS } from '@/core/defaults';
import { ageGroupForGrade } from '@/core/grades';
import { AGE_GROUPS, GRADES, type AgeGroup, type ChildProfile, type Grade } from '@/core/types';
import { INTEREST_MAX_LENGTH, MAX_INTERESTS, NICKNAME_MAX_LENGTH, type NewChildInput } from '@/data';
import { ageGroupName, gradeName, useT, type Translate } from '@/i18n';
import { Button, Chip, cx, Field, Select, TextInput } from '@/ui';
import { Note } from '../parts';

export interface ChildDraft {
  nickname: string;
  avatar: string;
  grade: Grade;
  ageGroup: AgeGroup;
  interests: string[];
}

export type ChildDraftErrors = Partial<Record<'nickname' | 'interests', string>>;

export function emptyChildDraft(): ChildDraft {
  return { nickname: '', avatar: AVATARS[0], grade: '1', ageGroup: ageGroupForGrade('1'), interests: [] };
}

export function childDraftOf(child: ChildProfile): ChildDraft {
  return {
    nickname: child.nickname,
    avatar: child.avatar,
    grade: child.grade,
    ageGroup: child.ageGroup,
    interests: [...child.interests],
  };
}

function charCount(text: string): number {
  return Array.from(text).length;
}

/** The nickname the way it will be stored: trimmed, inner spaces collapsed. */
export function tidyText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/** Problems that stop a save, in the interface language. Empty object = fine. */
export function validateChildDraft(draft: ChildDraft, t: Translate): ChildDraftErrors {
  const errors: ChildDraftErrors = {};
  const nickname = tidyText(draft.nickname);
  if (nickname === '') errors.nickname = t('parent.child.error.nickname');
  else if (charCount(nickname) > NICKNAME_MAX_LENGTH) errors.nickname = t('parent.child.error.nicknameLong', { max: NICKNAME_MAX_LENGTH });
  if (draft.interests.length > MAX_INTERESTS) errors.interests = t('parent.child.error.interestsMany', { max: MAX_INTERESTS });
  return errors;
}

export function childDraftToInput(draft: ChildDraft): NewChildInput {
  return {
    nickname: tidyText(draft.nickname),
    avatar: draft.avatar,
    grade: draft.grade,
    ageGroup: draft.ageGroup,
    interests: draft.interests,
  };
}

export function sameChildDraft(a: ChildDraft, b: ChildDraft): boolean {
  return (
    tidyText(a.nickname) === tidyText(b.nickname) &&
    a.avatar === b.avatar &&
    a.grade === b.grade &&
    a.ageGroup === b.ageGroup &&
    a.interests.length === b.interests.length &&
    a.interests.every((interest, index) => interest === b.interests[index])
  );
}

function hasInterest(list: readonly string[], interest: string): boolean {
  const key = interest.toLocaleLowerCase();
  return list.some((entry) => entry.toLocaleLowerCase() === key);
}

export interface ChildFormProps {
  draft: ChildDraft;
  onChange: (draft: ChildDraft) => void;
  errors?: ChildDraftErrors;
  disabled?: boolean;
}

export function ChildForm({ draft, onChange, errors = {}, disabled = false }: ChildFormProps) {
  const t = useT();
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const full = draft.interests.length >= MAX_INTERESTS;

  const set = (patch: Partial<ChildDraft>) => onChange({ ...draft, ...patch });

  const toggleInterest = (interest: string) => {
    if (hasInterest(draft.interests, interest)) {
      const key = interest.toLocaleLowerCase();
      set({ interests: draft.interests.filter((entry) => entry.toLocaleLowerCase() !== key) });
    } else if (!full) {
      set({ interests: [...draft.interests, interest] });
    }
  };

  const addCustom = () => {
    const interest = tidyText(custom);
    if (interest === '') return;
    if (charCount(interest) > INTEREST_MAX_LENGTH) {
      setCustomError(t('parent.child.error.interestLong', { max: INTEREST_MAX_LENGTH }));
      return;
    }
    if (hasInterest(draft.interests, interest)) {
      setCustom('');
      setCustomError(null);
      return;
    }
    if (full) {
      setCustomError(t('parent.child.error.interestsMany', { max: MAX_INTERESTS }));
      return;
    }
    set({ interests: [...draft.interests, interest] });
    setCustom('');
    setCustomError(null);
  };

  const suggestions = INTEREST_SUGGESTIONS as readonly string[];
  const ownInterests = draft.interests.filter((interest) => !hasInterest(suggestions, interest));

  return (
    <div className="flex flex-col gap-5">
      <Field label={t('parent.child.nickname')} hint={t('parent.child.nicknameHint')} error={errors.nickname} required>
        <TextInput
          value={draft.nickname}
          onValueChange={(nickname) => set({ nickname })}
          maxLength={NICKNAME_MAX_LENGTH + 10}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>

      <Field label={t('parent.child.avatar')} group>
        <div role="radiogroup" aria-label={t('parent.child.avatar')} className="flex flex-wrap gap-2">
          {AVATARS.map((avatar) => {
            const selected = draft.avatar === avatar;
            return (
              <button
                key={avatar}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={t('parent.child.avatarOption', { avatar })}
                disabled={disabled}
                onClick={() => set({ avatar })}
                className={cx(
                  'inline-flex h-14 w-14 items-center justify-center rounded-2xl border-2 text-3xl leading-none transition-transform',
                  'active:scale-90 disabled:cursor-not-allowed disabled:opacity-55',
                  selected ? 'border-brand-500 bg-brand-100 shadow-card' : 'border-ink-200 bg-white hover:border-brand-300 hover:bg-brand-50',
                )}
              >
                <span aria-hidden="true">{avatar}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('parent.child.grade')} hint={t('parent.child.gradeHint')}>
          <Select
            value={draft.grade}
            disabled={disabled}
            onValueChange={(value) => {
              const grade = value as Grade;
              // Choosing a grade suggests the usual age group; the parent can still change it.
              set({ grade, ageGroup: ageGroupForGrade(grade) });
            }}
            options={GRADES.map((grade) => ({ value: grade, label: gradeName(grade) }))}
          />
        </Field>
        <Field label={t('parent.child.ageGroup')} hint={t('parent.child.ageGroupHint')}>
          <Select
            value={draft.ageGroup}
            disabled={disabled}
            onValueChange={(value) => set({ ageGroup: value as AgeGroup })}
            options={AGE_GROUPS.map((age) => ({ value: age, label: ageGroupName(age) }))}
          />
        </Field>
      </div>

      <Field
        label={t('parent.child.interests')}
        hint={t('parent.child.interestsHint', { count: draft.interests.length, max: MAX_INTERESTS })}
        error={errors.interests}
        group
      >
        <div className="flex flex-wrap gap-2">
          {suggestions.map((interest) => {
            const selected = hasInterest(draft.interests, interest);
            return (
              <Chip key={interest} selected={selected} disabled={disabled || (!selected && full)} onClick={() => toggleInterest(interest)}>
                {t(`parent.interest.${interest}`)}
              </Chip>
            );
          })}
          {ownInterests.map((interest) => (
            <Chip key={interest} selected disabled={disabled} onClick={() => toggleInterest(interest)}>
              {interest}
            </Chip>
          ))}
        </div>
      </Field>

      <Field label={t('parent.child.customInterest')} error={customError ?? undefined}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              value={custom}
              onValueChange={(value) => {
                setCustom(value);
                setCustomError(null);
              }}
              placeholder={t('parent.child.customInterestPlaceholder')}
              disabled={disabled}
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addCustom();
                }
              }}
            />
          </div>
          <Button variant="secondary" onClick={addCustom} disabled={disabled || tidyText(custom) === ''}>
            {t('common.add')}
          </Button>
        </div>
      </Field>

      <Note tone="info" emoji="🔒">
        {t('parent.child.privacyNote')}
      </Note>
    </div>
  );
}
