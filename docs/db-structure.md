# DB構成概要

## 0. 目的と対象
- PostgreSQL + Prisma で実装する最終スキーマを示す。Draft/Itinerary/AI 生成系を含む全テーブルの構成・制約・リレーションを記載する。

## 1. 技術スタックと配置
- DB: PostgreSQL（docker-compose の db サービスを想定）。
- ORM: Prisma Client JS。ジェネレーターは `generator client { provider = "prisma-client-js" }`。
- スキーマ定義: `backend/prisma/schema.prisma`。
- マイグレーション: `backend/prisma/migrations/` 配下。

## 2. テーブル構成

### 2.1 User
- 列: `id`, `email`(UNIQUE), `passwordHash`, `displayName`, `createdAt`, `updatedAt`。
- 関連: 1:N Draft, 1:N Itinerary。

### 2.2 Draft
  `id`, `userId` FK, `origin`, `destinations`(string[]),  
  `startDate`, `endDate`, `budget`, `purposes`(string[]),  
  `memo?`, `status`(ACTIVE/EXPIRED), `createdAt`, `updatedAt`。
- 関連: 1:1 CompanionDetail、1:N GenerationJob、1:N Itinerary。

### 2.3 CompanionDetail
- 目的: 同行者情報の正規化。
- 列:  

### 2.4 GenerationJob
- 列:  
  `id`, `draftId` FK,  
  `status`(QUEUED/RUNNING/SUCCEEDED/FAILED),  
  `retryCount`(default 0), `partialDays`(int[] default []), `targetDays`(int[] default []),  
- 関連:  
  - 1:N AiGenerationAudit  
  - Itinerary との任意の 1:1（生成結果との紐付け、`itineraryId` UNIQUE）

### 2.5 AiGenerationAudit
- 目的: LLM 呼び出しと応答の監査ログ。
- 列:  
  `id`, `jobId` FK, `correlationId`,  
  `prompt?`, `request`(jsonb?), `rawResponse`(text?), `parsed`(jsonb?),  
  `status`, `retryCount`(default 0), `errorMessage?`, `model?`, `temperature?`,  
  `createdAt`, `updatedAt`。
- 運用:
  - DELETE 禁止
  - `createdAt` による月次パーティションを検討

### 2.6 Itinerary
- 目的: 旅程本体。
- 列:  
  `id`, `userId` FK, `draftId` FK,
  `title`, `version`(楽観ロック),
  `createdAt`, `updatedAt`。
- 関連: 1:N ItineraryDay、1:1 ItineraryRaw、GenerationJob との任意の 1:1（`GenerationJobItinerary` リレーション）。

### 2.7 ItineraryDay
- 目的: 旅程の 1 日単位表現。
- 列:  
  `id`, `itineraryId` FK,  
  `dayIndex`(0-based), `date`(Date), `scenario`(DayScenario, default SUNNY), `createdAt`, `updatedAt`。
- 制約:  
  `UNIQUE(itineraryId, dayIndex, scenario)`。

### 2.8 Activity
- 目的: 1 日の中のアクティビティ。
- 列:  
  `id`, `itineraryDayId` FK,  
  `time`(HH:mm), `area`, `placeName?`,  
  `category`(SpotCategory), `description`, `stayMinutes?`,
  `weather`(Weather), `orderIndex`, `createdAt`, `updatedAt`。
- 制約:
  - `CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$')`
  - `UNIQUE(itineraryDayId, orderIndex)` で並び順を固定

-### 2.9 ItineraryRaw
- 目的: LLM 生成の元 JSON を保持し、再解析・監査を可能にする。
- 列:  
  `id`, `itineraryId`(UNIQUE FK),  
  `rawJson`(jsonb), `model`, `promptHash`, `createdAt`, `updatedAt`。
- 制約:
  - `CHECK (jsonb_typeof(rawJson) = 'object')`
  - `promptHash` NOT NULL

### 2.10 Enum 定義
- `Weather`: `SUNNY`, `RAINY`, `CLOUDY`, `UNKNOWN`
- `DayScenario`: `SUNNY`, `RAINY`
- `SpotCategory`: `FOOD`, `SIGHTSEEING`, `MOVE`, `REST`, `STAY`, `SHOPPING`, `OTHER`


