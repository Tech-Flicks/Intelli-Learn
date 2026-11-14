import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './index';

function Controlled({ onChange = (_: boolean) => {}, disabled = false }) {
  const [on, setOn] = useState(false);
  return (
    <Toggle
      checked={on}
      disabled={disabled}
      label="Read aloud"
      description="Reads every screen to your child."
      onChange={(next) => {
        onChange(next);
        setOn(next);
      }}
    />
  );
}

describe('Toggle', () => {
  it('is a named and described switch', () => {
    render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Read aloud' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(toggle).toHaveAccessibleDescription('Reads every screen to your child.');
  });

  it('toggles with a click, the label, Space and Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch');
    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByText('Read aloud'));
    expect(onChange).toHaveBeenLastCalledWith(false);
    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('does nothing while disabled', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} disabled />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('works with only an aria-label and forwards className', () => {
    render(<Toggle checked aria-label="Microphone" className="extra-class" onChange={() => {}} />);
    const toggle = screen.getByRole('switch', { name: 'Microphone' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveClass('extra-class');
  });
});
