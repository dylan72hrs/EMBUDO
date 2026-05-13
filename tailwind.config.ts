import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#182026",
        line: "#d7dde2",
        paper: "#f7f9fb",
        accent: "#0f766e"
      }
    }
  },
  plugins: []
};

export default config;
