import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyA8o0-XyevfpaTWVtQEVEntrdM45ukSJf4',
  authDomain: 'budget-tracker-f7025.firebaseapp.com',
  projectId: 'budget-tracker-f7025',
  storageBucket: 'budget-tracker-f7025.firebasestorage.app',
  messagingSenderId: '532741868651',
  appId: '1:532741868651:web:a97a7a51f99d887bf7b52e',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let dbInstance: Firestore;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
    experimentalForceLongPolling: true,
  });
} catch {
  try {
    dbInstance = initializeFirestore(app, {
      experimentalForceLongPolling: true,
    });
  } catch {
    dbInstance = getFirestore(app);
  }
}

export const db = dbInstance;
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
export { app };
