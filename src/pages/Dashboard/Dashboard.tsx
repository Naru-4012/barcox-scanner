import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Login } from '../Login/Login'
import { Metric } from '../../components/common/Metric'
import { Navbar } from '../../components/layout/Navbar'
import { lookupProductByCode } from '../../features/catalog/api/productCatalog'
import { playScanFeedback } from '../../features/scanner/services/scanFeedback'
import { formatDate, formatWeight, getCatalogLookupCode, getItemDisplayName, getNextItemNumber, makeSessionNumber, parseQr, weightInGrams } from '../../features/scanner/services/scanner'
import { loadRemoteSession, saveRemoteSession } from '../../features/session/api/remoteSession'
import { clearSession, loadSession, saveSession } from '../../features/session/services/sessionStorage'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { supabase } from '../../services/supabaseClient'
import { EMPTY_SESSION, type Item, type ParsedItem, type Session } from '../../types'
import { getPageItems, getPaginationPages, ITEMS_PER_PAGE } from '../../utils/pagination'
import { getMostRecentlyScannedItem, removeItemById, renumberItems } from '../../utils/items'
import { isKeyboardScannerBurst, updateScannerKeyTiming } from '../../utils/scannerKeyboard'

const CameraScanner = lazy(() => import('../../features/scanner/components/CameraScanner').then(module => ({ default: module.CameraScanner })))

type ScanResolution =
  | { status: 'ready'; item: ParsedItem }
  | { status: 'weight-required'; code: string; warning?: string }
  | { status: 'error'; message: string }

/* ──────────────────────────── main app ─────────────────────────── */

