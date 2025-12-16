# 旧 tRavelIN と shin-travelin の違い・改善点まとめ

本章は **技術面接・チーム内共有で「一目で違いが伝わる」** ことを目的に、旧 tRavelIN と shin-travelin の差分を観点別に整理する。

---

## 1. UI / UX の違い

### 旧 tRavelIN
- 静的 HTML + JavaScript 構成
- 状態管理は **localStorage 依存**
- 入力チェックが曖昧
  - 目的地件数・文字数の上限が不明確
  - 日付・予算の境界条件が未定義
- エラー通知は `alert` のみ
- 並び順や編集中状態の仕様が弱い
- 印刷・共有向け画面が存在しない
- アクセシビリティ考慮なし

### shin-travelin
- **Next.js App Router** による SSR + Client 構成
- **RHF + Zod** による入力制約の明文化
  - 目的地：1–5 件 / 各 3–200 文字
  - 日付範囲、予算下限・上限を明示
- エラー表現を改善
  - フィールド直下エラー + トースト表示
- 並び順を `orderIndex` で永続管理
- **印刷専用ビュー** `/itineraries/[id]/print` を提供
- 部分再生成結果を **色分け表示**（成功 / 未生成）
- **アクセシビリティ対応**
  - aria 属性
  - フォーカストラップ
  - キーボード操作対応

---

## 2. API 設計の差異

### 旧 tRavelIN
- **Node + Flask に分散した API 構成**
  - 責務境界が不明確で、全体像を把握しづらい
- **認証・認可がほぼ存在しない**
  - ユーザー単位のアクセス制御なし
- **ドラフト保存 API が分断**
  - `/save-schedule` と `/save-companions` に分かれており、
    片方だけ成功するなど **整合性が崩れるリスク** があった
- **LLM 呼び出しが非構造化**
  - スキーマ検証なしで生 JSON をそのまま返却
  - パース失敗時の再試行・エラー分類なし

---

### shin-travelin
- **NestJS に API を統合**
  - Controller / Service / Prisma の明確なレイヤ構造
- **JWT による認証・認可を必須化**
  - userId スコープでリソースアクセスを制御
- **ドラフト保存の一貫性を保証**
  - `POST /drafts` で **Draft + CompanionDetail をトランザクション一括保存**
- **非同期生成ジョブモデルを導入**
  - `/ai/generate` → `jobId` 発行
  - `/ai/jobs/:id` でステータスをポーリング
- **旅程 API を体系化**
  - `/itineraries` に CRUD を集約
  - `version` による **楽観ロック** を実装
- **LLM 入出力の安全性を強化**
  - Zod による JSON スキーマ検証
  - 解析失敗時の自動再試行（1s / 3s / 9s）
  - 一部成功を許容し、`partialDays` として保持

---


## 3. DB モデルの差異

### 旧 tRavelIN
- **DB**: MySQL
- **ユーザー管理**
  - `user_master` に **平文パスワード** を保存
  - セキュリティ設計が不十分
- **旅程データ構造**
  - `tentative_schedule` と `travel_companion` の **1:1 関係が保証されていない**
  - 途中状態と確定状態の境界が曖昧
- **確定旅程**
  - `confirmed_schedule` に **長文 JSON をそのまま格納**
  - 日・アクティビティ単位の正規化なし
- **パフォーマンス・保守性**
  - インデックスは `user_id` 程度のみ
  - 検索性・拡張性が低い
  - JSON 構造変更に弱い

---

### shin-travelin
- **DB**: PostgreSQL + Prisma
- **正規化されたドメインモデル**
  - User
  - Draft
  - CompanionDetail
  - GenerationJob
  - AiGenerationAudit
  - Itinerary
  - ItineraryDay
  - Activity
  - ItineraryRaw
- **データ整合性と同時編集耐性**
  - `Itinerary.version` による **楽観ロック**
  - `UNIQUE(itineraryId, dayIndex)` による日単位の一意性保証
- **AI 生成向けの設計**
  - `promptHash` により **同一入力の再利用・重複生成防止**
  - `partialDays` により **部分成功を明示的に管理**
  - `ItineraryRaw` に **LLM 生 JSON（JSONB）を保持**し再解析可能
