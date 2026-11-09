type MetricProps = {
  label: string
  value: string
  icon: string
}

export function Metric({ label, value, icon }: MetricProps) {
  return (
    <div className="metric">
      <div className="metric-icon">
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
