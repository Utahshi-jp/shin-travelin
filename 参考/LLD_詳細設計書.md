# kubell コーディング課題 詳細設計書

## 0. ドキュメント情報

### ドキュメント目的
本プロジェクトは技術面接の課題のため、小林聖弥のみが作成・利用するものであるが、実務の開発を意識し、チームでの開発時にも利用できるような形式で作成する。

### 対象読者
- 小林聖弥（開発者）
- 技術面接官（レビュアー）

---

## 1. システム概要

### 課題概要
本システムは、ユーザーが入力した「現在日時」と「観覧者の構成（一般・未成年・シニア）」を元に、課題上で提供された上映スケジュールと料金体系から**最も安価に観覧可能な上映回を算出し提示する料金最適化システム**である。

料金計算では通常料金および各種割引（ファーストデイ／レイトショー／平日シニア割）を適用する。
複数の上映回が同額となる場合は最も早い上映回を選択し、未成年が含まれる場合は20時以降の上映回を候補外とする。

### 本システムのゴール
- ユーザーが指定した条件に基づき、最安値の上映日時と料金を提示すること。
- 各種割引条件を正確に適用し、料金計算の信頼性を確保すること。
- ユーザーの条件に合致する上映回が存在しない場合、適切なメッセージを表示すること。
- シンプルで直感的なUIを提供し、ユーザーが容易に情報を入力・取得できること。

### スコープ
- **実装する範囲**：料金シミュレーション機能および簡易的なUI
- **設計のみとする範囲**：予約管理機能、座席選択機能、および管理者向け機能

### 前提・制約
- ブラウザ上で動作するSPA（Single Page Application）として実装する。
- 外部APIやデータベースは使用せず、メモリ内データ構造で上映スケジュールと料金体系を管理する。


- **プロジェクト名**：映画料金最適化システム
- **作成者名**：小林聖弥
- **作成日**：2025年11月23日

### システム概要
映画館の料金シミュレーターを基に、ユーザーが指定した条件に最も適した上映日時と料金を計算・提示するシステム。ユーザーは大人、未成年、シニアの人数を入力し、システムは各種割引や特典を考慮して最適な上映日時と料金を算出する。

---

## 2. アーキテクチャ設計（レイヤ構成）

本システムはフロントエンドのみで動作する SPA(Single Page Application) とし、料金計算ロジックを UI から分離して保守性と拡張性を確保する。

### 2.1 レイヤ構造

| レイヤ | 役割 | 主な構成要素 |
|--------|------|--------------|
| Presentation(UI) | 入力・表示 | Reactコンポーネント、フォーム、結果表示 |
| Application | ユースケース実行 | `searchBestPlan()`、フォーム入力をDomainへ変換 |
| Domain | ビジネスロジック | `Screening` `Group` `Participant` `PriceRule` `DiscountCondition` `PricingService` |
| Infrastructure | 静的データ提供 | 上映スケジュール・通常料金・割引料金（定数定義）、`ScreeningRepository` / `InMemoryScreeningRepository` |

**役割の境界**

- Presentation は **計算しない**（ドメインロジックを持たない）
- Application は **UI形式 ↔ ドメイン形式の変換＋調停**
- Domain は **課題の中心要件（最適上映選択・割引判定・料金計算）**
- Infrastructure は **データの提供者**

---

### 2.2 依存関係ルール
依存方向は一方向とし、下層は上層を参照しない。

Presentation → Application → Domain → Infrastructure


- **Domain は UI / React / 入力フォーマットに依存しない**
- **Application はユースケース単位で Domain をオーケストレーション**
- **Infrastructure の変更（上映回追加・料金変更）はロジックに影響しない実装を目指す**

**狙い（要点）**

- UI変更（例：日時入力UI変更）がロジックへ影響しない
- 将来的にバックエンドAPI化する場合、Domainをそのまま移植可能
- 割引条件をクラス追加で拡張できる構造（Strategy/Conditionパターン）

---

### 2.3 ディレクトリ構成（想定）

```text
src/
  domain/
    screening.ts
    group.ts
    participant.ts
    searchCondition.ts
    bestPlanResult.ts
    pricingRule.ts
    discountCondition.ts
    conditions/
      ageCondition.ts
      dayOfMonthCondition.ts
      WeekdayCondition.ts
      timeRangeCondition.ts
    pricingService.ts
  application/
    pricingApplicationService.ts
  infra/
    screeningsMock.ts
    pricingRulesMock.ts
  presentation/
    pages/
      PricingSimulatorPage.tsx
    components/
      ParticipantForm.tsx
      DateTimeInput.tsx
      ResultPanel.tsx


```

- `PricingService.calculateMinimumPrice(screening, group)` は `EvaluatedPlan | null` を返す。評価中に一人でも適用可能なルールが見つからなかった場合は `null` を返し、`searchBestPlan` 側で当該上映回を棄却する。
- `searchBestPlan` は上映候補フィルタ（過去上映／残席不足／20時以降×未成年）を実施した後、各候補に対して `calculateMinimumPrice` を実行し、得られた `EvaluatedPlan` 群から最安＋最も早い上映を選択して `BestPlanResult` へ整形する。

### 2.4 設計意図
- ドメインロジックを中心に据え、UIやデータ提供から独立させることで保守性を向上
- 将来的な拡張（新割引追加、バックエンド化）を見据えた柔軟な設計
- 将来、Reservation・座席選択・管理画面を追加しても Domain が再利用できるようにする
- 上映スケジュール取得は `ScreeningRepository` 経由とし、現在は `InMemoryScreeningRepository` で静的データを返すだけだが、将来 API / DB に切り替える際も Infrastructure 層の差し替えのみで対応できる構成とする。

---

## 3. 使用技術と選定理由
本プロジェクトは「フロントエンド実装を含むコーディング課題」であるため、
ブラウザ上で動作するSPA構成を採用する。学習コスト・開発効率・型安全性を重視し、以下の技術選定とする。

---

### **3-1. 利用言語・フレームワーク**

| 技術 | 用途 | 選定理由 | 本音・補足 |
|------|------|----------|----------|
| **TypeScript** | 型定義・開発サポート | ドメインモデルの型表現に適し、計算ロジックの整合性を静的に保証できるため。 | Reactとの親和性も高く、学習コストが低い。 |
| **React** | UI構築・SPA | UI更新が状態に依存するためReactのコンポーネントモデルが適する。学習コストと実装速度のバランスが良い。 | 業界のデファクトスタンダードであり、面接官も馴染みがある可能性が高い。 |
| **Vite** | ビルドツール・開発サーバ | 高速なHMRにより開発体験が良く、課題規模に適した軽量構成を取れるため。 | |

