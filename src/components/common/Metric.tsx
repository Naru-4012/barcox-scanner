type MetricProps = {
  label: string
  value: string
  icon: string
}

export function Metric({ label, value, icon }: MetricProps) {
  return (
    <div className="metric">
      <div className="metric-icon">
        <span aria-hidden="true" className="material-symbols-outlined">{icon}</span>
      </div>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
