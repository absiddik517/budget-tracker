import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { runTopBackHandler } from '../lib/backStack';

/**
 * Handles the Android hardware/gesture Back button on native Capacitor builds.
 * Does nothing on web browsers.
 */
export function useAndroidBack(): void {
  const navigate = useNavigate();
  const location = useLocation();

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

      // 4. Already on the Dashboard with no overlay or history: exit the app.
      void App.exitApp();
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
}