---

### **3-2. 主要ライブラリ**

| ライブラリ | 用途 | 選定理由 |
|------------|------|----------|
| **Zod** | 入力バリデーション（人数・日時のチェック） | スキーマ駆動で型とバリデーションを一元管理できるため。TSとの親和性が高い。 |
| **Tailwind CSS** | スタイリング | Tailwind は UI ロジックとスタイル定義をコンポーネント単位に局所化でき、CSSファイルの肥大化を防ぐため採用。|

*依存追加は最小限とし、基本は標準APIで実装する方針。*

---

### **3-3. 選定方針（総括）**

- **型安全性（TS + Zod）**
  ドメインモデル（観覧団体/上映回/割引条件）を型で厳密に表現し、ロジックの誤用を防ぐ。

- **軽量かつ実装速度を重視（React + Vite）**
  フルスタック構成は要求されていないため、最短で価値を出す技術を選択。

- **業界標準技術の採用**
  本課題は将来的な拡張（予約機能・管理画面など）を見据えた設計を前提としており、評価者が理解しやすく、保守性や学習コストの観点で有利な業界標準の技術スタックを選定した。新規性よりも、設計意図が伝わりやすい安定した技術基盤を重視する。

---

## 4. ドメインモデル詳細設計

> **※重要**
> 各概念クラスの背景・モデリング意図・関係性などの詳細説明は
> **「LLD_概念クラス図設計意図.md」** に記載済みのため、本章では重複を避ける。

参考資料：
- 概念設計資料 → `LLD_概念クラス図設計意図.md`
- 型定義・ドメインロジック → `src/domain/`
- 割引条件 → `src/domain/conditions/`
- 料金ルール → `src/domain/pricingRule.ts`
- 最適プラン検索処理 → `src/domain/pricingService.ts`

---

## 5. コンポーネント設計

### 5.1 コンポーネント一覧

本システムの UI は、`PricingSimulatorPage` を親コンテナとし、その配下に複数のプレゼンテーションコンポーネントを配置する。

| コンポーネント名            | 種別            | 役割概要                                                                                   | 配置パス例                                      |
|-----------------------------|-----------------|--------------------------------------------------------------------------------------------|------------------------------------------------|
| `PricingSimulatorPage`      | ページ（親）    | 料金シミュレーター画面のコンテナ。フォーム入力値と計算結果の状態管理、ユースケース呼び出し。 | `presentation/pages/PricingSimulatorPage.tsx`  |
| `ParticipantForm`           | 子コンポーネント | 大人・未成年・シニア人数の入力フォーム。                                                  | `presentation/components/ParticipantForm.tsx`  |
| `DateTimeInput`             | 子コンポーネント | 現在日時の入力（または「現在時刻を使う」ボタン）を提供。                                   | `presentation/components/DateTimeInput.tsx`    |
| `ResultPanel`               | 子コンポーネント | 最適上映回と料金、利用不可時のメッセージ、料金内訳の表示。                                 | `presentation/components/ResultPanel.tsx`      |
| `ErrorBanner`   | 子コンポーネント | バリデーションエラーやドメインエラーの共通表示。                                           | `presentation/components/ErrorBanner.tsx`      |

> ※ `PricingSimulatorPage` は「ページレベルのコンテナ」として扱い、詳細設計は画面設計セクション側で記述する想定。

---

### 5.2 コンポーネント責務分離方針

- **ドメインロジックは保持しない**
  - 各コンポーネントはあくまで「表示」と「入力イベントの通知」に責務を限定し、
    料金計算や上映回フィルタリング等のドメインロジックは `domain/` 配下のサービスが担当する。
- **状態管理はページコンテナに集約**
  - 参加者人数や日時、計算結果などの状態は `PricingSimulatorPage` が保持し、
    子コンポーネントには `props` として値とイベントハンドラを渡す。
- **UI バリデーションはコンポーネント／Application 層で完結**
  - 型・形式チェックなどの UI バリデーションは Zod スキーマを用いて `PricingSimulatorPage` もしくはフォームコンポーネントで実施し、
    ドメイン層には不正値を渡さない（REQ F10, F11 の方針に準拠）。
- **エラー表示は共通コンポーネントで行う**
  - バリデーションエラーやドメイン層からの「利用不可理由」（未成年 × 20 時以降など）は
    `ErrorBanner` で一元的に表示し、個々のフォームが勝手にトーストを出さない。
- **アクセシビリティと再利用性**
  - ラベル・入力要素には `htmlFor` / `id` を適切に設定し、スクリーンリーダー対応を意識する。
  - 今後、他画面でも人数入力／日時入力を流用できるよう、文言やレイアウトに依存しない構造を意識する。

---

### 5.3 各コンポーネント詳細（Props 定義・戻り値）

#### 5.3.1 `ParticipantForm`

##### 役割

- 大人・未成年・シニアの人数入力を受け付けるフォームコンポーネント。
- 「人数が 0 以上の整数」であることを UI レベルでチェックし、
  不正な値は `ErrorBanner` 経由で通知できるようにする（ドメイン層には渡さない）。

##### Props インターフェース（案）

```ts
// コンポーネント内で扱う値オブジェクト
export type ParticipantFormValues = {
  adultCount: number;
  youthCount: number;
  seniorCount: number;
};

export type ParticipantFormProps = {
  /** 現在のフォーム値（親コンテナ側で管理する） */
  value: ParticipantFormValues;

  /** フォーム値変更時に呼び出すコールバック */
  onChange: (value: ParticipantFormValues) => void;

  /** フォーム全体の活性／非活性制御（計算中など） */
  disabled?: boolean;

  /** バリデーションエラーメッセージ（人数に関するもの） */
  errorMessage?: string;
};

```

##### 入出力・振る舞い
- **入力**
    - `value` プロパティで渡された `ParticipantFormValues` オブジェクトを元に各人数入力欄を初期化。
    - ユーザーが各人数入力欄を変更した際、`onChange` コールバックを呼び出し、最新の `ParticipantFormValues` を渡す。
