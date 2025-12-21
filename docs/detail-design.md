# shin-travelin 詳細設計

本書は要件定義書・基本設計に基づき、実装者が迷わず手を動かせる粒度で記述する。各見出しは可能な限り「入力」「処理」「出力」「エラー」「責務境界」を明示し、全体の詳細度を揃える。

---

## 0. 対象と読み方

- 対象: Next.js 15（App Router）+ NestJS 11 + Prisma 7（PostgreSQL）。
- 読み方:
  - 1章: フォルダ責務
  - 2章: 画面 UI / 状態 / 遷移
  - 3章: API / DTO / バリデーション
  - 4章: データモデル
  - 5章: フロー（並行・再試行含む）
  - 6–7章: 実装指針
  - 8章: 非機能
  - 9章: ドメイン
  - 10–11章: テスト観点 / 設計
  - 12章: プロンプト運用
  - 13–15章: サンプル / 関数 I/O / エラー設計

---

## 1. ディレクトリと命名（責務粒度）

### 1.1 フロントエンド（Next.js 15 App Router）

- app/: RSC 中心のページと layout。
  - `app/page.tsx`（条件入力）
  - `app/itineraries/page.tsx`（一覧）
  - `app/itineraries/[id]/page.tsx`（詳細/編集）
  - `app/itineraries/[id]/print/page.tsx`（印刷）
  - `app/layout.tsx`（メタ/フォント/構造）

- processes/（予定）: 複数 feature を束ねるフロー UI。
  - 例: `processes/generate-and-save/` にステップ表示・ガードを配置

- features/: ドメイン別ロジック・UI（FSD の features）。
  - `features/auth/components/LoginForm.tsx`
  - `features/auth/hooks/useAuth.ts`
  - `features/itinerary/api/*.ts`
  - `features/itinerary/hooks/*`
  - `features/ai/hooks/*`

- widgets/（予定）: 画面横断のコンポーネント（FSD の widgets）。
  - `widgets/header/`
  - `widgets/itinerary-card/`
  - `widgets/footer/`

- entities/: ドメイン型とマッパー（FSD の entities）。
  - `entities/itinerary/model.ts`
  - `entities/itinerary/mapper.ts`

- shared/: 共通基盤（FSD の shared）。
  - `shared/api/client.ts`（fetch ラッパー）
  - `shared/config/env.ts`（予定: Public env の型安全読み出し）
  - `shared/lib/queryClient.ts`
  - `shared/validation/*.schema.ts`（Zod）
  - `shared/ui/*`（予定: UI 基盤）
  - `shared/lib/*`（hooks / util）

---

### 1.2 バックエンド（NestJS 11）

- 層: Controller → Service → Prisma。
- 共通適用:
  - ValidationPipe（whitelist / forbidNonWhitelisted / transform）
  - HttpExceptionFilter
  - LoggingInterceptor
  - JWT Guard

- モジュール:
  - `AuthModule`
  - `DraftsModule`
  - `AiModule`（ai.pipeline 集約）
  - `ItinerariesModule`
  - `PrismaModule`

- 主要ファイル例:
  - `backend/src/main.ts` 起動・共通ミドルウェア登録
  - `backend/src/app.module.ts` ルートモジュール
  - `backend/src/auth/auth.controller.ts` / `auth.service.ts` / `dto/*.ts`
  - `backend/src/drafts/drafts.controller.ts` / `drafts.service.ts` / `dto/*.ts`
  - `backend/src/itineraries/itineraries.controller.ts` / `itineraries.service.ts` / `dto/*.ts`
  - `backend/src/ai/ai.pipeline.ts`（プロンプト生成・Gemini 呼び出し・パース/修復）
  - `backend/src/ai/ai.service.ts`（多重起動防止・ステータス参照）
  - `backend/src/prisma/prisma.service.ts` PrismaClient ラッパー

- Cross-cutting（予定）:
  - `backend/src/shared/logging.interceptor.ts`
  - `backend/src/shared/http-exception.filter.ts`
  - `backend/src/shared/correlation.middleware.ts`

- 永続化:
  - `backend/prisma/schema.prisma`
  - `backend/prisma/migrations/`

---

### 1.3 共通ライブラリ（DTO・ユーティリティ）

- フロント:
  - `shared/api`（timeout/backoff/エラー正規化）
  - `shared/validation`（draft/itinerary/ai response の Zod）
  - `shared/lib/queryClient`（React Query 設定）
  - `shared/ui`（予定: 汎用 UI）
  - `shared/config/env.ts`（予定）

- バックエンド:
  - DTO: `backend/src/**/dto/*.ts`（class-validator）
  - 共通:
    - `backend/src/shared/errors.ts`（予定: エラーコード定義）
    - `backend/src/shared/types.ts`（予定: 共通型）

---

### 1.4 テスト（E2E・ユニット）

- backend:
  - `backend/test/`（e2e: Jest）
  - `backend/src/**/*.spec.ts`（単体）

- front:
  - Playwright（`tests/e2e/*` 予定）
  - Testing Library + Jest/Vitest（`src/**/__tests__/*.test.tsx` 予定）

---

### 1.5 インフラ（IaC・設定）

- `docker-compose.yml`: front/back/db を個別コンテナで起動
- `backend/prisma/`: schema.prisma と migrations/
- 環境変数は `.env`（DATABASE_URL ほか）
- `tRavelIN/config/` は旧資料（参考用）

---

### 1.6 ドキュメント（設計・運用・会議記録）

- `docs/`: requirements / basic-design / detail-design など現行設計
- `tRavelIN/`: 旧システム資料（参照のみ）

---


## 2. 画面仕様（項目・状態・イベント・エラーの粒度）

共通方針：
- フォームは **React Hook Form（RHF）+ Zod** で入力を検証する。
- 入力エラーは **該当フィールド直下** に表示し、フォーム全体の失敗（API エラー等）は **トースト** で通知する。
- **キーボード操作のみで完結**できること（Tab 移動、Enter 送信、フォーカス可視）を担保し、`aria-label` / `role` 等のアクセシビリティ属性を付与する。
- モーダル等を開く場合は **フォーカストラップ**（モーダル外へフォーカスが抜けない）を適用する。
- サーバーデータ取得は原則 **`no-store`**（常に最新取得）を基本とし、一覧等で許容できる場合は **短い `revalidate`**（短期キャッシュ）を利用する。

---

### 2.1 `/` 旅行条件入力

#### 入力項目と制約
- 出発地：**3–200文字**
- 目的地：**1–5件**、各 **3–200文字**
- （他項目の制約は要件定義書の FR-1 に準拠）

#### 状態とイベント
- `onSubmit`
  - Zod で検証
  - `createDraft` → `POST /drafts`
  - `generate` → `POST /ai/generate`
  - `jobId` を取得し、`/itineraries/[id]?jobId=...` に遷移（`push`）
