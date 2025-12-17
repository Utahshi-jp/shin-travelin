# shin-travelin

AI 補助付き旅程作成ツール。Next.js 15 (App Router) と NestJS 11 + Prisma 7 で構成し、docs/ 以下の要件定義・設計書をソースオブトゥルースとして運用します。

## Tech Stack

- Frontend: Next.js 15, React 19, React Hook Form, TanStack Query.
- Backend: NestJS 11, Prisma 7, PostgreSQL.
- Infrastructure: Docker Compose for local multi-service boot, scripts/verify-artifact.mjs で成果物検証。

## Repository Layout

- docs/: requirements/basic/detail/db/legacy ドキュメント群。
- src/: Next.js アプリケーション（App Router）。
- backend/: NestJS + Prisma。`backend/prisma/schema.prisma` が単一の DB スキーマ定義。
- public/: 静的アセット。
- scripts/: 補助スクリプト（例: verify-artifact.mjs）。

## Getting Started

```bash
# Install dependencies
npm install
npm install --prefix backend

# Start backend API
npm run dev:api

# Start frontend (別ターミナル)

```

API は http://localhost:4000 、Next.js は http://localhost:3000 で起動します。`.env` と `backend/.env` に API キーや DB URL を設定してください。

## Artifact Checklist (必須)

ZIP などで成果物を提出する前に、必要フォルダが含まれているかを自動検証してください。

```bash
npm run verify:artifact
```

欠損がある場合はエラーになります。`docs/requirements.md` や `backend/prisma/schema.prisma` など、レビュアーが前提とするファイルが抜けた状態での提出を防げます。パッケージング時は `git archive -o shin-travelin.zip HEAD` など Git 管理下の内容をそのまま出力する方法を推奨します。

## Testing

- Frontend: add React Testing Library specs under `src/**/__tests__`（予定）。
- Backend: `npm run test` / `npm run test:e2e` within `backend/`。

## Conventions

- Conventional Commits (`feat:`, `fix:`...)。
- Cache 制御: `shared/api/client.ts` 経由の fetch は `cache: \"no-store\"` を強制。
- 認証トークンは Cookie + Authorization header の両方を送信し SSR/CSR で共通化。

## Support

問題があれば issue に記載し、再現手順とログ、`verify:artifact` の結果を添付してください。
