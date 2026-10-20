import asyncio
import hashlib
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import requests
from bs4 import BeautifulSoup
from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
)

# Bot settings are configured as GitHub repository secrets.
BOT_TOKEN = os.environ["BOT_TOKEN"]
CHANNEL_ID = os.environ["CHANNEL_ID"]

# Raw JSON files from the existing public repository.
REPO_OWNER = os.getenv("REPO_OWNER", "ztgraphiky-art")
REPO_NAME = os.getenv("REPO_NAME", "grafik-zhytomyr")
BRANCH = os.getenv("REPO_BRANCH", "main")
SCHEDULE_URL = os.getenv(
    "SCHEDULE_URL",
    f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{BRANCH}/data/schedule.json",
)
NOTICES_URL = os.getenv(
    "NOTICES_URL",
    f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/{BRANCH}/data/notices.json",
)
SOURCE_URL = "https://www.ztoe.com.ua/unhooking-search.php"
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "300"))
STATE_FILE = Path(os.getenv("BOT_STATE_FILE", "bot_state.json"))
QUEUES = [f"{n}.{sub}" for n in range(1, 7) for sub in (1, 2)]

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("zhytomyr-light-bot")


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"users": {}, "fingerprints": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        data.setdefault("users", {})
        data.setdefault("fingerprints", {})
        return data
    except (OSError, json.JSONDecodeError):
        log.exception("Could not read state file; starting with empty state")
        return {"users": {}, "fingerprints": {}}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp.replace(STATE_FILE)