- **制約による品質担保**
  - Activity の時刻・文字長に CHECK 制約
  - `retries >= 0`
  - `promptHash NOT NULL`
  - JSONB 型チェック
- **インデックス設計**
  - `(draftId, status)`
  - `(userId, createdAt DESC)`
  - `(itineraryId, dayIndex)`
  - 生成ジョブ・一覧取得を想定した設計

---

### 差異の要点まとめ
- **旧**: 「JSON を保存するだけの DB」
- **新**: 「編集・再生成・監査・並行操作まで考慮した DB」

shin-travelin では、**生成系アプリに必要な「再現性・安全性・拡張性」** を DB レイヤから担保している。


## 4. 生成フローの差異

### 旧 tRavelIN
- **流れ**
  - tentative 保存 → Flask が取りまとめ → **1 回のプロンプト**で長文 JSON を生成させる想定
- **課題**
  - **検証なし**（JSON 形式・必須項目・型の保証がない）
  - **再試行なし**（失敗したらそのまま終了）
  - **部分成功なし**（一部成功でも全体失敗扱い）
  - **監査ログなし**（プロンプト・応答・失敗理由を追えない）
  - 失敗時の **再現性が低い**（原因特定・改善が難しい）

---

### shin-travelin
- **バックエンド生成パイプライン**
  1. Draft 取得
  2. `promptBuilder` でプロンプト生成
  3. Gemini 呼び出し
     - **timeout: 15s**
     - **retry: 最大 3 回（指数バックオフ）**
  4. 応答処理（堅牢化）
     - `stripCodeFence` → `JSON.parse` → **Zod 検証**
  5. 解析失敗時の回復
     - **修復プロンプト**で最大 3 回再試行
  6. **部分成功の保持**
     - 成功した日だけ `partialDays` に記録して先行保存
  7. **状態管理と監査**
     - `GenerationJob` で状態（queued/running/succeeded/failed）を管理
     - `AiGenerationAudit` に `request/raw/parsed/status/retryCount/error` を記録

- **フロント側の監視と確定保存**
  - `GET /ai/jobs/:id` を **2 → 4 → 8 秒**でポーリング
  - **成功後に** Itinerary を正規化して保存（Day/Activity へ分解 + Raw JSON 保持）

---

### 差異の要点まとめ
- **旧**: 「一発生成に賭ける」→ 失敗すると原因も結果も残らない
- **新**: 「生成をパイプライン化」→ **検証・回復・部分成功・監査**で安定運用できる


## 5. 旧 → 新で強化された品質・安全性

### 全体比較サマリ

| 観点 | 旧 tRavelIN | shin-travelin（新） |
|---|---|---|
| 認証 / 認可 | ほぼ未実装 | **JWT 認証 + Guard による API 保護** |
| 入力検証 | 画面・APIともに弱い | **DTO + ValidationPipe / Zod** による厳密検証 |
| データ整合性 | 1:1 関係や制約が曖昧 | **トランザクション保存 / UNIQUE / CHECK 制約** |
| 競合制御 | なし | **version による楽観ロック** |
| 生成の再実行制御 | なし | **重複生成防止 + 再利用** |
| 監査 / 可観測性 | なし | **監査テーブル + 構造化ログ + メトリクス** |
| エラー設計 | 500 / alert 依存 | **統一エラーフォーマット** |
| 障害耐性 | 失敗＝即終了 | **再試行・部分成功・状態管理** |

---

### 5.1 認証・認可の強化
- **旧**
  - 認証・認可の概念がほぼなく、API は事実上オープン
- **新**
  - JWT 認証を必須化
  - NestJS Guard により `/auth` 以外を保護
  - userId スコープで Draft / Itinerary / Regenerate を厳密制御

---

### 5.2 データ整合性の強化
- **旧**
  - テーブル間の 1:1 / 1:N 関係が暗黙的
  - 保存順序や部分失敗により不整合が起きやすい
- **新**
  - Draft + Companion、Itinerary + Day + Activity を **トランザクション保存**
  - DB レベルで整合性を保証
    - UNIQUE 制約
    - CHECK 制約（文字長、時刻形式など）
  - **version カラムによる楽観ロック**で同時編集を安全に処理

