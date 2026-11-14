import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field, NumberInput, PasswordInput, Select, TextArea, TextInput } from './index';

describe('Field', () => {
  it('wires the label, hint and error to the control', () => {
    render(
      <Field label="Nickname" hint="Shown to your child." error="Please enter a nickname." required>
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: /Nickname/ });
    expect(input).toHaveAccessibleDescription('Shown to your child. Please enter a nickname.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toBeRequired();
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a nickname.');
    const label = screen.getByText('Nickname');
    expect(label).toHaveAttribute('for', input.id);
  });

  it('has no description or invalid state without hint and error', () => {
    render(
      <Field label="City">
        <TextInput />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'City' });
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toBeRequired();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses a given id and keeps the control`s own describedby', () => {
    render(
      <>
        <p id="extra">Extra help</p>
        <Field label="Model" id="model" hint="For example gpt-4o-mini.">
          <TextInput aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText('Model');
    expect(input.id).toBe('model');
    expect(input).toHaveAccessibleDescription('Extra help For example gpt-4o-mini.');
  });

  it('gives wiring props to a custom control', () => {
    render(
      <Field label="Colour" error="Pick one">
        {(control) => <input type="color" {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Colour');
    expect(input).toHaveAccessibleDescription('Pick one');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('names a group of controls', () => {
    render(
      <Field label="Interests" hint="Pick up to three." group>
        <button type="button">Space</button>
      </Field>,
    );
    const group = screen.getByRole('group', { name: 'Interests' });
    expect(group).toHaveAccessibleDescription('Pick up to three.');
  });

  it('works with Select and TextArea', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Field label="Grade" hint="School grade">
          <Select
            defaultValue=""
            placeholder="Choose"
            onValueChange={onValueChange}
            options={[
              { value: 'K', label: 'Kindergarten' },
              { value: '1', label: 'Grade 1' },
            ]}
          />
        </Field>
        <Field label="Note">
          <TextArea />
        </Field>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Grade' });
    expect(select).toHaveAccessibleDescription('School grade');
    await user.selectOptions(select, 'Grade 1');
    expect(onValueChange).toHaveBeenCalledWith('1');
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeInTheDocument();
  });
});

describe('TextInput', () => {
  it('reports changes both ways', async () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(<TextInput aria-label="Name" onChange={onChange} onValueChange={onValueChange} />);
    await user.type(screen.getByLabelText('Name'), 'Zo');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onValueChange).toHaveBeenLastCalledWith('Zo');
  });

  it('forwards className and ref', () => {
    let node: HTMLInputElement | null = null;
    render(
      <TextInput
        aria-label="Name"
        className="extra-class"
        ref={(element) => {
          node = element;
        }}
      />,
    );
    expect(screen.getByLabelText('Name')).toHaveClass('extra-class');
    expect(node).toBe(screen.getByLabelText('Name'));
  });
});

describe('PasswordInput', () => {
  it('hides the password until the toggle is pressed', async () => {
    const user = userEvent.setup();
    render(
      <Field label="Password">
        <PasswordInput />
      </Field>,
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.click(hide);
    expect(input).toHaveAttribute('type', 'password');
  });
});

describe('NumberInput', () => {
  function Minutes({ initial = 30 as number | null, onChange = (_: number | null) => {} }) {
    const [value, setValue] = useState<number | null>(initial);
    return (
      <Field label="Minutes per day">
        <NumberInput
          value={value}
          min={5}
          max={120}
          step={5}
          unit="min"
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      </Field>
    );
  }

  it('is a labelled spinbutton with its range', () => {
    render(<Minutes />);
    const input = screen.getByRole('spinbutton', { name: 'Minutes per day' });
    expect(input).toHaveValue('30');
    expect(input).toHaveAttribute('aria-valuenow', '30');
    expect(input).toHaveAttribute('aria-valuemin', '5');
    expect(input).toHaveAttribute('aria-valuemax', '120');
    expect(input).toHaveAttribute('aria-valuetext', '30 min');
  });

  it('steps with the buttons and the arrow keys, inside the range', async () => {
    const user = userEvent.setup();
    render(<Minutes initial={115} />);
    const input = screen.getByRole('spinbutton');
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    expect(input).toHaveValue('120');
    expect(screen.getByRole('button', { name: 'Increase' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(input).toHaveValue('115');
    input.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input).toHaveValue('105');
    await user.keyboard('{ArrowUp}');
    expect(input).toHaveValue('110');
  });

  it('accepts typed digits only, reports null when empty and clamps on blur', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Minutes onChange={onChange} />);
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(input, '9a9-9');
    expect(input).toHaveValue('999');
    expect(onChange).toHaveBeenLastCalledWith(999);
    await user.tab();
    expect(input).toHaveValue('120');
    expect(onChange).toHaveBeenLastCalledWith(120);
  });

  it('supports decimals and negatives when allowed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    function Temperature() {
      const [value, setValue] = useState<number | null>(null);
      return (
        <NumberInput
          aria-label="Temperature"
          value={value}
          min={-10}
          max={10}
          step={0.1}
          decimal
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Temperature />);
    const input = screen.getByRole('spinbutton', { name: 'Temperature' });
    await user.type(input, '-0.7');
    expect(input).toHaveValue('-0.7');
    expect(onChange).toHaveBeenLastCalledWith(-0.7);
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(-0.5);
  });

  it('follows a value changed from outside', () => {
    const { rerender } = render(<NumberInput aria-label="Count" value={3} onChange={() => {}} />);
    rerender(<NumberInput aria-label="Count" value={8} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton')).toHaveValue('8');
    rerender(<NumberInput aria-label="Count" value={null} onChange={() => {}} />);
    expect(screen.getByRole('spinbutton')).toHaveValue('');
  });
});
