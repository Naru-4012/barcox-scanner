import { useState } from 'react'
import { supabase } from '../../services/supabaseClient'

type LoginProps = { onSignIn: () => void }

export function Login({ onSignIn }: LoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoginError('')
    if (!supabase) {
      setLoginError('Supabase is not configured for this environment.')
      return
    }
    if (!username.trim() || !password) {
      setLoginError('Enter your Supabase Auth email and password.')
      return
    }
    setSubmitting(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: username.trim(), password })
      if (error) {
        setLoginError('Unable to sign in. Check your email and password, then try again.')
        return
      }
      onSignIn()
    } catch {
      setLoginError('Unable to connect to sign in. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="login-shell">
    <div className="login-art">
      <div className="art-grid" />
      <div className="art-copy">
        <span className="brand-mark large">
          <span className="material-symbols-outlined filled">qr_code_2</span>
        </span>
        <h1>Make every<br /><em>scan count.</em></h1>
        <p>One calm workspace for the work that moves your business forward.</p>
      </div>
      <div className="art-footer">Authorized Personnel Only • Terminal v2.4.1</div>
    </div>
    <section className="login-card">
      <div className="login-brand">
        <span className="brand-mark">
          <span className="material-symbols-outlined filled">barcode_scanner</span>
        </span>
        barco<span className="brand-x">X</span>
      </div>
      <div className="eyebrow">Terminal Access</div>
      <h2>Sign in to BarcoX</h2>
      <p className="muted">Authenticate to begin secure session.</p>
      <form onSubmit={handleSubmit}>
        <label>Operator ID<div style={{ position: 'relative' }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#837283' }}>badge</span>
          <input autoFocus required type="email" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="OP-XXXX-XXXX" style={{ paddingLeft: '44px' }} />
        </div></label>
        <label>Secure Passcode<div style={{ position: 'relative' }}>
          <span className="material-symbols-outlined" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#837283' }}>lock</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" style={{ paddingLeft: '44px' }} />
        </div></label>
        <div className="login-help">
          <button type="button" className="help-toggle" onClick={() => setShowHelp(current => !current)} aria-expanded={showHelp}>
            Need help?
          </button>
          {showHelp && <div className="help-contact" role="status">
            <span>Contact us on</span>
            <a href="mailto:narendrakorade173@gmail.com">narendrakorade173@gmail.com</a>
            <a href="tel:+918421681779">+91-8421681779</a>
          </div>}
        </div>
        {loginError && <div className="login-error">
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
          {loginError}
        </div>}
        <button className="primary-button sign-in-button" type="submit" disabled={submitting}>
          {submitting ? 'Initializing Session...' : 'Initialize Session'}
          {!submitting && <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>}
        </button>
      </form>
    </section>
  </div>
}
