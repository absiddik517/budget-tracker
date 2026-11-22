import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { runTopBackHandler } from '../lib/backStack';

export interface AndroidBackState {
  exitConfirmOpen: boolean;
  cancelExit: () => void;
  confirmExit: () => void;
}

/**
 * Handles the Android hardware/gesture Back button on native Capacitor builds.
 * Shows an exit confirmation popup before exiting on the Dashboard.
 * Does nothing on web browsers.
 */
export function useAndroidBack(): AndroidBackState {
  const navigate = useNavigate();
  const location = useLocation();
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const cancelExit = useCallback(() => {
    setExitConfirmOpen(false);
  }, []);

  const confirmExit = useCallback(() => {
    setExitConfirmOpen(false);
    if (Capacitor.isNativePlatform()) {
      void App.exitApp();
    }
  }, []);

  useEffect(() => {
    // Only intercept the Back button inside the native Android container.
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let listenerHandle: PluginListenerHandle | null = null;

    void App.addListener('backButton', () => {
      // 1. Close the topmost open modal, bottom sheet, or picker dialog first.
      if (runTopBackHandler()) return;

      // 2. Navigate back if React Router has a previous in-app history entry.
      const historyState = window.history.state as { idx?: unknown } | null;
      const hasPreviousPage =
        typeof historyState?.idx === 'number' && historyState.idx > 0;

      if (hasPreviousPage) {
        navigate(-1);
        return;
      }

      // 3. Otherwise, return to the Dashboard if currently on another route.
      if (location.pathname !== '/') {
        navigate('/', { replace: true });
        return;
      }

      // 4. Already on the Dashboard with no overlay or history: ask before exiting.
      setExitConfirmOpen(true);
    }).then((handle) => {
      if (cancelled) {
        // Cleanup ran before addListener resolved; remove the handle immediately.
        void handle.remove();
      } else {
        listenerHandle = handle;
      }
    });

    return () => {
      cancelled = true;
      if (listenerHandle) {
        void listenerHandle.remove();
        listenerHandle = null;
      }
    };
  }, [navigate, location.pathname]);

  return {
    exitConfirmOpen,
    cancelExit,
    confirmExit,
  };
}