- `onError`
  - **最初のエラーフィールドへスクロール**し、フォーカスを当てる
  - トーストで補足メッセージを表示（任意）
- 送信中
  - ボタンは **loading 表示**
  - 入力欄・送信ボタンは **disable**

#### エラー表示
- 400（入力不備：Zod / class-validator）
  - フィールド下に詳細を表示 + トースト
  - 最初のエラーへスクロール
- 401
  - ログイン導線（ログインモーダル/ページ表示）
- 500
  - 再試行ボタン（同じ入力で再実行できる導線）

---

### 2.2 `/itineraries` 一覧

#### データ取得
- SSR で `listItineraries(user, page, query)` を実行して一覧を取得する。
- 0件の場合は **空状態（プレースホルダー）** を表示する。

#### 操作
- 行（カード）クリックで詳細ページへ遷移する。
- 検索条件・ページ切替は URL クエリに反映し、状態を復元可能にする。

#### エラー
- SSR 失敗
  - エラービューを表示し **リトライ導線** を提供する
- クライアント側の再取得失敗（任意で再フェッチする場合）
  - トーストで通知する

---

### 2.3 `/itineraries/[id]` 詳細・編集

#### 表示
- タイトル
- 日付一覧
- Activities（時刻 / エリア / 任意スポット名 / カテゴリ / 説明 / 滞在目安 / 天気 enum）

#### 編集
- タイトル編集
- 日（Day）の追加
- 行（Activity）の追加・削除
- 並び替え（D&D）

#### 保存
- `PATCH /itineraries/:id`（**version 必須**）
- `onMutate`
  - 楽観更新（ローカルで version を仮に +1）
- `onError`
  - 失敗時は rollback（元の状態へ戻す）し、トースト表示
- `onSuccess`
  - サーバーから返る version を正として反映する

#### 再生成（部分再生成）
- dayIndex 配列を送信し jobId を受領
- `/ai/jobs/:id` をポーリングして完了を待つ
- 表示上の状態:
  - **成功した日：緑**
  - **未生成・失敗：黄**
- 失敗時は再試行導線（再生成ボタン等）を提供する

#### 競合（409）
- 409 を受けたら最新データを再取得する
- 変更差分を提示し、ユーザーが判断して反映できるようにする
- ローカルの編集内容は可能な限り保持する（破棄しない）

---

## 3. API・DTO（入力・出力・ステータス・バリデーション）

本章では、各 API の **入力（DTO）・出力・前提条件・エラーステータス** を明確にする。  
共通レスポンスエラー形式は `{ code, message, details?, correlationId }` とする。

---

### 3.1 認証（Authentication）

#### POST `/auth/register`
- **入力（DTO）**
  - `{ email(email), password(min:8), displayName(1–50) }`
- **出力**
  - `201 Created`
  - `{ id, accessToken }`
- **エラー**
  - `400` バリデーションエラー
  - `409` email 重複
  - `500` 内部エラー

#### POST `/auth/login`
- **入力**
  - `{ email, password }`
- **前提**
  - email / password が一致すること
- **出力**
  - `200 OK`
  - `{ user }`（または `{ accessToken }`）
- **エラー**
  - `401` 認証失敗
  - `400` 不正リクエスト
  - `500` 内部エラー

#### GET `/auth/me`
- **入力**
  - Header: `Authorization: Bearer <JWT>`
- **出力**
  - `200 OK`
  - `{ user }`
- **エラー**
  - `401` 未認証 / トークン無効

---

### 3.2 ドラフト（Draft）

#### POST `/drafts`
- **入力**
  - `CreateDraftDto`
- **処理**
  - 入力内容を検証し、Draft と CompanionDetail をトランザクションで作成
- **出力**
  - `201 Created`
  - `{ id, createdAt }`
- **エラー**
  - `400` バリデーションエラー
  - `401` 未認証
  - `403` 権限不一致
  - `500` 内部エラー

---

### 3.3 生成ジョブ（Generation Job）

#### GET `/ai/jobs/:id`
- **入力**
  - `jobId`
- **出力**
  - `200 OK`
  - `{ status, retryCount, partialDays }`
- **状態**
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
- **エラー**
  - `401` 未認証
  - `403` 権限不一致
  - `404` job 不存在

---

### 3.4 行程（Itinerary）

#### POST `/itineraries`
- **入力**
  - `{ draftId, jobId, title(1–120), days: Day[] }`
  - `Day`
    - `{ date: ISO8601, activities: Activity[] }`
  - `Activity`
    - `{ time: HH:mm, area(1–200), placeName?: string(<=200), category: SpotCategory, description(1–500), stayMinutes?: number(5–1440), weather: enum }`
- **前提**
  - 指定した `jobId` の status が `succeeded`
- **出力**
  - `201 Created`
  - `{ id, version: 1 }`
- **エラー**
  - `409` job 未完了
  - `400` バリデーションエラー（Zod / class-validator）
  - `401` 未認証
  - `403` 権限不一致
  - `500` 内部エラー

#### PATCH `/itineraries/:id`
- **入力**
  - `{ title?, days?, version(required) }`
- **前提**
  - version が最新であること（楽観ロック）
- **出力**
  - `200 OK`
  - `{ version: newVersion }`
- **エラー**
  - `400` バリデーションエラー
  - `401` 未認証
  - `403` 権限不一致
  - `404` 行程不存在
  - `409` version 不一致

#### POST `/itineraries/:id/regenerate`
- **入力**
  - `{ days: number[] }`
- **前提**
  - 対象行程に対して他の生成ジョブが実行中でないこと
- **出力**
  - `202 Accepted`
  - `{ jobId }`
- **エラー**
  - `400` バリデーションエラー
  - `401` 未認証
  - `403` 権限不一致
  - `404` 行程不存在
  - `409` 生成ジョブ実行中

#### GET `/itineraries/:id/print`
- **入力**
  - Path Parameter: `id`
- **出力**
  - `200 OK`
  - 読み取り専用 DTO（印刷・共有用）
- **エラー**
  - `401` 未認証
  - `403` 権限不一致
  - `404` 行程不存在

## 4. データ・Prisma モデル（フィールド粒度）

本章では、shin-travelin における永続データ構造を **Prisma モデル粒度** で定義する。  
履歴性・監査性を重視し、**原則として物理削除・ cascade delete は行わない**。

---

### 4.1 users
- `id` : UUID（PK）
- `email` : string（unique）
- `displayName` : string
- `passwordHash` : string
- `createdAt` : DateTime
- `updatedAt` : DateTime

---

### 4.2 drafts
- `id` : UUID（PK）
- `userId` : UUID（FK → users.id）
- `origin` : string
- `destinations` : string[]（PostgreSQL array）
- `startDate` : Date
- `endDate` : Date
- `budget` : int
- `purposes` : string[]（PostgreSQL array）
- `memo` : string
- `createdAt` : DateTime

※ Draft は生成前の入力スナップショットであり、TTL 管理対象（7 日）。

