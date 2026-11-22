import { useEffect, useRef } from 'react';

type BackEntry = {
  id: symbol;
  onBack: () => void;
};

// Module-level stack of active overlay/modal/sheet close handlers (topmost is last).
const backStack: BackEntry[] = [];

/**
 * Runs the topmost registered back handler, if any exists.
 * Returns true if a handler was executed, false otherwise.
 */
export function runTopBackHandler(): boolean {
  const top = backStack[backStack.length - 1];
  if (!top) return false;
  top.onBack();
  return true;
}

/**
 * Registers a close handler on the back stack while `active` is true,
 * and removes it automatically on cleanup.
 */
export function useBackHandler(active: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;

    // Unique symbol ensures cleanup removes only this registration.
    const entry: BackEntry = {
      id: Symbol('backHandler'),
      onBack: () => onBackRef.current(),
    };
    backStack.push(entry);

    return () => {
      const idx = backStack.findIndex((item) => item.id === entry.id);
      if (idx !== -1) {
        backStack.splice(idx, 1);
      }
    };
  }, [active]);
}
