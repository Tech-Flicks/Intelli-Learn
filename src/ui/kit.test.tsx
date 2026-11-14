import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStage } from '@/core/grades';
import { setLocale } from '@/i18n';
import {
  Badge,
  BigButton,
  Button,
  Card,
  ChildShell,
  Chip,
  EmptyState,
  IconButton,
  Meter,
  PageShell,
  ProgressBar,
  Spinner,
  StageBadge,
  StageSteps,
  StarCount,
  Stat,
  TabPanel,
  Tabs,
  cx,
} from './index';

afterEach(() => {
  act(() => setLocale('en'));
});

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
  });
});

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <form onSubmit={onSubmit}>
        <Button onClick={onClick} className="extra-class">
          Save
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('extra-class');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('blocks clicks and reports busy while loading', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('activates with the keyboard', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Go</Button>);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Go' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

describe('BigButton', () => {
  it('is named by its text, not its emoji, and is at least 56 px tall', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <BigButton emoji="🚀" tone="sun" size="md" onClick={onClick} className="extra-class">
        Play
      </BigButton>,
    );
    const button = screen.getByRole('button', { name: 'Play' });
    expect(button).toHaveClass('min-h-14', 'extra-class', 'font-display');
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <BigButton disabled onClick={onClick}>
        Play
      </BigButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('takes its name from aria-label', () => {
    render(<IconButton aria-label="Go home">🏠</IconButton>);
    const button = screen.getByRole('button', { name: 'Go home' });
    expect(button).toHaveAttribute('title', 'Go home');
  });
});

describe('Chip and Badge', () => {
  it('reports the selected state with aria-pressed', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Chip selected={false} emoji="🦖" onClick={onClick}>
        Dinosaurs
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Dinosaurs' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Chip selected emoji="🦖" onClick={onClick}>
        Dinosaurs
      </Chip>,
    );
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('is a plain button when it is not selectable', () => {
    render(<Chip>More</Chip>);
    expect(screen.getByRole('button', { name: 'More' })).not.toHaveAttribute('aria-pressed');
  });

  it('renders a badge with its text', () => {
    render(
      <Badge tone="success" emoji="✅" className="extra-class">
        Passed
      </Badge>,
    );
    expect(screen.getByText('Passed')).toHaveClass('extra-class');
  });
});

describe('ProgressBar, Meter, StarCount, Spinner', () => {
  it('exposes progress with a name and a value', () => {
    render(<ProgressBar value={3} max={5} label="Today" valueText="3 of 5" />);
    const bar = screen.getByRole('progressbar', { name: 'Today' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemax', '5');
    expect(bar).toHaveAttribute('aria-valuetext', '3 of 5');
  });

  it('clamps progress and accepts aria-label', () => {
    render(<ProgressBar value={250} aria-label="Mastery" />);
    const bar = screen.getByRole('progressbar', { name: 'Mastery' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '100%');
  });

  it('exposes a meter, optionally in segments', () => {
    render(<Meter value={2.5} max={4} segments={4} label="Grade 3" valueText="Strong" />);
    const meter = screen.getByRole('meter', { name: 'Grade 3' });
    expect(meter).toHaveAttribute('aria-valuenow', '2.5');
    expect(meter).toHaveAttribute('aria-valuetext', 'Strong');
    expect(meter.children).toHaveLength(4);
  });

  it('reads the star count in the active language', () => {
    render(<StarCount count={1} />);
    expect(screen.getByRole('img', { name: '1 star' })).toBeInTheDocument();
    act(() => setLocale('es'));
    expect(screen.getByRole('img', { name: '1 estrella' })).toBeInTheDocument();
  });

  it('never shows a negative or broken star count', () => {
    render(<StarCount count={Number.NaN} />);
    expect(screen.getByRole('img', { name: '0 stars' })).toBeInTheDocument();
  });

  it('announces loading', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'history', label: 'History', badge: 3 },
    { id: 'locked', label: 'Locked', disabled: true },
    { id: 'settings', label: 'Settings' },
  ] as const;

  function Demo({ onChange }: { onChange: (id: string) => void }) {
    return (
      <>
        <Tabs tabs={tabs} value="overview" onChange={onChange} aria-label="Sections" idBase="demo" />
        <TabPanel id="overview" idBase="demo" active>
          Overview content
        </TabPanel>
        <TabPanel id="history" idBase="demo" active={false}>
          History content
        </TabPanel>
      </>
    );
  }

  it('wires tabs to their panels', () => {
    render(<Demo onChange={() => {}} />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const selected = screen.getByRole('tab', { name: 'Overview' });
    expect(selected).toHaveAttribute('aria-selected', 'true');
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /History/ })).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(panel).toHaveTextContent('Overview content');
    expect(selected).toHaveAttribute('aria-controls', panel.id);
    expect(screen.queryByText('History content')).not.toBeInTheDocument();
  });

  it('selects with a click and with the arrow keys, skipping disabled tabs', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Demo onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: /History/ }));
    expect(onChange).toHaveBeenLastCalledWith('history');
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('history');
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith('settings');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('settings'); // value is still "overview": wraps to the last enabled tab
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith('overview');
    expect(onChange).not.toHaveBeenCalledWith('locked');
  });
});

