/**
 * The offline bank on the real play surface: every kind of interaction from
 * `@/offline` is mounted in the engine's `ChallengeStage` with the translated
 * labels from `@/i18n`, and a child can finish a choice, a tap and a number
 * challenge through the widgets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeStage } from '@/core/grades';
import { GRADES, INTERACTION_KINDS, type ChallengePlan, type Grade, type InteractionKind } from '@/core/types';
import { ChallengeStage, type Answer, type CheckResult } from '@/engine';
import { setLocale, stageLabels, useStageLabels } from '@/i18n';
import { pickOfflineChallenge } from '@/offline';

type Submit = (answer: Answer, result: CheckResult) => void;

function plan(interaction: InteractionKind, grade: Grade): ChallengePlan {
  return { childId: 'child-1', skillId: 'math-counting-cardinality', strand: 'math', stage: makeStage(grade, 'growing'), interaction, mode: 'quest', purpose: 'core', theme: 'space' };
}

beforeEach(() => {
  // jsdom has no canvas; the stage must work without one.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setLocale('en');
});

describe('offline challenges on the challenge stage', () => {
  it.each(INTERACTION_KINDS)('mounts a %s challenge of every grade without an error, and never starts solved', async (kind) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    for (const grade of GRADES) {
      const challenge = pickOfflineChallenge(plan(kind, grade), { seed: 3 });
      expect(challenge.interaction.kind).toBe(kind);
      const onSubmit = vi.fn<Submit>();
      const view = render(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion labels={stageLabels()} />);
      const check = screen.getByRole('button', { name: 'Check' });
      if (kind === 'order') {
        // The shuffled cards are always a complete answer, but never the right one to begin with.
        await user.click(check);
        expect(onSubmit, `${kind} ${grade}`).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ correct: false }));
      } else {
        // Nothing is answered yet, so there is nothing to check.
        expect(check, `${kind} ${grade}`).toBeDisabled();
      }
      view.unmount();
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('shows the widget texts in the interface language', () => {
    function Stage() {
      return <ChallengeStage challenge={pickOfflineChallenge(plan('choice', '2'), { seed: 1 })} onSubmit={() => {}} reducedMotion labels={useStageLabels()} />;
    }
    setLocale('es');
    render(<Stage />);
    expect(screen.getByRole('button', { name: 'Comprobar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check' })).toBeNull();
  });

  it('lets a child solve an offline choice challenge with the answer key', async () => {
    const challenge = pickOfflineChallenge(plan('choice', '1'), { seed: 2 });
    if (challenge.interaction.kind !== 'choice') throw new Error('expected a choice challenge');
    const onSubmit = vi.fn<Submit>();
    const user = userEvent.setup();
    render(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion labels={stageLabels()} />);

    const { options, correctIds } = challenge.interaction;
    const wrong = options.find((option) => !correctIds.includes(option.id));
    const right = options.filter((option) => correctIds.includes(option.id));
    if (!wrong) throw new Error('a choice challenge needs a wrong option');
    const buttonFor = (label: string): HTMLElement => {
      const found = screen.getAllByRole('button').find((button) => button.textContent?.includes(label));
      if (!found) throw new Error(`no button for "${label}"`);
      return found;
    };

    // A wrong pick first: kind feedback data, no penalty, and the child can change it.
    await user.click(buttonFor(wrong.label));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenLastCalledWith([wrong.id], expect.objectContaining({ correct: false, misconception: wrong.misconception ?? null }));

    if (challenge.interaction.multi) await user.click(buttonFor(wrong.label)); // take the wrong pick back
    for (const option of right) await user.click(buttonFor(option.label));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    const [answer, result] = onSubmit.mock.calls.at(-1) ?? [];
    expect([...(answer as string[])].sort()).toEqual([...correctIds].sort());
    expect(result).toMatchObject({ correct: true, progress: 1 });
  });

  it('lets a child solve an offline number challenge on the keypad', async () => {
    const challenge = pickOfflineChallenge(plan('number', 'K'), { seed: 4 });
    if (challenge.interaction.kind !== 'number') throw new Error('expected a number challenge');
    const onSubmit = vi.fn<Submit>();
    const user = userEvent.setup();
    render(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion labels={stageLabels()} />);
    for (const digit of String(challenge.interaction.answer)) await user.click(screen.getByRole('button', { name: digit }));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(onSubmit).toHaveBeenCalledWith(challenge.interaction.answer, { correct: true, misconception: null, progress: 1 });
  });

  it('lets a child solve an offline tap challenge through the accessible scene buttons', async () => {
    const challenge = pickOfflineChallenge(plan('tap', 'PK'), { seed: 5 });
    if (challenge.interaction.kind !== 'tap') throw new Error('expected a tap challenge');
    const onSubmit = vi.fn<Submit>();
    const user = userEvent.setup();
    const view = render(<ChallengeStage challenge={challenge} onSubmit={onSubmit} reducedMotion labels={stageLabels()} />);
    // Every tappable object is a real button, so the challenge works without seeing the canvas.
    const tappable = challenge.scene.objects.filter((object) => object.tappable);
    const sceneButtons = [...view.container.querySelectorAll<HTMLElement>('button[data-object-id]')];
    expect(sceneButtons.map((button) => button.dataset.objectId).sort()).toEqual(tappable.map((object) => object.id).sort());
    for (const id of challenge.interaction.targetIds) {
      const button = sceneButtons.find((candidate) => candidate.dataset.objectId === id);
      if (!button) throw new Error(`no scene button for ${id}`);
      // These buttons are for the keyboard and screen readers; touches go to the canvas itself.
      button.focus();
      await user.keyboard('{Enter}');
    }
    await user.click(screen.getByRole('button', { name: 'Check' }));
    const [answer, result] = onSubmit.mock.calls.at(-1) ?? [];
    expect([...(answer as string[])].sort()).toEqual([...challenge.interaction.targetIds].sort());
    expect(result).toMatchObject({ correct: true });
  });
});