- **出力**：`onChange` コールバックで `ParticipantFormValues` オブジェクトを返す
- **バリデーション**：各フィールドは 0 以上の整数であることをチェックし、違反時は `errorMessage` にメッセージをセットする。

---

####  `DateTimeInput`

##### 役割
- 現在日時の入力を受け付けるコンポーネント。
- 「現在時刻を使う」ボタンを提供し、クリック時に親コンテナへ通知する。

##### Props インターフェース（案）

```ts
export type DateTimeInputProps = {
  /** 日時入力欄の値（`YYYY-MM-DDTHH:mm` 形式の文字列） */
  value: string;

  /** 値変更時に呼ぶコールバック。受け渡しは常に文字列で行い、変換は Application 層で実施 */
  onChange: (value: string) => void;

  /** 「現在時刻を使用」ボタン押下時に呼ぶコールバック */
  onUseCurrent?: () => void;

  /** 日付形式エラーなどのメッセージ */
  errorMessage?: string;
};

```

##### 入出力・振る舞い
- **入力**
    - `value` プロパティで渡された日時文字列を元に日時入力欄を初期化。
    - ユーザーが日時入力欄を変更した際、`onChange` コールバックを呼び出し、最新の日時文字列を渡す。
    - 「現在時刻を使用」ボタンは常時表示され、クリック時に `onUseCurrent`（未指定の場合は何も行わない）を呼び出して現在日時の更新タイミングを親へ通知する。
- **出力**：`onChange` コールバックで日時文字列を返す
- **バリデーション**：日時形式が不正な場合、`errorMessage` にメッセージをセットする。

---

### 5.3.3 `ResultPanel`

##### 役割
- 最適上映回と料金、利用不可時のメッセージ、料金内訳を表示するコンポーネント。
##### Props インターフェース（案）

```ts
export type SearchBestPlanBreakdownItem = {
  category: 'ADULT' | 'YOUTH' | 'SENIOR';
  label: string;      // 画面表示用ラベル（例: "一般" "未成年" "シニア"）
  unitPrice: number;  // 単価
  count: number;      // 人数
  subtotal: number;   // 小計
};

export type SearchBestPlanOutput = {
  isAvailable: boolean;          // 利用可能フラグ
  screeningDateTime?: string;    // ISO文字列（UI側で日時フォーマット）
  totalPrice?: number;           // 合計料金（利用不可時は undefined）
  breakdown?: SearchBestPlanBreakdownItem[]; // 料金内訳（利用不可時は undefined）
  errorCode?: DomainErrorCode;   // 利用不可理由コード
  reasonIfUnavailable?: string;  // エラーメッセージ補足
};

export type ResultPanelProps = {
  /** 計算中フラグ */
  isLoading: boolean;

  /** 計算結果（未実行時は null） */
  result: SearchBestPlanOutput | null;
};

```
##### 表示パターン
- **計算中**：`isLoading` が true の場合、ローディングインジケーターを表示。
- **利用可能**：`result.isAvailable` が true の場合、最適上映日時、合計料金、料金内訳を表示。
- **利用可能**：`result.isAvailable` が true の場合、最適上映日時、合計料金、料金内訳を表示。上映日時は `toLocaleString` に `timeZone: 'Asia/Tokyo'` を指定して描画し、UI でも必ず日本時間を示す。
- **利用不可**：`result.isAvailable` が false の場合、`reasonIfUnavailable` を表示。
  - `errorCode` でハンドリングしつつ `reasonIfUnavailable` を補足テキストとして扱う
---

### 5.4 ErrorBanner

##### 役割
- バリデーションエラーやドメインエラーの共通表示コンポーネント。
##### Props インターフェース（案）

```ts
export type ErrorBannerProps = {
  /** 表示するエラーメッセージ */
  message: string;

  /** 表示・非表示制御 */
  isVisible: boolean;
};
```

##### 表示パターン
- **表示**：`isVisible` が true の場合、`message` を赤字で表示。
- **非表示**：`isVisible` が false の場合、何も表示しない。

## 6. データ定義
### 6.1 上映スケジュールデータ構造

```ts
export type ScreeningProps = {
  id: string;               // 上映回ID
  movieTitle: string;       // 作品名（UI表示用）
  startAt: string | Date;   // 上映開始日時（ISO 8601 文字列または Date）
  availableSeats: number;   // 残席数（現状はこの単一フィールドのみで収容可否を判定）
};

export class Screening {
  constructor(private readonly props: ScreeningProps) { /* 省略 */ }

  get startAt(): Date { /* ISO文字列をDateに変換して保持 */ }
  canAccommodate(headcount: number): boolean { /* 残席と人数で判定 */ }
  startsAtOrAfter(date: Date): boolean { /* 過去上映を除外 */ }
  startsAtHourOrLater(hour: number): boolean { /* レイトショー判定 */ }
  getDayOfMonth(): number { /* ファーストデイ判定 */ }
  getWeekday(): number { /* 平日/休日の判定 */ }
  getMinutesSinceMidnight(): number { /* JST基準でHH:mm→分に変換 */ }
}
```

> **補足**：実装では `Screening` クラスが ISO 文字列を `Date` に正規化したのち、`Intl.DateTimeFormat` を `Asia/Tokyo` に固定して時間帯／曜日／分換算の各ヘルパーを提供する。ユーザーの端末タイムゾーンに影響されず、常に上映館の日本時間で割引条件が評価される。座席位置や予約確保の状態は追跡しておらず、`availableSeats` のみで収容可否を判定している。将来的に予約・座席管理を導入する場合は、`initialSeatCount` と `remainingSeatCount` を分けたり、`canReserve` / `reserveSeats` を `Screening` に追加して残席更新の責務を集約させる計画。座席位置 (`Seat` / `SeatReservation`) や連番制御もこのタイミングで拡張する。

---

### 6.2 料金体系データ構造

```ts
export type PricingRule = {
  id: string;
  name: string;
  description?: string;
  price: number;                           // 1人あたりの料金額
  targetCategory: 'ADULT' | 'YOUTH' | 'SENIOR'; // 適用対象となる参加者区分（単一）
  conditions?: DiscountCondition[];        // すべて満たした場合のみ適用される割引条件
};

export interface DiscountCondition {
  id: string;
  description?: string;
  isSatisfied(screening: Screening, participant: Participant): boolean; // true のとき条件成立
}
```