---

### 4.3 companion_details
- `id` : UUID（PK）
- `draftId` : UUID（unique, FK → drafts.id）
- `companions` : JSON（人数構成。例：adultMale / adultFemale / child 等）

Draft と **1 対 1** の関係。

---

### 4.4 generation_jobs
- `id` : UUID（PK）
- `draftId` : UUID（FK → drafts.id）
- `status` : enum（`queued | running | succeeded | failed`）
- `retryCount` : int
- `partialDays` : int[]（成功した dayIndex のみ）
- `createdAt` : DateTime
- `updatedAt` : DateTime

生成処理の進捗・再試行・部分成功管理を担う。

---

### 4.5 ai_generation_audits
- `id` : UUID（PK）
- `jobId` : UUID（FK → generation_jobs.id）
- `prompt` : text
- `requestJson` : JSONB
- `responseJson` : JSONB
- `status` : enum
- `errorMessage` : string?（nullable）
- `model` : string
- `temperature` : float
- `retryCount` : int
- `correlationId` : string
- `createdAt` : DateTime

LLM 呼び出しの **完全監査ログ**。削除禁止。

---

### 4.6 itineraries
- `id` : UUID（PK）
- `userId` : UUID（FK → users.id）
- `draftId` : UUID（FK → drafts.id）
- `title` : string
- `version` : int（楽観ロック用）
- `createdAt` : DateTime
- `updatedAt` : DateTime

論理削除は行わず、履歴として保持する。

---

### 4.7 itinerary_days
- `id` : UUID（PK）
- `itineraryId` : UUID（FK → itineraries.id）
- `date` : Date
- `dayIndex` : int
- `createdAt` : DateTime

制約：
- `(itineraryId, dayIndex)` を **ユニーク**

---

### 4.8 activities
- `id` : UUID（PK）
- `itineraryDayId` : UUID（FK → itinerary_days.id）
- `time` : string（HH:mm）
- `area` : string（200 文字以内）
- `placeName` : string?（nullable, 200 文字以内）
- `category` : SpotCategory enum（FOOD / SIGHTSEEING / MOVE / REST / STAY / SHOPPING / OTHER）
- `description` : string（500 文字以内）
- `stayMinutes` : int?（nullable, 5–1440 分）
- `weather` : enum
- `orderIndex` : int

制約：
- `(itineraryDayId, orderIndex)` を **ユニーク**

---

#### 4.8.1 2025-12 Spot モデル刷新（URL 廃止）

- **背景**: 旧 `location/url/content` では AI 応答の揺らぎが大きく、URL の死活監視コストや位置情報欠損が発生していた。旅行者が把握したいのは「どのエリアで何をするか」「滞在時間はどれくらいか」であり、URL は MVP 以降に safely augment すべきと判断した。
- **新フィールド**:
  - `area` … 市区町村ベースで土地勘が伝わる粒度（例: 「札幌市中央区」「大阪市浪速区」）。必要に応じて後ろに簡潔な地区ラベルを付けてよい。
  - `placeName?` … 具体施設がある場合のみ設定。ただし `AiPipeline` が `DESTINATION_FALLBACK_LIBRARY`（+ `DESTINATION_PLACE_ALIAS`）で実在性を確認できた名称だけを永続化し、未検証の名称は `null` に落として area だけを表示する。
  - `category` … SpotCategory（FOOD / SIGHTSEEING / MOVE / REST / STAY / SHOPPING / OTHER）
  - `description` … 体験内容 1 文 / 500 文字以内
  - `stayMinutes?` … 5–1440 分の範囲で滞在目安（任意）
- **移行手順**:
  1. Prisma schema を更新し `SpotCategory` を導入、`location/url/content` を置換した migration（`20251217090000_refactor_activity_spots`）を適用する。
  2. NestJS DTO / `persistItineraryGraph` / `itineraries.service` / `ai.pipeline` 正規化ロジックを新フィールドへ差し替える（URL 参照は全削除）。
  3. AI プロンプトとモックプロバイダ（GeminiProvider）を area/placeName/category/stayMinutes を出力するよう更新し、既存のユニットテスト（`generation.flow.spec.ts`）のフィクスチャを再生成する。
  4. フロントエンド（一覧 / 詳細 / 印刷 / RHF schema）を area/placeName/category/description/stayMinutes に合わせて UI を再設計し、URL 入力欄を完全撤去する。
- **補足**: URL が必要になった場合は別テーブル（`activity_links`）で任意に紐づけ、AI からの取得ではなく運営側ハンドブックに寄せる方針とする。
  - **実在保証**: placeName のソースオブトゥルースは `destination-library.ts` で管理する全国カタログのみ。LLM 生成やフォールバックでカタログ外の名称が現れた場合は area-only にダウングレードし、ユーザーへ虚偽の POI を提示しない。

---

### 4.9 itineraries_raws
- `id` : UUID（PK）
- `itineraryId` : UUID（FK → itineraries.id）
- `rawJson` : JSONB（LLM 生レスポンス）
- `promptHash` : string
- `model` : string
- `createdAt` : DateTime

再解析・比較・監査用途のため **削除禁止**。

---

### 4.10 インデックス定義
- `drafts(createdAt)`
- `generation_jobs(status)`
- `itineraries(userId, createdAt DESC)`
- `itinerary_days(itineraryId, dayIndex)`
- `activities(itineraryDayId, orderIndex)`

※ 必要に応じて status 条件付きの partial index を追加検討。

---

### 4.11 参照整合・削除ポリシー
- `cascade delete` は使用しない（監査・履歴保持のため）
- Itinerary / Audit / Raw データは **物理削除しない**
- Draft のみ TTL ジョブにより削除対象とする


#### 簡易コード例（Prisma トランザクション保存）

```ts
// itineraries.service.ts の一部
await this.prisma.$transaction(async (tx) => {
  const itinerary = await tx.itinerary.create({
    data: {
      userId,
      draftId,
      title: dto.title,
      version: 1,
    },
  });

  for (const [dayIndex, day] of dto.days.entries()) {
    const dayRow = await tx.itineraryDay.create({
      data: {
        itineraryId: itinerary.id,
        dayIndex,
        date: day.date,
      },
    });

    await tx.activity.createMany({
      data: day.activities.map((a, orderIndex) => ({
        itineraryDayId: dayRow.id,
        time: a.time,
        area: a.area,
        placeName: a.placeName ?? null,
        category: a.category,
        description: a.description,
        stayMinutes: a.stayMinutes ?? null,
        weather: a.weather,
        orderIndex,
      })),
    });
  }
});
```

## 5. フロー詳細（逐次/並行/例外）

本章では、主要フロー（生成→保存、部分再生成）と、並行実行の抑止・再試行・例外系の扱いを定義する。

---

### 5.1 生成～保存シーケンス（Draft → Job → Itinerary）

