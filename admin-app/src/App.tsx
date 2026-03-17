import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GolfCoreProvider } from '@golf-core/contexts/GolfCoreContext';
import { auth, app } from './firebase';
import AutoSyncPage from './pages/AutoSyncPage';
import WebhookManagementPage from './pages/WebhookManagementPage';
import { Server, Webhook, LogOut } from 'lucide-react';

const queryClient = new QueryClient();

// Build the golf-core Firebase config from the same env vars the admin app uses
const getGolfCoreConfig = () => {
  const env = (import.meta as any).env;
  return {
    apiKey: env?.VITE_FIREBASE_API_KEY || '',
    authDomain: env?.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env?.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: env?.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env?.VITE_FIREBASE_APP_ID || '',
  };
};

const NavLink: React.FC<{ to: string; children: React.ReactNode; icon: React.ReactNode }> = ({ to, children, icon }) => {
  const location = useLocation();
  const active = location.pathname.startsWith(to);
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${active ? 'bg-green-700 text-white' : 'text-green-200 hover:bg-green-800/50 hover:text-white'}`}
    >
      {icon}{children}
    </Link>
  );
};

const LoginPage: React.FC<{ onLogin: (email: string, password: string) => Promise<void>; error: string | null }> = ({ onLogin, error }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try { await onLogin(email, password); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-green-950">
      <div className="bg-white rounded-xl shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Golf Core Admin</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-2 border border-gray-300 rounded focus:ring-green-500 focus:border-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-2 border border-gray-300 rounded focus:ring-green-500 focus:border-green-500" />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>}
          <button type="submit" disabled={loading} className="w-full py-2 bg-green-700 text-white font-semibold rounded hover:bg-green-800 transition disabled:opacity-50">
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
};

const AdminLayout: React.FC<{ user: User; onSignOut: () => void; children: React.ReactNode }> = ({ user, onSignOut, children }) => (
  <div className="min-h-screen bg-green-950">
    <nav className="bg-green-900 border-b border-green-700 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="text-lg font-bold text-white">⛳ Golf Core</span>
          <div className="flex gap-2">
            <NavLink to="/autosync" icon={<Server className="w-4 h-4" />}>Auto-Sync</NavLink>
            <NavLink to="/webhooks" icon={<Webhook className="w-4 h-4" />}>Webhooks</NavLink>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-green-300">{user.email}</span>
          <button onClick={onSignOut} className="flex items-center gap-1 text-sm text-green-300 hover:text-white transition">
            <LogOut className="w-4 h-4" />Sign out
          </button>
        </div>
      </div>
    </nav>
    <main>{children}</main>
  </div>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async (email: string, password: string) => {
    setLoginError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (authLoading) {
    return <div className="min-h-screen bg-green-950 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} error={loginError} />;
  }

  return (
    <GolfCoreProvider firebaseConfig={getGolfCoreConfig()}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AdminLayout user={user} onSignOut={handleSignOut}>
            <Routes>
              <Route path="/" element={<Navigate to="/autosync" replace />} />
              <Route path="/autosync" element={<AutoSyncPage />} />
              <Route path="/webhooks" element={<WebhookManagementPage />} />
            </Routes>
          </AdminLayout>
        </BrowserRouter>
      </QueryClientProvider>
    </GolfCoreProvider>
  );
};

export default App;
