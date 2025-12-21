import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "backend/**",
      "backend/dist/**",
    ],
  },
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "app", pattern: "src/app/**" },
        { type: "processes", pattern: "src/processes/**" },
        { type: "features", pattern: "src/features/**" },
        { type: "entities", pattern: "src/entities/**" },
        { type: "shared", pattern: "src/shared/**" },
        { type: "widgets", pattern: "src/widgets/**" },
      ],
    },
    rules: {
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          message: "Layer violation: {{from}} cannot import from {{dependency}}",
          rules: [
            {
              from: "app",
              allow: ["app", "processes", "features", "entities", "widgets", "shared"],
            },
            {
              from: "processes",
              allow: ["processes", "features", "entities", "widgets", "shared"],
            },
            {
              from: "features",
              allow: ["features", "entities", "widgets", "shared"],
            },
            {
              from: "entities",
              allow: ["entities", "shared"],
            },
            {
              from: "widgets",
              allow: ["widgets", "shared"],
            },
            {
              from: "shared",
              allow: ["shared"],
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "node-fetch",
              message: "Use shared/api/client.ts for HTTP requests to keep a single boundary.",
            },
            {
              name: "axios",
              message: "Use shared/api/client.ts for HTTP requests to keep a single boundary.",
            },
          ],
          patterns: [
            {
              group: ["../backend/**", "@/backend/**"],
              message: "Frontend cannot import backend internals.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