1) **POST `/drafts`**
   - 目的：旅行条件（Draft）を保存する
   - 処理：`draft + companion_detail` を **トランザクション（tx）** で作成

2) **POST `/ai/generate`**
   - 目的：生成ジョブを開始する
   - 処理：
     - 実行中ジョブがないことを検査（多重実行防止）
     - `generation_jobs` を `queued` で作成
     - `202 Accepted` で `{ jobId }` を返す
    - 再生成時に渡される `itineraryId` は Draft 所有者と突き合わせ、Draft に紐付かない旅程 ID は `Forbidden` として即座に拒否する。
  - `targetDays` は Draft の日数から外れた値を `[0, dayCount)` の範囲チェックで弾き、`invalidIndexes` を含む `VALIDATION_ERROR` を返す。`normalizeTargetDays` 実装: [backend/src/ai/ai.service.ts](backend/src/ai/ai.service.ts)
  - `overrideDestinations` は前後空白を除去し、重複排除後に最大 5 件へ丸めることで LLM プロンプトを安定化させる。
  - `promptHash`（draftId + model + temperature + targetDays + overrideDestinations）で同一入力を判定し、`SUCCEEDED` 済みのジョブを再利用して無駄な課金を避ける。

3) **`ai.pipeline.run(job)`（バックエンド内部処理）**
   - 3-1) **Draft 取得**：`draftId` から Draft を取得
   - 3-2) **プロンプト生成**
     - 制約例：開始時刻 `>= 09:00`、休憩を含める、日付順に並べる など
   - 3-3) **Gemini 呼び出し**
     - `timeout: 15s`
     - `retries: 3`
     - `backoff: 1s / 3s / 9s`
   - 3-4) **応答パース & 構造検証**
     - `code fence 除去 → JSON.parse → Zod 検証` の順で処理
     - 失敗時：raw を添えて「このJSONをスキーマに合わせて修復せよ」で再試行（最大3回、待機 1/3/9s）
      - 正規化後に `validateAndSanitizeActivities` を実行し、`DESTINATION_FALLBACK_LIBRARY` へ存在する名称のみ placeName を維持する。 alias 変換できない名称は `undefined` にして area のみ提示する。
      - `ensureMinimumActivities` のフォールバックも同カタログを優先し、枯渇した場合は「◯◯周辺の屋内エリア」など area のみのテンプレートで補う（新規 POI 名を生成しない）。
   - 3-5) **部分成功の扱い**
     - 成功した `dayIndex` のみ `partialDays` に保存
     - 失敗した日（未生成日）は残し、再生成対象にできるようにする
   - 3-6) **永続化（tx）**
     - `generation_jobs` を更新（status / retryCount / partialDays / error 等）
     - `ai_generation_audits` に監査ログを追記
     - `promptHash` を保存し、同じ入力条件での結果再利用を検討可能にする
   - 実装補足：`AiPipeline` は **晴天/悪天候ペアの時間帯同期**・**POI 多様性**・**行政区レベルの area 補正** を `normalizeDays`～`preventCrossDayPlaceReuse` で一括担保し、正規化後の JSON（`NormalizedItineraryPayload`）のみをサービス層へ返す: [backend/src/ai/ai.pipeline.ts](backend/src/ai/ai.pipeline.ts)

4) **Job 完了（`status=succeeded`）**
   - フロント側は `GET /ai/jobs/:id` のポーリングで `succeeded` を検知

5) **POST `/itineraries`**
   - 目的：生成結果を正規化して保存する
   - 処理：tx で以下を作成
     - `itineraries`（`version=1`）
     - `itinerary_days`
     - `activities`（`createMany` でまとめて保存）
     - `itineraries_raws`（`rawJson / promptHash / model` を保存）
    - 生成ジョブに既存 `itineraryId` が紐づく場合は `replaceItineraryDays` で対象日のみ差し替え、`version` を +1 しつつ `itinerary_raws` を再構築する: [backend/src/itineraries/itinerary.persistence.ts](backend/src/itineraries/itinerary.persistence.ts)

6) **以降の編集**
   - 編集は `PATCH /itineraries/:id` で更新
   - `409`（version 競合）の場合は再取得し、差分提示の上で再保存する

---

### 5.2 部分再生成フロー（Itinerary → Regenerate Job）

1) UI で対象 `dayIndex[]` を選択  
   → **POST `/itineraries/:id/regenerate`**

2) `202 Accepted` で `{ jobId }` を受領  
   → `GET /ai/jobs/:id` を **ポーリング**（2s → 4s → 8s）

3) ステータス別の処理
- `succeeded`
  - 成功した日だけ差し替える（他の日は維持）
- `failed`
  - 再試行導線を提示する
- `partialDays`
  - 成功日 / 失敗日を区別する（UI 表示：成功=緑、未生成/失敗=黄）

補足：
- `days` パラメータはバックエンド側で Draft の全日数と照合し、範囲外が含まれていれば `details.invalidIndexes` 付き `VALIDATION_ERROR` を返す（`normalizeTargetDays`）。実装: [backend/src/ai/ai.service.ts](backend/src/ai/ai.service.ts)
- フロントの `ItineraryDetailClient` は API から返る `partialDays`・`VALIDATION_ERROR` を `describeTargetDayError` / `parseTargetDayErrorDetails` で解釈し、再生成モーダル内で無効日を自動解除・ハイライトする。実装: [src/features/itinerary/components/ItineraryDetailClient.tsx](src/features/itinerary/components/ItineraryDetailClient.tsx)
- `destinationHints` は入力欄で 3–200 文字にバリデーションしたうえで重複排除し、バックエンドの `overrideDestinations` 正規化と同じ制約下に保つ。

---

### 5.3 リトライとタイムアウト（クライアント・サーバー・DB）

- **フロント fetch**
  - timeout: `10s`
  - retry: `最大3回`（指数バックオフ）
  - `409 / 422` はリトライせず即時失敗
- **ポーリング**
  - 間隔：`2s → 4s → 8s`
  - 上限：`最大 2 分` で打ち切り
- **バックエンド（Gemini）**
  - timeout: `15s`
  - retries: `最大3回`
  - backoff: `1s / 3s / 9s`
- **DB（Prisma）**
  - pool timeout を設定
  - 長時間トランザクションは避ける（createMany でまとめ書き）

---

### 5.4 エラーハンドリング共通フォーマット

共通エラーレスポンス：
`{ code, message, details?, correlationId }`

代表コード：
- AI 系：`AI_PARSE_ERROR` / `AI_RETRY_EXHAUSTED` / `AI_PARTIAL_SUCCESS`
- 楽観ロック：`409` + `currentVersion`
- 認証：`401`
- 認可：`403`
- バリデーション：`400`
- 内部エラー：`500`
---

## 6. フロントエンド実装指針（データ / 状態 / 副作用）

