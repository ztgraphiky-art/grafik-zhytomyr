"use strict";

const DATA_URL = "./data/schedule.json";
const QUEUES = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2",
                "4.1", "4.2", "5.1", "5.2", "6.1", "6.2"];

const table = document.getElementById("scheduleTable");
const tbody = document.getElementById("scheduleBody");

let dateBlocks = [];
let selectedDate = "";

function cellText(cell) {
  return String(cell?.text ?? "").trim();
}

function dateFromText(text) {
  const match = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (!match) return "";
  return ${match[3]}-${match[2]}-${match[1]};
}

function displayDate(isoDate) {
  const parts = isoDate.split("-");
  return ${parts[2]}.${parts[1]}.${parts[0]};
}

function getCellStyle(cell) {
  return ${cell?.style ?? ""} ${cell?.class ?? ""}.toLowerCase();
}

function isOutage(cell) {
  const value = getCellStyle(cell);
  return /#ff3333|#ff0000|rgb\(\s*255\s*,\s*51\s*,\s*51\s*\)/i.test(value);
}

function isTimeRow(row) {
  if (!Array.isArray(row)) return false;

  const times = row.filter(cell =>
    /^\d{2}:\d{2}$/.test(cellText(cell))
  );

  return times.length >= 40;
}

function findIntervals(row, subqueue) {
  if (!Array.isArray(row)) return null;

  const index = row.findIndex(cell => cellText(cell) === subqueue);
  if (index < 0) return null;

  // Після назви підчерги є службова клітинка,
  // а далі — 48 півгодинних інтервалів.
  const cells = row.slice(index + 2);

  if (cells.length >= 48) return cells.slice(0, 48);

  // Запасний варіант для рядків без службової клітинки.
  const alternative = row.slice(index + 1);
  if (alternative.length >= 48) return alternative.slice(0, 48);

  return null;
}

function parseDateBlocks(rows) {
  const blocks = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const dateCell = row.find(cell =>
      dateFromText(cellText(cell)) &&
      Number(cell?.colspan || 1) >= 24
    );

    if (!dateCell) continue;

    const isoDate = dateFromText(cellText(dateCell));
    if (!isoDate) continue;

    let timeIndex = -1;

    for (let j = i + 1; j < Math.min(i + 5, rows.length); j++) {
      if (isTimeRow(rows[j])) {
        timeIndex = j;
        break;
      }
    }

    if (timeIndex < 0) continue;

    const schedules = {};
    let end = rows.length;

    for (let j = timeIndex + 1; j < rows.length; j++) {
      const nextDate = rows[j]?.some?.(cell =>
        dateFromText(cellText(cell)) &&
        Number(cell?.colspan || 1) >= 24
      );

      if (nextDate) {
        end = j;
        break;
      }

      for (const subqueue of QUEUES) {
        const intervals = findIntervals(rows[j], subqueue);
        if (intervals) {
          schedules[subqueue] = intervals;
        }
      }
    }

    if (Object.keys(schedules).length) {
      blocks.push({
        date: isoDate,
        schedules
      });
    }

    i = Math.max(i, timeIndex - 1);
  }

  // Якщо дата зустрічається кілька разів, беремо останній блок.
  const unique = new Map();
  for (const block of blocks) unique.set(block.date, block);

  return [...unique.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

function createHeader() {
  const thead = table?.querySelector("thead");
  if (!thead) return;

  const row = document.createElement("tr");

  const queueHead = document.createElement("th");
  queueHead.textContent = "Черга";
  queueHead.className = "queue-head";
  row.appendChild(queueHead);

  const subqueueHead = document.createElement("th");
  subqueueHead.textContent = "Підчерга";
  subqueueHead.className = "time-head";
  row.appendChild(subqueueHead);

  for (let hour = 0; hour < 24; hour++) {
    const th = document.createElement("th");
    th.textContent =
      ${String(hour).padStart(2, "0")}:00– +
      ${String(hour + 1).padStart(2, "0")}:00;
    th.className = "hour-head";
    row.appendChild(th);
  }

  thead.replaceChildren(row);
}

function createScheduleCell(firstHalf, secondHalf) {
  const td = document.createElement("td");
  td.className = "cell";
  const firstOff = isOutage(firstHalf);
  const secondOff = isOutage(secondHalf);

  if (firstOff && secondOff) {
    td.classList.add("state-off");
    td.title = "Немає електропостачання протягом години";
  } else if (!firstOff && !secondOff) {
    td.classList.add("state-on");
    td.title = "Електропостачання протягом години";
  } else if (!firstOff && secondOff) {
    td.classList.add("state-first");
    td.title = "Перша половина — зі світлом; друга — без світла";
  } else {
    td.classList.add("state-second");
    td.title = "Перша половина — без світла; друга — зі світлом";
  }

  return td;
}

function renderSchedule(date) {
  const block = dateBlocks.find(item => item.date === date);

  if (!tbody) return;
  tbody.replaceChildren();

  if (!block) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 26;
    td.textContent = Немає даних графіка на ${displayDate(date)}.;
    td.style.padding = "20px";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  createHeader();

  QUEUES.forEach((subqueue, index) => {
    const intervals = block.schedules[subqueue];
    if (!intervals || intervals.length < 48) return;

    const tr = document.createElement("tr");

    if (index % 2 === 0) {
      const queueCell = document.createElement("td");
      queueCell.textContent = String(Math.floor(index / 2) + 1);
      queueCell.rowSpan = 2;
      queueCell.className = "queue-head";
      tr.appendChild(queueCell);
    }

    const subqueueCell = document.createElement("td");
    subqueueCell.textContent = subqueue;
    subqueueCell.className = "time-head";
    tr.appendChild(subqueueCell);

    for (let hour = 0; hour < 24; hour++) {
      tr.appendChild(
        createScheduleCell(intervals[hour * 2], intervals[hour * 2 + 1])
      );
    }

    tbody.appendChild(tr);
  });
}

function createDateControls() {
  let container = document.getElementById("dateTabs");

  if (!container && table) {
    container = document.createElement("div");
    container.id = "dateTabs";
    container.className = "date-tabs";
    table.parentElement?.insertBefore(container, table);
  }

  if (!container) return;

  container.replaceChildren();

  dateBlocks.forEach(block => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = displayDate(block.date);
    button.className = block.date === selectedDate ? "active" : "";
    button.addEventListener("click", () => {
      selectedDate = block.date;
      updateDateControls();
      renderSchedule(selectedDate);
    });
    container.appendChild(button);
  });
}

