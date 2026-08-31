export const appConfig = {
  storage: {
    sessionKey: 'barcox-session',
    sessionExpiryMs: 1000 * 60 * 60 * 24 * 7,
  },
  export: {
    csv: { delimiter: ',' },
    pdf: { pageFormat: 'a4' as const },
  },
  features: {
    camera: { enableRetry: true, requireSecureContext: true },
  },
} as const
