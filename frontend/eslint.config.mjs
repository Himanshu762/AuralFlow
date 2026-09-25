import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "node_modules/**", "next-env.d.ts"],
  },
  {
    rules: {
      /* Album art comes from remote catalogue URLs and Tauri serves the app
         from file:// — the Next image optimizer is disabled, so <img> is
         the correct element here. */
      "@next/next/no-img-element": "off",
    },
  },
];

export default eslintConfig;
