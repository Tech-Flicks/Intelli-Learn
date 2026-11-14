import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Modal } from './index';

function Harness({ onClose = () => {}, dismissible = true }: { onClose?: () => void; dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Behind</button>
      <Modal
        open={open}
        dismissible={dismissible}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Change the password"
        description="Pick something only you know."
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Save
          </button>
        }
      >
        <input aria-label="New password" />
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a named, described modal dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Change the password' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Pick something only you know.');
  });

  it('moves focus into the dialog and restores it on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const close = screen.getByRole('button', { name: 'Close' });
    const input = screen.getByLabelText('New password');
    const save = screen.getByRole('button', { name: 'Save' });

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus(); // wrapped, did not reach "Behind"
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Behind' })).not.toHaveFocus();
  });

  it('pulls focus back when it lands outside', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    screen.getByRole('button', { name: 'Behind' }).focus();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on the close button and on a backdrop click, but not on a click inside', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByLabelText('New password'));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const backdrop = document.querySelector('[data-modal-backdrop]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('cannot be dismissed when dismissible is false', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} dismissible={false} />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    await user.click(document.querySelector('[data-modal-backdrop]') as Element);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks page scroll while open and restores it', () => {
    document.body.style.overflow = 'auto';
    const { rerender } = render(
      <Modal open onClose={() => {}} title="One">
        text
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <Modal open={false} onClose={() => {}} title="One">
        text
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('focuses the element marked data-autofocus', () => {
    render(
      <Modal open onClose={() => {}} title="Unlock">
        <input aria-label="First" />
        <input aria-label="Password" data-autofocus="" />
      </Modal>,
    );
    expect(screen.getByLabelText('Password')).toHaveFocus();
  });

  it('uses aria-label when there is no title', () => {
    render(
      <Modal open onClose={() => {}} aria-label="Reward">
        You earned a star
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Reward' })).toBeInTheDocument();
  });

  it('only the top dialog reacts to Escape', async () => {
    const closeOuter = vi.fn();
    const closeInner = vi.fn();
    const user = userEvent.setup();
    function Nested() {
      const [inner, setInner] = useState(false);
      return (
        <Modal open onClose={closeOuter} title="Outer">
          <button type="button" onClick={() => setInner(true)}>
            More
          </button>
          <Modal
            open={inner}
            onClose={() => {
              closeInner();
              setInner(false);
            }}
            title="Inner"
          >
            inner text
          </Modal>
        </Modal>
      );
    }
    render(<Nested />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('dialog', { name: 'Inner' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(closeInner).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'More' })).toHaveFocus();
    expect(closeOuter).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe('hidden'); // the outer one is still open
    await user.keyboard('{Escape}');
    expect(closeOuter).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog', () => {
  it('asks, confirms and cancels', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Delete this profile?"
        message="All progress will be removed."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this profile?' });
    expect(dialog).toHaveAccessibleDescription('All progress will be removed.');
    // The safe choice has the first focus for a dangerous action.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('focuses the confirm button for a normal question and blocks both while busy', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<ConfirmDialog open title="Start?" onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'OK' })).toHaveFocus();
    rerender(<ConfirmDialog open title="Start?" busy onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});
