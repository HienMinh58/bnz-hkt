/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bnz: {
          50: "#eef7ff",
          100: "#d9edff",
          500: "#1774d1",
          700: "#0756a6",
          900: "#06386d",
        },
      },
      boxShadow: {
        panel: "0 12px 30px rgba(6, 56, 109, 0.08)",
      },
    },
  },
  plugins: [],
};
