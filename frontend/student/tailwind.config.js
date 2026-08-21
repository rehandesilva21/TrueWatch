/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // 'xs' isn't a default Tailwind breakpoint — added specifically so
      // secondary badges (e.g. identity status) can hide on the smallest
      // phone widths but reappear once there's room, rather than either
      // always showing (causing topbar overflow) or always hiding.
      screens: {
        xs: '420px',
      },
      colors: {
        primary: "#2563eb",
        primaryDark: "#1d4ed8",
        primaryLight: "#eff6ff",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
}