from __future__ import annotations

import argparse
import base64
import json
import os
from dataclasses import asdict, dataclass
from getpass import getpass
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


ITERATIONS = 210_000
ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class InventoryEnvelope:
    version: int
    kdf: dict[str, Any]
    cipher: dict[str, Any]
    payload: str


def b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64decode(value: str) -> bytes:
    return base64.b64decode(value.encode("ascii"))


def normalize_inventory(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict) and isinstance(payload.get("reagents"), list):
        reagents = payload["reagents"]
    elif isinstance(payload, dict):
        reagents = []
        for shelf, ids in payload.items():
            if not isinstance(ids, list):
                continue
            for reagent_id in ids:
                if isinstance(reagent_id, str) and reagent_id.strip():
                    reagents.append(
                        {
                            "id": reagent_id.strip(),
                            "name": reagent_id.strip(),
                            "shelf": str(shelf).strip(),
                        }
                    )
    else:
        raise ValueError("Inventory JSON must be an object.")

    cleaned = []
    seen: set[str] = set()
    for entry in reagents:
        if not isinstance(entry, dict):
            continue

        reagent_id = str(entry.get("id", "")).strip()
        name = str(entry.get("name", "")).strip()
        shelf = str(entry.get("shelf", "")).strip()
        if not reagent_id or not name or not shelf:
            continue

        key = reagent_id.lower()
        if key in seen:
            continue

        seen.add(key)
        cleaned.append({"id": reagent_id, "name": name, "shelf": shelf})

    return {"reagents": cleaned}


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=ITERATIONS,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_inventory(inventory: dict[str, Any], password: str) -> InventoryEnvelope:
    salt = os.urandom(16)
    iv = os.urandom(12)
    key = derive_key(password, salt)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(iv, json.dumps(inventory, ensure_ascii=False).encode("utf-8"), None)
    return InventoryEnvelope(
        version=1,
        kdf={
            "name": "PBKDF2",
            "hash": "SHA-256",
            "iterations": ITERATIONS,
            "salt": b64encode(salt),
        },
        cipher={
            "name": "AES-GCM",
            "iv": b64encode(iv),
        },
        payload=b64encode(ciphertext),
    )


def decrypt_inventory(envelope: InventoryEnvelope, password: str) -> dict[str, Any]:
    salt = b64decode(str(envelope.kdf["salt"]))
    iv = b64decode(str(envelope.cipher["iv"]))
    payload = b64decode(envelope.payload)
    key = derive_key(password, salt)
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(iv, payload, None)
    return json.loads(plaintext.decode("utf-8"))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Encrypt or decrypt QR inventory JSON.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    encrypt = subparsers.add_parser("encrypt", help="Encrypt a plain inventory JSON file.")
    encrypt.add_argument("input", nargs="?", default=ROOT / "private" / "reagents.json", type=Path)
    encrypt.add_argument("output", nargs="?", default=ROOT / "encrypted.json", type=Path)
    encrypt.add_argument("--ts", action="store_true", help="Output as TypeScript file.")
    encrypt.add_argument("--password", help="Password used to encrypt the payload.")

    decrypt = subparsers.add_parser("decrypt", help="Decrypt an encrypted inventory JSON file.")
    decrypt.add_argument("input", nargs="?", default=ROOT / "encrypted.json", type=Path)
    decrypt.add_argument("output", nargs="?", default=ROOT / "reagents.json", type=Path)
    decrypt.add_argument("--password", help="Password used to decrypt the payload.")

    return parser


def main() -> None:
    parser = make_parser()
    args = parser.parse_args()

    password = args.password or getpass("Password: ")

    if args.command == "encrypt":
        payload = normalize_inventory(read_json(args.input))
        envelope = encrypt_inventory(payload, password)
        if args.ts:
            content = f"const encryptedInventory = {json.dumps(asdict(envelope), indent=2)};\n\nexport default encryptedInventory;\n"
            args.output.write_text(content, encoding="utf-8")
        else:
            write_json(args.output, asdict(envelope))
        return

    envelope = InventoryEnvelope(**read_json(args.input))
    plain = decrypt_inventory(envelope, password)
    write_json(args.output, plain)


if __name__ == "__main__":
    main()
