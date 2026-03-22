import json
import sys

import requests


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python seed_profile.py profile.sample.json")

    profile_path = sys.argv[1]
    with open(profile_path, "r", encoding="utf-8") as file:
        data = json.load(file)

    response = requests.post("http://127.0.0.1:8765/profile", json={"data": data}, timeout=20)
    response.raise_for_status()
    print("Saved keys:", response.json().get("saved_keys", []))


if __name__ == "__main__":
    main()
