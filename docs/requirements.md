# shin-travelin 要件定義書

## 0. スコープと前提
- スコープ: 旅行条件入力→AI 生成→編集→保存→再生成→印刷/共有までの Web アプリ。バックエンドは REST API。LLM は Gemini。DB は PostgreSQL。
- 非スコープ: 決済、通知配信、多言語化、マルチテナント、SNS 連携。
- プラットフォーム: Web（SP/PC）。ブラウザは最新 Chromeをターゲット。

## 1. 背景 / 目的

- 技術面接やインターンシップの選考において、実務・選考用に開発したアプリケーションはソースコードを公開できない場合が多く、代替として過去に個人開発した旅行プラン生成アプリケーション **tRavelIN** を紹介していた。
- しかし、アプリケーションとしてのコンセプトや機能の面白さとは対照的に、使用技術がやや古く、アーキテクチャ設計やコード品質の観点で改善の余地がある点が課題であった。
- **shin-travelin** は、tRavelIN の機能を踏襲しつつ、  
  **Next.js 15（App Router）＋ NestJS ＋ Prisma（Driver Adapter）＋ PostgreSQL** を採用して再設計を行い、  
  モダンな技術スタックに基づく **アーキテクチャの改善、UI/UX の向上、生成処理の安定化** を目的として開発する。

## 2. ペルソナと利用シナリオ
- U-01 カップル/夫婦: 2 日旅を生成→晴/雨比較→編集→保存/共有。
- U-02 子連れ家族: 同行者と予算を詳細入力→子ども向けプラン重視→保存。
- U-03 友人グループ: 飲食中心プラン生成→履歴から再編集。
- U-04 ソロ: 1 泊旅を即時生成→必要な日だけ再生成→共有。
- U-05 旅行計画リーダー: ドラフト作成→人数更新→生成→差分確認・再生成。

## 3. 用語
- Draft: 生成前の旅行条件スナップショット（7 日 TTL）。
- GenerationJob: 生成リクエストの実行単位。状態: queued/running/succeeded/failed。
- Itinerary: 正規化された行程。version で楽観ロック。
- ItineraryRaw: LLM 生 JSON。監査/再解析用。
- AiGenerationAudit: プロンプト/応答/再試行/エラーの完全監査。

## 4. 機能要件（MUST / SHOULD / COULD）

### 4.0. 優先度定義
- MUST: 必須要件。満たされない場合、システムは受け入れられない。
- SHOULD: 重要要件。可能な限り満たすべきだが、必須ではない。
- COULD: 望ましい要件。実装できれば良いが、優先度は低い。


### 4.1 画面 / UX 要件（FR）

| ID | 優先度 | 画面 / パス | 内容 |
|----|------|------------|------|
| FR-1 | MUST | `/` | 入力制約：出発地（3–200文字）、目的地（1–5件・各3–200文字）、開始日≦終了日（最大3年以内）、予算（5,000–5,000,000円）、旅行目的（1–5件）、メモ（最大500文字）、同行者人数（各カテゴリ0–20人）。入力エラーは**該当フィールド直下に表示**し、送信時は**最初のエラーフィールドへ自動スクロール**する。 |
| FR-2 | MUST | `/` | 送信時は**ログイン必須**。送信中は入力欄およびボタンを無効化し、ローディング表示を行う。生成開始後は `/itineraries/[id]?jobId=...` へ遷移する。 |
| FR-3 | MUST | `/itineraries` | SSR による旅程一覧表示を行う。データが存在しない場合は空状態 UI を表示する。エラー発生時は再取得（リトライ）導線を提供する。検索条件・ページング状態は URL クエリとして保持する。 |
| FR-4 | MUST | `/itineraries/[id]` | 表示内容：タイトル（1–120文字）、日付、Activity（時刻・エリア・placeName・カテゴリ・内容・滞在目安・天気）。保存時は PATCH を使用し **version を必須**とする。409 発生時は最新データを再取得し、**編集差分をユーザーに提示**する。再生成された部分は視覚的に区別（色分け）して表示する。 |
| FR-5 | SHOULD | `/itineraries/[id]` | 指定した日（dayIndex 配列）単位で部分再生成を行う（API: `POST /itineraries/:id/regenerate`）。生成処理中は再実行不可とする。結果は **生成成功：緑 / 未生成・失敗：黄** として状態を可視化する。 |
| FR-6 | COULD | `/itineraries/[id]/print` | 読み取り専用の印刷向けビューを提供する。OG（SNS共有）対応。編集操作は不可。 |
| FR-7 | MUST | 共通 | アクセシビリティ対応：label-for、aria 属性、フォーカス管理を実装する。**キーボード操作のみで入力・送信・保存が完結可能**であること。 |

