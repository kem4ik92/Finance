/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d8ecff",
          200: "#b8ddff",
          300: "#85c6ff",
          400: "#4aa4ff",
          500: "#2186ff",
          600: "#0c68ea",
          700: "#0a53bd",
          800: "#0e4798",
          900: "#123e79",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 4px 20px -8px rgba(17, 24, 39, 0.15)",
      },
    },
  },
  plugins: [],
};
