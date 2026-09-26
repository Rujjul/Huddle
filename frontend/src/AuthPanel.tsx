import { useEffect, useState } from 'react';
import { ProfileEditor } from './Profile';
type Account = { user: { id: string; display_name: string; email: string }; csrfToken: string };
const errors: Record<string, string> = {
  campus: 'Please use your university-managed @vitbhopal.ac.in Google account. Other accounts cannot join Huddle.',
  denied: 'Google sign-in was canceled. You can try again whenever you’re ready.',
  state: 'Your sign-in expired or could not be verified. Please start again.',
  failed: 'We couldn’t complete sign-in. Please try again.',
  configuration: 'Google sign-in is not configured yet.',
};
export function AuthPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => errors[new URLSearchParams(location.search).get('authError') || ''] || '');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me', { signal: controller.signal }).then(async response => {
      if (response.ok) setAccount(await response.json());
      else if (response.status !== 401) throw new Error();
    }).catch(() => { if (!controller.signal.aborted) setError('Unable to check your account. Refresh to try again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    if (new URLSearchParams(location.search).has('authError')) history.replaceState(null, '', location.pathname);
    return () => controller.abort();
  }, []);
  async function logout() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/logout', { method: 'POST', headers: { 'x-csrf-token': account?.csrfToken || '' } });
      if (!response.ok && response.status !== 401) throw new Error();
      setAccount(null);
    } catch { setError('Unable to sign out. Please try again.'); }
    finally { setBusy(false); }
  }
  return <><section className="auth-panel" aria-labelledby="auth-title"><div><span className="eyebrow">VIT BHOPAL · CAMPUS ACCESS</span><h2 id="auth-title">{account ? `Welcome, ${account.user.display_name}.` : 'Your campus connection starts here.'}</h2><p>{loading ? 'Checking your session…' : account ? `Signed in as ${account.user.email}. Your campus account is verified.` : 'Sign in with your university Google account to get started.'}</p>{error && <p className="auth-error" role="alert">{error}</p>}</div>{!loading && (account ? <button className="button" onClick={logout} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</button> : <a className="button" href="/api/auth/google">Continue with Google <span aria-hidden="true">↗</span></a>)}</section>{account && <ProfileEditor csrf={account.csrfToken} onSave={name => setAccount({ ...account, user: { ...account.user, display_name: name } })}/>}</>;
}
