import { useState, type FormEvent } from 'react';
import { useGovernanceAuth } from './GovernanceAuthContext';

export function UnlockScreen() {
  const { status, error, unlock } = useGovernanceAuth();
  const [secret, setSecret] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!secret) return;
    await unlock(secret);
    setSecret('');
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-8">
        <div>
          <h1 className="text-xl font-semibold">Unlock governance review</h1>
          <p className="mt-1 text-sm text-slate-400">Enter the reviewer secret configured for this deployment.</p>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Reviewer secret"
          className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100 focus:border-sky-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === 'unlocking' || secret.length === 0}
          className="w-full rounded bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-600"
        >
          {status === 'unlocking' ? 'Unlocking…' : 'Unlock'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