def fetch_json(url: str) -> dict[str, Any]:
    response = requests.get(
        url,
        timeout=25,
        headers={"User-Agent": "ZhytomyrLightTelegramBot/1.0"},
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object from {url}")
    return data


def stable_fingerprint(data: Any) -> str:
    canonical = json.dumps(
        data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compact_json_payload(data: dict[str, Any]) -> Any:
    # Ignore checked_at so a routine refresh alone does not count as a change.
    result = dict(data)
    result.pop("checked_at", None)
    return result


def get_notice_text(data: dict[str, Any]) -> str:
    """Extract readable notice text from common JSON shapes."""
    for key in ("text", "notice", "message", "content", "title"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    # Common structure: {"notices": [...]} or {"items": [...]}
    for key in ("notices", "items", "messages"):
        value = data.get(key)
        if isinstance(value, list):
            pieces = []
            for item in value:
                if isinstance(item, str):
                    pieces.append(item.strip())
                elif isinstance(item, dict):
                    text = next(
                        (
                            item[k] for k in ("text", "notice", "message", "content")
                            if isinstance(item.get(k), str) and item[k].strip()
                        ),
                        None,
                    )
                    if text:
                        pieces.append(text.strip())
            if pieces:
                return "\n\n".join(pieces)

    return ""


def table_fingerprint_from_official_site() -> str:
    """Fallback monitoring of the official table HTML."""
    response = requests.get(
        SOURCE_URL,
        timeout=25,
        headers={"User-Agent": "Mozilla/5.0 (compatible; ZhytomyrLightBot/1.0)"},
    )
    response.raise_for_status()
    response.encoding = response.apparent_encoding
    soup = BeautifulSoup(response.text, "html.parser")

    target = None
    for table in soup.find_all("table"):
        text = table.get_text(" ", strip=True)
        if (
            "Підчерга" in text
            and re.search(r"\b1\.1\b", text)
            and re.search(r"\d{2}:\d{2}\s*-\s*\d{2}:\d{2}", text)
        ):
            target = table
            break

    if target is None:
        raise RuntimeError("Official schedule table was not found")

    # Keep text, cell classes and inline styles; ignore volatile attributes.
    rows = []
    for tr in target.find_all("tr"):
        row = []
        for cell in tr.find_all(["th", "td"], recursive=False):
            row.append({
                "text": cell.get_text(" ", strip=True),
                "class": cell.get("class", []),
                "style": cell.get("style", ""),
                "colspan": cell.get("colspan", "1"),
                "rowspan": cell.get("rowspan", "1"),
            })
        if row:
            rows.append(row)

    if not rows:
        raise RuntimeError("Official schedule table was empty")
    return stable_fingerprint(rows)



def cell_style_color(cell: dict[str, Any]) -> str:
    """Return a normalized background color from a schedule cell."""
    style = str(cell.get("style", "")).lower()
    match = re.search(r"(?:background-color|background)\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)", style)
    if match:
        return match.group(1)
    classes = cell.get("class", [])
    if isinstance(classes, str):
        classes = [classes]
    class_text = " ".join(str(item).lower() for item in classes)
    if "red" in class_text or "off" in class_text:
        return "red"
    return ""


def cell_text(cell: Any) -> str:
    if isinstance(cell, dict):
        return str(cell.get("text", "")).strip()
    return str(cell).strip()


def get_schedule_date(data: dict[str, Any]) -> str:
    rows = data.get("rows", [])
    if not isinstance(rows, list):
        return ""
    for row in rows:
        if not isinstance(row, list):
            continue
        for cell in row:
            text = cell_text(cell)
            match = re.search(r"\b\d{2}\.\d{2}\.\d{4}\b|\b\d{4}-\d{2}-\d{2}\b", text)
            if match:
                return match.group(0)
    return ""


def extract_queue_intervals(data: dict[str, Any], queue: str) -> list[str]:
    """Read red half-hour cells for a queue from schedule.json."""
    rows = data.get("rows")
    if not isinstance(rows, list):
        raise ValueError("У schedule.json немає масиву rows")

    queue_row = None
    for row in rows:
        if isinstance(row, list) and row and re.fullmatch(re.escape(queue), cell_text(row[0])):
            queue_row = row
            break
    if queue_row is None:
        raise ValueError(f"У schedule.json не знайдено підчергу {queue}")

    header_row = max(
        (row for row in rows if isinstance(row, list)),
        key=lambda row: sum(
            bool(re.search(r"\b\d{2}:\d{2}\s*[-–]\s*\d{2}:\d{2}\b", cell_text(cell)))
            for cell in row
        ),
        default=[],
    )
    time_labels = []
    for cell in header_row:
        match = re.search(r"(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})", cell_text(cell))
        if match:
            time_labels.append((match.group(1), match.group(2)))

    data_cells = queue_row[1:]
    if len(time_labels) != len(data_cells):
        if len(data_cells) == 48:
            time_labels = []
            for index in range(48):
                start_minutes = index * 30
                end_minutes = (index + 1) * 30
                time_labels.append((
                    f"{start_minutes // 60:02d}:{start_minutes % 60:02d}",
                    f"{end_minutes // 60:02d}:{end_minutes % 60:02d}",
                ))
        else:
            raise ValueError(
                f"Не вдалося зіставити години з клітинками черги {queue} "
                f"(клітинок: {len(data_cells)}, часових міток: {len(time_labels)})"
            )

    red_indices = []
    for index, cell in enumerate(data_cells):
        color = cell_style_color(cell)
        is_red = color in {"#ff3333", "#f33", "#ff0000", "#f00", "red"} or "red" in color
        if is_red:
            red_indices.append(index)

    if not red_indices:
        return []

    intervals = []
    start_index = previous_index = red_indices[0]
    for index in red_indices[1:]:
        if index == previous_index + 1:
            previous_index = index
        else:
            intervals.append(f"{time_labels[start_index][0]}–{time_labels[previous_index][1]}")
            start_index = previous_index = index
    intervals.append(f"{time_labels[start_index][0]}–{time_labels[previous_index][1]}")
    return intervals


def format_queue_schedule(data: dict[str, Any], queue: str) -> str:
    intervals = extract_queue_intervals(data, queue)
    date = get_schedule_date(data)
    date_line = f"Дата графіка: {date}\n" if date else ""
    hours = "\n".join(f"• {interval}" for interval in intervals) if intervals else (
        "У файлі немає позначених червоним проміжків для цієї черги."
    )
    checked_at = data.get("checked_at")
    checked_line = f"\nЧас перевірки джерела: {checked_at}" if checked_at else ""
    return (
        f"⚡ Графік для підчерги {queue}\n"
        f"{date_line}{hours}{checked_line}\n\n"
        f"Офіційне джерело: {SOURCE_URL}\n"
        "Звіряй години з офіційною таблицею."
    )


def get_queue_from_args(args: list[str]) -> str | None:
    if not args:
        return None
    candidate = args[0].strip()
    return candidate if candidate in QUEUES else None


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    if not chat or not update.effective_message:
        return
    state = load_state()
    user = state["users"].setdefault(str(chat.id), {})
    user.setdefault("queue", None)
    user["active"] = True
    save_state(state)

    await update.effective_message.reply_text(
        "💡 Вітаю! Це бот сповіщень про графіки відключень "
        "електроенергії на Житомирщині.\n\n"
        "Обери свою чергу: /queue 1.1\n"
        "Усі черги: /queues\n"
        "Мій графік: /schedule\n"
        "Статус джерел: /status\n"
        "Вимкнути особисті сповіщення: /stop\n\n"
        "Бот повідомляє про виявлені зміни в опублікованих даних. "
        "Завжди звіряй конкретні години з офіційним джерелом."
    )


async def cmd_queues(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.effective_message:
        await update.effective_message.reply_text(
            "Доступні черги:\n" + ", ".join(QUEUES) +
            "\n\nПриклад вибору: /queue 1.1"
        )


async def cmd_queue(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.effective_message:
        return
    queue = get_queue_from_args(context.args)
    if queue is None:
        await update.effective_message.reply_text(
            "Вкажи чергу з переліку 1.1–6.2, наприклад /queue 2.1."
        )
        return

    state = load_state()
    user = state["users"].setdefault(str(update.effective_chat.id), {})
    user["queue"] = queue
    user["active"] = True
    save_state(state)
    try:
        data = await asyncio.to_thread(fetch_json, SCHEDULE_URL)
        schedule_text = format_queue_schedule(data, queue)
    except Exception as exc:
        log.warning("Could not read queue schedule: %s", exc)
        schedule_text = (
            f"✅ Збережено чергу {queue}.\n"
            "Поки що не вдалося прочитати години з schedule.json. "
            "Спробуй пізніше або перевір /status."
        )
    await update.effective_message.reply_text(
        f"✅ Збережено чергу {queue}.\n\n{schedule_text}"
    )


async def cmd_schedule(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.effective_message:
        return
    state = load_state()
    user = state.get("users", {}).get(str(update.effective_chat.id), {})
    queue = user.get("queue")
    if queue not in QUEUES:
        await update.effective_message.reply_text(
            "Спочатку обери свою підчергу командою, наприклад /queue 1.1."
        )
        return
    try:
        data = await asyncio.to_thread(fetch_json, SCHEDULE_URL)
        message = format_queue_schedule(data, queue)
    except Exception:
        log.exception("Could not build schedule for queue %s", queue)
        message = (
            "Не вдалося прочитати графік зараз. Спробуй пізніше.\n"
            f"Офіційне джерело: {SOURCE_URL}"
        )
    await update.effective_message.reply_text(message)


async def cmd_stop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_chat or not update.effective_message:
        return
    state = load_state()
    state["users"].pop(str(update.effective_chat.id), None)
    save_state(state)
    await update.effective_message.reply_text(
        "Особисті сповіщення вимкнено. Щоб підписатися знову, надішли /start."
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_message:
        return
    results = []
    for label, url in (("schedule.json", SCHEDULE_URL), ("notices.json", NOTICES_URL)):
        try:
            data = await asyncio.to_thread(fetch_json, url)
            results.append(f"🟢 {label}: доступний")
        except Exception as exc:
            log.warning("Status check failed for %s: %s", label, exc)
            results.append(f"🔴 {label}: недоступний")
    results.append(f"Офіційний сайт: {SOURCE_URL}")
    await update.effective_message.reply_text("\n".join(results))


async def send_change(
    context: ContextTypes.DEFAULT_TYPE,
    message: str,
    changed_kind: str,
    schedule_data: dict[str, Any] | None = None,
) -> None:
    await context.bot.send_message(chat_id=CHANNEL_ID, text=message)

    state = load_state()
    for chat_id, user in list(state.get("users", {}).items()):
        if not user.get("active", True):
            continue
        user_message = message
        if changed_kind == "schedule" and schedule_data is not None:
            queue = user.get("queue")
            if queue not in QUEUES:
                continue
            try:
                user_message = (
                    "⚡ Оновлено графік відключень для Житомирщини.\n\n"
                    + format_queue_schedule(schedule_data, queue)
                )
            except Exception:
                log.exception("Could not format schedule for user %s", chat_id)
                continue
        try:
            await context.bot.send_message(chat_id=int(chat_id), text=user_message)
            await asyncio.sleep(0.04)
        except Exception as exc:
            log.info("Could not message user %s: %s", chat_id, exc)


async def poll_sources(context: ContextTypes.DEFAULT_TYPE) -> None:
    state = load_state()
    fingerprints = state.setdefault("fingerprints", {})

    checks = [
        ("schedule", SCHEDULE_URL, "Графік відключень"),
        ("notices", NOTICES_URL, "Офіційне повідомлення"),
    ]

    for key, url, label in checks:
        try:
            data = await asyncio.to_thread(fetch_json, url)
            payload = compact_json_payload(data)
            current = stable_fingerprint(payload)
            previous = fingerprints.get(key)

            # First successful run establishes baseline; no false alert.
            if previous is None:
                fingerprints[key] = current
                save_state(state)
                log.info("Initial baseline saved for %s", key)
                continue

            if current == previous:
                continue

            # Persist the new fingerprint to avoid repeat notifications.
            fingerprints[key] = current
            save_state(state)

            notice = get_notice_text(data) if key == "notices" else ""
            if notice:
                body = notice[:3000]
            else:
                body = (
                    "Виявлено зміну опублікованих даних. "
                    "Перевір актуальну таблицю на офіційному сайті."
                )

           message = (
                f"⚡ Оновлення графіків відключень у Житомирській області!\n\n"
                f"{body}\n\n"
                f"🔗 Актуальний графік: {SOURCE_URL}\n\n"
                "ℹ️ Повідомлення сформовано автоматично після виявлення змін "
                "на офіційному сайті."
            )
            await send_change(context, message, key, data if key == "schedule" else None)

        except Exception:
            log.exception("Source check failed for %s (%s)", key, url)


async def post_init(app: Application) -> None:
    # Run an initial check soon after startup, then every 5 minutes.
    app.job_queue.run_repeating(
        poll_sources,
        interval=POLL_SECONDS,
        first=15,
        name="poll-official-data",
    )


def main() -> None:
    # Check that the state file can be created before starting.
    load_state()
    app = (
        Application.builder()
        .token(BOT_TOKEN)
        .post_init(post_init)
        .build()
    )
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("queues", cmd_queues))
    app.add_handler(CommandHandler("queue", cmd_queue))
    app.add_handler(CommandHandler("schedule", cmd_schedule))
    app.add_handler(CommandHandler("stop", cmd_stop))
    app.add_handler(CommandHandler("status", cmd_status))
    log.info("Starting Zhytomyr Light Telegram bot")
    app.run_polling()


if __name__ == "__main__":
    main()
