/** `/kids/:childId/shelf`: the companion, the badges and the treasure shop. */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion } from 'motion/react';
import type { ChildProfile, RewardRecord } from '@/core/types';
import { db, getChild, updateChild } from '@/data';
import { starCountText, t as translate, tn, useT } from '@/i18n';
import {
  BADGES,
  buyCollectible,
  companionEmoji,
  companionProgress,
  getCollectible,
  getCompanionDef,
  type BadgeDef,
  type CollectibleDef,
} from '@/progression';
import {
  Badge,
  BigButton,
  Button,
  ChildShell,
  Field,
  Modal,
  ProgressBar,
  TextInput,
  cx,
  useReducedMotion,
  useToast,
} from '@/ui';
import {
  badgeHint,
  badgeName,
  badgeReason,
  companionName,
  growthName,
  itemName,
  shopGroups,
  starsToGo,
  themeEmoji,
  themeName,
} from './catalog';
import { COMPANION_NAME_MAX_LENGTH, checkCompanionName, type CompanionNameProblem } from './companionName';
import { useChildScreen, useScreenVoice, wantsReadAloud } from './hooks';
import { BackButton, ScreenColumn, ScreenTitle, SectionHeading, SpeakerButton, TopBarStars } from './parts';
import './child.css';
import './strings';

// ---------------------------------------------------------------------------
// Companion
// ---------------------------------------------------------------------------