describe('shells', () => {
  it('PageShell has a heading, a back link and actions', () => {
    render(
      <MemoryRouter>
        <PageShell title="Settings" subtitle="For parents" backTo="/parent" actions={<button type="button">Lock</button>} className="extra-class">
          <p>Content</p>
        </PageShell>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/parent');
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Content');
    expect(screen.getByRole('banner')).toHaveTextContent('For parents');
  });

  it('PageShell works without a router and with a back handler', async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<PageShell title="Setup" backTo="/x" />);
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/x');
    rerender(<PageShell title="Setup" onBack={onBack} backLabel="Previous step" />);
    await user.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('ChildShell renders the top bar and content, with decorations hidden from assistive tech', () => {
    const { container } = render(
      <ChildShell tone="space" topBar={<span>Top</span>} className="extra-class">
        <p>Play</p>
      </ChildShell>,
    );
    const shell = container.firstElementChild;
    expect(shell).toHaveClass('child-bg', 'child-bg-space', 'extra-class', 'min-h-full');
    expect(screen.getByRole('banner')).toHaveTextContent('Top');
    expect(screen.getByRole('main')).toHaveTextContent('Play');
    expect(container.querySelector('.decor')).toHaveAttribute('aria-hidden', 'true');
  });

  it('ChildShell can drop the decorations', () => {
    const { container } = render(<ChildShell decorations={false}>x</ChildShell>);
    expect(container.querySelector('.decor')).toBeNull();
  });
});

describe('Card, Stat, EmptyState', () => {
  it('render their content and forward className', () => {
    render(
      <>
        <Card as="section" aria-label="Profile" className="extra-class">
          Card body
        </Card>
        <Stat label="Minutes" value={42} hint="this week" data-testid="stat" />
        <EmptyState emoji="🪴" title="Nothing here yet" description="Play a challenge first." action={<button type="button">Play</button>} />
      </>,
    );
    expect(screen.getByRole('region', { name: 'Profile' })).toHaveClass('extra-class', 'text-ink-900');
    expect(screen.getByTestId('stat')).toHaveTextContent('Minutes42this week');
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });
});

describe('stage displays', () => {
  it('StageBadge names the grade and step', () => {
    render(<StageBadge stage={makeStage('3', 'strong')} />);
    expect(screen.getByText('Grade 3, Strong')).toBeInTheDocument();
  });

  it('StageBadge short form keeps the full name for screen readers', () => {
    render(<StageBadge stage={makeStage('K', 'ready')} short />);
    expect(screen.getByText('Kindergarten, Ready for next grade')).toHaveClass('sr-only');
    expect(screen.getByText('K')).toHaveAttribute('aria-hidden', 'true');
  });

  it('StageSteps reads the grade, the step and its position, and fills the blocks', () => {
    const { container } = render(<StageSteps stage={makeStage('5', 'growing')} mastery={50} />);
    const figure = screen.getByRole('img', { name: 'Grade 5, Growing. Step 2 of 4' });
    expect(figure).toBeInTheDocument();
    const fills = [...container.querySelectorAll<HTMLElement>('[style]')].map((element) => element.style.width);
    expect(fills).toEqual(['100%', '50%', '0%', '0%']);
  });

  it('StageSteps follows the language', () => {
    render(<StageSteps stage={makeStage('2', 'starting')} />);
    act(() => setLocale('es'));
    expect(screen.getByRole('img', { name: 'Segundo grado, Empezando. Paso 1 de 4' })).toBeInTheDocument();
  });
});
