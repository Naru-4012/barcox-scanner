type NavbarProps = {
  email: string
  online: boolean
  onSignOut: () => void
}

export function Navbar({ email, online, onSignOut }: NavbarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <span className="material-symbols-outlined">qr_code_2</span>
        </span>
        <span>Barco<span className="brand-x">X</span></span>
      </div>
      <div className="topbar-meta">
        <span className="online-status">{email}</span>
        <span className="online-status">
          <span className={`status-dot ${online ? '' : 'offline'}`} />
          {online ? 'Online' : 'Offline mode'}
        </span>
        <button className="icon-button" title="Sign out" onClick={onSignOut}>
          <span className="material-symbols-outlined">logout</span>
        </button>
      </div>
    </header>
  )
}
