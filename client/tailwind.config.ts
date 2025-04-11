import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      dropShadow: {
        text: "2px 1px 5.3px #000",
        outline: "0px 0px 2px #000",
      },
      backgroundImage: {
        "btn-white": "linear-gradient(180deg, #FFF 61.36%, #9E9EB5 115.91%)",
      },
      boxShadow: {
        outline: "0px 0px 0px 1px var(--black)",
        "btn-base": "0px 19px 34px 0px #000",
      },
      borderRadius: {
        lg: "100px",
        md: "var(--radius)",
        sm: "var(--radius)",
      },
      colors: {
        white: "var(--white)",
        black: "var(--black)",
        dark: {
          "1": "var(--dark)",
          "2": "var(--dark2)",
        },
        border: {
          "1": "var(--border)",
          "2": "var(--border2)",
        },
        muted: {
          "1": "var(--muted)",
          "2": "var(--muted2)",
        },
        green: "var(--green)",
        red: "var(--red)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