- データ取得
  - 一覧・詳細は **サーバー側で fetch** して初期描画し、必要に応じて **dehydrate → Client hydrate** で React Query に引き継ぐ。
  - 代表的なクエリキー：
    - `['draft', id]`
    - `['ai-job', jobId]`
    - `['itineraries', userId, page, query]`
    - `['itinerary', id]`

- フォーム
  - **RHF + ZodResolver** を標準とする。
  - `onSubmit` で mutation を実行し、失敗時は **最初のエラーフィールドへスクロール**してフォーカスを当てる。

- 楽観更新（保存）
  - `useSaveItinerary` の `onMutate` で **ローカル状態を先に更新**し、`version` を仮に `+1` する。
  - `onError` で rollback（元に戻す）し、トーストで失敗を通知する。
  - `onSuccess` でサーバーから返る `version` を正として反映する。

- エラーハンドリング
  - `shared/api/client.ts` が投げる例外（`{ status, code, message, correlationId }`）を catch し、UI に表示する。
  - `401` はログインダイアログ（またはログイン導線）を表示し、再実行できる状態にする。

- アクセシビリティ
  - `label-for`、`aria-describedby` を付与し、エラー説明とフォーム部品を関連付ける。
  - フォーカス可視化・Enter 送信・Tab 移動を確認し、モーダルはフォーカストラップを適用する。

- 状態管理
  - サーバーデータは React Query を基本とし、**Zustand は編集中のローカル一時状態**（フォーム途中の並び替え等）に限定する。

#### Itinerary 詳細画面の責務分離

- `ItineraryDetailClient` は **コンテナ層**としてポーリング・再生成コマンド・ハイライト状態を管理し、`ItineraryDetailView` に純粋な表示 props を渡す。実装: [src/features/itinerary/components/ItineraryDetailClient.tsx](src/features/itinerary/components/ItineraryDetailClient.tsx)
- 集計・マトリクス化などの派生計算は `buildScenarioMatrix` / `buildSummary` などヘルパに退避し、UI から計算ロジックを切り離す。実装: [src/features/itinerary/components/ItineraryDetail.helpers.ts](src/features/itinerary/components/ItineraryDetail.helpers.ts)
- API で得た JSON は `sanitizeItinerary` で欠損フィールドや null を除去し、日別 ID の重複もここで吸収する。実装: [src/features/itinerary/utils/sanitizeItinerary.ts](src/features/itinerary/utils/sanitizeItinerary.ts)
- scenario/destination ヒントの入力値はコンテナ内で正規化（3–200 文字、最大 5 件）し、再生成 payload でも同じ制約を再利用することで DTO（`RegenerateRequestDto`）との契約ズレを防ぐ。

---

## 7. バックエンド実装指針（品質・安全）

- バリデーション（入口）
  - `ValidationPipe` を共通適用し、以下を有効化する：
    - `whitelist: true`
    - `forbidNonWhitelisted: true`
    - `transform: true`（DTO の型変換）
  - `class-validator` で DTO の **文字数・数値範囲・配列長** を明示する。

- エラー整形
  - `HttpExceptionFilter` により、エラーレスポンスを `code / message / correlationId` 形式に統一する。
  - 未捕捉例外も `500` に包み、レスポンス形式を崩さない。

- ロギング
  - `LoggingInterceptor` で以下を JSON 形式で出力する：
    - `method`, `url/path`, `status`, `latency_ms`, `requestId`, `correlationId`, `userId`

- 認証
  - Passport の `JWT Strategy` を採用し、`/auth` 以外を Guard で保護する。
  - JWT 秘密鍵は環境変数で管理し、`/auth` 系には rate limit を適用する。

- Prisma / 永続化
  - 論理削除は行わない（履歴性は監査テーブルと Raw 保存で担保）。
  - 生成結果の保存など **一貫性が必要な処理のみ** トランザクションを使用する。
  - `activities` は `createMany` でまとめ書きし、長期ロックを避ける。

- 生成ジョブ
  - 初期は **プロセス内実行**（簡易運用）とする。
  - 将来的に Bull 等の Queue を導入し、cron によるハング検知・再実行を追加できる構造にする。


## 8. 非機能・運用

### 8.1 性能（Performance）
- SSR の TTFB は以下を目標とする：
  - 50 パーセンタイル：**1.0 秒未満**
  - 95 パーセンタイル：**1.5 秒未満**
- AI 生成処理は以下を目標とする：
  - 生成完了時間：**90 パーセンタイルで 10 秒以内**
- API 応答性能：
  - **95 パーセンタイルで 300ms 未満**（ネットワーク遅延を除く）

---

### 8.2 可用性（Availability）
- データベース接続失敗時は自動再試行を行う。
- **3 回連続で失敗した場合はサーキットブレーカーを開放**し、15 秒後に半開状態で再試行する。
- 生成処理は `generation_jobs.status` により状態管理し、失敗したジョブは再実行可能とする。

---

### 8.3 セキュリティ（Security）
- 認証方式：
  - JWT（**HttpOnly / Secure / SameSite=Lax**）
- 入力検証：
  - サーバー側で **DTO + Zod** による二重検証を行う。
- 秘密情報：
  - API キーや秘密鍵は **環境変数で管理**し、リポジトリへは一切コミットしない。
- 監査ログ：
  - 個人情報（PII）は監査テーブルに保存しない。

---

### 8.4 運用（Operation）
- 主な環境変数：
  - `DATABASE_URL`
  - `LLM_API_KEY`
  - `CORS_ORIGIN`
  - `SESSION_SECRET`
  - `LOG_LEVEL`
  - `AI_MODEL`
  - `AI_TEMPERATURE`
- CI パイプライン：
  - `.github/workflows/quality-gate.yml` で `pnpm lint:all → pnpm typecheck:all → pnpm test:all → pnpm check:deps → pnpm check:unused → pnpm verify:artifact` を順に実行し、警告でも失敗扱いにする。
  - `prisma migrate deploy` は **本番環境に接続できる CI ステージが整い次第** quality gate の後段に追加する方針（現状は手動適用を Runbook で管理）。
  - README の品質ゲート手順と同一コマンドであることを保証し、ローカル実行と CI の結果が乖離しないようにする。
- ヘルスチェック：
  - `/health` エンドポイントを提供し、疎通確認およびアプリケーションバージョンを返却する。

---

### 8.5 監視（Monitoring）
- 主要メトリクス：
  - `api_latency_ms`
  - `prisma_query_ms`
  - `ai_retry_count`
  - `job_duration_seconds`
  - `ai_failure_rate`
- ログ：
  - 構造化ログ（JSON）で出力し、検索・集計が可能な形式とする。

---

### 8.6 アラート（Alerting）
- 以下の条件でアラートを発報する：
  - **5xx エラー率 > 2%（5 分間）**
  - **AI 生成失敗率 > 10%**
  - **Prisma クエリ 95 パーセンタイル > 500ms**


## 9. ドメイン責務まとめ（属性・不変条件）

本章では、各ドメインオブジェクトが担う責務と、システムとして必ず守られる **不変条件（Invariant）** を整理する。

