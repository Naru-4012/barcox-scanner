type NavbarProps = {
  email: string
  online: boolean
  onSignOut: () => void
}

export function Navbar({ email, online, onSignOut }: NavbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <span className="material-symbols-outlined">qr_code_2</span>
        </span>
        <span>Barco<span className="brand-x">X</span></span>
      </div>
      <div className="topbar-meta">
        <span className="account-email" title={email}>{email}</span>
        <span className="online-status" aria-label={online ? 'Online' : 'Offline'}>
          <span className={`status-dot ${online ? '' : 'offline'}`} aria-hidden="true" />
          {online ? 'Online' : 'Offline'}
        </span>
        <button className="icon-button sign-out-button" type="button" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>
  )
}
