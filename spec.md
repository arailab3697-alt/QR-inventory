# QR Inventory

QR コードで試薬在庫を確認する Web アプリケーションです。暗号化された在庫データをブラウザで復号し、カメラ読み取りと手入力を組み合わせて試薬の探索と棚卸を行います。

## 目的

- 試薬を素早く検索する
- 棚卸の進捗を可視化する
- 読み取った QR を一度だけ記録し、重複検出を抑える

## 画面構成

アプリは起動時にロック画面を表示します。

- パスワードを入力して暗号化データを復号する
- 復号成功後に scan / coverage の 2 モードを利用する

## モード

### 1. Scan

探索用モードです。

- 複数の探索対象 QR ID を登録できる
- カメラで検出した QR を overlay canvas に描画する
- 探索対象は赤、通常の登録済み QR は緑、未登録 QR は警告色で表示する
- 検出中の QR の ID と試薬名を表示する

### 2. Coverage

棚卸用モードです。

- 全体の scan 進捗を表示する
- 棚ごとの進捗を表示する
- 選択した棚に対して以下を表示する
  - Scanned items
  - Unscanned items
  - Foreign items
- 未登録で読み取った QR を `Unregistered items` として別枠で表示する
- coverage が 100% になったら完了バナーを表示する

## QR 検出

- 基本は `BarcodeDetector` を利用する
- カメラ映像は `<video>` で表示する
- QR の矩形とラベルは video 上に重ねた canvas へ描画する
- 同一 QR の連続検出は短時間にまとめ、読み取り済み集合として保持する

## 在庫データ

平文の在庫データは次の形式を想定する。

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

### ルール

- `id` は必須
- `name` と `shelf` は文字列として取り込む
- 同じ `id` の重複は 1 件にまとめる
- `id` の比較は大文字小文字を無視する

## 暗号化

在庫データはブラウザ側で Web Crypto API により復号する。

- 鍵導出: PBKDF2
- ハッシュ: SHA-256
- 暗号化方式: AES-GCM

## 実装メモ

- `src/lib/inventoryTypes.ts`: 在庫データ型
- `src/lib/inventoryParse.ts`: 平文 JSON の正規化
- `src/lib/inventoryDedup.ts`: `id` ベースの重複排除
- `src/lib/reagentIndex.ts`: QR ID から試薬を引く index
- `src/lib/shelves.ts`: 棚ツリーの構築
- `src/hooks/useSelectedShelfState.ts`: 選択棚の scanned / unscanned / foreign 集計

## Python ツール

`src-uv/main.py` で平文 JSON と暗号化 JSON を相互変換する。

条件:

- Python 3.12 以上
- `uv` で管理
- `cryptography` を利用
- AES-GCM と PBKDF2-HMAC-SHA256 を使用

## 技術スタック

- React
- TypeScript
- Vite
- Web Crypto API
- Shape Detection API
- Python
- uv
- cryptography
