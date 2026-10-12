import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        border: "var(--border)",
        muted: "var(--muted)",
        surface: "var(--surface)",
        red: { bauhaus: "var(--primary-red)" },
        blue: { bauhaus: "var(--primary-blue)" },
        yellow: { bauhaus: "var(--primary-yellow)", soft: "var(--accent-yellow-soft)" },
      },
      fontFamily: {
        sans: ["var(--font-outfit)", "system-ui", "sans-serif"],
      },
      borderWidth: { DEFAULT: "var(--border-w)", 4: "4px" },
      borderRadius: { square: "0px", circle: "9999px" },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        none: "none",
      },
      transitionTimingFunction: { bauhaus: "cubic-bezier(0.2, 0, 0, 1)" },
      keyframes: {
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "toast-in": {
          from: { transform: "translateX(120%)" },
          to: { transform: "translateX(0)" },
        },
        "shape-in": {
          from: { transform: "scale(0.9) rotate(-6deg)", opacity: "0" },
          to: { transform: "scale(1) rotate(0deg)", opacity: "1" },
        },
        "spin-square": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "slide-up": "slide-up 200ms cubic-bezier(0.2,0,0,1) both",
        "toast-in": "toast-in 200ms cubic-bezier(0.2,0,0,1) both",
        "shape-in": "shape-in 300ms cubic-bezier(0.2,0,0,1) both",
        "spin-square": "spin-square 800ms linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
