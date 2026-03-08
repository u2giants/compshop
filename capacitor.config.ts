import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.compshop',
  appName: 'CompShop',
  webDir: 'dist',
  server: {
    url: 'https://6054c773-88f0-46d6-aed8-439b0531b157.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  plugins: {
    Camera: {
      presentationStyle: 'popover',
    },
  },
};

export default config;