---

### 4.2 API 要件（AR）※ 前提条件 / 事後条件を明示

| ID | 優先度 | Method / Path | 前提条件 | 事後条件 / レスポンス |
|----|------|---------------|----------|------------------------|
| AR-1 | MUST | POST `/auth/register` | email、password（8文字以上）、displayName（1–50文字） | ユーザーを新規作成する。email 重複時は 409。成功時は JWT を返却する。 |
| AR-2 | MUST | POST `/auth/login` | email、password | 認証失敗時は 401。成功時は JWT または Cookie を返却する。 |
| AR-3 | MUST | GET `/auth/me` | 有効な JWT | 無効時は 401 を返却し、Cookie 認証の場合は破棄を推奨する。 |
| AR-4 | MUST | POST `/drafts` | CreateDraftDto が妥当 | 開始日が終了日を超える場合は 400。Draft と Companion 情報を **単一トランザクションで保存**する。Draft は TTL 管理対象とする。 |
| AR-5 | MUST | GET `/drafts/:id` | リクエストユーザーと所有者が一致 | 不存在は 404、権限不一致は 403、未認証は 401 を返却する。 |
| AR-6 | MUST | POST `/ai/generate` | Draft の所有者であり、生成処理が未実行 | 生成ジョブをキューに登録する。202 `{ jobId, status }` を返却する。 |
| AR-7 | MUST | GET `/ai/jobs/:id` | 有効な jobId | 200 `{ status, retryCount, partialDays, error? }` を返却する。 |
| AR-8 | MUST | GenerationJob 成功時（`ai.pipeline` 内部処理）※ `POST /itineraries` は 410 を返却 | 対象 job が `succeeded` | サービス側で Itinerary / ItineraryRaw / Audit を自動保存し、初期 version=1 で確定する。フロントエンドからの手動 POST は不要。 |
| AR-9 | MUST | PATCH `/itineraries/:id` | version が最新 | 更新成功時は version をインクリメント。不一致時は 409。 |
| AR-10 | MUST | POST `/itineraries/:id/regenerate` | 他の生成ジョブが未実行 | 再生成ジョブを開始し 202 `{ jobId }` を返却。競合時は 409。 |
| AR-11 | MUST | GET `/itineraries/:id/print` | 認可済みユーザー | 印刷用の読み取り専用 DTO を返却する。 |

---

### 4.3 データ / DB 要件（DB）

| ID | 優先度 | 内容 |
|----|------|------|
| DB-1 | MUST | 正規化構成：User / Draft / CompanionDetail（1対1）/ GenerationJob / Itinerary / ItineraryDay / Activity / ItineraryRaw（1対1）/ AiGenerationAudit（1対多）。 |
| DB-2 | MUST | インデックス：Itinerary（userId, createdAt DESC）、GenerationJob（draftId, status）、Draft（createdAt）、Audit（jobId, createdAt）。 |
| DB-3 | MUST | 生成監査ログとして、prompt・request（JSON）・rawResponse（テキスト）・parsed（JSON）・retryCount・status・errorMessage・model・temperature・correlationId を保存する。 |
| DB-4 | SHOULD | Draft は 7 日経過後に EXPIRED とし、定期ジョブで削除する。GenerationJob / Itinerary / Audit は保持対象とする。 |
| DB-5 | COULD | 同じ入力で繰り返し実行しても結果が変わらないよう、draftId + promptHash + model + temperature に一意制約を設け、再生成時に既存結果を再利用できるようにする。 目的は LLM コスト削減と不要な再生成防止である。 |

---

### 4.4 生成 / AI 要件（AI）

