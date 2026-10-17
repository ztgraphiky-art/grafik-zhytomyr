
import json
import re
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.ztoe.com.ua/unhooking-search.php"
OUTPUT = Path("data/schedule.json")


def main():
    response = requests.get(
        SOURCE_URL,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()
    response.encoding = response.apparent_encoding

    soup = BeautifulSoup(response.text, "html.parser")

    schedule_table = None

    for table in soup.find_all("table"):
        text = table.get_text(" ", strip=True)

        if (
            "Підчерга" in text
            and re.search(r"\b1\.1\b", text)
            and re.search(r"\d{2}:\d{2}\s*-\s*\d{2}:\d{2}", text)
        ):
            schedule_table = table
            break

    if schedule_table is None:
        raise RuntimeError(
            "Таблицю графіка не знайдено. "
            "Можливо, структура офіційного сайту змінилася."
        )

    rows = []

    for tr in schedule_table.find_all("tr"):
        cells = []

        for cell in tr.find_all(["th", "td"], recursive=False):
            cells.append({
                "text": cell.get_text(" ", strip=True),
                "class": cell.get("class", []),
                "style": cell.get("style", ""),
                "colspan": int(cell.get("colspan", 1)),
                "rowspan": int(cell.get("rowspan", 1)),
            })

        if cells:
            rows.append(cells)

    if len(rows) < 2:
        raise RuntimeError("Таблиця графіка неповна.")

    data = {
        "source": SOURCE_URL,
        "checked_at": datetime.now(
            ZoneInfo("Europe/Kyiv")
        ).isoformat(timespec="seconds"),
        "rows": rows,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Графік збережено.")
    print("Кількість рядків:", len(rows))
    print("Час перевірки:", data["checked_at"])


if __name__ == "__main__":
    main()