- 1 つの `PricingRule` は必ず 1 カテゴリ（一般・未成年・シニアのいずれか）にのみ適用される。複数カテゴリで同一割引を提供する場合はカテゴリ別にルールを定義する（例：`discount-first-day-adult` / `discount-first-day-youth`）。
- `conditions` は論理 AND とし、すべての `DiscountCondition` が `true` を返す場合に限り適用可能とみなす。条件が不要な通常料金は空配列または undefined を渡す。
- 代表的な条件クラス：
  - `AgeCondition`：`minAge` / `maxAge` で年齢区間を指定
  - `DayOfMonthCondition`：`dayOfMonth`（1〜31）で月日を判定
  - `WeekdayCondition`：`weekdays: number[]`（0=Sun〜6=Sat）で複数曜日をサポート。`description?` も保持できる
  - `TimeRangeCondition`：`from` / `to`（HH:mm）で時間帯を判定

---

### 6.3 日時フォーマット
- 入力日時形式：`YYYY-MM-DDTHH:mm`（例：`2025-12-01T14:30`）
- 内部処理・表示用日時形式：ISO 8601 文字列（例：`2025-12-01T14:30:00Z`）

---

### 6.4 静的データ管理
- 上映スケジュール、料金体系、割引条件は `infra/` 配下のモックデータとして定義。

---

### 6.5 データ例
```ts


// 6.5 データ例

// --- 6.5.1 上映スケジュール静的データ例 ---

import { Screening } from '../domain/screening';

const BASE_MOVIE_TITLE = 'The Kubell Case';
const toDate = (value: string): string => `${value}:00+09:00`;

export const screeningsMock: Screening[] = [
  new Screening({
    id: 'screening-20251030-1500',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-10-30T15:00'),
    availableSeats: 4,
  }),
  new Screening({
    id: 'screening-20251030-2000',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-10-30T20:00'),
    availableSeats: 6,
  }),
  new Screening({
    id: 'screening-20251031-1500',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-10-31T15:00'),
    availableSeats: 1,
  }),
  new Screening({
    id: 'screening-20251031-2000',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-10-31T20:00'),
    availableSeats: 2,
  }),
  new Screening({
    id: 'screening-20251101-1500',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-11-01T15:00'),
    availableSeats: 4,
  }),
  new Screening({
    id: 'screening-20251101-2000',
    movieTitle: BASE_MOVIE_TITLE,
    startAt: toDate('2025-11-01T20:00'),
    availableSeats: 5,
  }),
];

```

// --- 6.5.2 料金ルール／割引条件モックデータ例 ---

```ts
const firstDayCondition = new DayOfMonthCondition({
  id: 'cond-first-day',
  dayOfMonth: 1,
  description: '毎月1日に適用されるファーストデイ割',
});

const lateShowCondition = new TimeRangeCondition({
  id: 'cond-late-show',
  from: '20:00',
  description: '20時以降に開始する上映回で適用',
});

const seniorWeekdayCondition = new WeekdayCondition({
  id: 'cond-weekday',
  weekdays: [1, 2, 3, 4, 5],
  description: '平日のみ適用',
});

const seniorTimeRangeCondition = new TimeRangeCondition({
  id: 'cond-senior-time',
  from: '10:00',
  to: '20:00',
  description: '10:00-20:00 の上映で適用',
});

const seniorAgeCondition = new AgeCondition({
  id: 'cond-senior-age',
  minAge: 60,
  description: '60歳以上限定',
});

export const PRICING_RULES: PricingRule[] = [
  new PricingRule({
    id: 'base-adult',
    name: '一般 通常料金',
    price: 1600,
    targetCategory: 'ADULT',
  }),
  new PricingRule({
    id: 'base-youth',
    name: '未成年 通常料金',
    price: 1000,
    targetCategory: 'YOUTH',
  }),
  new PricingRule({
    id: 'base-senior',
    name: 'シニア 通常料金',
    price: 1600,
    targetCategory: 'SENIOR',
  }),
  new PricingRule({
    id: 'discount-first-day-adult',
    name: 'ファーストデイ割（一般）',
    price: 1000,
    targetCategory: 'ADULT',
    conditions: [firstDayCondition],
  }),
  new PricingRule({
    id: 'discount-first-day-youth',
    name: 'ファーストデイ割（未成年）',
    price: 1000,
    targetCategory: 'YOUTH',
    conditions: [firstDayCondition],
  }),
  new PricingRule({
    id: 'discount-first-day-senior',
    name: 'ファーストデイ割（シニア）',
    price: 1000,
    targetCategory: 'SENIOR',
    conditions: [firstDayCondition],
  }),
  new PricingRule({
    id: 'discount-late-show-adult',
    name: 'レイトショー（一般）',
    price: 1400,
    targetCategory: 'ADULT',
    conditions: [lateShowCondition],
  }),
  new PricingRule({
    id: 'discount-late-show-senior',
    name: 'レイトショー（シニア）',
    price: 1400,
    targetCategory: 'SENIOR',
    conditions: [lateShowCondition],
  }),
  new PricingRule({
    id: 'discount-senior-weekday',
    name: '平日シニア割',
    price: 1200,
    targetCategory: 'SENIOR',
    conditions: [seniorWeekdayCondition, seniorTimeRangeCondition, seniorAgeCondition],
  }),
];
```

- すべての割引ルールはカテゴリごとに定義する。例えばファーストデイ割は「一般」「未成年」「シニア」の 3 ルールに分割し、それぞれ `targetCategory` を一致させる。
- 割引条件はクラスインスタンスを使って表現し、複数条件を配列で組み合わせることで AND 判定を実現している（例：平日シニア割は「平日」×「10〜20時」×「60歳以上」）。



---

### 6.6 意図
- 上映スケジュール、料金体系、割引条件を静的データとして分離し、ドメインロジックから独立させることで保守性を向上。
- 将来的に外部データソース（API・DB）に切り替える場合も、`Infrastructure` 層の実装を変更するだけで済む設計とする。
- シニアについても通常料金テーブル上に `SENIOR` 区分を定義し、基本料金は一般と同額（1,600円）とする。これにより、
  - 「平日シニア割」は「通常料金 1,600円 → 割引適用時 1,200円への上書き」として表現でき、
  - 将来的にシニア専用の通常料金や別種の割引を追加したい場合にも、データ構造を変更せずに拡張できるようにしている。
