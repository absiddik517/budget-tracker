import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { getCurrentFiscalYear } from '../lib/fy';
import { normalizeEmail } from '../lib/validation';
import type { InviteDoc, UserDoc } from '../types';

export type AccessState =
  | 'loading'
  | 'unauthenticated'
  | 'active'
  | 'pending'
  | 'disabled'
  | 'error';

interface AuthContextValue {
  firebaseUser: User | null;
  userDoc: UserDoc | null;
  accessState: AccessState;
  authError: string | null;
  needsOfficeSetup: boolean;
  clearOfficeSetupFlag: () => void;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [accessState, setAccessState] = useState<AccessState>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsOfficeSetup, setNeedsOfficeSetup] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setAuthError(null);
      if (!fbUser) {
        setFirebaseUser(null);
        setUserDoc(null);
        setAccessState('unauthenticated');
        return;
      }

      setFirebaseUser(fbUser);
      setAccessState('loading');

      try {
        const userRef = doc(db, 'users', fbUser.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const data = { id: userSnap.id, ...userSnap.data() } as UserDoc;
          if (data.status === 'disabled') {
            setUserDoc(null);
            setAccessState('disabled');
            await firebaseSignOut(auth);
            return;
          }
          setUserDoc(data);
          setAccessState('active');
          // Update lastActiveAt silently
          updateDoc(userRef, { lastActiveAt: serverTimestamp() }).catch(() => {});
          return;
        }

        // User document does not exist yet: check invite first, then bootstrap
        const emailLower = normalizeEmail(fbUser.email || '');
        if (emailLower) {
          const inviteRef = doc(db, 'invites', emailLower);
          const inviteSnap = await getDoc(inviteRef);
          if (inviteSnap.exists()) {
            const invite = inviteSnap.data() as Omit<InviteDoc, 'id'>;
            const newUser = {
              name: fbUser.displayName || invite.name || emailLower.split('@')[0],
              designation: invite.designation || 'Staff',
              email: emailLower,
              role: invite.role,
              status: 'active' as const,
              lastActiveAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              createdBy: invite.invitedBy || fbUser.uid,
              updatedAt: serverTimestamp(),
              updatedBy: fbUser.uid,
            };
            const batch = writeBatch(db);
            batch.set(userRef, newUser);
            batch.delete(inviteRef);
            await batch.commit();

            setUserDoc({ id: fbUser.uid, ...newUser, createdAt: null, updatedAt: null, lastActiveAt: null });
            setAccessState('active');
            return;
          }
        }

        // Check bootstrap: only succeeds when settings/office does not exist yet
        let isBootstrapEmpty = false;
        try {
          const existingUsersSnap = await getDocs(query(collection(db, 'users'), limit(1)));
          isBootstrapEmpty = existingUsersSnap.empty;
        } catch {
          // If settings/office already exists, non-admin list is denied -> treat as not bootstrap
          isBootstrapEmpty = false;
        }

        if (isBootstrapEmpty) {
          const currentFy = getCurrentFiscalYear();
          const newSuperAdmin = {
            name: fbUser.displayName || emailLower.split('@')[0] || 'Administrator',
            designation: 'System Administrator',
            email: emailLower,
            role: 'superAdmin' as const,
            status: 'active' as const,
            lastActiveAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            createdBy: fbUser.uid,
            updatedAt: serverTimestamp(),
            updatedBy: fbUser.uid,
          };
          await setDoc(userRef, newSuperAdmin);

          // Ensure initial settings/office document exists
          const officeRef = doc(db, 'settings', 'office');
          const officeSnap = await getDoc(officeRef);
          if (!officeSnap.exists()) {
            await setDoc(officeRef, {
              officeName: 'Government Office',
              address: '',
              activeFiscalYear: currentFy,
              fiscalYears: [currentFy],
              language: 'en',
              createdAt: serverTimestamp(),
              createdBy: fbUser.uid,
              updatedAt: serverTimestamp(),
              updatedBy: fbUser.uid,
            });
          }

          setUserDoc({ id: fbUser.uid, ...newSuperAdmin, createdAt: null, updatedAt: null, lastActiveAt: null });
          setNeedsOfficeSetup(true);
          setAccessState('active');
          return;
        }

        // No user doc and no invite
        setUserDoc(null);
        setAccessState('pending');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to verify user access.';
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
          setAuthError(
            'Firestore permission denied. Please publish firestore.rules in Firebase Console for project budget-tracker-f7025.'
          );
        } else {
          setAuthError(msg);
        }
        setAccessState('error');
      }
    });

    return () => unsub();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  };

  const signUpWithEmail = async (name: string, email: string, password: string) => {
    setAuthError(null);
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    if (name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() });
    }
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    await signInWithPopup(auth, googleProvider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUserDoc(null);
    setNeedsOfficeSetup(false);
    setAccessState('unauthenticated');
  };

  const clearOfficeSetupFlag = () => setNeedsOfficeSetup(false);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userDoc,
        accessState,
        authError,
        needsOfficeSetup,
        clearOfficeSetupFlag,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
