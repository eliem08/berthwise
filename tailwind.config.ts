import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        harbor: {
          950: "#060d1a",
          900: "#0a1628",
          850: "#0d1c33",
          800: "#122540",
          700: "#1b3355",
          600: "#274472",
        },
        signal: {
          300: "#ffd08a",
          400: "#f5a623",
          500: "#e8890c",
          600: "#c96f06",
        },
        tide: {
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
