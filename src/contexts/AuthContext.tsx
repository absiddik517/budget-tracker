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
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { todayYmd } from '../lib/dates';
import { getCurrentFiscalYear } from '../lib/fy';
import { normalizeEmail } from '../lib/validation';
import type { InviteDoc, OfficeRole, UserDoc, WorkHistoryDoc } from '../types';

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
  isSuperAdmin: boolean;
  myActivePostings: WorkHistoryDoc[];
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
  const [myActivePostings, setMyActivePostings] = useState<WorkHistoryDoc[]>([]);
  const [accessState, setAccessState] = useState<AccessState>('loading');
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsOfficeSetup, setNeedsOfficeSetup] = useState(false);

  useEffect(() => {
    let unsubUserDoc: (() => void) | null = null;
    let unsubPostings: (() => void) | null = null;

    const cleanupListeners = () => {
      if (unsubUserDoc) {
        unsubUserDoc();
        unsubUserDoc = null;
      }
      if (unsubPostings) {
        unsubPostings();
        unsubPostings = null;
      }
    };

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      cleanupListeners();
      setAuthError(null);

      if (!fbUser) {
        setFirebaseUser(null);
        setUserDoc(null);
        setMyActivePostings([]);
        setAccessState('unauthenticated');
        return;
      }

      setFirebaseUser(fbUser);
      setAccessState('loading');

      try {
        const userRef = doc(db, 'users', fbUser.uid);
        let userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          // 1. Check pending invite by email lowercase
          const emailLower = normalizeEmail(fbUser.email || '');
          let provisioned = false;

          if (emailLower) {
            const inviteRef = doc(db, 'invites', emailLower);
            const inviteSnap = await getDoc(inviteRef);
            if (inviteSnap.exists()) {
              const invite = inviteSnap.data() as Omit<InviteDoc, 'id'>;
              const officeId = invite.officeId || 'default_office';
              const role: OfficeRole = invite.role === 'ddo' ? 'ddo' : 'employee';
              const kind = invite.kind || 'regular';
              const displayName = fbUser.displayName || invite.name || emailLower.split('@')[0];
              const designation = invite.designation || 'Staff';
              const today = todayYmd();

              const whRef = doc(collection(db, 'workHistory'));
              const batch = writeBatch(db);

              batch.set(userRef, {
                name: displayName,
                designation,
                email: emailLower,
                phone: invite.phone || '',
                status: 'active' as const,
                globalRole: null,
                homeOfficeId: kind === 'regular' ? officeId : null,
                access: { [officeId]: role },
                officeIds: [officeId],
                lastActiveAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                createdBy: invite.invitedBy || fbUser.uid,
                updatedAt: serverTimestamp(),
                updatedBy: fbUser.uid,
              });

              batch.set(whRef, {
                userId: fbUser.uid,
                userName: displayName,
                officeId,
                role,
                kind,
                designation,
                startDate: today,
                endDate: null,
                status: 'active',
                orderNo: invite.orderNo || 'INITIAL-JOIN',
                orderDate: invite.orderDate || today,
                endReason: null,
                assignedBy:
                  typeof invite.invitedBy === 'object' && invite.invitedBy
                    ? { uid: invite.invitedBy.uid, name: invite.invitedBy.name }
                    : { uid: String(invite.invitedBy || fbUser.uid), name: 'Admin' },
                remarks: 'Joined via invite',
                createdAt: serverTimestamp(),
                createdBy: fbUser.uid,
                updatedAt: serverTimestamp(),
                updatedBy: fbUser.uid,
              });

              batch.delete(inviteRef);
              await batch.commit();
              userSnap = await getDoc(userRef);
              provisioned = true;
            }
          }

          // 2. Bootstrap first Super Admin on an empty DB
          if (!provisioned) {
            let isBootstrapEmpty = false;
            try {
              const existingUsersSnap = await getDocs(query(collection(db, 'users'), limit(1)));
              isBootstrapEmpty = existingUsersSnap.empty;
            } catch {
              isBootstrapEmpty = false;
            }

            if (isBootstrapEmpty) {
              const currentFy = getCurrentFiscalYear();
              const batch = writeBatch(db);
              const displayName = fbUser.displayName || emailLower.split('@')[0] || 'Administrator';
              batch.set(userRef, {
                name: displayName,
                designation: 'System Administrator',
                email: emailLower,
                phone: '',
                status: 'active' as const,
                globalRole: 'superAdmin',
                homeOfficeId: null,
                access: {},
                officeIds: [],
                lastActiveAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                createdBy: fbUser.uid,
                updatedAt: serverTimestamp(),
                updatedBy: fbUser.uid,
              });
              batch.set(
                doc(db, 'settings', 'bootstrap'),
                {
                  initialized: true,
                  superAdminUid: fbUser.uid,
                  createdAt: serverTimestamp(),
                },
                { merge: true }
              );
              batch.set(
                doc(db, 'settings', 'office'),
                {
                  officeName: 'Government Office',
                  address: '',
                  activeFiscalYear: currentFy,
                  fiscalYears: [currentFy],
                  language: 'bn',
                  createdAt: serverTimestamp(),
                  createdBy: fbUser.uid,
                  updatedAt: serverTimestamp(),
                  updatedBy: fbUser.uid,
                },
                { merge: true }
              );
              await batch.commit();
              setNeedsOfficeSetup(true);
              userSnap = await getDoc(userRef);
              provisioned = true;
            }
          }

          if (!provisioned) {
            setUserDoc(null);
            setAccessState('pending');
            return;
          }
        }

        // Update lastActiveAt silently once on sign-in
        updateDoc(userRef, { lastActiveAt: serverTimestamp() }).catch(() => {});

        // Live listener on users/{uid} so role/posting/status changes take effect immediately
        unsubUserDoc = onSnapshot(
          userRef,
          (snap) => {
            if (!snap.exists()) {
              setUserDoc(null);
              setAccessState('pending');
              return;
            }
            const raw = snap.data() as Omit<UserDoc, 'id'>;
            const normalized: UserDoc = {
              id: snap.id,
              ...raw,
              globalRole: raw.globalRole ?? (raw.role === 'superAdmin' ? 'superAdmin' : null),
              homeOfficeId: raw.homeOfficeId ?? null,
              access: raw.access || {},
              officeIds: raw.officeIds || Object.keys(raw.access || {}),
            };
            if (normalized.status === 'disabled') {
              setUserDoc(null);
              setAccessState('disabled');
              firebaseSignOut(auth).catch(() => {});
              return;
            }
            setUserDoc(normalized);
            setAccessState('active');
          },
          (err) => {
            const msg = err instanceof Error ? err.message : 'Failed to watch user profile.';
            setAuthError(msg);
            setAccessState('error');
          }
        );

        // Live listener on current user's active workHistory records
        unsubPostings = onSnapshot(
          query(
            collection(db, 'workHistory'),
            where('userId', '==', fbUser.uid),
            where('status', '==', 'active')
          ),
          (snap) => {
            setMyActivePostings(
              snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkHistoryDoc))
            );
          },
          () => {
            setMyActivePostings([]);
          }
        );
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

    return () => {
      cleanupListeners();
      unsubAuth();
    };
  }, []);

  const isSuperAdmin = Boolean(
    userDoc && (userDoc.globalRole === 'superAdmin' || userDoc.role === 'superAdmin')
  );

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
    setMyActivePostings([]);
    setNeedsOfficeSetup(false);
    setAccessState('unauthenticated');
  };

  const clearOfficeSetupFlag = () => setNeedsOfficeSetup(false);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userDoc,
        isSuperAdmin,
        myActivePostings,
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
