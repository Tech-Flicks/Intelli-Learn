import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_TOASTS, ToastViewport, dismissToast, showToast, useToast } from './index';

function Demo() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success('Saved')}>
        Save
      </button>
      <button type="button" onClick={() => toast.error('Could not save')}>
        Fail
      </button>
      <ToastViewport />
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

describe('toasts', () => {
  it('announces messages in a polite live region', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const region = document.querySelector('[data-toast-viewport]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(region).toHaveTextContent('Saved');
  });

  it('goes away on its own', async () => {
    render(<ToastViewport />);
    act(() => {
      showToast('Hello', { durationMs: 40 });
    });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Hello')).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('keeps a toast with no duration until it is dismissed', async () => {
    const user = userEvent.setup();
    render(<ToastViewport />);
    act(() => {
      showToast('Stay', { durationMs: 0 });
      showToast('Go', { durationMs: 40 });
    });
    await waitFor(() => expect(screen.queryByText('Go')).not.toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText('Stay')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Stay')).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it('uses the tone for errors and successes', async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByText('Saved').closest('[data-tone]')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('Could not save').closest('[data-tone]')).toHaveAttribute('data-tone', 'error');
  });

  it('shows at most a few at once, newest kept', () => {
    render(<ToastViewport />);
    act(() => {
      for (let i = 1; i <= MAX_TOASTS + 2; i += 1) showToast(`Message ${i}`, { durationMs: 0 });
    });
    expect(screen.getByText(`Message ${MAX_TOASTS + 2}`)).toBeInTheDocument();
    expect(screen.getByText('Message 3')).toBeInTheDocument();
  });

  it('mounts its own live region when the app has none', async () => {
    function Lonely() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.show('On my own')}>
          Go
        </button>
      );
    }
    const user = userEvent.setup();
    await act(async () => {
      render(<Lonely />);
    });
    const host = document.querySelector('[data-toast-host="auto"]');
    expect(host).not.toBeNull();
    expect(host?.querySelector('[aria-live="polite"]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(host).toHaveTextContent('On my own');

    // An explicit viewport takes over; the automatic one steps aside.
    await act(async () => {
      render(<ToastViewport />);
    });
    expect(host?.querySelector('[aria-live="polite"]')).toBeNull();
    expect(document.querySelectorAll('[data-toast-viewport]')).toHaveLength(1);
  });
});