---

### 5.3 監査・可観測性の強化
- **旧**
  - 生成処理の中身や失敗理由が残らない
- **新**
  - `AiGenerationAudit` に以下を保存
    - prompt / raw response / parsed / retryCount / error / model / temperature
  - 構造化ログに `correlationId` を付与
  - メトリクスで以下を可視化
    - 生成失敗率
    - リトライ回数
    - ジョブ滞留時間

---

### 5.4 エラー応答設計の改善
- **旧**
  - ほぼ 500 固定
  - フロントは `alert()` 依存
- **新**
  - すべての API が以下の形式で返却
    ```json
    {
      "code": "ERROR_CODE",
      "message": "human readable message",
      "details": {},
      "correlationId": "xxxx"
    }
    ```
  - UX 改善（ユーザー向け）とデバッグ容易性（開発者向け）を両立

---

### 5.5 生成フローの堅牢化
- **旧**
  - 同じ条件で何度でも生成が走る
  - LLM 失敗時の回復手段なし
- **新**
  - `promptHash` により
    - **同一入力の重複生成を防止**
    - **成功済み結果を再利用**
  - LLM 呼び出しは
    - 指数バックオフ（1 / 3 / 9 秒）
    - 最大 3 回再試行
  - 生成失敗・部分成功・完全成功を **状態として管理**

---
## 6. ソースコード品質の比較（旧 tRavelIN / shin-travelin）

本章では、**実際のソースコード品質・実装姿勢**という観点で  
旧 tRavelIN と shin-travelin を比較する。  
shin-travelin 側は「改善を前提にした設計・実装方針」を明示する。

---

### 6.1 全体比較サマリ（コード品質視点）

| 観点 | 旧 tRavelIN | shin-travelin（改善前提） |
|---|---|---|
| 認証・認可の扱い | ほぼ未実装。`user_id` をリクエストで自由指定 | **JWT 前提。userId はトークン由来のみ** |
| 入力検証 | ほぼなし | **DTO + class-validator / Zod による厳密検証** |
| データ保存 | API 分割・非トランザクション | **ユースケース単位で tx 一括保存** |
| データ構造 | 長文 JSON を丸ごと保存 | **正規化 + Raw JSON を分離保持** |
| エラー処理 | 500 / alert 依存 | **統一エラー形式 + エラーコード** |
| LLM 呼び出し | 無防備（検証・再試行なし） | **timeout / retry / schema 検証 / 修復** |
| ログ・監査 | ほぼなし | **構造化ログ + 監査テーブル** |
| HTTP 設計 | POST 乱用、コード曖昧 | **REST 準拠・ステータス厳密化** |

---

### 6.2 認証・認可まわりのコード品質

- **旧 tRavelIN**
  - 認証チェックがなく、API は事実上オープン
  - `user_id` を body / query で自由指定可能
  - セキュリティ境界がコード上に存在しない

- **shin-travelin（改善前提）**
  - JWT Strategy + Guard を共通適用
  - **userId は必ず JWT payload から取得**
  - Controller では userId を引数に取らず、Service 層で注入
  - 認可ロジックが明確にコード上に表現される

---

### 6.3 入力検証・境界値の扱い

- **旧 tRavelIN**
  - 文字長・件数・日付・人数チェックなし
  - 負数や極端値がそのまま DB に入る
  - 「想定外入力＝即バグ」なコード構造

- **shin-travelin（改善前提）**
  - Backend: DTO + class-validator
  - Frontend: RHF + Zod
  - ValidationPipe により
    - whitelist
    - forbidNonWhitelisted
    - transform
  - **境界値がコードとして可視化される**

---

### 6.4 データ保存・トランザクション設計

- **旧 tRavelIN**
  - Draft / Companion が別 API
  - 非トランザクションで保存
  - 途中失敗で不整合が残る

- **shin-travelin（改善前提）**
  - `/drafts` で Draft + Companion を tx 保存
  - Itinerary 保存も
    - Itinerary
    - ItineraryDay
    - Activity
    を **1 トランザクション**
  - Service 層に「ユースケース単位の責務」を集約