export default function Dashboard() {
  const [authReady, setAuthReady] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const signedIn = authReady && userEmail !== ''
  const [session, setSession] = useState<Session>(loadSession)
  const [business, setBusiness] = useState(() => session.business)
  const [productName, setProductName] = useState(() => session.productName ?? '')
  const [setup, setSetup] = useState(() => !session.business)
  const [input, setInput] = useState('')
  const [inputFormat, setInputFormat] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [weightPrompt, setWeightPrompt] = useState('')
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(null)
  const [catalogLookupInProgress, setCatalogLookupInProgress] = useState(false)
  const [remoteSyncMessage, setRemoteSyncMessage] = useState('')
  const online = useOnlineStatus()
  const [shareModal, setShareModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const scanInputRef = useRef<HTMLInputElement>(null)
  const cancelDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const historyInitialized = useRef(false)
  const catalogLookupRef = useRef(false)
  const pendingScanRef = useRef<{ raw: string; format?: string } | null>(null)
  const scannerKeysRef = useRef({ lastKeyAt: 0, fastKeyCount: 0 })
  const processingScanRef = useRef(false)
  const remoteSaveQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    let mounted = true
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) { setUserEmail(session?.user.email ?? ''); setAuthReady(true) }
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!signedIn || session.number) return
    let cancelled = false
    void loadRemoteSession().then(remoteSession => {
      if (cancelled || !remoteSession) return
      setSession(remoteSession)
      setBusiness(remoteSession.business)
      setProductName(remoteSession.productName ?? '')
      setSetup(false)
      setCurrentPage(1)
    }).catch(restoreError => {
      if (!cancelled) {
        const message = restoreError instanceof Error ? restoreError.message : 'Unknown restore error.'
        setRemoteSyncMessage(`Cloud restore failed: ${message}`)
      }
    })
    return () => { cancelled = true }
  }, [session.number, signedIn])

  /* ── persist session ── */
  useEffect(() => { saveSession(session) }, [session])

  useEffect(() => {
    if (!signedIn || !session.business || !session.number) return
    if (!online) {
      setRemoteSyncMessage('Offline; saved locally and will sync when reconnected')
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setRemoteSyncMessage('Syncing to Supabase...')
      remoteSaveQueueRef.current = remoteSaveQueueRef.current
        .then(async () => {
          if (cancelled) return
          await saveRemoteSession(session)
          if (!cancelled) setRemoteSyncMessage('Synced to Supabase')
        })
        .catch(syncError => {
          if (!cancelled) {
            const message = syncError instanceof Error ? syncError.message : 'Unknown sync error.'
            setRemoteSyncMessage(`Cloud sync failed: ${message}`)
          }
        })
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [online, session, signedIn])

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

  const total = useMemo(() => session.items.reduce((sum, item) => sum + weightInGrams(item.weight, item.unit), 0), [session.items])
  const barcodeOrQrScanned = useMemo(() => session.items.filter(item => item.scanType === 'qr' || item.scanType === 'barcode').length, [session.items])
  const previousItem = useMemo(() => getMostRecentlyScannedItem(session.items), [session.items])
  const pendingDeleteItem = session.items.find(item => item.id === pendingDeleteItemId)
  const pageCount = Math.ceil(session.items.length / ITEMS_PER_PAGE)
  const activePage = Math.min(currentPage, Math.max(pageCount, 1))
  const visibleItems = useMemo(() => getPageItems(session.items, activePage), [activePage, session.items])
  const paginationPages = getPaginationPages(activePage, pageCount)
  const firstVisibleItem = Math.max(1, session.items.length - activePage * ITEMS_PER_PAGE + 1)
  const lastVisibleItem = session.items.length - (activePage - 1) * ITEMS_PER_PAGE

  useEffect(() => {
    setCurrentPage(page => Math.min(page, Math.max(pageCount, 1)))
  }, [pageCount])

  useEffect(() => {
    if (setup || !signedIn) return
    const frame = requestAnimationFrame(() => scanInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [setup, signedIn])

  useEffect(() => {
    if (!pendingDeleteItem) return
    cancelDeleteButtonRef.current?.focus()

    function handleDeleteDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingDeleteItemId(null)
        deleteTriggerRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleDeleteDialogKeyDown)
    return () => window.removeEventListener('keydown', handleDeleteDialogKeyDown)
  }, [pendingDeleteItem])

  function showNewestItems() {
    setCurrentPage(1)
  }

  /* ── session management ── */
  function beginSession(event: React.FormEvent) {
    event.preventDefault(); if (!business.trim()) return
    const nextNumber = makeSessionNumber(business.trim())
    setSession({ business: business.trim(), productName: productName.trim(), number: nextNumber, items: [], status: 'active' }); setSetup(false); setNotice('Your scanning session is ready.')
  }

  function addParsed(parsed: ParsedItem) {
    setNotice(`${formatWeight(parsed.weight, parsed.unit)} added to session`)
    showNewestItems()
    setSession(current => {
      const itemNumber = getNextItemNumber(current.items)
      const item: Item = {
        ...parsed,
        id: crypto.randomUUID(),
        itemNumber,
        product: parsed.product ?? current.productName,
        scannedAt: new Date().toISOString(),
      }
      return { ...current, items: renumberItems([...current.items, item]), status: 'active' }
    })
    pendingScanRef.current = null
    scannerKeysRef.current = { lastKeyAt: 0, fastKeyCount: 0 }
    setInput(''); setInputFormat(''); setError(''); setWeightPrompt('')
    requestAnimationFrame(() => scanInputRef.current?.focus())
  }

  async function resolveScan(raw: string, manualWeight: string, format?: string): Promise<ScanResolution> {
    const parsed = parseQr(raw, manualWeight, format)
    const lookupCode = getCatalogLookupCode(raw)
    if (!('error' in parsed)) return { status: 'ready', item: parsed }
    if (manualWeight.trim() || !raw.trim()) return { status: 'error', message: parsed.error }
    if (!lookupCode) return { status: 'weight-required', code: raw.trim().slice(0, 128) }

    if (catalogLookupRef.current) return { status: 'error', message: 'Product catalogue lookup is already in progress.' }
    catalogLookupRef.current = true
    setCatalogLookupInProgress(true)
    setError('')
    setNotice('Looking up product in the catalogue...')
    try {
      const catalogItem = await lookupProductByCode(lookupCode, format)
      if (catalogItem) return { status: 'ready', item: { ...catalogItem, raw: raw.trim() } }
      return { status: 'weight-required', code: lookupCode }
    } catch (lookupError) {
      const message = lookupError instanceof Error ? lookupError.message : 'Unknown lookup error.'
      return {
        status: 'weight-required',
        code: lookupCode,
        warning: `Catalogue lookup failed; you can still enter the printed weight. Check Supabase setup. ${message}`,
      }
    } finally {
      catalogLookupRef.current = false
      setCatalogLookupInProgress(false)
      setNotice('')
    }
  }

  function showScanResolution(resolution: Exclude<ScanResolution, { status: 'ready' }>, raw?: string, format?: string) {
    if (resolution.status === 'error') {
      setError(resolution.message)
      setWeightPrompt('')
      return
    }

    pendingScanRef.current = raw ? { raw, format } : null
    setInput('')
    setInputFormat('')
    setError(resolution.warning ?? '')
    setWeightPrompt(`Scanned content has no usable weight. Enter the printed weight in grams below to add it.`)
    requestAnimationFrame(() => scanInputRef.current?.focus())
  }

  async function addItem(event?: React.FormEvent) {
    event?.preventDefault()
    if (processingScanRef.current) return
    if (session.status !== 'active') {
      setError('Resume the session before scanning another item.')
      return
    }
    if (catalogLookupRef.current) return
    const cleanInput = input.trim()
    if (!cleanInput) {
      setError('Scan a barcode or QR code, or enter a weight.')
      return
    }

    const now = performance.now()
    const isScannerBurst = isKeyboardScannerBurst(scannerKeysRef.current, now)
    scannerKeysRef.current = { lastKeyAt: 0, fastKeyCount: 0 }
    const pendingScan = isScannerBurst ? null : pendingScanRef.current
    if (isScannerBurst) pendingScanRef.current = null
    const raw = pendingScan?.raw ?? (isScannerBurst ? cleanInput : '')
    const manualWeight = pendingScan ? cleanInput : isScannerBurst ? '' : cleanInput
    const format = pendingScan?.format ?? inputFormat

    processingScanRef.current = true
    try {
      let resolution = await resolveScan(raw, manualWeight, format)
      if (resolution.status === 'error' && !pendingScan && !isScannerBurst) {
        resolution = await resolveScan(cleanInput, '', format)
      }
      if (resolution.status !== 'ready') {
        showScanResolution(resolution, raw || cleanInput, format)
        return
      }
      playScanFeedback()
      addParsed(resolution.item)
    } finally {
      processingScanRef.current = false
    }
  }

  async function handleCameraDetected(raw: string, format?: string) {
    if (session.status !== 'active' || processingScanRef.current) return
    const cleanRaw = raw.trim()
    if (!cleanRaw) return
    processingScanRef.current = true
    try {
      pendingScanRef.current = null
      setInput(cleanRaw)
      setInputFormat(format ?? '')
      const resolution = await resolveScan(cleanRaw, '', format)
      if (resolution.status !== 'ready') { showScanResolution(resolution, cleanRaw, format); return }
      addParsed(resolution.item)
    } finally {
      processingScanRef.current = false
    }
  }

  function confirmRemoveItem() {
    if (!pendingDeleteItemId) return
    const item = session.items.find(candidate => candidate.id === pendingDeleteItemId)
    if (!item) {
      setPendingDeleteItemId(null)
      setError('This item is no longer in the session.')
      return
    }

    const nextPageCount = Math.ceil((session.items.length - 1) / ITEMS_PER_PAGE)
    setSession(current => ({ ...current, items: removeItemById(current.items, pendingDeleteItemId) }))
    setCurrentPage(current => Math.min(current, Math.max(nextPageCount, 1)))
    setPendingDeleteItemId(null)
    setNotice(`Item #${item.itemNumber} removed`)
  }

  function trackScannerKey(event: React.KeyboardEvent<HTMLInputElement>) {
    scannerKeysRef.current = updateScannerKeyTiming(scannerKeysRef.current, event.key, performance.now())
  }

  /* ── CSV export ── */
  async function exportCsv() {
    try {
      const { downloadCsv } = await import('../../features/reports/services/reportExport')
      downloadCsv(session)
      setNotice('CSV downloaded.')
    } catch {
      setError('Could not generate the CSV report. Try again.')
    }
  }

  /* ── PDF export ── */
  async function exportPdf() {
    try {
      const { downloadPdf } = await import('../../features/reports/services/reportExport')
      downloadPdf(session, total)
      setNotice('PDF downloaded.')
    } catch {
      setError('Could not generate the PDF report. Try again.')
    }
  }

  /* ── share (Bug #4) ── */
  function getShareText() {
    let text = `*${session.business}*\nBilling Report\n\n`
    text += `Total Items: ${session.items.length}\n`
    text += `Grand Total Weight: ${total.toLocaleString('en-IN', { maximumFractionDigits: 3 })}g\n`
    text += `Date: ${formatDate(new Date())}\n\n`
    text += `Items:\n`
    session.items.forEach((item, i) => { text += `${i + 1}) ${formatWeight(item.weight, item.unit)}  ` ; if ((i + 1) % 4 === 0) text += '\n' })
    text += `\n\nGRAND TOTAL: ${total.toLocaleString('en-IN', { maximumFractionDigits: 3 })}g`
    text += `\n\n— Sent via BarcoX`
    return text
  }

  async function shareNative() {
    const text = getShareText()
    const browserNavigator = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (browserNavigator.share) {
      try {
        await browserNavigator.share({ title: `${session.business} — Billing Report`, text })
      } catch (shareError) {
        if (!(shareError instanceof Error && shareError.name === 'AbortError')) {
          setError('Could not share the report. Check browser permissions and try again.')
        }
        return
      }
    } else {
      try {
        await navigator.clipboard.writeText(text)
        setNotice('Summary copied to clipboard.')
      } catch {
        setError('Could not access the clipboard. Check browser permissions and try again.')
        return
      }
    }
    setShareModal(false)
  }

  function shareWhatsApp() {
    const text = getShareText()
    const shareWindow = window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
    if (!shareWindow) {
      setError('WhatsApp could not be opened. Allow pop-ups and try again.')
      return
    }
    setShareModal(false)
    setNotice('WhatsApp opened.')
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(getShareText())
      setShareModal(false)
      setNotice('Copied to clipboard — paste into any app.')
    } catch {
      setError('Could not access the clipboard. Check browser permissions and try again.')
    }
  }

  /* ── new session / reset (Bug #6) ── */
  function startNewSession() {
    setSession({ business: '', productName: '', number: '', items: [], status: 'active' })
    setCurrentPage(1)
    setBusiness('')
    setProductName('')
    setSetup(true)
    setInput('')
    setInputFormat('')
    pendingScanRef.current = null
    setError('')
    setPendingDeleteItemId(null)
    clearSession()
    setNotice('Ready for a new session.')
  }

  /* ── sign in handler ── */
  function handleSignIn() {
    clearSession()
    setSession(EMPTY_SESSION)
    setBusiness('')
    setProductName('')
    setSetup(true)
    setInput('')
    setInputFormat('')
    pendingScanRef.current = null
    setError('')
    setPendingDeleteItemId(null)
    setCurrentPage(1)
    setShareModal(false)
    historyInitialized.current = false
  }

  async function handleSignOut() {
    try {
      const { error: signOutError } = await supabase?.auth.signOut() ?? {}
      if (signOutError) {
        setError('Could not sign out. Check your connection and try again.')
        return
      }
    } catch {
      setError('Could not sign out. Check your connection and try again.')
      return
    }
    setUserEmail('')
    historyInitialized.current = false
  }

  if (!authReady) return <div className="login-shell" aria-busy="true"><section className="login-card"><p className="muted">Checking your secure session...</p></section></div>
  if (!signedIn) return <Login onSignIn={handleSignIn} />

  return <div className={setup ? 'app-shell app-shell-setup' : 'app-shell'}>
    {!setup && <Navbar email={userEmail} online={online} onSignOut={() => void handleSignOut()} />}
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
            <label>Business Name<div className="input-with-icon"><span className="material-symbols-outlined">storefront</span><input autoFocus required maxLength={120} value={business} onChange={event => setBusiness(event.target.value)} placeholder="Enter corporate entity name" /></div></label>
            <label>Product Name<div className="input-with-icon"><span className="material-symbols-outlined">inventory_2</span><input value={productName} onChange={event => setProductName(event.target.value)} placeholder="Optional default for scanned items" maxLength={120} /></div></label>
            <label className="session-identifier">Session Identifier <span>Auto-generated</span><div className="input-with-icon"><span className="material-symbols-outlined">key</span><input value="" placeholder="Generated when session opens" disabled /></div></label>
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
            {session.productName && <p className="session-product-name">Product: {session.productName}</p>}
            <p>{session.number} <span className="separator">/</span> Started today</p>
          </div>
          <button className="outline-button" onClick={startNewSession}>
            <span className="material-symbols-outlined">restart_alt</span> New session
          </button>
        </section>

        <section className="metrics">
          <Metric label="Barcode / QR Scans" value={barcodeOrQrScanned.toString()} icon="qr_code_scanner" />
          <Metric label="Previous Weight" value={previousItem ? formatWeight(previousItem.weight, previousItem.unit) : '—'} icon="history" />
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
            <Suspense fallback={<div className="camera-scanner" aria-busy="true">Loading camera scanner…</div>}>
              <CameraScanner onDetected={handleCameraDetected} disabled={session.status !== 'active'} />
            </Suspense>
            <form onSubmit={addItem} className="scan-form">
              <label>
                Manual Weight
                <input
                  ref={scanInputRef}
                  disabled={session.status !== 'active'}
                  value={input}
                  onKeyDown={trackScannerKey}
                  onChange={event => { setInput(event.target.value); setInputFormat(''); setWeightPrompt(''); setError('') }}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter a weight or scan a barcode / QR code"
                />
              </label>
              <div className="weight-row">
                <span>grams</span>
                <button className="primary-button compact" type="submit" disabled={catalogLookupInProgress || session.status !== 'active'}>
                  {catalogLookupInProgress ? 'Looking up…' : 'Add item'}
                </button>
              </div>
              {weightPrompt && <div className="weight-prompt" role="status">{weightPrompt}</div>}
              {error && <div className="error-message">
                <span className="material-symbols-outlined" style={{fontSize: '16px'}}>help</span>
                {error}
              </div>}
            </form>
            <div className="scanner-footnote">
              <span className="material-symbols-outlined" style={{fontSize: '16px'}}>cloud_sync</span>
              Saved locally first{remoteSyncMessage ? ` · ${remoteSyncMessage}` : online ? ' · waiting to sync' : ' · offline'}
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
              <div className="item-batch">
                <div className="batch-heading">
                  <span>Batch {pageCount - activePage + 1}</span>
                  <span>{visibleItems.length} items</span>
                </div>
                {visibleItems.map(item => <div className="item-row" key={item.id}>
                  <span className="item-number">#{item.itemNumber.toString().padStart(3, '0')}</span>
                  <div className="item-detail">
                    <strong>{getItemDisplayName(item.product, item.itemNumber, item.scanType)}</strong>
                    <span>{[item.size ? `Size ${item.size}` : '', item.raw].filter(Boolean).join(' · ')}</span>
                  </div>
                  <strong className="item-weight">{formatWeight(item.weight, item.unit)}</strong>
                  <button
                    className="item-delete-button"
                    type="button"
                    aria-label={`Remove item ${item.itemNumber}: ${getItemDisplayName(item.product, item.itemNumber, item.scanType)}`}
                    title="Remove item"
                    onClick={event => {
                      deleteTriggerRef.current = event.currentTarget
                      setPendingDeleteItemId(item.id)
                    }}
                  ><Trash2 size={17} aria-hidden="true" /></button>
                </div>)}
              </div>
            </div>}
            {pageCount > 1 && <nav className="pagination" aria-label="Recent items pages">
              <span className="pagination-summary">Showing {firstVisibleItem}–{lastVisibleItem} of {session.items.length}</span>
              <div className="pagination-controls">
                <button className="pagination-button" type="button" disabled={activePage === 1} onClick={() => setCurrentPage(activePage - 1)}>
                  Previous
                </button>
                {paginationPages.map((page, index) => page === 'ellipsis'
                  ? <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">…</span>
                  : <button
                    className={`pagination-button pagination-page${page === activePage ? ' active' : ''}`}
                    type="button"
                    key={page}
                    aria-label={`Page ${page}`}
                    aria-current={page === activePage ? 'page' : undefined}
                    onClick={() => setCurrentPage(page)}
                  >{page}</button>)}
                <button className="pagination-button" type="button" disabled={activePage === pageCount} onClick={() => setCurrentPage(activePage + 1)}>
                  Next
                </button>
              </div>
            </nav>}
            <div className="items-actions">
              {session.status !== 'completed' && <button className="ghost-button" onClick={() => setSession(current => ({ ...current, status: current.status === 'paused' ? 'active' : 'paused' }))}>
                <span className="material-symbols-outlined">{session.status === 'paused' ? 'play_arrow' : 'pause'}</span>
                {session.status === 'paused' ? 'Resume' : 'Pause'}
              </button>}
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
          <div className="session-summary">
            <div><span>Business Name:</span><strong>{session.business || '—'}</strong></div>
            <div><span>Product Name:</span><strong>{session.productName || '—'}</strong></div>
            <div><span>Total Items:</span><strong>{session.items.length}</strong></div>
            <div><span>Total Weight:</span><strong>{formatWeight(total)}</strong></div>
          </div>
          <div className="bottom-actions">
            <button className="primary-button" onClick={() => setSession(current => ({ ...current, status: 'completed' }))}>
              <span className="material-symbols-outlined filled">check_circle</span> Complete session
            </button>
          </div>
        </section>

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
    {pendingDeleteItem && <div className="modal-backdrop" onClick={() => setPendingDeleteItemId(null)}>
      <section
        className="modal delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-item-title"
        onClick={event => event.stopPropagation()}
      >
        <h2 id="delete-item-title">Remove item?</h2>
        <p>Are you sure you want to remove item #{pendingDeleteItem.itemNumber.toString().padStart(3, '0')} ({getItemDisplayName(pendingDeleteItem.product, pendingDeleteItem.itemNumber, pendingDeleteItem.scanType)} · {formatWeight(pendingDeleteItem.weight, pendingDeleteItem.unit)})?</p>
        <div className="modal-actions">
          <button ref={cancelDeleteButtonRef} className="outline-button" type="button" onClick={() => {
            setPendingDeleteItemId(null)
            deleteTriggerRef.current?.focus()
          }}>Cancel</button>
          <button className="danger-button" type="button" onClick={() => {
            confirmRemoveItem()
            deleteTriggerRef.current?.focus()
          }}>Delete</button>
        </div>
      </section>
    </div>}
  </div>
}

/* ── sub-components ── */
