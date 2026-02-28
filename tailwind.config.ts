import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: '#161c24',
        panelSoft: '#1e2632',
        rail: '#11161d',
        accent: '#ff8b2b',
        accentSoft: '#ffb171',
        ink: '#e6edf5',
        muted: '#90a0b5'
      },
      boxShadow: {
        panel: '0 8px 20px rgba(0, 0, 0, 0.28)'
      }
    }
  },
  plugins: []
};

export default config;