---

### Draft
- **属性**
  - `origin`
  - `destinations`
  - `startDate / endDate`
  - `budget`
  - `purposes`
  - `memo`
  - `companions`
- **責務**
  - 生成前の旅行条件をスナップショットとして保持する。
- **不変条件**
  - `startDate <= endDate`
  - 作成後は内容を変更しない（生成の再現性確保）。
  - **7 日 TTL** を超えたものは削除対象。

---

### GenerationJob
- **属性**
  - `draftId`
  - `status`
  - `retryCount`
  - `partialDays`
- **責務**
  - AI 生成処理の進捗・再試行・結果状態を管理する。
- **不変条件**
  - `status` は以下の順序でのみ遷移する：  
    `queued → running → succeeded | failed`
  - `partialDays` には **生成に成功した日（dayIndex）のみ** を保持する。

---

### AiGenerationAudit
- **属性**
  - `prompt`
  - `raw`
  - `parsed`
  - `errors`
  - `retryCount`
  - `model`
  - `temperature`
  - `correlationId`
- **責務**
  - LLM 呼び出しの完全な履歴を保持し、後から再解析・検証できるようにする。
- **不変条件**
  - 生レスポンス（raw）は必ず保存する。
  - 監査目的のため **削除・上書きは禁止**。

---

### Itinerary
- **属性**
  - `title`（1–120 文字）
  - `days[]`
  - `version`
- **責務**
  - 正規化された旅行行程を表現し、編集・再生成の基点となる。
- **不変条件**
  - `version` による **楽観ロック**を必須とする。
  - 生成元データは `ItineraryRaw` として生 JSON + `promptHash` を保持する。

---

### Activity
- **属性**
  - `time`
  - `area`
  - `placeName?`
  - `category`
  - `description`
  - `stayMinutes?`
  - `weather`（enum）
  - `orderIndex`
- **責務**
  - 1 日の中の具体的な行動を表現する。
- **不変条件**
  - 表示・保存順序は `orderIndex` によって一意に決まる。
  - 同一日の Activity は `orderIndex` の重複を許可しない。


## 10. テスト観点

本章では、shin-travelin における主要なテスト観点を **フロントエンド / バックエンド** に分けて整理する。  
実装変更時の回帰防止および品質担保のため、これらの観点を最低限カバーする。

---

### フロントエンド

- **フォーム入力**
  - 文字数境界値（最小 / 最大）
  - 件数制約（目的地 1–5 件など）
  - 日付逆転（開始日 > 終了日）
- **送信制御**
  - 送信中に入力・ボタンが disable されること
  - 二重送信が発生しないこと
- **楽観更新**
  - 保存成功時に version が更新されること
  - 保存失敗時に rollback され、元の状態に戻ること
- **競合処理**
  - 409 発生時に最新データを再取得すること
  - 差分提示後もローカル編集内容が保持されること
- **ポーリング**
  - job 完了時に自動停止すること
  - タイムアウト条件（最大時間）で停止すること
- **アクセシビリティ**
  - Tab 移動が論理順であること
  - `aria-*` 属性が正しく付与されていること
  - Enter キーで送信できること

---

### バックエンド

- **DTO / バリデーション**
  - 文字数・数値範囲・配列長の境界値
  - 必須項目欠落時の 400 応答
- **認証・認可**
  - JWT 未付与時に 401 となること
  - 他ユーザーリソースへのアクセスで 403 となること
- **競合制御**
  - Itinerary 更新時の version 不一致で 409 となること
  - 生成ジョブ実行中の再実行で 409 となること
- **AI 生成**
  - Gemini 呼び出しのリトライが上限で停止すること
  - parse / repair 失敗時に `AI_RETRY_EXHAUSTED` となること
  - `partialDays` に成功日のみが保持されること
- **監査ログ**
  - AiGenerationAudit に必須項目（prompt / raw / retryCount / model / correlationId 等）が保存されること
- **トランザクション**
  - Prisma トランザクションが途中失敗時にロールバックされること
  - Draft + Companion、Itinerary + Days + Activities が一貫して保存されること

## 11. テスト設計（詳細網羅）

本章では、テストを **単体 / サービス / インテグレーション / E2E / 回帰** に分けて、網羅すべき観点を具体化する。  
※ 「冪等キー」は表現を避け、以降は **「同一入力の重複実行を防ぐキー」** と記載する。

---

### 11.1 単体テスト（Unit）

- DTO / class-validator（境界値）
  - 文字数：最小 / 最大 / 超過
  - 件数：目的地 1–5 件など（0 件 / 6 件の検証）
  - 日付：開始日 > 終了日（逆転）
  - 同行者：負数、上限超過
  - URL：不正形式 / 空 / 任意項目としての扱い

- Zod スキーマ
  - Draft 入力スキーマ（必須キー / 型 / 範囲）
  - Itinerary スキーマ（day 構造 / activity 配列 / enum など）
  - AI 応答スキーマ（stripCodeFence 後の JSON が検証に通るか）

- promptBuilder
  - 日付展開（start–end の日数計算、dayIndex と date の対応）
  - 必須キーの埋め込み（origin / destinations / budget / purposes / companions 等）
  - 制約反映（開始>=9:00、休憩含む、順序など）

- parser（AI 応答処理）
  - 壊れた JSON の検出
  - 修復プロンプトの適用
  - **最大 3 回で打ち切る**こと（上限到達でエラー化）

---

### 11.2 サービステスト（Service / UseCase）

- `drafts.service`
  - `draft + companion` が **同一 tx で作成される**こと
  - 途中失敗時にロールバックされること

- `ai.service`
  - 実行中ジョブがある場合に **409** を返すこと（多重実行防止）
  - `jobs.status` の遷移が正しいこと（queued → running → succeeded/failed）
  - `partialDays` が成功日のみ保持されること

- `itineraries.service`
  - version 競合で **409** になること
  - 失敗時に rollback されること
  - 部分再生成で **対象日だけ差し替え**されること（他の日は保持）

---

### 11.3 インテグレーションテスト（Integration）

- 対象
  - Controller + Prisma（test DB）
  - HTTP レイヤを通した request/response の整合

- `/ai/generate`
  - Gemini クライアントはモックする
  - ケース網羅：
    - 成功
    - 部分成功（partialDays あり）
    - 失敗
    - リトライ上限到達
    - タイムアウト

- 監査（AiGenerationAudit）
  - 必須列（prompt/raw/parsed/retryCount/model/temperature/correlationId 等）が埋まること
  - エラー時も audit が残ること

---

### 11.4 E2E テスト（Playwright）

- 基本シナリオ
  - ログイン → 条件入力 → 生成 → 保存 → 再編集 → 印刷

- UI 観点
  - アクセシビリティ（tab / enter / aria）
  - 送信中 disable（入力・ボタン）
  - 409 発生後の再取得と差分提示
  - ポーリング停止条件（succeeded/failed/タイムアウト）
  - モバイル幅（レスポンシブで崩れない）

