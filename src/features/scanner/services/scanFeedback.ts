export function playScanFeedback() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (AudioCtx) {
      const context = new AudioCtx()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(1200, context.currentTime)
      gain.gain.setValueAtTime(0.25, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12)
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.12)
      setTimeout(() => void context.close().catch(() => {}), 250)
    }
  } catch {
    // Audio feedback may be blocked or unsupported.
  }

  try {
    if ('vibrate' in navigator) navigator.vibrate(80)
  } catch {
    // Haptic feedback may be unsupported.
  }
}
