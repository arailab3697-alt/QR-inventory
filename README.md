# QR Inventory

QR コードで試薬在庫を確認する Web アプリです。暗号化された在庫データをブラウザで復号し、カメラ読み取りと手入力を使って探索と棚卸を行います。

## 機能

- パスワードによる在庫データの復号
- QR カメラ読み取り
- 探索対象 ID の登録と強調表示
- 棚卸進捗の可視化
- 棚ごとの `Scanned / Unscanned / Foreign` 表示
- 未登録 QR の表示
- 手入力による QR ID 確認

## 構成

- `src/App.tsx`
  - 画面全体の状態管理とレイアウト
- `src/components/`
  - `InventoryItemList.tsx`: アイテム一覧の共通描画
  - `ShelfItemsSection.tsx`: 棚内アイテムのセクション表示
  - `ShelfTreePanel.tsx`: 棚ツリー表示
- `src/hooks/`
  - `useSelectedShelfState.ts`: 選択棚の派生 state 計算
- `src/lib/`
  - `code.ts`: QR ID 正規化
  - `crypto.ts`: PBKDF2 + AES-GCM の復号処理
  - `inventoryTypes.ts`: 在庫データ型
  - `inventoryParse.ts`: 在庫 JSON の正規化
  - `inventoryDedup.ts`: `id` ベースの重複排除
  - `reagentIndex.ts`: QR ID から試薬を引く index
  - `shelves.ts`: 棚グループ構築
  - `shelfSelection.ts`: 棚選択文字列の解析
- `src/encryptedInventory.ts`
  - アプリ起動時に復号する埋め込み済み暗号化データ
- `src-uv/`
  - Python の変換ツール

## 起動

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
```

## Python ツール

`src-uv/main.py` には、平文 JSON と暗号化 JSON を相互変換する CLI があります。

```bash
uv run main.py encrypt ..\private\reagents.json ../src/encryptedInventory.ts --ts --password cucris
uv run main.py decrypt ../encrypted.json ../plain.json --password cucris
```

## データ形式

平文の在庫データは次の形式を想定しています。

```json
{
  "reagents": [
    {
      "id": "12345",
      "name": "Acetone",
      "shelf": "A-1"
    }
  ]
}
```

## 暗号化

- 鍵導出: PBKDF2
- ハッシュ: SHA-256
- 暗号化方式: AES-GCM

ブラウザ側では Web Crypto API を使って復号します。
