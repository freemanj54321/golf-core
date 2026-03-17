import React, { useState, useEffect } from 'react';
import { collection, getDocs, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Webhook, Trash2, Plus, ToggleLeft, ToggleRight, Copy, RefreshCw } from 'lucide-react';

interface WebhookRegistration {
  id: string;
  consumerId: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
}

const ALL_EVENTS = [
  'rankings.updated',
  'schedule.updated',
  'field.updated',
  'teeTimes.updated',
  'results.updated',
  'scorecards.updated',
  'activeTournament.updated',
  'results.cleared',
];

const generateSecret = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
};

const WebhookManagementPage: React.FC = () => {
  const [registrations, setRegistrations] = useState<WebhookRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newConsumerId, setNewConsumerId] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newSecret, setNewSecret] = useState(generateSecret());
  const [newEvents, setNewEvents] = useState<string[]>(ALL_EVENTS);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const fetchRegistrations = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'Webhook-Registrations'));
      const regs: WebhookRegistration[] = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
      } as WebhookRegistration));
      regs.sort((a, b) => a.consumerId.localeCompare(b.consumerId));
      setRegistrations(regs);
    } catch (err) {
      console.error('Error fetching webhooks:', err);
      setMessage({ text: 'Failed to load webhook registrations.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRegistrations(); }, []);

  const showMsg = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleToggle = async (reg: WebhookRegistration) => {
    try {
      await setDoc(doc(db, 'Webhook-Registrations', reg.id), { enabled: !reg.enabled }, { merge: true });
      setRegistrations(prev => prev.map(r => r.id === reg.id ? { ...r, enabled: !r.enabled } : r));
      showMsg(`${reg.consumerId} ${!reg.enabled ? 'enabled' : 'disabled'}.`, 'success');
    } catch (err) {
      showMsg('Failed to toggle webhook.', 'error');
    }
  };

  const handleDelete = async (reg: WebhookRegistration) => {
    if (!window.confirm(`Delete webhook registration for "${reg.consumerId}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, 'Webhook-Registrations', reg.id));
      setRegistrations(prev => prev.filter(r => r.id !== reg.id));
      showMsg(`${reg.consumerId} deleted.`, 'success');
    } catch (err) {
      showMsg('Failed to delete webhook.', 'error');
    }
  };

  const handleAdd = async () => {
    if (!newConsumerId.trim() || !newUrl.trim() || !newSecret.trim() || newEvents.length === 0) {
      showMsg('All fields are required and at least one event must be selected.', 'error');
      return;
    }
    setSaving(true);
    try {
      const docId = newConsumerId.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await setDoc(doc(db, 'Webhook-Registrations', docId), {
        consumerId: newConsumerId.trim(),
        url: newUrl.trim(),
        secret: newSecret.trim(),
        events: newEvents,
        enabled: true,
      });
      showMsg(`Webhook registered for ${newConsumerId}.`, 'success');
      setShowAddForm(false);
      setNewConsumerId('');
      setNewUrl('');
      setNewSecret(generateSecret());
      setNewEvents(ALL_EVENTS);
      await fetchRegistrations();
    } catch (err) {
      showMsg('Failed to register webhook.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const copySecret = async (secret: string) => {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const toggleEvent = (event: string) => {
    setNewEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-green-700">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center">
            <Webhook className="w-8 h-8 mr-3 text-blue-400" />
            Webhook Management
          </h1>
          <p className="mt-2 text-green-100">Manage consumer webhook registrations for golf-core events.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchRegistrations}
            className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition"
          >
            <Plus className="w-4 h-4" />
            Register Consumer
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-6 p-3 rounded-lg text-sm font-medium ${message.type === 'success' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'}`}>
          {message.text}
        </div>
      )}

      {/* Add Form */}
      {showAddForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-8 border border-blue-200">
          <h2 className="text-xl font-bold mb-4">Register New Consumer</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Consumer ID</label>
              <input
                type="text"
                value={newConsumerId}
                onChange={e => setNewConsumerId(e.target.value)}
                placeholder="e.g. mezzters, afi"
                className="w-full p-2 border border-gray-300 rounded focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
              <input
                type="url"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder="https://us-central1-your-project.cloudfunctions.net/golfCoreWebhookHandler"
                className="w-full p-2 border border-gray-300 rounded focus:ring-green-500 focus:border-green-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">HMAC Secret</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  className="flex-1 p-2 border border-gray-300 rounded font-mono text-sm focus:ring-green-500 focus:border-green-500"
                />
                <button
                  onClick={() => copySecret(newSecret)}
                  className="px-3 py-2 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition text-sm"
                  title="Copy secret"
                >
                  {copiedSecret ? '✓' : <Copy className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setNewSecret(generateSecret())}
                  className="px-3 py-2 bg-gray-100 border border-gray-300 rounded hover:bg-gray-200 transition text-sm"
                  title="Regenerate"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Copy and store this secret in the consumer's GOLF_CORE_WEBHOOK_SECRET environment variable before saving.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Subscribed Events</label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_EVENTS.map(event => (
                  <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(event)}
                      onChange={() => toggleEvent(event)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    <span className="font-mono text-xs">{event}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 transition"
              >Cancel</button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50"
              >{saving ? 'Saving...' : 'Register'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Registrations List */}
      {loading ? (
        <div className="text-center py-10 text-white/60">Loading registrations...</div>
      ) : registrations.length === 0 ? (
        <div className="text-center py-12 bg-white/5 rounded-lg border border-white/10">
          <p className="text-white/60">No webhook registrations found.</p>
          <p className="text-white/40 text-sm mt-1">Click "Register Consumer" to add the first one.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {registrations.map(reg => (
            <div key={reg.id} className="bg-white rounded-lg shadow p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{reg.consumerId}</h3>
                  <p className="text-sm text-gray-500 font-mono truncate max-w-md">{reg.url}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggle(reg)}
                    className={`flex items-center gap-1 px-3 py-1 rounded text-sm font-medium transition ${reg.enabled ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {reg.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    {reg.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button
                    onClick={() => handleDelete(reg)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {reg.events.map(event => (
                  <span key={event} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-mono">{event}</span>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-400">
                ID: <span className="font-mono">{reg.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-white/5 rounded-lg border border-white/10">
        <h3 className="font-semibold text-white mb-2">How It Works</h3>
        <ul className="text-sm text-white/60 space-y-1">
          <li>• After each sync completes, golf-core POSTs to all subscribed consumer URLs.</li>
          <li>• Each request is signed with HMAC-SHA256 in the <code className="font-mono">X-Golf-Core-Signature</code> header.</li>
          <li>• Consumers verify the signature using their stored <code className="font-mono">GOLF_CORE_WEBHOOK_SECRET</code>.</li>
          <li>• Failed deliveries are retried once and logged in SyncLogs.</li>
        </ul>
      </div>
    </div>
  );
};

export default WebhookManagementPage;