function updateDateControls() {
  const container = document.getElementById("dateTabs");
  if (!container) return;

  container.querySelectorAll("button").forEach(button => {
    button.classList.toggle(
      "active",
      button.textContent === displayDate(selectedDate)
    );
  });

  const picker = document.getElementById("datePicker");
  if (picker) picker.value = selectedDate;
}

function updateTimestamp(value) {
  const element = document.getElementById("updatedAt");
  if (!element || !value) return;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    element.textContent = value;
    return;
  }

  element.textContent = date.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function initSchedule() {
  if (!table || !tbody) {
    console.error("Не знайдено #scheduleTable або #scheduleBody в index.html");
    return;
  }

  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(Не вдалося завантажити JSON: HTTP ${response.status});
    }

    const data = await response.json();

    if (!Array.isArray(data.rows)) {
      throw new Error("У schedule.json немає масиву rows");
    }

    dateBlocks = parseDateBlocks(data.rows);
    if (!dateBlocks.length) {
      throw new Error("Не знайдено дат або рядків підчерг у schedule.json");
    }

    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Kyiv"
    });

    selectedDate = dateBlocks.some(item => item.date === today)
      ? today
      : dateBlocks[0].date;

    createDateControls();
    updateDateControls();
    updateTimestamp(data.checked_at);
    renderSchedule(selectedDate);

    const picker = document.getElementById("datePicker");
    if (picker) {
      picker.min = dateBlocks[0].date;
      picker.max = dateBlocks[dateBlocks.length - 1].date;
      picker.addEventListener("change", () => {
        if (dateBlocks.some(item => item.date === picker.value)) {
          selectedDate = picker.value;
          updateDateControls();
          renderSchedule(selectedDate);
        }
      });
    }

    console.log("Графік успішно завантажено:", dateBlocks);
  } catch (error) {
    console.error("Помилка завантаження графіка:", error);

    tbody.replaceChildren();
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 26;
    td.textContent = Не вдалося показати графік: ${error.message};
    td.style.padding = "20px";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

initSchedule();
