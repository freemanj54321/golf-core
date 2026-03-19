import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GolfCoreProvider } from '@golf-core/contexts/GolfCoreContext';
import { auth, db } from './firebase';
import AutoSyncPage from './pages/AutoSyncPage';
import WebhookManagementPage from './pages/WebhookManagementPage';
import { Server, Webhook, LogOut, Lock, ArrowRight } from 'lucide-react';

const queryClient = new QueryClient();


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
      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <div className="relative group mb-0.5">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-green-300 group-focus-within:text-yellow-400 transition-colors" />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email"
            required
            className="w-full pl-10 pr-4 py-3 rounded-t-lg bg-green-950/80 border-b-2 border-green-600 text-white placeholder-green-400/50 focus:outline-none focus:bg-green-900/90 focus:border-yellow-400 transition-all text-center tracking-widest backdrop-blur-sm"
          />
        </div>
        <div className="relative group mb-0.5">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-green-300 group-focus-within:text-yellow-400 transition-colors" />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            required
            className="w-full pl-10 pr-4 py-3 bg-green-950/80 border-b-2 border-green-600 text-white placeholder-green-400/50 focus:outline-none focus:bg-green-900/90 focus:border-yellow-400 transition-all text-center tracking-widest backdrop-blur-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-yellow-400 text-green-900 font-bold py-3 rounded-b-lg hover:bg-yellow-300 transition-colors shadow-lg uppercase tracking-wider text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? 'Signing in...' : 'Sign In'}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </button>
        {error && (
          <div className="mt-4 bg-red-900/80 text-red-200 text-sm py-2 px-4 rounded border border-red-800/50 backdrop-blur-sm">
            {error}
          </div>
        )}
      </form>
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
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        await u.getIdToken(true); // force-refresh so custom claims (admin) are current
      }
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
    <GolfCoreProvider db={db}>
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