---

### 6.5 データ構造と更新容易性

- **旧 tRavelIN**
  - confirmed_schedule に巨大 JSON を丸ごと保存
  - 検索・部分更新・差分比較が困難
  - コード変更＝既存データ破壊のリスク

- **shin-travelin（改善前提）**
  - 正規化モデル（Itinerary / Day / Activity）
  - 生 JSON は ItineraryRaw に分離
  - **更新・再生成・差分提示がコードで自然に書ける**

---

### 6.6 LLM 呼び出しと生成処理の安全性

- **旧 tRavelIN**
  - スキーマ検証なし
  - 再試行なし
  - タイムアウトなし
  - Flask API にも認証なし

- **shin-travelin（改善前提）**
  - ai.pipeline に生成処理を一極集中
  - Gemini 呼び出しは
    - timeout
    - retry（指数バックオフ）
  - 応答は
    - strip code fence
    - JSON.parse
    - Zod 検証
  - 修復プロンプトで最大 3 回再試行
  - **部分成功を partialDays として保持**

---

### 6.7 エラー処理・デバッグ容易性

- **旧 tRavelIN**
  - 500 / alert 依存
  - 失敗理由がログから追えない

- **shin-travelin（改善前提）**
  - 共通エラーフォーマット
    ```json
    { "code", "message", "details?", "correlationId" }
    ```
  - correlationId をログ・レスポンスに含める
  - **ユーザー向け UX と開発者向けデバッグを分離**

---

## 7. まとめ（旧 tRavelIN → shin-travelin の改善ポイント総括）

### 7.1 一言で言うと
- **旧 tRavelIN**：プロトタイプ志向（「動く」優先）で、運用・安全・保守の前提が薄い
- **shin-travelin**：プロダクション志向（「壊れない・追える・直せる」優先）で、生成系に必要な再現性と監査性を備える

---

### 7.2 改善の軸（5 つの観点）
1. **UI/UX**
   - 入力制約を明文化し、エラーをユーザーが理解できる形に統一
   - 印刷ビューや部分再生成の状態表示を追加し、体験の完成度を上げた

2. **API 設計**
   - Node/Flask 分散を解消し NestJS に統合
   - JWT 認証・認可を前提に、Draft→Job→Itinerary を一貫した REST として整理
   - version による楽観ロックで「同時編集に耐える API」に移行

3. **DB / データモデル**
   - JSON 保存中心から、**正規化（Itinerary/Day/Activity）+ Raw JSONB 保持**へ
   - 制約（UNIQUE/CHECK）とインデックスを設計し、検索性・保守性・品質を底上げ
   - promptHash / partialDays をデータとして持ち、生成特有の要件を DB で支える

4. **生成フロー**
   - 一発生成依存から、**パイプライン化（検証→修復→再試行→部分成功→監査）**へ
   - GenerationJob と AiGenerationAudit によって状態管理・原因追跡・再現性を確保
   - フロントは job ポーリングで UX を破綻させずに非同期処理を扱える

5. **コード品質・運用性**
   - 入力検証、例外整形、構造化ログ、メトリクス、アラートを前提として設計
   - 失敗や不正入力を「想定外」ではなく「想定内」に落とし込み、運用品質を上げた

---

### 7.3 shin-travelin が満たす実務要件（面接での言い換え）
- **安全性**：JWT + Guard + 検証（DTO/Zod）で境界を固定
- **整合性**：トランザクションと制約で「壊れない保存」
- **再現性**：監査（prompt/raw/parsed/correlationId）で「後から追える」
- **安定性**：timeout/retry/partial success で「生成が止まらない」
- **保守性**：責務分離（Controller/Service/Repo）と正規化で「直しやすい」

---

### 7.4 結論
shin-travelin は、旧 tRavelIN の課題（認可不足、検証不足、不整合、生成失敗の追跡不能）を踏まえ、**生成系アプリに必須の “安全性・安定性・再現性・拡張性” を、UI / API / DB / 生成フロー / 運用の各層で具体的に実装可能な形へ落とし込んだ刷新版**である。




