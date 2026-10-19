🇺🇦UA_Dimonkp🇺🇦, [19.10.2026 23:51]
"use strict";

const SCHEDULE_URL = "./data/schedule.json";
const QUEUES = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2",
                "4.1", "4.2", "5.1", "5.2", "6.1", "6.2"];

const table = document.getElementById("scheduleTable");
const tbody = document.getElementById("scheduleBody");
const todayBtn = document.getElementById("todayBtn");
const tomorrowBtn = document.getElementById("tomorrowBtn");
const todayDate = document.getElementById("todayDate");
const tomorrowDate = document.getElementById("tomorrowDate");
const datePicker = document.getElementById("datePicker");
const updateTime = document.getElementById("updateTime");
const updatedAt = document.getElementById("updatedAt");

let scheduleData = null;
let schedulesByDate = new Map();
let selectedDate = "";

function kyivDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const date = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + offsetDays
  ));

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function toISODate(dateText) {
  const match = String(dateText || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? ${match[3]}-${match[2]}-${match[1]} : "";
}

function displayDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return ${day}.${month}.${year};
}

function getBackground(cell) {
  const style = String(cell?.style || "");
  const match = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  return match ? match[1].trim().toLowerCase() : "";
}

function isOutage(cell) {
  const background = getBackground(cell);

  // Офіційна таблиця позначає відключення червоним.
  if (background.includes("#ff3333") ||
      background.includes("#ff0000") ||
      background.includes("red")) {
    return true;
  }

  // Додаткова підтримка інших кольорів, якщо джерело змінить формат.
  return false;
}

function getDateBlocks(rows) {
  const blocks = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const dateCell = row.find(cell =>
      /^\d{2}\.\d{2}\.\d{4}$/.test(String(cell.text || "").trim()) &&
      Number(cell.colspan || 1) >= 24
    );

    if (!dateCell) continue;

    const isoDate = toISODate(dateCell.text.trim());
    if (!isoDate) continue;

    const intervalsRow = rows.slice(i + 1, i + 4).find(candidate =>
      candidate?.some(cell =>
        /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(
          String(cell.text || "").trim()
        )
      )
    );

    if (!intervalsRow) continue;

    const intervals = intervalsRow
      .map(cell => String(cell.text || "").trim())
      .filter(text => /^\d{2}:\d{2}\s*-\s*\d{2}:\d{2}$/.test(text));

    const entries = new Map();

    for (let j = i + 1; j < rows.length; j++) {
      const currentRow = rows[j] || [];

      // Дійшли до наступного блоку дати.
      const nextDate = currentRow.some(cell =>
        /^\d{2}\.\d{2}\.\d{4}$/.test(String(cell.text || "").trim()) &&
        Number(cell.colspan || 1) >= 24
      );
      if (nextDate) break;

      const subIndex = currentRow.findIndex(cell =>
        QUEUES.includes(String(cell.text || "").trim())
      );
      if (subIndex < 0) continue;

      const queue = String(currentRow[subIndex].text).trim();
      const cells = currentRow.slice(subIndex + 2);

      // Потрібні всі 48 півгодинних клітинок.
      if (cells.length < intervals.length || intervals.length !== 48) {
        continue;
      }

      entries.set(queue, cells.slice(0, 48));
    }

    if (entries.size) {
      blocks.push({ date: isoDate, intervals, entries });
    }
  }

  return blocks;
}

