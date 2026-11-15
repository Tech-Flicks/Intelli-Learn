/**
 * The last pointer position on the page, shared by every Pip that follows the pointer with
 * its eyes: one passive listener for all of them, attached only while somebody needs it.
 */
let x = 0;
let y = 0;
/** 0 until the pointer has been seen. It grows with every move, so a reader can tell "nothing new". */
let version = 0;
let users = 0;

function onPointer(event: PointerEvent): void {
  x = event.clientX;
  y = event.clientY;
  version += 1;
}

/** Starts tracking (if nobody did yet) and returns the function that gives the claim back. */
export function retainPointer(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (users === 0) {
    window.addEventListener('pointermove', onPointer, { passive: true });
    // A tap on a touch screen has no move before it.
    window.addEventListener('pointerdown', onPointer, { passive: true });
  }
  users += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
    }
  };
}

/** Position in viewport (client) pixels. `version` is 0 while no pointer has been seen. */
export function readPointer(): { x: number; y: number; version: number } {
  return { x, y, version };
}