- 割引条件は団体の参加者一人一人に対して運用される。

---

## 7. バリデーション・エラー設計

本章では、入力値チェック（バリデーション）およびドメイン制約違反時のエラーの扱い方を定義する。  
目的は以下の通り。

- 不正な入力値による計算結果の不整合を防ぐこと
- ドメインルール（未成年の20時以降入場不可・残席不足など）を破らないこと
- UI から見て一貫したエラー表示を行うこと

---

### 7.1 バリデーションの全体方針

- **UIバリデーション（Presentation / Application 層）**
  - 型・形式・範囲などの**入力値の妥当性**をチェックする。
  - 不正値はドメイン層に渡さない（0人未満の人数、日時フォーマット不正など）。
  - 実装では Zod を用いたスキーマバリデーションを想定する。

- **ドメイン制約チェック（Domain 層）**
  - 「未成年は20時以降入場不可」「残席不足なら予約不可」など、**ビジネスルール**に関する検証を行う。
  - 制約違反時は `DomainErrorCode`（後述）を用いてエラー状態を表現し、UI側に理由を返す。

- **システムエラー**
  - Dateパースの失敗など、想定外の例外はログ出力対象とし、ユーザーには一般的なエラーメッセージを表示する（本課題では簡易対応）。

---

### 7.2 入力バリデーション仕様（UI層）

参加者人数や日時など、ユーザー入力に対して行うチェック内容を以下に定義する。

| 項目 | 層 | チェック内容 | エラー時の動作 |
|------|----|--------------|----------------|
| 大人の人数 | UI | 0以上の整数か | ErrorBanner で「人数は0以上の整数で入力してください」を表示 |
| 未成年の人数 | UI | 0以上の整数か | 同上 |
| シニアの人数 | UI | 0以上の整数か | 同上 |
| 現在日時（※入力する場合） | UI | `YYYY-MM-DDTHH:mm` 形式か | ErrorBanner で「日時の形式が不正です」を表示／計算を実行しない |

> 実装では、`PricingSimulatorPage` 側で Zod スキーマを定義し、
> `ParticipantForm` からの値を受け取ってバリデーションを行う想定。

---

### 7.3 ドメイン制約チェック仕様（Domain層）

ドメインモデルに紐づくビジネスルールを、料金計算の前後でチェックする。

| 制約ID | 内容 | チェックタイミング | 違反時の扱い |
|--------|------|--------------------|--------------|
| D1 | 未成年は20時以降入場不可 | 上映候補ごとの評価時 | 当該上映回を候補から除外し、すべての上映がNGの場合は `UNDER_AGE_AFTER_20` を返す |
| D2 | 残席数 < 参加者人数の場合は予約不可 | 上映候補ごとの評価時 | 当該上映回を候補から除外し、すべての上映がNGの場合は `SEAT_NOT_AVAILABLE` を返す |
| D3 | 条件に合致する上映回が一つも存在しない | 全上映回評価後 | `NO_SCREENING_AVAILABLE` を返す |

> ※ ドメイン層では「どの上映回が候補から落ちたか」と「最終的に候補がゼロか」を判定して、
> 結果として `BestPlanResult` に `errorCode` として設定するイメージ。

エラー処理優先度
- D1（未成年×20時以降） ＞ D2（残席不足） ＞ D3（上映回なし）

---

### 7.4 ドメインエラーコード定義

ドメイン制約違反を表現するための識別子を `DomainErrorCode` として定義する。

```ts
// src/domain/error/DomainErrorCode.ts
export enum DomainErrorCode {
  UNDER_AGE_AFTER_20 = 'UNDER_AGE_AFTER_20',　// 未成年の20時以降入場不可
  SEAT_NOT_AVAILABLE = 'SEAT_NOT_AVAILABLE', // 残席不足
  NO_SCREENING_AVAILABLE = 'NO_SCREENING_AVAILABLE', // 条件に合う上映回なし
}

```

BestPlanResult 例（ドメイン層の返却型イメージ）：

```ts
export type PriceBreakdownItem = {
  ruleId: string;
  ruleName: string;
  participantCategory: ParticipantCategory;
  unitPrice: number;
  quantity: number;
  subtotal: number;
};

export type BestPlanResult = {
  isAvailable: boolean;
  screening?: Screening;
  totalPrice?: number;
  breakdown?: PriceBreakdownItem[];
  errorCode?: DomainErrorCode;
  reasonIfUnavailable?: string; // UI 表示用の補足テキスト。ハンドリング自体は errorCode で行う
};

```

`calculateMinimumPrice` は UI 専用の結果ではなく、上映単位の評価結果を表す `EvaluatedPlan`（内部値オブジェクト）を返す。

```ts
export type EvaluatedPlan = {
  screening: Screening;
  totalPrice: number;
  breakdown: PriceBreakdownItem[]; // ruleId / ruleName / participantCategory / unitPrice / quantity / subtotal
};

// すべての参加者に適用可能な料金ルールが存在しない場合は null を返し、呼び出し元が該当上映回を候補から除外する
```

---

### 7.5 エラー表示方針（UI層）
ドメイン層から返却された `DomainErrorCode` に基づき、ユーザーにわかりやすいエラーメッセージを表示する。
| ドメインエラーコード | 表示メッセージ例 |
|----------------------|------------------|
| UNDER_AGE_AFTER_20   | 「未成年の方が含まれる場合、20時以降の上映回はご利用いただけません。」 |
| SEAT_NOT_AVAILABLE   | 「申し訳ございません。ご希望の人数分の空席がございません。」 |
| NO_SCREENING_AVAILABLE | 「ご希望の条件に合う上映回が見つかりませんでした。」 |


ErrorBanner での利用例：
```ts
<ErrorBanner
  isVisible={!!result?.errorCode}
  message={
    result?.errorCode ? DomainErrorMessages[result.errorCode] : ''
  }
/>
```

---

## 8. ユースケース設計 / アプリケーションサービス設計
本章では、アプリケーション層で提供するユースケースとその入出力定義を示す。

### 8.1 ユースケース概要

| ユースケース名 | 概要 | 主担当レイヤ |
|----------------|------|--------------|
| `searchBestPlan` | 現在日時と観覧者構成を入力として最適な上映回と料金を返す | Application |
| `searchBestPlanSchema`（Zod） | 参加人数や日時文字列の形式を検証 | Presentation / Application |
| `mapToDomainModel` | UI入力値を `Domain` が扱う型へ変換 | Application |