🇺🇦UA_Dimonkp🇺🇦, [19.10.2026 23:51]
function createHeader(intervals) {
  const thead = table.querySelector("thead");
  const headerRow = document.createElement("tr");

  const queueHead = document.createElement("th");
  queueHead.className = "queue-head";
  queueHead.textContent = "Черга";
  headerRow.appendChild(queueHead);

  const subHead = document.createElement("th");
  subHead.className = "time-head";
  subHead.textContent = "Підчерга";
  headerRow.appendChild(subHead);

  for (let hour = 0; hour < 24; hour++) {
    const th = document.createElement("th");
    th.className = "hour";
    th.textContent =
      ${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00;
    th.title = th.textContent;
    headerRow.appendChild(th);
  }

  thead.replaceChildren(headerRow);
}

function getHourState(firstHalf, secondHalf) {
  if (firstHalf && secondHalf) return "off";
  if (firstHalf && !secondHalf) return "first";
  if (!firstHalf && secondHalf) return "second";
  return "on";
}

function createCell(queue, hour, cells) {
  const firstOff = isOutage(cells[hour * 2]);
  const secondOff = isOutage(cells[hour * 2 + 1]);
  const state = getHourState(firstOff, secondOff);

  const td = document.createElement("td");
  td.className = cell state-${state};
  td.dataset.queue = queue;
  td.dataset.hour = String(hour);
  td.title = ${queue}, ${String(hour).padStart(2, "0")}:00–${String(hour + 1).padStart(2, "0")}:00;

  if (state === "off") {
    td.textContent = "⚡";
  } else if (state === "first" || state === "second") {
    td.textContent = "⚡";
    // Перша половина: зліва. Друга половина: справа.
    td.style.background = firstOff
      ? "linear-gradient(90deg, #c9cdd2 0 50%, #fff 50%)"
      : "linear-gradient(90deg, #fff 0 50%, #c9cdd2 50%)";
  }

  return td;
}

function renderSchedule(isoDate) {
  selectedDate = isoDate;

  const block = schedulesByDate.get(isoDate);
  tbody.replaceChildren();

  todayBtn.classList.toggle("active", isoDate === kyivDate());
  tomorrowBtn.classList.toggle("active", isoDate === kyivDate(1));

  if (datePicker) datePicker.value = isoDate;

  if (!block) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 26;
    td.textContent = У файлі schedule.json немає графіка на ${displayDate(isoDate)}. Очікуємо оновлення офіційних даних.;
    td.style.padding = "20px";
    td.style.whiteSpace = "normal";
    tr.appendChild(td);
    tbody.appendChild(tr);

    if (updatedAt) updatedAt.textContent = "дані на цю дату відсутні";
    return;
  }

  createHeader(block.intervals);

  QUEUES.forEach((queue, index) => {
    const cells = block.entries.get(queue);
    const tr = document.createElement("tr");

    const queueCell = document.createElement("th");
    queueCell.textContent = String(Math.floor(index / 2) + 1);
    tr.appendChild(queueCell);

    const subCell = document.createElement("th");
    subCell.textContent = queue;
    tr.appendChild(subCell);

    if (!cells) {
      for (let hour = 0; hour < 24; hour++) {
        const td = document.createElement("td");
        td.className = "cell state-on";
        td.title = Немає даних для підчерги ${queue};
        tr.appendChild(td);
      }
    } else {
      for (let hour = 0; hour < 24; hour++) {
        tr.appendChild(createCell(queue, hour, cells));
      }
    }

    tbody.appendChild(tr);
  });

  if (updatedAt) {
    const checkedAt = scheduleData?.checked_at;
    if (checkedAt) {
      const date = new Date(checkedAt);
      updatedAt.textContent = Number.isNaN(date.getTime())
        ? displayDate(isoDate)
        : new Intl.DateTimeFormat("uk-UA", {
            timeZone: "Europe/Kyiv",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          }).format(date);
    } else {
      updatedAt.textContent = displayDate(isoDate);
    }
  }
}

function setupDateButtons() {
  const today = kyivDate();
  const tomorrow = kyivDate(1);

🇺🇦UA_Dimonkp🇺🇦, [19.10.2026 23:51]
if (todayDate) todayDate.textContent = displayDate(today);
  if (tomorrowDate) tomorrowDate.textContent = displayDate(tomorrow);

  todayBtn?.addEventListener("click", () => renderSchedule(today));
  tomorrowBtn?.addEventListener("click", () => renderSchedule(tomorrow));

  datePicker?.addEventListener("change", () => {
    if (datePicker.value) renderSchedule(datePicker.value);
  });
}

async function init() {
  try {
    const response = await fetch(SCHEDULE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(Не вдалося завантажити JSON: HTTP ${response.status});
    }

    scheduleData = await response.json();

    if (!Array.isArray(scheduleData.rows)) {
      throw new Error("У schedule.json не знайдено масив rows.");
    }

    const blocks = getDateBlocks(scheduleData.rows);
    schedulesByDate = new Map(blocks.map(block => [block.date, block]));

    setupDateButtons();

    const today = kyivDate();
    const tomorrow = kyivDate(1);

    if (schedulesByDate.has(today)) {
      renderSchedule(today);
    } else if (schedulesByDate.has(tomorrow)) {
      renderSchedule(tomorrow);
    } else {
      renderSchedule(today);
    }
  } catch (error) {
    console.error("Помилка завантаження графіка:", error);
    tbody.replaceChildren();

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 26;
    td.style.padding = "20px";
    td.style.whiteSpace = "normal";
    td.textContent =
      "Не вдалося завантажити графік. Перевір файл data/schedule.json і консоль браузера.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

init();