---

### 11.5 回帰テスト（Regression）

- 同一入力の重複実行防止（同じ入力条件で二重生成しない）
- `partialDays` が成功日のみであること
- Audit 記録の必須フィールドが欠けないこと
- JSONB（ItineraryRaw / AiGenerationAudit）の保存が継続して可能であること
- インデックスが存在すること（migration / seed を含む検証）
- TTL ジョブが Draft を期限後に `EXPIRED` 扱い（または削除対象）として処理すること


## 12. プロンプトテンプレートと運用（legacy 参照反映）

本章では、旧 tRavelIN の運用要件（公式サイト URL、晴天/悪天候ペア、近接条件）を踏襲しつつ、shin-travelin で JSON の機械処理（parse / validation）を安定させるためのプロンプト方針と運用ルールを定義する。

---

### 12.1 ベースプロンプト（晴天 / 悪天候 2 系列）

あなたは敏腕の旅行プランナーです。以下の条件に基づいて最適な旅行スケジュールを立ててください。

1. 晴天時の屋外中心スケジュールと悪天候時の屋内中心スケジュールの二つを作成する（晴天に屋内含有は可）。
2. 突然の天候変化に備え、晴天 / 悪天候で目的地は可能な限り近接させる。
3. 旅行開始地点は {{origin}}、目的地は {{destinations}} から選ぶ。開始日は {{startDate}}、終了日は {{endDate}}。
4. 予算は {{budget}} 円、目的は {{purposes}}、同行者は 成人男 {{adultMale}} 人、成人女 {{adultFemale}} 人、男児 {{boy}} 人、女児 {{girl}} 人、幼児 {{infant}} 人、ペット {{pet}} 匹、その他条件「{{notes}}」。
5. 各 activity には `area`（必ず「京都市東山区」「札幌市中央区」のように市区町村レベルで 1–200 文字）、任意の `placeName`、`category`（FOOD/SIGHTSEEING/MOVE/REST/STAY/SHOPPING/OTHER）、`description`（1 文 / 500 文字以内）、`stayMinutes`（5–1440）を含め、URL は書かない。
6. placeName は社内でキュレートした Real POI Catalog（`DESTINATION_FALLBACK_LIBRARY` と alias）を最優先で使用し、該当がない場合でも抽象表現（◯◯周辺のカフェ 等）でなければ自然言語で保持する。判定から漏れた場合のみ area だけで表現する。
7. 同じ日付の SUNNY / RAINY は同一の時間帯スロット数・時刻を共有し、切り替え時に 1:1 対応で比較できるようにする。
8. 出力は次の JSON 形式のみ（余計な文章は不要）：

{
  "title": "〇〇旅行スケジュール",
  "days": [
    {
      "dayIndex": 0,
      "date": "2025-05-01",
      "scenario": "SUNNY",
      "activities": [
        {
          "time": "09:00",
          "area": "〇〇駅周辺",
          "placeName": "〇〇神社",
          "category": "SIGHTSEEING",
          "description": "参拝と散策で朝の雰囲気を楽しむ",
          "stayMinutes": 60,
          "weather": "SUNNY",
          "orderIndex": 0
        }
      ]
    },
    {
      "dayIndex": 0,
      "date": "2025-05-01",
      "scenario": "RAINY",
      "activities": [
        {
          "time": "09:00",
          "area": "駅前屋内モール",
          "placeName": "〇〇ミュージアム",
          "category": "OTHER",
          "description": "屋内展示で天候を気にせず文化体験",
          "stayMinutes": 75,
          "weather": "RAINY",
          "orderIndex": 0
        }
      ]
    }
  ]
}

- 晴雨ペアと近接条件は従来通り維持しつつ、URL ではなくエリア粒度＋カテゴリで比較しやすい JSON に寄せる。

---

### 12.2 プロンプト識別子の保存（再利用と監査）

- プロンプトの同一性を判定するため、以下の入力からハッシュを作成して保存する。
  - draftId
  - dateRange
  - destinations
  - purposes
  - budget
  - companions

- 保存例：
  - promptHash = sha256(draftId + dateRange + destinations + purposes + budget + companions)

- 用途：
  - 監査ログで「どの入力から生成したか」を追跡できるようにする。
  - 同一入力条件で過去に成功した生成結果がある場合は、それを再利用できる設計とし、生成コストを抑制する。

---

### 12.3 応答処理（検証と修復）