> Application層は「UIの入力を解釈 → Domain処理を実行 → UI用に整形して返す」役割に限定する。

---

### 8.2 入出力定義：searchBestPlan（主要ユースケース）

```ts
// 入力型（UI層から受け取る形）
export type SearchBestPlanInput = {
  now: string; // ISO 8601
  participantCounts: {
    adultCount: number;
    youthCount: number;
    seniorCount: number;
  };
};

// 出力型（UI向け）
export type SearchBestPlanOutput = {
  isAvailable: boolean;
  screeningDateTime?: string;
  totalPrice?: number;
  breakdown?: {
    label: string;
    unitPrice: number;
    count: number;
    subtotal: number;
  }[];
  errorCode?: DomainErrorCode;
};
```

### 8.3 フロー図（シーケンス）
```text
[UI] PricingSimulatorPage
   ↓ 入力値（文字列・number）
[Application] pricingApplicationService.searchBestPlan()
   ↓ バリデーション
   ↓ ドメイン形式へ変換
[Domain] PricingService.searchBestPlan()
  ↓ 上映候補フィルタ（過去/残席/20時以降×未成年）
  ↓ 各候補ごとに calculateMinimumPrice() を実行し EvaluatedPlan を取得
  ↓ 最安プランを選び、BestPlanResult に整形
[Application] UI用DTOへ変換
   ↓
[UI] ResultPanel / ErrorBanner 表示
```

### 8.4 実装方針（Pseudo Code）
```ts
export class PricingApplicationService {
  constructor(
    private pricingService: PricingService,
    private screeningsRepo: ScreeningRepository,
  ) {}

  async searchBestPlan(input: SearchBestPlanInput): Promise<SearchBestPlanOutput> {
    // 1. 入力値バリデーション
    const parsed = searchBestPlanSchema.parse(input);

    // 2. ドメインモデルへマッピング
    const group = Group.fromDistribution(parsed.participantCounts);
    const condition = buildSearchCondition({
      group,
      currentDateTime: parsed.now,
    });
    const screenings = this.screeningsRepo.getAll();
    const result = this.pricingService.searchBestPlan(condition, screenings);
    // searchBestPlan 内で calculateMinimumPrice() を実行し、得られた EvaluatedPlan から最安プランを選んで BestPlanResult を返す

    // 3. UI向けレスポンスへ詰め直す
    return mapToUIResult(result);
  }
}
```
---

### 8.4.1 Data Source 設計（Repository）

上映スケジュールは、アプリケーション層から直接配列を参照するのではなく、
`ScreeningRepository` インターフェースを介して取得する設計とする。

これにより、現在は静的データ (`InMemoryScreeningRepository`) を返すだけの実装としつつ、
将来的に API / DB にデータソースを差し替える場合でも Domain / Application 層を変更せずに済む。

```ts
export interface ScreeningRepository {
  /** 現在取り扱う上映回一覧を取得（本課題ではメモリ上の静的データ） */
  getAll(): Screening[];
}

export class InMemoryScreeningRepository implements ScreeningRepository {
  constructor(private screenings: Screening[]) {}

  getAll(): Screening[] {
    return this.screenings;
  }
}
```

---

### 8.5 Application層の責務（明確化）
- **入力バリデーション**：UI層からの入力値を検証し、不正値をドメイン層に渡さない。
- **ドメインモデル変換**：UI形式のデータをドメイン層が扱う型に変換する。
- **ユースケースオーケストレーション**：ドメイン層のサービスを呼び出し、結果をUI向けに整形して返す。

---

### 8.6 意図
- Application層をユースケース単位で設計し、UIとドメインの橋渡し役に限定することで、各層の責務を明確化。
- ドメイン層はビジネスロジックに専念でき、UI変更や入力形式変更の影響を受けにくくする。

---

## 9. テスト設計

本章では、システム全体のテスト設計を示す。

- 料金計算ロジックおよび割引適用条件が仕様通りに動作することを確認する
- ドメイン制約（未成年 20 時以降入場不可、残席不足など）が正しく適用されることを確認する
- 入力値に対するバリデーションが適切に機能し、UI上で正しくフィードバックされることを確認する

筆者はテスト設計に詳しくないため、基本的な本項目についてはAIに生成させた上で、必要に応じて補足・修正を加えている。
そのため、内容に不備・不足がある可能性、業界のベストプラクティスに沿っていない可能性があることを予めご了承いただきたい。


---

### 9.1 テストレベル・対象

| テストレベル | 対象コンポーネント・モジュール | 目的 |
|---------------|-------------------------------|------|
| 単体テスト | Domain層（`PricingService`, 割引条件, 制約判定） | 割引ロジック・最安プラン選択ロジックの正当性を検証 |
| 単体テスト | Application層（`searchBestPlan` 関数） | UI入力形式から Domain への変換、および Domain 結果の整形を検証 |
| 結合テスト | Application層のユースケース | UIからの入力を受け取り、ドメインロジックを正しく呼び出し、期待される結果を返すことを検証 |
| エンドツーエンドテスト | UIコンポーネント（PricingSimulatorPageなど） | ユーザー操作フロー全体が期待通りに動作することを検証 |

---

### 9.2 テスト環境・ツール選定
| テストレベル | ツール・フレームワーク | 理由 |
|---------------|-----------------------|------|
| 単体テスト・結合テスト | Vitest | Vite構成との親和性が高く、TypeScript対応とウォッチ速度に優れるため |
| エンドツーエンドテスト | Cypress | UI操作の自動化に適しており、リアルなユーザーフローを検証できるため |

コマンド例：
- 単体テスト・結合テスト実行：`npm run test`
- エンドツーエンドテスト実行：`npx cypress open`

---

### 9.3 主要テストケース例（Domain層）(優先度高)

