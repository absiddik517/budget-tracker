# Budget Tracker

Government office budget allocation, spending ledger with VAT/IT deductions, ministry spending cap enforcement, and financial reporting.

## Firebase Setup (Required Before First Use)

This app connects directly to the configured Firebase project (`budget-tracker-f7025`) with client-side Firestore transactions and offline persistence. Complete these steps in the Firebase Console:

1. **Enable Authentication Providers**:
   - Open **Authentication → Sign-in method** in the Firebase Console.
   - Enable **Email/Password**.
   - Enable **Google** (select a support email and save).
2. **Add Authorized Domains**:
   - Under **Authentication → Settings → Authorized domains**, add your deployed web domain (and preview domain if applicable) so Google Sign-In works in production.
3. **Create the Default Firestore Database**:
   - Open **Firestore Database → Create database**.
   - Use the **(default)** database ID in production mode.
4. **Publish Security Rules & Composite Indexes**:
   - Copy the contents of `firestore.rules` into **Firestore Database → Rules** and publish them (or deploy via Firebase CLI: `firebase deploy --only firestore:rules,firestore:indexes`).
   - Create the composite indexes listed in `firestore.indexes.json` (most importantly on `auditLogs`: `collection ASC, docId ASC, timestamp DESC`), or click the index creation link printed in the browser console the first time you open a Budget/Spending detail panel.

## Bengali Font (`Nikosh`)

Place `Nikosh.ttf` inside `public/fonts/Nikosh.ttf` so Bengali head names (such as `আপ্যায়ন ব্যয়`) render with Nikosh. If the file is absent, the font stack falls back cleanly to `'Noto Sans Bengali'`.

## First-Time Onboarding

1. Sign in with your Google account or register with Email/Password.
2. When no user document exists yet in Firestore, the first user to sign in is automatically promoted to **Super Admin** and taken to **Settings** to set the office name and active fiscal year.
3. Use **Settings → Load sample data** to populate FY `2025-26` with the 13 official VAT/IT rate heads, two sample budgets, sample spendings, and an 80% cap on `3211106`.
4. Invite team members on the **Users** page by email and role (`Employee`, `DDO`, or `Super Admin`).

## Local Development & Capacitor Android Build

```bash
npm install
npm run dev
npm run build
```

For Capacitor wrapping:

```bash
npx cap add android
npx cap sync android
npx cap open android
```
