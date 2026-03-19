import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import serviceAccount from '../golf-apps-core-firebase-adminsdk-fbsvc-b265ea5838.json' with { type: 'json' };

initializeApp({ credential: cert(serviceAccount as any) });

const auth = getAuth();

await auth.getUserByEmail('freemanj54321@gmail.com')
  .then(user => auth.setCustomUserClaims(user.uid, { admin: true }))
  .then(() => console.log('Admin claim set for freemanj54321@gmail.com'));
