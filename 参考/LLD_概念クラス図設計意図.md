# 映画館料金システム クラス設計解説（技術面接用）（LLD_概念クラス図_v3.jpg対応）

## 0. 全体方針・設計コンセプト

- **将来の拡張を見据えたドメインモデル中心設計**
  - 提示されている課題はあくまで「料金計算ロジック」の実装であるが、課題が非常にシンプルであり、工夫がしづらい面があるため、上流工程に関心が強いことを活かし、将来的に必要となるであろう「作品管理」「上映管理」「予約管理」などの概念もクラス図上に含め、ドメインモデル中心設計の観点で全体像を捉えた設計にしている。

- **料金計算ロジックをドメインモデル側に集約し、変更に強くする**
  - 料金ルールや割引条件はデータ＋ロジックとしてクラス化し、if 文だらけの「料金計算メソッド」を避ける。
  - 新しい割引ルール追加時は、**`割引条件` の実装クラスを増やす**ことで対応できる構成。
  - 料金計算のアルゴリズム自体も `料金計算サービス` に集約し、ルール追加とアルゴリズム変更を独立に行えるようにしている。

- **今回は簡略化のため座席“数”のみを扱い、座席位置は未モデリング**
  - 本来は映画館の座席ということで、前後方の選択や隣り合わせの可否なども考慮して、座席表` や `座席予約` のようなクラスで「どの座席が残っているか」を管理すべきではあるが、今回は提示されている静的データに座席位置情報が含まれておらず、スコープに含めるとシステムが非常に複雑化するため、「座席数」のみで扱う設計にしている。

- **クラス図と実装のスコープを分けて設計**
  - 要件定義上でSHOULD、COHULDレベルの要件として挙がっている管理システムや予約システムもクラス図上に含め、将来の拡張を見据えた設計にしつつ、実装範囲を明確に区分。

---

## 1. コアドメイン【実装範囲】


### 1-1. 上映回（Screening）

#### 役割・責務

- 特定日時・特定スクリーンでの上映単位。
- 座席数と残席数を持ち、**収容可能か** という座席連動ロジックを担う。
- 予約システムを実装する場合は、**収容可能か**の他に**予約可能か／座席確保**の判定も担う。

#### 主な属性（Attributes）

- `id: string`
  - 上映ID（上映単位の識別子）
- `movieTitle: String`
  - 表示用の作品名。実装ではモックデータから文字列で受け取る
- `startAt: DateTime`
  - 上映開始日時
- `availableSeats: int`
  - 現時点で利用可能な座席数。実装では座席位置や確保状況を管理せず、この値のみで収容可否を判定する


#### 未実装の属性（将来拡張）

- `movieId: int`（未実装）
  - DB上のFKを意識したフィールド。
- `initialSeatCount / remainingSeatCount`
  - 実装では簡略化のため `availableSeats` の単一値のみ保持しているが、将来的に予約確定後の残席を管理する場合は初期座席数と残席数を分ける想定


#### 主なメソッド（インターフェース）

- `canAccommodate(numberOfPeople: int): bool`
  **入力**
  - `numberOfPeople: int` — 団体人数

  **出力**
  - `boolean` — 残り座席数が人数以上なら `true`

  **意図**
  - 「理論上の収容可能か」を判定するメソッド。


#### **未実装メソッド（今後追加予定）**

- `canReserve(numberOfPeople: int): bool`
  **入力**
  - `numberOfPeople: int` — 予約希望人数

  **出力**
  - `boolean` — 現在の残席数が人数以上なら `true`

  **意図**
  - 「現在の残席ベースで予約できるか」を判定
  - `canAccommodate()` が理論上の収容制約、`canReserve()` が実際の残席制約


- `reserveSeats(numberOfPeople: int): void`
  **入力**
  - `numberOfPeople: int` — 確定予約人数

  **処理**
  - 事前に `canReserve()` が `true` である前提で `availableSeats -= numberOfPeople` を行う（将来的に初期座席数と残席数を分離する場合は残席側を更新）

  **意図**
  - 残席は `Screening` が集約として一元管理し、外部が勝手に変更できないようにする


#### 補足：本来の座席モデルについて

- 現在は **「座席数」= 整数** で扱っているため、
  - 「どの席（中央/前/後ろ）」
  - 「団体客が隣り合わせで座れるか」
  のような制約は表現できていない。
- 実運用の映画館システムでは、未実装の属性やメソッドの他に以下のようなクラスを追加して設計すべき：
  - `Seat`：座席番号・列・スクリーンなど
  - `SeatReservation`：`Seat`＋`Screening`＋`Reservation` との紐づけ
- 今回は料金・人数ロジックにフォーカスし、座席位置はスコープ外と割り切っている。


---
### 1-2. 観覧団体（Group）

#### 役割・責務

- 家族・友人・学校団体など、上映回に対して一緒に観に行く人の集合を表す。
- 年齢構成・人数を集約し、料金計算や座席収容判定の入力となる。

#### 主な属性（Attributes）

- `members: List<Participant>`
  - 団体を構成する参加者一覧（後述の `参加者` クラスの集合）

#### 主なメソッド（インターフェース）

- `size(): int`
  **出力**
  - `int` — `members.size()`（参加者数）

  **意図**
  - 団体人数を取得し、料金計算・座席収容判定の基本情報とする


- `hasMinor(): bool`
  **出力**
  - `boolean` — `age < 18` が1人でもいれば `true`

  **意図**
  - 未成年が一人でもいる場合、20時以降の上映が不可となるルール判定に利用する
  - 今回は使用しないがPG指定判定にも応用可能


#### 未実装のメソッド（将来拡張）

- `includesUnder15(): bool`
  **出力**
  - `boolean` — 15歳未満を含むか

  **意図**
  - PG12 / R15 制限と整合可能

- `includesUnder12(): bool`
  **出力**
  - `boolean` — 12歳未満を含むか

  **意図**
  - PG12 制限と整合可能

- 現時点の料金ロジックでは使用しないため、**コードとして未実装**。


#### 関係

- `Group "1" --> "1..*" Participant : contains（集約）`
  - 観覧団体は複数参加者の集約ルートとなる

---

### 1-3. 参加者（Participant）

#### 役割・責務

- 個々の来場者を表す値オブジェクト的な存在。
- 年齢や区分に基づき、料金ルールの適用判定対象となる。

#### 主な属性（Attributes）

- `age: int`
  - 参加者の年齢

- `category: CategoryType`
  - 参加者区分（一般／学生／シニア／子ども等を想定した enum）

#### 主なメソッド（インターフェース）

- `isMinor(): bool`
  **出力**
  - `boolean` — `age < 18`

  **意図**
  - 未成年割引・年齢限定上映の基礎判定に利用する


- `isSenior(): bool`
  **出力**
  - `boolean` — `age >= 60`

  **意図**
  - シニア料金ルール適用の判定に利用する


#### 未実装のメソッド（将来拡張）

- `isUnder15(): bool`
  **出力**
  - `boolean` — `age < 15`

  **意図**
  - PG12 / R15 制限の判定に利用する

- `isUnder12(): bool`
  **出力**
  - `boolean` — `age < 12`

  **意図**
  - PG12 制限の判定に利用する

- 現時点では料金計算が主体のため、**コード上は未実装**としている

---

### 1-4. 検索条件（SearchCondition）

#### 役割・責務

- 料金計算や最適上映回算出時に利用する検索パラメータを保持するレスポンスオブジェクト。

#### 主な属性（Attributes）

- `currentDateTime: DateTime`
  - 診断時点の日時
  - 割引条件（日付／時間帯／曜日など）との照合に使用する

- `group: Group`
  - 観覧団体（年齢構成・人数判定の対象）

#### 関係

- `SearchCondition --> Group : refers（依存）`
  - 検索条件が観覧団体を参照し、料金計算や上映可能判定に利用する

---

### 1-5. 最適プラン結果（BestPlanResult）

#### 役割・責務

- 最適な上映回と、その上映回における合計料金を表すレスポンスオブジェクト。
- 利用不可の場合は、利用不可理由を保持する。

#### 主な属性（Attributes）

- `screening: Screening?`
  - 選択された上映回（利用不可の場合は `null`）

- `totalPrice: int?`
  - 合計料金（利用不可の場合は `null`）

- `isAvailable: bool`
  - プランが利用可能かどうか

- `breakdown: PriceBreakdownItem[]?`
  - 料金内訳。ルールごとの単価・人数・小計を含む

##### PriceBreakdownItem（料金内訳項目）
- **役割**: 1 本の上映プランにおいて、どの料金ルールが何人に適用され、いくらになったかを一覧化する行オブジェクト。UI に金額内訳を説明するためのデータソースとなる。
- **主な属性**:
- `ruleId: string` — 内訳行に紐づく料金ルール ID。UI でルール説明を引く際のキーになる。
- `ruleName: string` — 料金ルール名（例：一般、ファーストデイ）。ユーザーに説明する表示用文言。
- `participantCategory: CategoryType` — 適用対象となった参加者区分。料金設定の根拠を可視化するために保持。
- `unitPrice: int` — 単価（円）。1 名あたりの料金を保持し、単価改定時の検証にも利用できる。
- `quantity: int` — 適用人数。複数人が同じルールで課金された場合にまとめて表現する。
- `subtotal: int` — `unitPrice × quantity` の小計。最終合計金額と一致するかの検算に使用する。

- **意図**: 最適プランが「どの割引で安くなったのか」を可視化し、将来的には管理画面やレシート出力でもそのまま利用できるようにする。

- `errorCode: DomainErrorCode?`
  - プレゼンテーション層からエラーメッセージを選択表示できるよう、ドメイン側で理由をコード化

- `reasonIfUnavailable: String?`
  - 利用不可の理由（例：対象の上映回なし／PG制限不一致 等）
  - `errorCode` とセットで UI に表示する文言。コードで表示文言を選び、必要に応じてこの文字列を補足説明として利用する

---

### 1-6. 料金ルール（PriceRule）

#### 役割・責務

- 「誰が」「いつ」観に来たかに応じて適用される料金ルールを表現する。
- 例：一般 1,800円／高校生 1,000円／ファーストデイ 1,200円／レイトショー 1,300円など。

#### 主な属性（Attributes）

- `id: string`
  - 料金ルールの識別子（実装では文字列IDを付与）

- `name: String`
  - ルール名（例：「一般」「レイトショー」「ファーストデイ」）

- `targetCategory: CategoryType`
  - 対象となる参加者区分（ADULT / MINOR / SENIOR など）

- `price: int`
  - 適用される料金（円）

- `conditions: List<DiscountCondition>`
  - ルール適用のために満たすべき条件群

#### 主なメソッド（インターフェース）

- `isApplicable(screening: Screening, participant: Participant): bool`
  **出力**
  - `boolean` — `conditions` の全要素が `isSatisfied(...) == true` なら `true`

  **意図**
  - 条件の評価ロジックをルール側に保持し、料金計算サービス側をシンプルに保つ

---

### 1-7. 割引条件インターフェース（DiscountCondition）

#### 役割・責務

- すべての割引条件が実装すべき共通インターフェースを定義する。
- 戦略パターン的に条件ロジックを差し替え可能にする。

#### 主なメソッド（Interface）

- `isSatisfied(screening: Screening, participant: Participant): bool`
  **出力**
  - `boolean` — 割引条件に合致する場合 `true`

  **意図**
  - 条件ごとにクラスを追加するだけで拡張でき、料金計算サービス側を変更しない


---
### 1-8. 各種条件クラス（Conditions）

#### 年齢条件（AgeCondition）

#### 役割・責務

#### 主な属性（Attributes）

- `minAge: int?`
  - 最低年齢（null の場合は下限なし）
- `maxAge: int?`
  - 最高年齢（null の場合は上限なし）

#### 主なメソッド（インターフェース）
- `isSatisfied(screening: Screening, participant: Participant): bool`
  **出力**
  - `boolean` — `participant.age` が `[minAge, maxAge]` 範囲内の場合 `true`
  **意図**
  - 例：通常料金(未成年) → `maxAge = 17`

#### 月日条件（DayOfMonthCondition）

#### 役割・責務
- 「毎月◯日」ベースの割引条件を表現する。

#### 主な属性（Attributes）

- `dayOfMonth: int`
  - 月内日付（例：1 → 毎月1日）

#### 主なメソッド（インターフェース）

- `isSatisfied(screening: Screening, participant: Participant): bool`
  **出力**
  - `boolean` — `screening.startAt.day == dayOfMonth`

  **意図**
  - 例：ファーストデイ → `dayOfMonth = 1`

#### 時間帯条件（TimeRangeCondition）

#### 役割・責務
- 上映開始時刻が指定の時間帯に含まれる場合のみ割引を適用する。

#### 主な属性（Attributes）

- `startTime: LocalTime?`
  - 時間帯開始時刻（null の場合は下限なし）
- `endTime: LocalTime?`
  - 時間帯終了時刻（null の場合は上限なし）

#### 主なメソッド（インターフェース）

- `isSatisfied(screening: Screening, participant: Participant): bool`
  **出力**
  - `boolean` — `screening.startAt.time` が `[startTime, endTime)` に含まれる場合 `true`

  **意図**
  - 例：レイトショー → `startTime = 20:00`

#### 曜日条件（WeekdayCondition）

#### 役割・責務
- 上映日の曜日に応じた条件を表す（サービスデーなどに利用）。

#### 主な属性（Attributes）

- `weekdays: List<DayOfWeek>`
  - 適用対象となる曜日を配列で保持（例：`[Monday, Tuesday, Wednesday, Thursday, Friday]` で平日全体を表現）。複数曜日の条件でもクラス追加なしで対応可能
- `description: String?`
  - 管理画面やログ向けの補足説明（任意）

#### 主なメソッド（インターフェース）

- `isSatisfied(screening: Screening, participant: Participant): bool`
  **出力**
- `boolean` — `screening.startAt.weekday` が `weekdays` 配列に含まれる場合は `true`

  **意図**
- 例：サービスデー → `weekdays = [Tuesday]`
- 例：平日シニア割 → `weekdays = [Monday, Tuesday, Wednesday, Thursday, Friday]`

#### 実装状況
- 平日シニア割など曜日指定の料金ルールで利用するため、コードでも `WeekdayCondition` を実装済み。

#### 共通の意図
- 条件ごとに責務を分離し、複数条件を組み合わせて新しい割引を表現できる構造とする（コンポジション）
- 例：
  - 「レイトショー」 → TimeRangeCondition のみ
  - 「ファーストデイかつ未成年割」 → DayCondition + AgeCondition の組み合わせ

---
### 1-9. 料金計算サービス（PricingService）

#### 役割・責務（Responsibility）

- 全体の料金計算ロジックを束ねるドメインサービス。
- 利用者から見ると「この団体で、いつ・どの上映に行ったら、いくらかかるか？」を算出する入口。

---

#### 属性（Attributes）

- `priceRules: List<PriceRule>`
  適用対象となる料金ルール一覧。

---

#### 主なメソッド（Methods）

---

##### `searchBestPlan(condition: SearchCondition, screenings: List<Screening>): BestPlanResult`

**入力**
- `condition` — 現在日時＋観覧団体情報
- `screenings` — 検討対象の上映回候補

**処理フロー（概要）**
1. `screenings.startAt` が `condition.currentDateTime` 以前の上映回を除外
2. `canAccommodate(group.size)` を満たさない上映回を除外
3. 観覧団体に未成年が含まれており、かつ `screening.startAt` が 20 時以降の上映回を候補から除外（将来的にはPG制限もここで判定可能）
4. 各上映回について参加者ごとに適用可能な `PriceRule` を探索
5. 団体全体の合計料金を算出
6. 最も安い組み合わせの中から、`screening.startAt` が最も早いものを選択して `BestPlanResult` を返却
7. 利用可能な上映回がない場合は、`BestPlanResult.isAvailable = false` として理由を設定して返却

**出力**
- `BestPlanResult` — 最適上映回＋合計料金、または利用不可理由
- `calculateMinimumPrice()` が返す `EvaluatedPlan`（後述）の中で最安値だったものを元に、UI 用の結果へ整形する



---

##### `calculateMinimumPrice(screening: Screening, group: Group): EvaluatedPlan | null`

**入力**
- `screening` — 対象上映回
- `group` — 観覧団体

**処理フロー（概要）**
1. 団体の各参加者ごとに適用可能な `PriceRule` を探索
2. 各参加者ごとに最安料金を選択し、ルールIDやカテゴリとともに内訳へ集計
3. 全員分の評価が完了したら `EvaluatedPlan`（合計金額と `PriceBreakdownItem` の配列）を返却。どの参加者にも適用可能なルールが見つからない場合は `null`

**出力**
- `EvaluatedPlan | null` — 当該上映回における最安料金と料金内訳。算出不可能な場合は `null`

###### `searchBestPlan` と `calculateMinimumPrice` の役割分担
- `calculateMinimumPrice` は純粋な料金計算を担当し、`screening`・`totalPrice`・`breakdown (ruleId, ruleName, participantCategory, unitPrice, quantity, subtotal)` を保持した `EvaluatedPlan` を返す
- `searchBestPlan` は上映フィルタ（過去除外／席数／20時以降）と最安プラン比較を担い、最後に `EvaluatedPlan` を `BestPlanResult`（UI 用）へ写像する
- これにより料金計算ロジックをテストしやすく保ったまま、UI 向けの可用性判定やメッセージ整形を別責務に切り出せる

###### `EvaluatedPlan`（内部値オブジェクト）
- `screening: Screening`
- `totalPrice: int`
- `breakdown: PriceBreakdownItem[]` （各行に `ruleId`/`ruleName`/`participantCategory`/`unitPrice`/`quantity`/`subtotal` を含む）
  - Breakdown 行の `ruleId` が UI 側で "どの料金ルールが適用されたか" を説明する `appliedRuleId` として機能する

---

#### 意図（Design Intent）

- **計算アルゴリズムは `PricingService` に集約**
- **条件評価は `PriceRule + DiscountCondition` 側に分離**
  - → アルゴリズムとルール定義が独立
- 「未成年を含む団体は 20 時以降の上映を選択できない」といった **利用可否の制約** も、料金ルールではなく上映候補フィルタ（`findBestPlan` 内）でまとめて扱う。

**拡張性**
- 新ルール追加 → 新条件クラス追加で対応（既存ロジック変更不要）
- アルゴリズム変更 → サービス側のみ修正すればよく、ルール定義はそのまま

---

## 2. 管理システム【将来拡張-熟考はしていないので抜け漏れの可能性あり】

### 2-1. 作品（Movie）

#### 役割・責務（Responsibility）

- 映画作品そのものを表現するドメインエンティティ。
- 上映スケジュールや料金計算の前提となる作品情報を保持する。
- 今回実装範囲ではロジック未使用（管理システム側の対象）。

---

#### 主な属性（Attributes）

- `movieId: int`
  - DB 上の主キー相当。`Screening` から FK 参照。
- `title: String`
- `durationMinutes: int`
- `rating: String`
  - PG12 / R15 などのレーティング。
  - 将来的には enum 型または専用クラスに抽象化可能。

---

#### 関係（Relationships）

- `Movie "1" --> "1..*" Screening : 上映する`
  - 1つの作品に対して複数の上映が紐づく関係。

---

#### 実装状況（Implementation Note）

- **今回のコード実装には含めない（設計のみ）。**
- 「作品管理（CRUD）」「レーティングに基づく入場制限」は将来の拡張で実装。
- 現行の料金シミュレーションでは上映単位（Screening）から作品情報を参照しないため、仕様上は未使用。
- 本来はコアドメインに含まれるべき概念である

---


### 2-2. 管理者（AdminUser）

#### 役割・責務（Responsibility）

- 管理システムにおける操作主体（作品管理／上映管理／料金ルール管理など）。

#### 主な属性（Attributes）

- `adminUserId: int`
- `name: String`
- `role: String`  // 権限レベルなど

---

### 2-3. 作品管理サービス（MovieAdminService）

#### 役割・責務（Responsibility）

- `作品（Movie）` のライフサイクル管理を行うアプリケーションサービス。
- UI や API から直接 `Movie` を操作せず、本サービス経由で CRUD を行う入口となる。

---

#### 主なメソッド（Methods）

- `registerMovie(movie: Movie): void`
  - **入力**
    - `movie: Movie` — 登録対象の作品情報
  - **出力**
    - `void` — 戻り値なし（必要に応じて ID や結果オブジェクトを返す設計も可能）
  - **意図**
    - 新規作品の登録処理を一元管理する。
    - バリデーションや重複チェック、監査ログ出力などをドメイン外（UI）ではなくサービス側で担えるようにする。

- `updateMovie(movieId: int, movie: Movie): void`
  - **入力**
    - `movieId: int` — 更新対象の作品ID
    - `movie: Movie` — 更新後の作品情報
  - **出力**
    - `void` — 戻り値なし（更新結果やバージョン情報を返す設計もあり得る）
  - **意図**
    - 作品情報の更新を一箇所に集約することで、
      作品更新時の整合性チェック（レーティング変更に伴う制約など）をここに閉じ込める。

- `deleteMovie(movieId: int): void`
  - **入力**
    - `movieId: int` — 削除対象の作品ID
  - **出力**
    - `void` — 戻り値なし
  - **意図**
    - 作品削除の入り口を一本化し、
      「該当作品に紐づく上映回がある場合は論理削除にする」などの運用ポリシーを、
      呼び出し側ではなくサービス内で制御できるようにする。

---

### 2-4. 上映管理サービス（ScreeningAdminService）

#### 役割・責務（Responsibility）

- `上映回（Screening）` の登録・更新・削除を行うアプリケーションサービス。
- 編成担当者が GUI や管理画面から上映スケジュールを扱う際の入口となる。

---

#### 主なメソッド（Methods）

- `createScreening(movieId: int, startAt: DateTime, seatCount: int): void`
  **入力**
  - `movieId: int` — 上映する作品ID
  - `startAt: DateTime` — 上映開始日時
  - `seatCount: int` — 初期座席数

  **出力**
  - `void` — 戻り値なし（必要に応じて Screening を返す設計も可能）

  **意図**
  - 新規上映を作成する。
  - 座席数や上映時間の整合チェックをサービス側に閉じ込め、
    UI では検証ロジックを持たないようにする。


- `updateScreening(screeningId: string, ...): void`
  **入力**
  - `screeningId: string` — 更新対象の上映回ID
  - `...` — 更新内容（日時や座席数、作品IDなど）

  **出力**
  - `void`

  **意図**
  - 上映スケジュールや座席数の変更を反映する。
  - 「既に予約がある上映に対する座席数変更」などの運用制約を
    サービス側で制御可能にする。


- `deleteScreening(screeningId: string): void`
  **入力**
  - `screeningId: string` — 削除対象の上映回ID

  **出力**
  - `void`

  **意図**
  - 上映回を削除する。
  - 予約済みの場合は取消不可 or 論理削除にするなどの運用ルールを
    UI ではなくサービス側で適用できる。

---

#### 関係（Relationships）

- `AdminUser --> ScreeningAdminService : operate`
- `ScreeningAdminService --> Screening : manage (CRUD)`

---


---

### 2-5. 料金ルール管理サービス（RuleAdminService）

#### 役割・責務（Responsibility）

- `料金ルール（PriceRule）` の登録・変更・削除を行う管理サービス。
- 値上げ・割引キャンペーン・新料金体系の導入を「コード変更なしに」運用で調整できる状態を目指す。

---

#### 主なメソッド（Methods）

- `createRule(rule: PriceRule): void`
  **入力**
  - `rule: PriceRule` — 新規に追加する料金ルール

  **出力**
  - `void`

  **意図**
  - 新しい料金ルールを作成しシステムに追加する。
  - 価格改定や季節限定価格などを、プログラムではなくデータ追加で対応可能にする。


- `updateRule(ruleId: string, rule: PriceRule): void`
  **入力**
  - `ruleId: string` — 更新対象のルールID
  - `rule: PriceRule` — 更新内容を含むルールオブジェクト

  **出力**
  - `void`

  **意図**
  - 既存ルール内容を変更する。
  - キャンペーン終了／割引条件追加／価格改定の運用を想定。


- `deleteRule(ruleId: string): void`
  **入力**
  - `ruleId: string` — 削除対象のルールID

  **出力**
  - `void`

  **意図**
  - 過去に使用した古い料金ルールや誤登録ルールを削除する。
  - 過去データとの整合性維持のため「無効化フラグで論理削除」案も考慮可能。

---


## 3. 予約システム【将来拡張-熟考はしていないので抜け漏れの可能性あり】

### 3-1. 顧客（Customer）

- 属性
  - `顧客ID: int`
  - `氏名: String`
  - `メールアドレス: String`

- 意図
  - 予約情報や通知（メール送信など）に利用。

---

### 3-2. 予約（Reservation）

#### 役割・責務（Responsibility）

- 映画館システムにおける「予約」というビジネス上の事実を表すエンティティ（集約ルート）。
- 顧客・上映回・団体・料金を一括して保持し、後続の決済／発券処理の基礎データとなる。

---

#### 主な属性（Attributes）

- `reservationId: int`
  予約データの識別子（主キー相当）

- `customer: Customer`
  予約者情報

- `screening: Screening`
  どの上映回に対する予約か

- `group: Group`
  どの観覧団体が参加するか

- `totalPrice: int`
  当該予約における確定済み料金

- `status: String`
  予約状態（例：`pending`／`confirmed`／`canceled`）

---

#### 主なメソッド（Methods）

- `confirm(): void`
  **処理**
  - `status` を `confirmed` に更新し、必要に応じて座席確保処理を実行する（実装は別サービスで担う場合もあり）

  **意図**
  - 仮予約状態から正式予約に遷移させるライフサイクル操作。


- `cancel(): void`
  **処理**
  - `status` を `canceled` に更新
  - 必要に応じて座席を解放する（実装スタイルに依存）

  **意図**
  - キャンセル時に残席反映の起点となる。

---

#### 意図（Design Intent）

- **「予約」というビジネスイベントを表現する中心エンティティ**として設計。
- 将来的には次のような情報を外部クラスと連携し管理するための基礎となる：
  - 決済情報 (`Payment`)
  - 発券・チケット情報 (`Ticket`)
  - 座席確保 (`SeatReservation`)
- ライフサイクル管理（仮→確定→発券→入場→キャンセル）を拡張しやすくするため、
  `Reservation` を集約ルートとして保持。

---


---

### 3-3. 予約サービス（ReservationService）

#### 役割・責務（Responsibility）

- `Reservation` の生成・状態遷移を司るアプリケーションサービス（オーケストレーター）。
- 座席確保や料金算出は **ドメインサービス / 上映回側のロジックを呼び出して制御**する。

---

#### 主なメソッド（Methods）

---

##### `estimatePrice(screening: Screening, group: Group): int`

**入力**
- `screening` — 対象上映回
- `group` — 観覧団体

**処理**
- `PricingService.calculateMinimumPrice()` に委譲し、見積もりだけを返す。

**出力**
- `int` — 見積もり料金

**意図**
- UI から「この条件だといくらか？」を即時計算する用途を想定。
- 状態変更は行わず、あくまで計算結果の返却に徹する。

---

##### `createReservation(customer: Customer, screening: Screening, group: Group): Reservation`

**入力**
- `customer` — 予約者
- `screening` — 対象上映回
- `group` — 観覧団体

**処理フロー（概要）**
1. `PricingService.calculateMinimumPrice()` で料金を算出
2. `screening.canReserve(group.size)` で空席確認
3. `screening.reserveSeats(group.size)` を呼び出して残席を減算
4. `Reservation` を生成（初期状態は `pending` or `confirmed`）

**出力**
- `Reservation` — 予約情報オブジェクト

**意図**
- 座席確保や料金計算はドメイン側に委譲し、
  `ReservationService` はユースケース制御（順序・例外処理など）に専念。

**補足**
- 決済・ステータス遷移を扱う場合は `PaymentService` や `TicketService` を別途定義し、このサービスから呼び出す。


---

#### 意図（Design Intent）

- **ドメインロジックは `Screening` / `PricingService` に集約**
  - 予約サービスは手続きの「流れ」を制御するのみ
- **ユースケース単位で API・UI と接続しやすくする**
  - REST や GraphQL のエンドポイントになる想定
- **副作用（座席変更）を責務分離**
  - 座席更新を `Screening` 側で行い、整合性を担保


---

## 4. まとめ

- **ドメインモデル中心設計**
  - 「何をクラスとして切り出すか」をビジネス概念（作品／上映回／観覧団体／料金ルール／割引条件）に合わせて設計。
- **変更に強い料金ロジック**
  - 割引ルールは `PriceRule`＋`DiscountCondition` の組み合わせで表現し、
    新しい割引はクラスを追加するだけで拡張できる構造。
- **年齢・時間・日付条件の汎用化**
  - `AgeCondition`、`TimeRangeCondition`、`DayCondition` といった汎用的な条件クラスを設計し、
    現実の映画館キャンペーンに近いルールを表現しやすくしている。
  - なお、`WeekdayCondition` も実装済みであり、設計ドキュメントとコードの乖離がない状態にしている。
- **座席連動**
  - `Screening` クラスが座席数と残席数を管理し、
    `canAccommodate()` メソッドで収容可能かを判定するロジックを実装。
  - 一方で、本来必要な「座席位置」の概念（`Seat`／`SeatReservation` 等）は
    未実装であり、今後の改善ポイントとして認識している。
- **PG 指定・作品管理などの拡張余地をクラス図で先に示している**
  - 観覧団体・参加者には PG 指定と対応する属性（15歳未満／12歳未満）を**クラス図上で設計**しつつ、
    今回は料金ロジックの実装に絞るためコード上は未実装としている。
  - 作品クラスも同様に、**管理システム側のエンティティとしてクラス図には存在**させ、
    実装は上映／料金周りにフォーカスしている。
- **レイヤ分離**
  - コアドメイン（料金・上映・団体）
  - 管理システム（管理者による CRUD）
  - 予約システム（顧客・予約）
  に分けることで、課題要件と将来拡張のスコープを明確に区分。

---
# 以上
