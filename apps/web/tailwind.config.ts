import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["selector", '[data-theme="monochrome-dark"], [data-theme="gruvbox-dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/design-system/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        "background-deep": "var(--background-deep)",
        panel: "var(--panel)",
        "panel-raised": "var(--panel-raised)",
        "panel-strong": "var(--panel-strong)",
        input: "var(--input)",
        hover: "var(--hover)",
        selected: "var(--selected)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        ring: "var(--ring)",
        foreground: "var(--foreground)",
        "foreground-strong": "var(--foreground-strong)",
        "foreground-muted": "var(--foreground-muted)",
        "muted-foreground": "var(--muted-foreground)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        "primary-soft": "var(--primary-soft)",
        success: "var(--success)",
        "success-soft": "var(--success-soft)",
        warning: "var(--warning)",
        "warning-soft": "var(--warning-soft)",
        destructive: "var(--destructive)",
        "destructive-soft": "var(--destructive-soft)",
        info: "var(--info)",
        "info-soft": "var(--info-soft)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        purple: "var(--purple)",
        "purple-soft": "var(--purple-soft)"
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)"
      },
      boxShadow: {
        panel: "var(--shadow-panel)",
        popover: "var(--shadow-popover)"
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"]
      }
    }
  },
  plugins: []
};

export default config;