- LLM 応答は以下の順序で処理する。
  1. stripCodeFence（```json 等のフェンス除去）
  2. JSON.parse
  3. Zod スキーマ検証

- 検証に失敗した場合は、以下の修復プロンプトを用いて最大 3 回まで再試行する。
  - 待機時間：1 秒 → 3 秒 → 9 秒

The following JSON is invalid. Fix to match schema and output ONLY valid JSON.
<raw>

- 一部の日のみ生成に成功した場合は、成功分のみを partialDays に保持する。
- 以降の再生成は失敗日のみを対象とし、全体再生成を避けてコストを抑える。

---

### 12.4 部分再生成の差分指示

- 特定日のみを再生成する場合は、ベースプロンプトに以下の差分指示を追加する。

Regenerate only these days: [1,2].  
Keep other days unchanged and keep locations nearby between sunny / rainy.

- 目的：
  - 既存の編集済み日程や他日付を保持したまま、必要な日だけを再生成できるようにする。
  - 晴天 / 悪天候ペアの近接条件を再生成時も維持する。


## 13. API 入出力サンプル

### POST /drafts (201)
- req:
  {
    "origin": "東京",
    "destinations": ["京都"],
    "startDate": "2025-01-10",
    "endDate": "2025-01-12",
    "budget": 120000,
    "purposes": ["文化"],
    "companions": {
      "adultMale": 1
    },
    "memo": "寺社巡り"
  }

- res:
  {
    "id": "drv_123",
    "createdAt": "2025-01-01T00:00:00Z"
  }

---

### POST /ai/generate (202)
- req:
  {
    "draftId": "drv_123"
  }

- res:
  {
    "jobId": "job_123",
    "status": "queued"
  }

---

### GET /ai/jobs/:id (200)
- res:
  {
    "status": "succeeded",
    "retryCount": 1,
    "partialDays": [0, 1],
    "error": null
  }

---

### POST /itineraries (201)
- req:
  {
    "draftId": "drv_123",
    "jobId": "job_123",
    "title": "京都2泊",
    "days": [
      {
        "date": "2025-01-10",
        "activities": [
          {
            "time": "10:00",
            "location": "金閣寺",
            "content": "観光",
            "weather": "SUNNY"
          }
        ]
      }
    ]
  }

- res:
  {
    "id": "itn_123",
    "version": 1
  }

---

### PATCH /itineraries/:id (200)
- req:
  {
    "title": "京都2泊(改)",
    "version": 1
  }

- res:
  {
    "version": 2
  }


## 14. ファイル別関数一覧と I/O（責務粒度）

---

### 14.1 フロントエンド（Next.js / FSD 構成）

#### shared/api/client.ts
- 責務: API 通信の単一窓口（timeout / retry / エラー正規化）
- 関数:
  - `apiFetch<T>(url: string, init?: RequestInit): Promise<T>`
- 出力:
  - 正常時: `T`
  - 例外:  
    `{ status, code, message, correlationId }`  
    または `AbortError`（timeout）

---

#### shared/lib/queryClient.ts
- 責務: React Query の共通設定
- 関数:
  - `createQueryClient(): QueryClient`
- 挙動:
  - retry: 5xx のみ最大 3 回
  - backoff: 500ms * 2^n

---

#### features/itinerary/api/
- 責務: 行程ドメインの API I/O + Zod パース
- 関数:
  - `getItinerary(id: string): Promise<ItineraryDto>`
  - `listItineraries(params): Promise<{ items: ItineraryDto[]; page: number; total: number }>`
  - `saveItinerary(id: string, payload): Promise<{ version: number }>`
  - `regenerateItinerary(id: string, days: number[]): Promise<{ jobId: string }>`
- 例外:
  - client.ts の正規化エラーをそのまま throw

---

#### features/ai/hooks/useGenerateItinerary.ts
- 責務: 生成ジョブ開始 + ポーリング制御
- 関数:
  - `mutate({ draftId, targetDays? }): Promise<{ jobId: string; status: JobStatus }>`
- 副作用:
  - `['ai-job', jobId]` クエリを初期化
  - 2s → 4s → 8s の指数バックオフで status を監視

---

#### features/itinerary/hooks/
- `useItinerary(id)`
  - 入力: itineraryId
  - 出力: ItineraryDto
- `useSaveItinerary()`
  - 入力: { id, payload, version }
  - 副作用: 楽観更新（version +1 仮）
- `useRegenerateItinerary()`
  - 入力: { id, days[] }
  - 出力: { jobId }

---

### 14.2 バックエンド（NestJS）

#### backend/src/ai/ai.service.ts
- 責務: 生成ジョブの制御・多重実行防止
- 関数:
  - `enqueue(draftId, targetDays, userId)`
    - 前提: 実行中ジョブなし
    - 処理: job を queued 作成 → pipeline.run()
  - `getStatus(jobId, userId)`
    - 出力: `{ status, retryCount, partialDays }`
    - エラー: 404 / 403

---

#### backend/src/ai/ai.pipeline.ts
- 責務: LLM 呼び出しの一極集中パイプライン
- 関数:
  - `run(job: GenerationJob)`
- 処理:
  - prompt 生成
  - Gemini 呼び出し（timeout / retry）
  - parse → repair → Zod 検証
  - partialDays 判定
  - transaction で job / audit 更新

---

#### backend/src/drafts/drafts.service.ts
- 責務: Draft と Companion の整合生成
- 関数:
  - `createDraft(dto, userId)`
    - 処理: tx で draft + companion 同時保存
  - `findById(id, userId)`
    - 処理: 所有者チェック込み取得

---

#### backend/src/itineraries/itineraries.service.ts
- 責務: 行程の永続化と更新
- 関数:
  - `create(dto, userId)`
    - 前提: job.status === succeeded
    - 出力: `{ id, version: 1 }`
  - `update(dto, userId)`
    - 前提: version 一致
    - 出力: `{ version: newVersion }`
  - `regenerate(id, days, userId)`
    - 処理: 部分生成ジョブ登録

---

### 14.3 責務境界まとめ

- **shared/**: 横断的・技術的関心事（通信・状態管理）
- **features/**: ユースケース単位の I/O と副作用
- **entities/**: 純粋なドメイン型（I/O なし）
- **backend service**: トランザクション・業務ルール
- **ai.pipeline**: LLM 依存処理の隔離・再利用性確保


## 15. エラー設計詳細

### 共通エラーフォーマット
すべての API エラーは以下の形式で返却する。

{
  "code": string,
  "message": string,
  "details"?: object,
  "correlationId": string
}

- code: アプリケーション定義のエラーコード
- message: 人が読める簡潔な説明（UI 表示用）
- details: フィールド別・追加情報（任意）
- correlationId: ログ・監査と突合するための ID

---

### 400 VALIDATION_ERROR
- 内容:
  - DTO / Zod / class-validator による入力不正
- details 例:
  {
    "fieldErrors": {
      "startDate": "開始日は終了日以前である必要があります",
      "destinations": "目的地は最大5件までです",
      "url": "URL形式が正しくありません"
    }
  }
- フロント対応:
  - フィールド下に表示
  - 最初のエラーへスクロール
  - トーストで概要通知

---

### 401 UNAUTHORIZED / 403 FORBIDDEN
- 内容:
  - JWT 失効・未付与（401）
  - 他ユーザーリソースへのアクセス（403）
- フロント対応:
  - トークン破棄
  - ログインモーダル / ログインページへ誘導

---

### 409 CONFLICT
- 種別:
  - VERSION_CONFLICT（Itinerary 更新時）
  - JOB_ALREADY_RUNNING（generate / regenerate）
- payload 例:
  {
    "code": "VERSION_CONFLICT",
    "message": "Itinerary has been updated by another operation",
    "details": {
      "currentVersion": 3
    },
    "correlationId": "corr_123"
  }
- フロント対応:
  - 最新データを再取得
  - 差分があればユーザーに提示
  - ローカル編集中データは保持

---

### 422 UNPROCESSABLE_ENTITY
- 内容:
  - LLM 応答がスキーマ不整合
- code 例:
  - SCHEMA_MISMATCH
  - AI_PARTIAL_SUCCESS（部分成功併用可）
- details 例:
  {
    "partialDays": [0, 1]
  }
- フロント対応:
  - 成功日と失敗日を色分け表示
  - 再生成導線を提示

---

### 424 FAILED_DEPENDENCY / 500 INTERNAL_ERROR
- 種別:
  - AI_RETRY_EXHAUSTED（修復リトライ上限超過）
  - AI_PARSE_ERROR（JSON 修復不能）
  - UPSTREAM_TIMEOUT（Gemini / 外部 API）
- payload 例:
  {
    "code": "AI_RETRY_EXHAUSTED",
    "message": "AI generation failed after retries",
    "details": {
      "partialDays": [0]
    },
    "correlationId": "corr_456"
  }
- フロント対応:
  - エラーメッセージ表示
  - correlationId を添えて再試行案内

---

### 5xx 系（予期せぬ例外）
- 内容:
  - 未捕捉例外・ランタイムエラー
- バックエンド対応:
  - HttpExceptionFilter で捕捉
  - code=INTERNAL_ERROR に正規化
  - スタックトレースはログのみに出力
- フロント対応:
  - 汎用エラートースト
  - 再試行ボタン表示

---



