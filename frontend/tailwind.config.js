/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
      },
      colors: {
        naf: {
          50: '#f0f7f4',
          100: '#dcefe6',
          500: '#0f766e',
          600: '#0d6157',
          700: '#0a4f47',
          900: '#052e2b',
        },
      },
    },
  },
  plugins: [],
};