#### 9.3.1 割引適用ロジック
| テストケースID | 入力条件 | 期待結果 |
|----------------|----------|----------|
| TC-DISCOUNT-01 | ファーストデイ（11月1日）に大人2名、未成年1名、シニア1名で参加 | 全員にファーストデイ割適用、料金は (1000*4)=4000円 |
| TC-DISCOUNT-02 | レイトショー（20時以降）に大人2名、シニア1名で参加 | |全員にレイトショー割適用、料金は (1400*3)=4200円 |
| TC-DISCOUNT-03 | 平日シニア割（平日15時）に大人1名、シニア2名で参加 | シニア2名に平日シニア割適用、料金は (1600*1)+(1200*2)=4000円 |
| TC-DISCOUNT-04 | 平日シニア割の条件外（休日20時）にシニア1名で参加 | シニアに割引適用されず、料金は (1600*1)=1600円 |

#### 9.3.2 最適プラン選択ロジック
| テストケースID | 入力条件 | 期待結果 |
|----------------|----------|----------|
| TC-BESTPLAN-01 | 大人2名、未成年1名、シニア1名で2025年10月29日に検索 | 最安値は2025/11/01(土)15:00、料金は4000円（ファーストデイ割適用） |
| TC-BESTPLAN-02 | 大人2名、シニア1名で2025年10月29日に検索 | 最安値は2025/10/30(木)20:00、料金は4200円（レイトショー割適用） |
| TC-BESTPLAN-03 | 大人2名、シニア1名で2025年10月29日に検索 | 2025/11/01(土)15:00 と 20:00 の料金はいずれも 3,000 円（ファーストデイ割適用）で同額だが、「同額の場合は最も早い上映日時を選択する」ルールに従い、2025/11/01(土)15:00 が選択される |


#### 9.3.3 残席数と参加者条件（候補除外とエラーの切り分け）

| テストケースID | 入力条件 | 期待結果 |
|----------------|----------|----------|
| TC-SEAT-01 | 残席不足（残席2、参加者3名） | 残席が不足している上映回（2025/10/31(金)15:00 残席1, 20:00 残席2）が候補から除外され、残席が十分な上映回が存在する場合はその回が選択される（例：11/1 15:00） |
| TC-SEAT-02 | 全上映回で残席不足（全上映回の最大残席2、参加者3名） | **原因が残席不足であることが明確なため**、エラーコード `SEAT_NOT_AVAILABLE` |
| TC-SEAT-03 | 未成年を含む＆全上映回が20時以降だが残席は十分 | 深夜入場不可により全上映回候補外となり、エラーコード `UNDER_AGE_AFTER_20` |
| TC-SEAT-04 | 未成年を含む ＋ 一部上映は残席不足 & 一部は20時以降 | 候補がゼロだが原因が複合（時間制約＋残席不足）で単一要因に特定不可のため、エラーコード `NO_SCREENING_AVAILABLE` |

---

### 9.4 テストケース例（Application層）(優先度高)

`searchBestPlan` 関数の責務は以下である：

- UI入力（文字列・number）を Domain モデルに変換
- Domainの `resolveBestPlan` を呼び出し
- Domain結果を UI向け DTO（`SearchBestPlanOutput`）へマッピング

| テストID | 観点 | 入力 | 期待結果 |
|----------|------|------|----------|
| A-01 | 入力値→Domain変換 | `now` が ISO文字列 `"2025-10-30T10:00"` | `PricingService` に `new Date("2025-10-30T10:00")` が渡される |
| A-02 | Domain結果→UI変換（成功） | Domainが `isAvailable=true` の結果を返す | `SearchBestPlanOutput` で `isAvailable=true` & `screeningDateTime`/`totalPrice`/`breakdown` がセットされる |
| A-03 | Domain結果→UI変換（エラー） | Domainが `isAvailable=false, errorCode=NO_SCREENING_AVAILABLE` を返す | `SearchBestPlanOutput` で `isAvailable=false` & `errorCode=NO_SCREENING_AVAILABLE` がセットされる |
| A-04 | バリデーションエラー時の動作 | `adultCount=-1` のような不正入力 | `searchBestPlanSchema` が例外を投げ、呼び出し元で ErrorBanner 表示につながる |

※ Application層のテストでは、`PricingService` をモック化し、I/Oの変換のみにフォーカスする。

---

### 9.5 テストケース例（UI層）(優先度低)

#### 9.5.1 ParticipantForm
| テストID | 観点 | 入力操作 | 期待結果 |
|----------|------|----------|----------|
| UI-PF-01 | 初期表示 | `value` プロパティで `{ adultCount: 2, youthCount: 1, seniorCount: 0 }` を渡す | 各入力欄にそれぞれ 2、1、0 が表示される |
| UI-PF-02 | 入力変更 | 大人の人数欄に 3 を入力 | `onChange` コールバックが `{ adultCount: 3, youthCount: 1, seniorCount: 0 }` を返す |
| UI-PF-03 | バリデーションエラー表示 | `errorMessage` プロパティに「人数は0以上の整数で入力してください」を渡す | エラーメッセージが赤字で表示される |

#### 9.5.2 ResultPanel
| テストID | 観点 | 入力操作 | 期待結果 |
|----------|------|----------|----------|
| UI-RP-01 | 計算中表示 | `isLoading` プロパティに true を渡す | ローディングインジケーターが表示される |
| UI-RP-02 | 利用可能表示 | `result` プロパティに `isAvailable=true, screeningDateTime="2025-11-01T15:00", totalPrice=4000, breakdown=[...]` を渡す | 最適上映日時、合計料金、料金内訳が表示される |
| UI-RP-03 | 利用不可表示 | `result` プロパティに `isAvailable=false, reasonIfUnavailable="未成年の方が含まれる場合、20時以降の上映回はご利用いただけません。"` を渡す | 利用不可理由が表示される |

#### 9.5.3 End-to-End テスト（Cypress）
| テストID | 観点 | ユーザー操作 | 期待結果 |
|----------|------|--------------|----------|
| E2E-01 | 正常フロー | 大人2名、未成年1名、シニア1名を入力し、現在日時を設定して「最適プランを検索」ボタンをクリック | 最適上映日時と料金が表示される |
| E2E-02 | バリデーションエラー | 大人の人数欄に -1 を入力し、「最適プランを検索」ボタンをクリック | 「人数は0以上の整数で入力してください」というエラーメッセージが表示される |

---


## 10. 拡張方針（将来的な機能拡張・本番適用を見据えた設計）

本システムは、現時点では「料金シミュレーション（最適な上映回と料金の算出）」までを実装スコープとし、予約管理・座席選択・管理システムなどは **クラス図と要件定義上のみで整理**している。

