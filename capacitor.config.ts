import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jarvis.ai',
  appName: 'JARVIS',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  SystemBars: {
    insetsHandling: "css",
    hidden: true,
  },
};

export default config;