## 3. リレーションと整合性（最終）

- User 1:N Draft  
- User 1:N Itinerary  

- Draft 1:1 CompanionDetail  
- Draft 1:N GenerationJob  
- GenerationJob 1:N AiGenerationAudit  

- Draft 1:N Itinerary  
- Itinerary 1:N ItineraryDay  
- ItineraryDay 1:N Activity  
- Itinerary 1:1 ItineraryRaw  

- 外部キー制約は **履歴保持を最優先** とし、`ON DELETE CASCADE` は原則使用しない  
  （削除はアプリケーション制御、もしくは論理削除／TTL ジョブで対応）

---

## 4. 制約・インデックス（最終）

### Draft
- インデックス:
  - `(userId)`
  - `(status, createdAt)`

### GenerationJob
- インデックス:
  - `(draftId, status)`
  - `(status)`
- 一意制約（冪等・再利用用）:
  - `UNIQUE(draftId, model, temperature, promptHash)`
  - `UNIQUE(itineraryId)`
- CHECK 制約:
  - `CHECK (retryCount >= 0)`

### Itinerary
- インデックス:
  - `(userId, createdAt)`
  - `(draftId)`

### ItineraryDay
- 制約:
  - `UNIQUE(itineraryId, dayIndex, scenario)`

### Activity
- インデックス:
  - `(itineraryDayId, orderIndex)`
- 制約:
  - `UNIQUE(itineraryDayId, orderIndex)`

### ItineraryRaw
- CHECK 制約:
  - `CHECK (jsonb_typeof(rawJson) = 'object')`

### AiGenerationAudit
- 運用制約:
  - `createdAt` での **月次パーティション化を検討**
  - DELETE / TRUNCATE 禁止（監査要件）
- インデックス:
  - `(jobId, createdAt)`

## 5. 移行と運用メモ

- **マイグレーション**
  - `prisma migrate dev` / `prisma migrate deploy` により本スキーマを適用する。
  - 既存の `Trip` テーブル（旧 tRavelIN 由来）は廃止対象とし、必要に応じて移行スクリプトで新スキーマへ変換する。

- **シード / ETL**
  - 旧システムの JSON 旅程データは、そのまま `ItineraryRaw.rawJson` に保存する。
  - `ItineraryDay` / `Activity` は、
    - 既存 JSON をパースして変換する、もしくは
    - 新 AI 生成によって再生成する
    のいずれかで補完する。
  - ETL はトランザクション内で実行し、部分失敗時はロールバックする。

- **TTL / クリーンアップ**
  - Draft は作成から 7 日経過後に `status = EXPIRED` とする定期ジョブを実行する。
  - GenerationJob の不要データは `status` と `finishedAt` を基準に整理するが、監査要件を満たす範囲で保持期間を定める。

- **バックアップと監査**
  - DB は日次スナップショットバックアップを取得する。
  - `AiGenerationAudit` および `ItineraryRaw` は削除禁止とし、監査証跡として永続的に保持する。
  - メトリクス（生成失敗率・レイテンシ等）と構造化ログを用いた監視を導入する。


## 6. 補足コード例

- **Prisma インデックス作成シード例**

```ts
// prisma/seed-index.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_generation_jobs_status ON "GenerationJob" ("status")'
  );
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS idx_itineraries_user_created ON "Itinerary" ("userId", "createdAt" DESC)'
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- **旧 → 新 ETL の簡易例**

```ts
// scripts/etl-move-one.ts
const mysqlRow = await oldDb.query(
  'select * from confirmed_schedule where schedule_id=?',
  [id]
);

const parsed = JSON.parse(mysqlRow.json_text);

await prisma.$transaction(async (tx) => {
  const itinerary = await tx.itinerary.create({
    data: {
      userId: mapUser(mysqlRow.user_id),
      title: parsed.title,
      version: 1,
    },
  });

  await tx.itineraryRaw.create({
    data: {
      itineraryId: itinerary.id,
      rawJson: parsed,
      model: 'legacy',
      promptHash: 'legacy-import',
    },
  });
});
```