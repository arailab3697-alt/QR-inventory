# QR Inventory

QR コードで試薬の在庫を読み取り、暗号化された JSON データを復号して管理する Web アプリです。

## 構成

- `src/`
  - React + TypeScript の画面実装
  - QR 読み取り画面、進捗表示、手入力フォールバック
  - `src/lib/crypto.ts`: Web Crypto API を使った PBKDF2 + AES-GCM
  - `src/lib/inventory.ts`: 在庫データの正規化と検索用ユーティリティ
- `data/`
  - `plain.json`: 平文の在庫データサンプル
- `src/encryptedInventory.ts`
  - アプリ起動時に復号する埋め込み済み暗号化データ
- `src-uv/`
  - Python の変換ツール
  - `main.py`: `encrypt` / `decrypt` CLI
  - `pyproject.toml`: Python 側の依存定義

## 起動

```bash
npm install
npm run dev
```

ビルド確認:

```bash
npm run build
npm run lint
```

## Python ツール

`src-uv/main.py` には、平文 JSON と暗号化 JSON を相互変換する CLI があります。

```bash
uv run main.py encrypt ..\private\reagents.json ../src/encryptedInventory.ts --ts --password cucris
uv run main.py decrypt ../encrypted.json ../plain.json --password cucris
```

## データ形式

在庫データは次のような形を想定しています。

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

暗号化形式は PBKDF2 で鍵を導出し、AES-GCM で本文を保護しています。