| ID | 優先度 | 内容 |
|----|------|------|
| AI-1 | MUST | 旅程は日単位で生成し、最終的に集約する。生成結果は Zod により day / activity 構造を検証する。 |
| AI-2 | MUST | JSON 構造の解析に失敗した場合は、修復プロンプトを用いて最大 3 回再試行する（待機時間：1秒 / 3秒 / 9秒）。上限到達時は `AI_RETRY_EXHAUSTED` とする。 |
| AI-3 | MUST | 一部の日のみ生成に成功した場合でも結果を保持し、成功日を partialDays として保存する。再生成は失敗日のみ対象とする。 |
| AI-4 | MUST | すべての生成処理について、promptHash・raw レスポンス・parsed 結果・retryCount・error・correlationId・model・temperature を監査ログに保存する。 |
| AI-5 | SHOULD | 同じ入力ハッシュ（draftId+promptHash+model+temperature）で成功済みの生成結果がある場合は、新規生成を行わずその結果を再利用する。 |
| AI-6 | COULD | 禁止・不適切なコンテンツを検知した場合は、ガード用プロンプトを用いて再生成する。 |
| AI-7 | SHOULD | LLM 応答は `code fence 除去 → JSON.parse → Zod 検証` の順で処理する。失敗時は「スキーマに適合するよう修復せよ」という再プロンプトで再試行し、partialDays と同じ入力ハッシュを活用してコストを抑制する。 |

---

### 4.5 エラー / 異常系（ER）

| ID | 内容 |
|----|------|
| ER-1 | バリデーションエラー：400 + details を返却し、UI は該当フィールドへフォーカスする。 |
| ER-2 | 認証エラー：401。UI はログイン導線を表示し、認証 Cookie は破棄する。 |
| ER-3 | 競合エラー：409（version 不一致 / 生成ジョブ競合）。レスポンスには currentVersion や jobStatus を含める。 |
| ER-4 | 再試行上限到達：`AI_RETRY_EXHAUSTED` + correlationId を返却。UI は ID コピーと再生成ボタンを提供する。 |
| ER-5 | 部分成功：`AI_PARTIAL_SUCCESS` と partialDays を返却する。 |
| ER-6 | 想定外エラー：500 + correlationId を返却する。 |

---

## 5. 非機能要件（N）( 現時点では目標値ベース )

| ID | 分類 | 要件 |
|----|------|------|
| N-1 | 性能 | SSR TTFB：50 パーセンタイル < 1.0 秒、95 パーセンタイル < 1.5 秒。API 応答は 95 パーセンタイル < 300ms（NW 除外）。生成処理は 90 パーセンタイル < 10 秒、LLM 呼び出しは 30 秒でタイムアウト。 |
| N-2 | 可用性 | API 月間稼働率 99%。DB 接続失敗時は再試行し、3 連続失敗でサーキットブレーカーを開放（半開まで 15 秒）。 |
| N-3 | セキュリティ | JWT は HttpOnly / Secure / SameSite=Lax を設定。/auth 系 API にレートリミットを適用。入力値は DTO + Zod で検証する。 |
| N-4 | 監視 / ログ | 構造化ログに requestId、userId、method、path、status、latency、correlationId を含める。主要メトリクスを収集する。 |
| N-5 | 運用 | 環境変数で設定を管理（DATABASE_URL 等）。CI では lint → test → prisma migrate deploy を実行。`/health` エンドポイントで疎通確認可能とする。 |
| N-6 | UX | モバイルファースト設計。入力検証は blur / submit 時に実行。ローディング・再試行 UI を提供し、correlationId をユーザーに表示する。 |


## 6. 受け入れ基準

### 6.1 正常系
- 主要フロー: ログイン済みで入力→「生成」→10s 以内にプラン表示し /itineraries/[id] へ遷移。
- 編集: 一覧から選択→タイトルと 1 行編集→保存→version が +1 され再取得と一致。
- 認証: 未ログインで /itineraries へ遷移しようとするとログインモーダルが出る。

### 6.2 異常系
- 生成失敗: 壊れた JSON で 3 回再試行→失敗→AI_RETRY_EXHAUSTED と correlationId 表示、再生成ボタン有り。
- 部分成功: 3 日中 2 日成功で partialDays=[0,1]、未生成日を黄表示。監査に残る。

### 6.3 最適化 / 再利用
- 同じ入力での再実行: 同一 draftId/promptHash/model/temperature で成功済みがある場合、新規生成せず既存結果を返す設定が可能。

## 7. データ品質と監査
- AiGenerationAudit に prompt/raw/parsed/retryCount/error/model/temperature/correlationId を保存し再解析可能にする。
- ItineraryRaw に LLM 生 JSON と promptHash を保存し、比較・再生成の根拠を保持。
- 監査テーブルは削除禁止。バックアップは 24h ごと。

## 8. リスク・未決事項
- LLM コスト/レイテンシ変動への対応（将来キュー化）。
- OpenAPI→フロント型生成(orval 等)の導入有無。
- コンテンツフィルタ強度（宗教・医療・児童配慮）の閾値設定。
- マルチリージョン冗長化は現段階で対象外。


