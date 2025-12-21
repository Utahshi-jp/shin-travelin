# shin-travelin

AI を補助にした旅程自動生成ツールです。Next.js 15 (App Router) + NestJS 11 + Prisma 7 + PostgreSQL で構成し、要件/設計は `docs/`（特に detail-design.md）をソース・オブ・トゥルースとして管理します。

## 概要

- 旅行条件（Draft）を保存し、Gemini API を利用して晴天/悪天候ペアの旅程を生成します。
- 旅程詳細画面では日単位の部分再生成と差分適用、ジョブ状態の可視化を提供します。
- docs/detail-design.md の CI 方針（lint → test → prisma migrate deploy）に沿って品質ゲートを定義し、CI/ローカルのコマンドを統一しています。

## アーキテクチャ

- `src/` … Next.js 15 App Router。`features/itinerary` が再生成 UI、`shared/api/client.ts` が API クライアント。
- `backend/` … NestJS 11 + Prisma 7。`src/ai/ai.service.ts` がジョブ調停、`src/ai/ai.pipeline.ts` が LLM 正規化処理。
- `docs/` … requirements/basic/detail/db などの設計書。コード変更時はここを先に更新する運用。
- `docker-compose.yml` … PostgreSQL（デフォルトユーザー `shin/shinpass`）。
- `scripts/verify-artifact.mjs` … 成果物チェック。

## セットアップ

### 前提

- Node.js 20.12 以上（CI と同じ）
- pnpm 10.24（ルート依存関係用）
- npm 10 以上（backend ディレクトリは独立パッケージのため npm を使用）
- Docker Desktop（PostgreSQL コンテナ）

### 手順

```bash
# 依存関係
pnpm install
(cd backend && npm install)

# DB 起動
docker compose up db -d

# Prisma マイグレーション
cd backend
npx prisma migrate deploy

# .env（フロント）
cat <<'EOF' > .env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
EOF

# backend/.env
cat <<'EOF' > backend/.env
DATABASE_URL=postgresql://shin:shinpass@localhost:5432/shintravelin?schema=public
JWT_SECRET=dev-secret
GEMINI_API_KEY=your-key-or-blank
AI_MODEL=gemini-pro
AI_TEMPERATURE=0.3
USE_MOCK_GEMINI=true
EOF

# 開発サーバー（別ターミナルで実行）
pnpm dev        # Next.js 3000 番
npm run dev:api # NestJS 4000 番
```

`USE_MOCK_GEMINI=true` にすると API キーがなくてもモックレスポンスで動作します。実機テスト時は本物のキーを設定してください。

## 開発コマンド

| 目的 | コマンド | 備考 |
| --- | --- | --- |
| フロント開発サーバー | `pnpm dev` | `http://localhost:3000` |
| バックエンド開発サーバー | `npm run dev:api` | `http://localhost:4000` |
| Prisma マイグレーション | `cd backend && npx prisma migrate dev` | スキーマ変更時 |
| フロント lint | `pnpm lint` | Next.js ESLint |
| バックエンド lint | `npm run lint --prefix backend` | NestJS ESLint |
| 単体テスト（front/back） | `pnpm test` / `npm run test --prefix backend` | Vitest / Jest |
| E2E (backend) | `npm run test:e2e --prefix backend` | Supertest + Jest |

## 品質ゲート（ローカル）

目的：CI 落ちを未然に防ぎ、AI 生成コストが絡む変更を安全にリリースするための最小ラインです。原則として **警告も失敗扱い** にし、無視する場合は issue または README で理由を共有してください。

```bash
pnpm lint:all
pnpm typecheck:all
pnpm test:all
pnpm check:deps
pnpm check:unused
pnpm verify:artifact
```

- `lint:all` / `typecheck:all` / `test:all` は front/back をまとめて検証します。
- `check:deps` は madge、`check:unused` は knip を使用します。
- `verify:artifact` は docs / prisma schema など必須ファイルの欠損を検出します。
- pnpm を利用できない環境では `npm run lint:all` のように npm コマンドへ置き換えても構いません（実行内容は同一です）。

## CI

- `.github/workflows/quality-gate.yml` が push / PR (main) で走り、上記品質ゲートと同じコマンドを pnpm で実行します。
- `prisma migrate deploy` は detail-design.md に沿って **quality gate 通過後に実行する将来ステージ** として予約しており、現状は手動で適用します。
- CI で失敗した場合は同じコマンドをローカルで再現し、修正後に再 push してください。

## よくある不具合と対処

- **API との通信が CORS で失敗する** → `NEXT_PUBLIC_API_BASE_URL` が 4000 番を向いているか、ブラウザの Cookie（`shin_access_token`）が存在するか確認してください。
- **Gemini 呼び出しが常に失敗する** → `GEMINI_API_KEY` を設定するか、一時的に `USE_MOCK_GEMINI=true` でモック応答に切り替えます。
- **旅程詳細で再生成対象を選べない** → Draft の日付レンジから外れた `days` を送ると `VALIDATION_ERROR` になります。UI で無効日に黄色ラベルが表示されたら選択を解除してください。

## ドキュメント運用

- detail-design.md を更新してからコードを変更します。差分には必ず根拠となるファイルパス (`[backend/src/ai/ai.service.ts](backend/src/ai/ai.service.ts)` など) を追記してください。
- README は日本語で保守し、初見の開発者が 30 分以内に開発環境を立ち上げられるよう保つことを目標にします。