function NameDialog({
  open,
  current,
  strictness,
  onClose,
  onSave,
}: {
  open: boolean;
  current: string;
  strictness: 'strict' | 'standard';
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const t = useT();
  const formId = useId();
  const [value, setValue] = useState(current);
  const [problem, setProblem] = useState<CompanionNameProblem | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh start every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setValue(current);
    setProblem(null);
    setSaving(false);
  }, [open, current]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const result = checkCompanionName(value, strictness);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    setSaving(true);
    try {
      await onSave(result.name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('child.shelf.name.title')}
      size="sm"
      playful
      dismissible={!saving}
      footer={
        <>
          <Button variant="ghost" size="lg" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} size="lg" loading={saving}>
            {t('child.shelf.name.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Field
          label={t('child.shelf.name.label')}
          hint={t('child.shelf.name.hint')}
          error={problem ? t(`child.shelf.name.err.${problem}`) : undefined}
        >
          <TextInput
            scale="lg"
            value={value}
            maxLength={COMPANION_NAME_MAX_LENGTH}
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            enterKeyHint="done"
            data-autofocus=""
            onValueChange={(next) => {
              setValue(next);
              setProblem(null);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}

function CompanionCard({ child, onRename }: { child: ChildProfile; onRename: () => void }) {
  const t = useT();
  const { companion } = child;
  const progress = companionProgress(companion);
  const stages = getCompanionDef(companion.species)?.stages ?? ['🥚', '🥚', '🥚', '🥚', '🥚'];
  const percent = Math.round(progress.progress * 100);
  const named = companion.name.trim() !== '';
  const cheer =
    progress.nextGrowthAt === null
      ? t('child.shelf.grow.max')
      : progress.growth === 0
        ? t('child.shelf.grow.egg')
        : t('child.shelf.grow.more');

  return (
    <section
      aria-labelledby="child-companion-title"
      className="flex flex-col items-center gap-3 rounded-[2rem] bg-white px-5 py-6 text-center text-ink-900 shadow-card"
    >
      <h2 id="child-companion-title" className="sr-only">
        {t('child.shelf.companionTitle')}
      </h2>
      <span aria-hidden="true" className="animate-float whitespace-nowrap text-8xl leading-none sm:text-9xl">
        {companionEmoji(companion)}
      </span>
      <p className="break-words font-display text-3xl font-bold leading-tight" data-testid="companion-name">
        {companionName(companion)}
      </p>
      <Badge tone="brand" size="md">
        {growthName(progress.growth)}
      </Badge>

      {/* The five sizes: reached ones in colour, the ones to come as shapes. */}
      <ol aria-hidden="true" className="flex max-w-full flex-wrap items-end justify-center gap-1 sm:gap-4">
        {stages.map((emoji, index) => (
          <li
            key={index}
            className={cx(
              'flex h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-2xl px-1 text-2xl leading-none',
              index === progress.growth ? 'border-2 border-brand-500 bg-brand-50' : 'border-2 border-transparent',
              index > progress.growth && 'child-silhouette',
            )}
          >
            {emoji}
          </li>
        ))}
      </ol>

      <ProgressBar
        value={percent}
        tone="leaf"
        size="lg"
        aria-label={t('child.shelf.growAria')}
        valueText={progress.nextGrowthAt === null ? cheer : t('child.shelf.growValue', { percent })}
        className="max-w-sm"
      />
      <p className="text-lg font-semibold text-ink-700">{cheer}</p>
      <Button variant="secondary" size="lg" icon="✏️" onClick={onRename}>
        {named ? t('child.shelf.name.change') : t('child.shelf.name.give')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Treasures the child owns
// ---------------------------------------------------------------------------

function TreasureShelf({ owned, fresh }: { owned: CollectibleDef[]; fresh: string | null }) {
  const t = useT();
  return (
    <section aria-labelledby="child-treasures-title" className="flex flex-col gap-3">
      <SectionHeading id="child-treasures-title" emoji="🧸">
        {t('child.shelf.treasuresTitle')}
      </SectionHeading>
      <div className="rounded-3xl bg-white px-4 pt-4 text-ink-900 shadow-card">
        {owned.length === 0 ? (
          <p className="px-2 pb-3 text-center text-lg font-semibold text-ink-700">{t('child.shelf.treasures.empty')}</p>
        ) : (
          <ul className="flex flex-wrap items-end justify-center gap-x-4 gap-y-2 px-2" data-testid="owned-treasures">
            {owned.map((item) => (
              <li key={item.key} className="flex w-20 flex-col items-center gap-0.5 text-center">
                <span aria-hidden="true" className={cx('text-5xl leading-none', fresh === item.key && 'animate-pop')}>
                  {item.emoji}
                </span>
                <span className="w-full break-words text-xs font-bold leading-tight text-ink-700">{itemName(item)}</span>
              </li>
            ))}
          </ul>
        )}
        <div aria-hidden="true" className="child-plank -mx-1 mb-4 mt-2 h-3 rounded-full" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function Badges({ rewards, small }: { rewards: readonly RewardRecord[]; small: boolean }) {
  const t = useT();
  const [hintFor, setHintFor] = useState<string | null>(null);
  const reasons = new Map(rewards.map((reward) => [reward.key, reward.reason]));
  const earned = BADGES.filter((badge) => reasons.has(badge.key));
  const waiting = BADGES.filter((badge) => !reasons.has(badge.key));
  const hinted: BadgeDef | undefined = waiting.find((badge) => badge.key === hintFor);

  return (
    <section aria-labelledby="child-badges-title" className="flex flex-col gap-3">
      <SectionHeading
        id="child-badges-title"
        emoji="🏅"
        aside={
          <Badge tone="warning" size="md">
            {t('child.shelf.badges.count', { earned: earned.length, total: BADGES.length })}
          </Badge>
        }
      >
        {t('child.shelf.badgesTitle')}
      </SectionHeading>

      {earned.length === 0 ? (
        <p className="rounded-3xl bg-white px-5 py-4 text-lg font-semibold text-ink-700 shadow-card">{t('child.shelf.badges.none')}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="earned-badges">
          {earned.map((badge) => (
            <li key={badge.key} className="flex items-center gap-3 rounded-3xl border-2 border-sun-500 bg-sun-100 p-3 text-ink-900">
              <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-3xl leading-none shadow-card">
                {badge.emoji}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-display text-lg font-bold leading-tight">{badgeName(badge)}</span>
                <span className={cx('leading-snug text-ink-700', small ? 'sr-only' : 'text-sm')}>{badgeReason(badge, reasons.get(badge.key))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {waiting.length > 0 && (
        <div role="group" aria-label={t('child.shelf.mysteryTitle')} className="flex flex-col gap-3 rounded-3xl bg-white p-4 text-ink-900 shadow-card">
          <p aria-live="polite" className="min-h-7 text-base font-bold text-ink-700" data-testid="badge-hint">
            {hinted ? t('child.shelf.mystery.hint', { hint: badgeHint(hinted) }) : t('child.shelf.mystery.tap')}
          </p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
            {waiting.map((badge, index) => (
              <li key={badge.key} className="flex justify-center">
                <button
                  type="button"
                  aria-label={t('child.shelf.mystery.aria', { index: index + 1 })}
                  aria-pressed={hintFor === badge.key}
                  onClick={() => setHintFor((current) => (current === badge.key ? null : badge.key))}
                  className={cx(
                    'flex h-14 w-14 items-center justify-center rounded-full border-2 text-3xl leading-none transition-[background-color,border-color,transform] duration-150 active:scale-95',
                    hintFor === badge.key ? 'border-brand-500 bg-brand-100' : 'border-dashed border-ink-400 bg-ink-50 hover:border-brand-500',
                  )}
                >
                  <span aria-hidden="true" className="child-silhouette">
                    {badge.emoji}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

function ShopItem({ item, stars, owned, onGet }: { item: CollectibleDef; stars: number; owned: boolean; onGet: (item: CollectibleDef) => void }) {
  const t = useT();
  const name = itemName(item);
  const toGo = starsToGo(stars, item.cost);
  const moreText = tn('child.shelf.more.one', 'child.shelf.more.other', toGo);

  return (
    <li data-item={item.key} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center text-ink-900">
      <span aria-hidden="true" className={cx('text-5xl leading-none', !owned && toGo > 0 && 'opacity-80')}>
        {item.emoji}
      </span>
      <span className="break-words font-display text-base font-bold leading-tight">{name}</span>
      {owned ? (
        <Badge tone="success" size="md" emoji="✓" className="mb-1 mt-auto max-w-full whitespace-normal">
          {t('child.shelf.owned')}
        </Badge>
      ) : (
        <div className="mt-auto flex w-full flex-col items-center gap-1.5">
          <span aria-hidden="true" className="whitespace-nowrap font-display text-lg font-bold">
            ⭐ {item.cost}
          </span>
          {toGo === 0 ? (
            <BigButton
              tone="sun"
              size="md"
              fullWidth
              onClick={() => onGet(item)}
              aria-label={`${t('child.shelf.get')}: ${name}, ${starCountText(item.cost)}`}
              className="px-2! text-base! min-[400px]:text-lg!"
            >
              {t('child.shelf.get')}
            </BigButton>
          ) : (
            // Not enough stars yet: show the way there, never a "no".
            <>
              <ProgressBar value={stars} max={item.cost} tone="sun" size="sm" aria-label={`${name}, ${starCountText(item.cost)}`} valueText={moreText} />
              <span className="flex min-h-10 items-center text-sm font-bold leading-tight text-ink-700">{moreText}</span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Themes shown before "More treasures" is tapped: four on a phone, six from tablet width. */
const SHOP_PREVIEW_PHONE = 4;
const SHOP_PREVIEW_WIDE = 6;

function Shop({ child, onGet }: { child: ChildProfile; onGet: (item: CollectibleDef) => void }) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const groups = shopGroups(child.interests);
  return (
    <section aria-labelledby="child-shop-title" className="flex flex-col gap-3">
      <SectionHeading
        id="child-shop-title"
        emoji="🛍️"
        aside={<p className="text-base font-semibold opacity-80">{t('child.shelf.shop.hint')}</p>}
      >
        {t('child.shelf.shopTitle')}
      </SectionHeading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group, index) => (
          <section
            key={group.theme}
            aria-label={themeName(group.theme)}
            data-theme={group.theme}
            className={cx(
              'flex-col gap-2 rounded-3xl border-2 border-brand-200 bg-brand-50 p-3 text-ink-900',
              showAll || index < SHOP_PREVIEW_PHONE ? 'flex' : index < SHOP_PREVIEW_WIDE ? 'hidden sm:flex' : 'hidden',
            )}
          >
            <h3 className="flex items-center gap-2 px-1 font-display text-lg font-bold leading-tight">
              <span aria-hidden="true">{themeEmoji(group.theme)}</span>
              {themeName(group.theme)}
            </h3>
            <ul className="flex flex-1 gap-2">
              {group.items.map((item) => (
                <ShopItem key={item.key} item={item} stars={child.stars} owned={child.collectibles.includes(item.key)} onGet={onGet} />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {!showAll && groups.length > SHOP_PREVIEW_PHONE && (
        <BigButton tone="white" size="md" emoji="🎁" onClick={() => setShowAll(true)} className="self-center">
          {t('child.shelf.shop.more')}
        </BigButton>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function ShelfScreen() {
  const { child, controls, small } = useChildScreen();
  const t = useT();
  const toast = useToast();
  const calm = useReducedMotion();
  const badgeRewards = useLiveQuery(
    () => db.rewards.where('[childId+kind]').equals([child.id, 'badge']).toArray(),
    [child.id],
  );
  const voice = useScreenVoice({
    line: t(small ? 'child.shelf.say.small' : 'child.shelf.say'),
    enabled: controls.voiceOutput,
    auto: wantsReadAloud(child),
    rate: child.voiceRate,
  });

  const [naming, setNaming] = useState(false);
  const [wanted, setWanted] = useState<CollectibleDef | null>(null);
  const [buying, setBuying] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const owned = child.collectibles
    .map((key) => getCollectible(key))
    .filter((item): item is CollectibleDef => item !== undefined);

  const saveName = async (name: string) => {
    // Read the profile again: only the name changes, whatever else happened to the companion meanwhile.
    const latest = await getChild(child.id);
    if (!latest) return;
    await updateChild(child.id, { companion: { ...latest.companion, name } });
    setNaming(false);
    if (name !== '') toast.success(translate('child.shelf.name.saved', { name }), { emoji: '👋' });
  };

  const buy = async () => {
    if (!wanted || buying) return;
    const item = wanted;
    setBuying(true);
    try {
      const result = await buyCollectible(child.id, item.key);
      if (result.ok) {
        setFresh(item.key);
        toast.success(translate('child.shelf.bought', { item: itemName(item) }), { emoji: item.emoji });
      } else if (result.reason === 'not-enough-stars') {
        toast.show(translate('child.shelf.notYet'), { emoji: '⭐' });
      }
    } finally {
      setBuying(false);
      setWanted(null);
    }
  };

  const wantedName = wanted ? itemName(wanted) : '';

  return (
    <ChildShell
      tone="sunset"
      topBar={
        <>
          <BackButton to={`/kids/${child.id}`} label={t('child.backToMap')} />
          <span className="flex-1" />
          <TopBarStars count={child.stars} />
          <SpeakerButton voice={voice} />
        </>
      }
    >
      <ScreenColumn className="pb-6">
        <ScreenTitle emoji="🏆">{t('child.shelf.title')}</ScreenTitle>
        <motion.div
          initial={calm ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="mx-auto w-full max-w-xl"
        >
          <CompanionCard child={child} onRename={() => setNaming(true)} />
        </motion.div>

        <p className="flex items-center justify-center gap-2 text-center font-display text-xl font-bold" data-testid="total-stars">
          <span aria-hidden="true">🌟</span>
          {tn('child.shelf.total.one', 'child.shelf.total.other', child.totalStars)}
        </p>

        <TreasureShelf owned={owned} fresh={fresh} />
        <Badges rewards={badgeRewards ?? []} small={small} />
        <Shop child={child} onGet={setWanted} />
      </ScreenColumn>

      <NameDialog
        open={naming}
        current={child.companion.name}
        strictness={controls.strictness}
        onClose={() => setNaming(false)}
        onSave={saveName}
      />

      <Modal
        open={wanted !== null}
        onClose={() => setWanted(null)}
        title={t('child.shelf.confirm.title', { item: wantedName })}
        description={
          wanted
            ? t('child.shelf.confirm.text', {
                cost: starCountText(wanted.cost),
                left: starCountText(Math.max(0, child.stars - wanted.cost)),
              })
            : undefined
        }
        size="sm"
        playful
        hideClose
        dismissible={!buying}
        footer={
          // One below the other on every screen: side by side in this narrow dialog "Yes, get it!" breaks in two.
          <div className="flex w-full flex-col gap-3">
            <BigButton tone="leaf" size="md" emoji="⭐" onClick={() => void buy()} disabled={buying} data-autofocus="" className="flex-1">
              {t('child.shelf.confirm.yes')}
            </BigButton>
            <BigButton tone="white" size="md" onClick={() => setWanted(null)} disabled={buying} className="flex-1">
              {t('child.shelf.confirm.no')}
            </BigButton>
          </div>
        }
      >
        <p aria-hidden="true" className="animate-float text-center text-7xl leading-none">
          {wanted?.emoji}
        </p>
      </Modal>
    </ChildShell>
  );
}
