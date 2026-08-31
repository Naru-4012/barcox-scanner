import { useEffect, useMemo, useRef, useState } from 'react'
import { Login } from './components/Login'
import { CameraScanner, playScanFeedback } from './components/CameraScanner'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { clearSession, loadSession, saveSession } from './services/sessionStorage'
import { findDuplicateItem, formatDate, formatWeight, getItemDisplayName, makeSessionNumber, parseQr } from './services/scanner'
import { EMPTY_SESSION, type Item, type ParsedItem, type Session } from './types'
import { supabase } from './services/supabaseClient'

/* ──────────────────────────── main app ─────────────────────────── */

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userId, setUserId] = useState('')
  const signedIn = authReady && userEmail !== ''
  const [business, setBusiness] = useState(() => loadSession().business)
  const [session, setSession] = useState<Session>(loadSession)
  const [setup, setSetup] = useState(() => !loadSession().business)
  const [input, setInput] = useState('')
  const [manual, setManual] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<Item | null>(null)
  const [removeWeight, setRemoveWeight] = useState('')
  const online = useOnlineStatus()
  const [shareModal, setShareModal] = useState(false)

  const scanInputRef = useRef<HTMLInputElement>(null)
  const historyInitialized = useRef(false)

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    let mounted = true
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) { setUserEmail(session?.user.email ?? ''); setUserId(session?.user.id ?? ''); setAuthReady(true) }
    })
    // The root application entry is deliberately a fresh sign-in boundary.
    void supabase.auth.signOut({ scope: 'local' }).finally(() => {
      if (mounted) { setUserEmail(''); setUserId(''); setAuthReady(true) }
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  /* ── persist session ── */
  useEffect(() => { saveSession(session) }, [session])

  /* ── auto-dismiss notice ── */
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(''), 3600); return () => clearTimeout(timer) } }, [notice])

  /* ── browser back button handling (Bug #7) ── */
  useEffect(() => {
    if (!signedIn) return

    // Push initial state so back button has somewhere to go within the app
    if (!historyInitialized.current) {
      window.history.pushState({ page: 'app' }, '')
      historyInitialized.current = true
    }

    function handlePopState(event: PopStateEvent) {
      // Always prevent going back to login by re-pushing state
      event.preventDefault()
      window.history.pushState({ page: 'app' }, '')

      // If we're in the scanner view, go back to setup
      if (!setup) {
        setSetup(true)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [signedIn, setup])

  const total = useMemo(() => session.items.reduce((sum, item) => sum + item.weight, 0), [session.items])
  const barcodeOrQrScanned = useMemo(() => session.items.filter(item => item.scanType === 'qr' || item.scanType === 'barcode').length, [session.items])
  const manualScanned = useMemo(() => session.items.filter(item => item.scanType === 'manual').length, [session.items])
  const lastItem = session.items.at(-1)
  const itemBatches = Array.from({ length: Math.max(1, Math.ceil(session.items.length / 10)) }, (_, batchIndex) => session.items.slice(batchIndex * 10, batchIndex * 10 + 10))

  /* ── session management ── */
  function beginSession(event: React.FormEvent) {
    event.preventDefault(); if (!business.trim()) return
    const nextNumber = makeSessionNumber(business.trim())
    setSession({ business: business.trim(), number: nextNumber, items: [], status: 'active' }); setSetup(false); setNotice('Your scanning session is ready.')
  }

  function addParsed(parsed: ParsedItem) {
    setSession(current => {
      const itemNumber = current.items.length + 1
      const item: Item = {
        ...parsed,
        id: crypto.randomUUID(),
        itemNumber,
        product: getItemDisplayName(parsed.product, itemNumber, parsed.scanType),
        scannedAt: new Date().toISOString(),
      }
      setNotice(`${formatWeight(item.weight)} added to session`)
      return { ...current, items: [...current.items, item], status: 'active' }
    })
    setInput(''); setManual(''); setError('')
  }

  function addItem(event?: React.FormEvent, force = false) {
    event?.preventDefault(); const cleanInput = input.trim(); const cleanManual = manual.trim(); const parsed = parseQr(cleanInput, cleanManual)
    if ('error' in parsed) { setError(parsed.error); return }
    const existing = findDuplicateItem(session.items, parsed.raw)
    if (existing && !force) { setDuplicate(existing); return }
    playScanFeedback()
    addParsed(parsed)
  }

  function handleCameraDetected(raw: string, format?: string) {
    const cleanRaw = raw.trim()
    if (!cleanRaw) return
    setInput(cleanRaw)
    const parsed = parseQr(cleanRaw, '', format)
    if ('error' in parsed) { setError(parsed.error); return }
    const existing = findDuplicateItem(session.items, parsed.raw)
    if (existing) { setDuplicate(existing); return }
    addParsed(parsed)
  }

  function removeOne() {
    const weight = Number(removeWeight); const index = session.items.findIndex(item => item.weight === weight)
    if (!Number.isFinite(weight) || index < 0) { if (index < 0) setError('No matching item was found.'); return }
    setSession(current => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) })); setRemoveWeight(''); setNotice(`Item #${session.items[index].itemNumber} removed`)
  }

  /* ── CSV export ── */
  async function exportCsv() {
    const { downloadCsv } = await import('./services/reportExport')
    downloadCsv(session)
    setNotice('CSV downloaded.')
  }

  /* ── PDF export ── */
  async function exportPdf() {
    const { downloadPdf } = await import('./services/reportExport')
    downloadPdf(session, total)
    setNotice('PDF downloaded.')
  }

  /* ── share (Bug #4) ── */
  function getShareText() {
    let text = `*${session.business}*\nBilling Report\n\n`
    text += `Total Items: ${session.items.length}\n`
    text += `Grand Total Weight: ${total.toLocaleString('en-IN', { maximumFractionDigits: 3 })}g\n`
    text += `Date: ${formatDate(new Date())}\n\n`
    text += `Items:\n`
    session.items.forEach((item, i) => { text += `${i + 1}) ${item.weight}g  ` ; if ((i + 1) % 4 === 0) text += '\n' })
    text += `\n\nGRAND TOTAL: ${total.toLocaleString('en-IN', { maximumFractionDigits: 3 })}g`
    text += `\n\n— Sent via BarcoX`
    return text
  }

  async function shareNative() {
    const text = getShareText()
    const browserNavigator = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (browserNavigator.share) {
      try { await browserNavigator.share({ title: `${session.business} — Billing Report`, text }) } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(text)
      setNotice('Summary copied to clipboard.')
    }
    setShareModal(false)
  }

  function shareWhatsApp() {
    const text = getShareText()
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    setShareModal(false)
    setNotice('WhatsApp opened.')
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(getShareText())
    setShareModal(false)
    setNotice('Copied to clipboard — paste into any app.')
  }

  /* ── new session / reset (Bug #6) ── */
  function startNewSession() {
    setSession({ business: '', number: '', items: [], status: 'active' })
    setBusiness('')
    setSetup(true)
    setInput('')
    setManual('')
    setError('')
    setRemoveWeight('')
    clearSession()
    setNotice('Ready for a new session.')
  }

  /* ── sign in handler ── */
  function handleSignIn() {
    clearSession()
    setSession(EMPTY_SESSION)
    setBusiness('')
    setSetup(true)
    setInput('')
    setManual('')
    setError('')
    setRemoveWeight('')
    setDuplicate(null)
    setShareModal(false)
    historyInitialized.current = false
  }

  async function handleSignOut() {
    await supabase?.auth.signOut()
    setUserEmail('')
    historyInitialized.current = false
  }

  if (!authReady) return <div className="login-shell" aria-busy="true"><section className="login-card"><p className="muted">Checking your secure session...</p></section></div>
  if (!signedIn) return <Login onSignIn={handleSignIn} />

  return <div className={setup ? 'app-shell app-shell-setup' : 'app-shell'}>
    {!setup && <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <span className="material-symbols-outlined">qr_code_2</span>
        </span>
        <span>Barco<span className="brand-x">X</span></span>
      </div>
      <div className="topbar-meta">
        <span className="online-status">{userEmail}</span>
        <span className="online-status">
          <span className={`status-dot ${online ? '' : 'offline'}`} />
          {online ? 'Online' : 'Offline mode'}
        </span>
        <button className="icon-button" title="Sign out" onClick={() => void handleSignOut()}>
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>}
    <main className={setup ? 'setup-page' : 'page'}>
      {setup ? <section className="setup-view">
        <div className="setup-intro">
          <span className="setup-icon material-symbols-outlined filled">barcode_scanner</span>
          <h1>Configure Your Command Center</h1>
          <p>Initialize your scanning session with zero-latency sync and secure data persistence.</p>
        </div>
        <div className="setup-card">
          <form onSubmit={beginSession} className="setup-form">
            <div className="environment-card">
              <span className="material-symbols-outlined">dns</span>
              <div><strong>Environment</strong><small>Production Cluster</small></div>
              <span className="environment-status" aria-label="Production cluster online" />
            </div>
            <label>Business Name<div className="input-with-icon"><span className="material-symbols-outlined">storefront</span><input autoFocus value={business} onChange={event => setBusiness(event.target.value)} placeholder="Enter corporate entity name" /></div></label>
            <label className="session-identifier">Session Identifier <span>Auto-generated</span><div className="input-with-icon"><span className="material-symbols-outlined">key</span><input value="BX-8942-PRD" disabled /></div></label>
            <div className="setup-submit"><button className="primary-button" type="submit">Open Scanner <span className="material-symbols-outlined">arrow_forward</span></button><p>Secure encrypted connection</p></div>
          </form>
        </div>
        <aside className="setup-help" aria-label="Technical assistance contact details">
          <span className="material-symbols-outlined" aria-hidden="true">help_outline</span>
          <div>
            <strong>Need technical assistance?</strong>
            <span>Contact us on <a href="mailto:narendrakorade173@gmail.com">narendrakorade173@gmail.com</a></span>
            <a href="tel:+918421681779">+91-8421681779</a>
          </div>
        </aside>
      </section> : <>
        <section className="session-header">
          <div>
            <div className="eyebrow">Active session <span className="session-pill">{session.status}</span></div>
            <h1>{session.business}</h1>
            <p>{session.number} <span className="separator">/</span> Started today</p>
          </div>
          <button className="outline-button" onClick={startNewSession}>
            <span className="material-symbols-outlined">restart_alt</span> New session
          </button>
        </section>

        <section className="metrics">
          <Metric label="Barcode / QR Scans" value={barcodeOrQrScanned.toString()} icon="qr_code_scanner" />
          <Metric label="Manual Scans" value={manualScanned.toString()} icon="edit_note" />
          <Metric label="Total net weight" value={formatWeight(total)} icon="scale" />
        </section>

        {notice && <div className="toast">
          <span className="material-symbols-outlined filled">check_circle</span>
          {notice}
        </div>}

        <div className="workspace-grid">
          <section className="scanner-panel">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Capture item</div>
                <h2>Ready when you are</h2>
              </div>
              <div className="scanner-icon">
                <span className="material-symbols-outlined" style={{fontSize: '28px'}}>qr_code_scanner</span>
              </div>
            </div>
            <CameraScanner onDetected={handleCameraDetected} />
            <form onSubmit={addItem} className="scan-form">
              <label>
                Barcode payload or QR data
                <input
                  ref={scanInputRef}
                  value={input}
                  onChange={event => setInput(event.target.value)}
                  placeholder="Scan with barcode scanner gun or paste data"
                />
              </label>
              <div className="or-divider"><span>or enter a weight manually</span></div>
              <div className="weight-row">
                <input inputMode="decimal" value={manual} onChange={event => setManual(event.target.value)} placeholder="0.00" />
                <span>grams</span>
                <button className="primary-button compact" type="submit">
                  Add item
                </button>
              </div>
              {error && <div className="error-message">
                <span className="material-symbols-outlined" style={{fontSize: '16px'}}>help</span>
                {error}
              </div>}
            </form>
            <div className="scanner-footnote">
              <span className="material-symbols-outlined" style={{fontSize: '16px'}}>cloud_sync</span>
              Saved locally first{online ? ' · sync ready' : ' · will sync when online'}
            </div>
          </section>

          <aside className="items-panel">
            <div className="items-heading">
              <div>
                <div className="eyebrow">Live list</div>
                <h2>Recent items</h2>
              </div>
              <span className="count-badge">{session.items.length}</span>
            </div>
            {session.items.length === 0 ? <div className="empty-state">
              <p>No items yet</p>
              <span>Your next scan will appear here.</span>
            </div> : <div className="items-list">
              {itemBatches.map((batch, batchIndex) => <div className="item-batch" key={batchIndex}>
                <div className="batch-heading">
                  <span>Batch {batchIndex + 1}</span>
                  <span>{batch.length} items</span>
                </div>
                {batch.slice().reverse().map(item => <div className="item-row" key={item.id}>
                  <span className="item-number">#{item.itemNumber.toString().padStart(3, '0')}</span>
                  <div className="item-detail">
                    <strong>{getItemDisplayName(item.product, item.itemNumber, item.scanType)}</strong>
                    <span>{item.size ? `Size ${item.size} · ` : ''}{item.raw}</span>
                  </div>
                  <strong className="item-weight">{formatWeight(item.weight)}</strong>
                </div>)}
              </div>)}
            </div>}
            <div className="items-actions">
              <button className="ghost-button" onClick={() => setSession(current => ({ ...current, status: current.status === 'paused' ? 'active' : 'paused' }))}>
                <span className="material-symbols-outlined">{session.status === 'paused' ? 'play_arrow' : 'pause'}</span>
                {session.status === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button className="ghost-button" onClick={exportPdf}>
                <span className="material-symbols-outlined">download</span> PDF
              </button>
              <button className="ghost-button" onClick={exportCsv}>
                <span className="material-symbols-outlined">table_chart</span> CSV
              </button>
            </div>
          </aside>
        </div>

        <section className="bottom-bar">
          <div>
            <span className="eyebrow">Session total</span>
            <strong>{formatWeight(total)}</strong>
          </div>
          <div className="bottom-actions">
            <button className="outline-button" onClick={() => setRemoveWeight(removeWeight ? '' : ' ')}>
              <span className="material-symbols-outlined">delete</span> Remove item
            </button>
            <button className="primary-button" onClick={() => setSession(current => ({ ...current, status: 'completed' }))}>
              <span className="material-symbols-outlined filled">check_circle</span> Complete session
            </button>
          </div>
        </section>

        {removeWeight !== '' && <section className="remove-panel">
          <div>
            <strong>Remove a scanned item</strong>
            <span>Enter the exact weight to remove one match.</span>
          </div>
          <input autoFocus inputMode="decimal" value={removeWeight.trim()} onChange={event => setRemoveWeight(event.target.value)} placeholder="e.g. 56.80" />
          <button className="danger-button" onClick={removeOne}>
            <span className="material-symbols-outlined">delete</span> Remove
          </button>
          <button className="icon-button" onClick={() => setRemoveWeight('')}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </section>}

        {/* ── Completion Panel (Bug #6) ── */}
        {session.status === 'completed' && <section className="completion-panel">
          <div className="completion-icon">
            <span className="material-symbols-outlined filled" style={{fontSize: '24px'}}>check_circle</span>
          </div>
          <div>
            <div className="eyebrow">Scanning completed</div>
            <h2>That session is wrapped.</h2>
            <p>Review, export, or share your {session.items.length} items.</p>
          </div>
          <div className="completion-actions">
            <button className="outline-button" onClick={() => setShareModal(true)}>
              <span className="material-symbols-outlined">share</span> Share
            </button>
            <button className="outline-button" onClick={exportPdf}>
              <span className="material-symbols-outlined">description</span> Export PDF
            </button>
            <button className="outline-button" onClick={exportCsv}>
              <span className="material-symbols-outlined">download</span> CSV
            </button>
            <button className="primary-button" onClick={startNewSession}>
              <span className="material-symbols-outlined">restart_alt</span> New Session
            </button>
          </div>
        </section>}
      </>}
    </main>

    {/* ── Duplicate modal ── */}
    {duplicate && <div className="modal-backdrop">
      <div className="modal">
        <button className="modal-close icon-button" onClick={() => setDuplicate(null)}>
          <span className="material-symbols-outlined">close</span>
        </button>
        <div className="duplicate-icon">
          <span className="material-symbols-outlined" style={{fontSize: '24px'}}>restart_alt</span>
        </div>
        <div className="eyebrow">Possible duplicate</div>
        <h2>This QR code or barcode is already here.</h2>
        <p>Item #{duplicate.itemNumber} carries the same payload and weighs {formatWeight(duplicate.weight)}.</p>
        <div className="modal-actions">
          <button className="outline-button" onClick={() => setDuplicate(null)}>Cancel</button>
          <button className="primary-button" onClick={() => { addItem(undefined, true); setDuplicate(null) }}>
            Add anyway
            <span className="material-symbols-outlined">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>}

    {/* ── Share modal (Bug #4) ── */}
    {shareModal && <div className="modal-backdrop" onClick={() => setShareModal(false)}>
      <div className="modal share-modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close icon-button" onClick={() => setShareModal(false)}>
          <span className="material-symbols-outlined">close</span>
        </button>
        <div className="share-header-icon">
          <span className="material-symbols-outlined" style={{fontSize: '24px'}}>share</span>
        </div>
        <h2>Share Session</h2>
        <p>Share the billing report for {session.business} with {session.items.length} items totalling {formatWeight(total)}.</p>
        <div className="share-buttons">
          <button className="share-btn whatsapp" onClick={shareWhatsApp}>
            <span className="material-symbols-outlined">message</span> WhatsApp
          </button>
          <button className="share-btn native" onClick={shareNative}>
            <span className="material-symbols-outlined">share</span> More Apps
          </button>
          <button className="share-btn copy" onClick={copyToClipboard}>
            <span className="material-symbols-outlined">content_copy</span> Copy Text
          </button>
        </div>
        <p className="share-hint">On mobile, "More Apps" opens your share sheet with Instagram, Snapchat, Telegram, and more.</p>
      </div>
    </div>}
  </div>
}

/* ── sub-components ── */

function Metric({ label, value, icon }: { label: string; value: string; icon: string }) {
  return <div className="metric">
    <div className="metric-icon">
      <span className="material-symbols-outlined">{icon}</span>
    </div>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
}
