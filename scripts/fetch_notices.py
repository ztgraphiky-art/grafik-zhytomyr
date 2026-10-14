import json
import re
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.ztoe.com.ua/unhooking-search.php"
OUTPUT = Path("data/notices.json")


def main():
    response = requests.get(
        SOURCE_URL,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"}
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))

    markers = [
        "УВАГА! ВАЖЛИВА ІНФОРМАЦІЯ!",
        "УВАГА! ВАЖЛИВА ІНФОРМАЦІЯ",
    ]

    start = -1
    for marker in markers:
        start = text.find(marker)
        if start != -1:
            break

    if start == -1:
        raise RuntimeError(
            "Не знайдено текст оголошення на сторінці. "
            "Структура сайту могла змінитися."
        )

    end_markers = [
        "Пошук черги та підчерги за адресою",
        "Пошук черги за адресою",
        "Графіки погодинних відключень",
    ]

    ends = [
        text.find(marker, start + 1)
        for marker in end_markers
    ]
    ends = [pos for pos in ends if pos != -1]

    message = text[start:min(ends)].strip() if ends else text[start:].strip()

    if len(message) < 20:
        raise RuntimeError("Отримане оголошення неповне.")

    data = {
        "source": SOURCE_URL,
        "checked_at": datetime.now(
            ZoneInfo("Europe/Kyiv")
        ).isoformat(timespec="seconds"),
        "message": message,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    print("Офіційне повідомлення збережено.")
    print("Час перевірки:", data["checked_at"])
    print("Текст:", message)


if name == "main":
    main()