将来的に「映画館の料金最適化・予約候補提示システム」として本番運用を想定する場合、以下の方針でドメイン・アーキテクチャ・UI を拡張していくことを前提とした設計とする。

---

### 10.1 ドメインモデルの段階的な拡張

現状コアとなるドメインは `Screening` / `Group` / `Participant` / `PriceRule` / `DiscountCondition` / `PricingService` であり、料金計算と最適上映回選択のロジックをこの範囲に閉じ込めている。

将来的には、以下のように集約を増やしながら段階的に拡張する。

- **予約関連の追加**
  - `Reservation` 集約を導入し、「料金見積もり結果」を確定させる概念を追加する。
  - `Screening` には `canReserve()` / `reserveSeats()` を追加し、残席更新の責務を集約ルートに集約する。

- **作品・レーティングの活用**
  - 既にクラス図に存在する `Movie`・レーティング情報を、PG12/R15 などの入場制限判定にも利用できるようにする。

- **座席モデルの導入**
  - 現状は「座席数（整数）」のみだが、将来的には `Seat` / `SeatReservation` を導入し、  「どの席が予約されているか」「連番・孤立席防止」などを表現可能な構造にする。

このように、**現在の料金シミュレーション用ドメインをそのまま拡張していく前提**で、クラス図上にはすでに Reservation / Seat / Movie / Admin などの概念を配置している。

---

### 10.2 Infrastructure 層の API / DB 化

要件定義および詳細設計では、現在は `infra/` 配下に上映スケジュール・料金・割引条件を静的データとして保持しているが、本番適用時には以下のようにデータソースを差し替えることを想定している。

- **上映スケジュール**
  - 今：`SCREENINGS` 定数として TypeScript に埋め込み。
  - 将来：`/api/screenings`（もしくは DB の `screenings` テーブル）から取得し、`ScreeningRepository` インターフェース経由で Domain に供給。

- **料金ルール・割引条件**
  - 今：`infra/pricingRulesMock.ts` の `pricingRulesMock` 配列として、割引条件込みで静的に定義。
  - 将来：管理画面から編集可能なマスタとして DB 化し、`PricingRuleRepository` などのリポジトリ層を介して取得。

- **拡張方針**
  - Domain 層は「配列で渡されるルール・条件」を前提に書いておき、**データの取得元を意識しない**ようにしている。
  - これにより、静的データ→API/DB への切り替えは **Infrastructure 層の差し替えのみ**で対応可能とする。
---

### 10.3 料金ルール・割引条件の拡張

料金ルールや割引条件は、`PriceRule` と `DiscountCondition`（条件クラス）に責務を分離しており、**新しい割引を追加する場合も既存の料金計算サービスを変更せずに拡張可能**な構造としている。

- 例：将来追加しうる割引
  - レディースデイ（特定曜日＋性別）
  - 学生デイ（年齢＋学生属性）
  - 誕生日月割（ユーザープロファイル＋日付条件）

- 拡張方法
  - 新たな `DiscountCondition` 実装クラスを追加し、必要に応じて `PriceRule` の `conditions` に組み込む。
  - `PricingService` 側のアルゴリズムは「候補ルールの中から適用可能なものを評価する」構造のため、変更不要。

---

### 10.4 予約・管理系 UI への発展

要件定義書では、料金シミュレーター（P1）に加え、将来の管理ダッシュボードや予約確認画面などを**COULD要件として**整理している。

- **予約確認〜予約候補確定**
  - 現在の「最適上映回＋料金」表示結果を、`Reservation` 作成画面に引き継ぐ形で UI を拡張。
  - `BestPlanResult` を元に、上映日時・人数・料金をユーザーに再確認させ、「予約候補確定」アクションを持たせる。

- **管理ダッシュボード**
  - `Movie` / `Screening` / `PriceRule` / `DiscountCondition` を CRUD できるバックオフィス UI を追加。
  - その際も Domain モデルはそのまま利用し、`application` 層に管理用のユースケースサービスを追加する方針とする。
---

### 10.5 非機能要件を踏まえた拡張

要件定義の非機能要件（N1〜N11）を満たしつつ拡張していくため、以下の方針を採用する。

- **拡張性**
  - 割引ルールは `DiscountCondition` の追加で対応し、`PricingService` のアルゴリズムを変更しない（N1）。
- **保守性**
  - ドメインと UI を分離したレイヤード構成のまま保ち、バックエンド化後も同一ドメインを利用する（N2, N4）。
- **テスト容易性**
  - ドメインサービス・条件クラスは副作用を持たない設計とし、単体テストでカバーできるようにする（N8）。
- **一貫性・同じ操作を繰り返しても結果が変わらない設計**
  - 将来 `Reservation` を導入した際は、「予約確定後の料金・残席を再計算しない」ポリシーで API 設計を行う（N9, N11）。

---

### 10.6 開発工数見積もり（参考）

上記の拡張方針を踏まえ、将来的に本番適用を目指す場合の開発工数見積もり例を以下に示す。
| 機能・作業内容                     | 見積工数（人日） |
|------------------------------------|------------------|
| 料金シミュレーション機能の実装     | 5                |
| 予約管理機能の実装                 | 10               |
| 座席選択機能の実装                 | 8                |
| 管理ダッシュボードの実装           | 7                |
| テスト設計・実装                   | 5                |
| ドキュメント整備・最終確認         | 3                |
| **合計**                           | **38人日**       |

---

### 10.7 まとめ

- 今回の提出物では **料金シミュレーションまでを実装**しつつ、
  クラス図・要件定義レベルでは **予約・座席・管理系まで含めた将来像**を定義している。
- ドメインモデルを中心に据えた構成とし、
  - データ取得方法の変更（静的 → API/DB）
  - 割引ルール追加
  - 予約 / 管理機能の追加
  を **既存ドメインを壊さずに段階的に追加できる構造**とすることを拡張方針とする。


## 11. スケジュール（作業計画）

| 日付       | 作業内容                           |
|------------|------------------------------------|
| 2025-11-20 | 要件定義書 |
| 2025-11-21 | 概念モデリング（クラス図・説明資料）   |
| 2025-11-22 | 設計書作成（画面設計・コンポーネント設計・テスト計画など） |
| 2025-11-23 | フロントエンド実装 |
| 2025-11-24 | フロントエンド実装完了・テスト実施 |
| 2025-11-25 | ドキュメント整備・最終確認           |

---

