/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // V2: Deeper dark base
        darkBg:        "#070c18",
        cardBg:        "#0f1629",
        borderDark:    "#1e2a45",
        textPrimary:   "#F3F4F6",
        textSecondary: "#6B7280",

        // V2: Violet/Purple as primary accent (replaced blue)
        accentViolet:  "#7C3AED",
        violetLight:   "#A78BFA",
        violetDim:     "#4C1D95",

        // Supporting accents
        accentBlue:    "#3B82F6",
        accentGreen:   "#10B981",
        accentYellow:  "#F59E0B",
        accentRed:     "#EF4444",
        accentOrange:  "#F97316",
      },
      boxShadow: {
        'glow-violet': '0 0 20px rgba(124,58,237,0.25)',
        'glow-green':  '0 0 20px rgba(16,185,129,0.20)',
        'glow-red':    '0 0 20px rgba(239,68,68,0.20)',
        'card':        '0 4px 24px rgba(0,0,0,0.4)',
      },
      animation: {
        'fade-in':    'fadeIn 0.3s ease-out',
        'slide-up':   'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' },                                      to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(12px)', opacity: '0' },       to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
}
