export const productConfig = {
  name: 'SignalRoom',
  canonicalOrigin: 'https://signalroom-feedback-saas.vercel.app',
  routes: {
    register: '/app?mode=register',
    login: '/app?mode=login',
    demo: '/b/vercel-production-feedback',
    privacy: '/privacy',
    terms: '/terms',
  },
  availability: {
    label: 'Free preview',
    detail: 'The current public build is a free preview. Paid plans have not launched.',
  },
} as const;

export type ProductConfig = typeof productConfig;
