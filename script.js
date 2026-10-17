const groups = [
  "1.1", "1.2",
  "2.1", "2.2",
  "3.1", "3.2",
  "4.1", "4.2",
  "5.1", "5.2",
  "6.1", "6.2"
];

const states = ["on", "off", "first", "second"];

const stateClasses = [
  "state-on",
  "state-off",
  "state-first",
  "state-second"
];

const stateLabels = [
  "Світло є",
  "Світла немає",
  "Світла не буде перші 30 хвилин",
  "Світла не буде другі 30 хвилин"
];

const hours = Array.from({ length: 24 }, (_, i) =>
  `${String(i).padStart(2, "0")}-${String((i + 1) % 24).padStart(2, "0")}`
);

let selectedDate = getLocalDate(new Date());

function $(selector) {
  return document.querySelector(selector);
}

// Форматування локальної дати
function getLocalDate(date) {
  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  );

  return local.toISOString().slice(0, 10);
}

// Додати або відняти дні
function shiftDate(iso, days) {
  const date = new Date(`${iso}T12:00:00`);

  date.setDate(date.getDate() + days);

  return getLocalDate(date);
}

// Формат дати ДД.ММ.РР
function formatDate(iso) {
  const [year, month, day] = iso.split("-");

  return `${day}.${month}.${year.slice(2)}`;
}

// Окреме збереження для кожної дати
function storageKey(date) {
  return `zhytomyr-gpv-${date}`;
}

function readData(date) {
  try {
    return JSON.parse(
      localStorage.getItem(storageKey(date)) || "{}"
    );
  } catch {
    return {};
  }
}

function saveData(date, data) {
  localStorage.setItem(
    storageKey(date),
    JSON.stringify(data)
  );
}

// Оновлення кнопок дат та часу
function updateDates() {
  const today = getLocalDate(new Date());
  const tomorrow = shiftDate(today, 1);

  $("#todayDate").textContent = formatDate(today);
  $("#tomorrowDate").textContent = formatDate(tomorrow);

  $("#todayBtn").classList.toggle(
    "active",
    selectedDate === today
  );

  $("#tomorrowBtn").classList.toggle(
    "active",
    selectedDate === tomorrow
  );

  $("#datePicker").value = selectedDate;

  $("#updatedAt").textContent =
    `${formatDate(selectedDate)} ${$("#updateTime").value || "—"}`;
}

// Створення таблиці
function buildTable() {
  const head = document.querySelector(
    "#scheduleTable thead tr"
  );

  head.innerHTML = `
    <th class="queue-head">Черга /<br>підчерга</th>
    <th class="time-head">Часові<br>проміжки</th>
  `;

  // Заголовки годин
  hours.forEach(hour => {
    const th = document.createElement("th");

    th.className = "hour";
    th.textContent = hour;

    head.appendChild(th);
  });

  const body = $("#scheduleBody");
  body.innerHTML = "";

  // 12 підчерг
  groups.forEach(group => {
    const tr = document.createElement("tr");

    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = group;

    tr.appendChild(th);

    const label = document.createElement("td");
    label.style.fontSize = "12px";
    label.style.color = "#7b8492";
    label.textContent = "00–24";

    tr.appendChild(label);

    // 24 клітинки на кожну підчергу
    hours.forEach((hour, index) => {
      const td = document.createElement("td");

      td.className = "cell state-on";
      td.tabIndex = 0;
      td.setAttribute("role", "button");

      td.dataset.group = group;
      td.dataset.hour = String(index);

      td.setAttribute(
        "aria-label",
        `${group}, ${hour}, Світло є`
      );

      td.title =
        `${group} · ${hour} · Світло є — натисни, щоб змінити`;

      td.addEventListener("click", () => {
        cycleCell(td);
      });

      td.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cycleCell(td);
        }
      });

      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
}

// Перемикання стану клітинки
function cycleCell(td) {
  const data = readData(selectedDate);

  const key =
    `${td.dataset.group}-${td.dataset.hour}`;

  const current = data[key] ?? 0;
  const next = (current + 1) % states.length;

  data[key] = next;

  saveData(selectedDate, data);
  applyCell(td, next);
}

// Застосування кольору та позначення
function applyCell(td, stateIndex) {
  td.classList.remove(...stateClasses);
  td.classList.add(stateClasses[stateIndex]);

  td.innerHTML = stateIndex === 0
    ? ""
    : '<span class="bolt">ϟ</span>';

  const label = stateLabels[stateIndex];

  td.setAttribute(
    "aria-label",
    `${td.dataset.group}, ${hours[Number(td.dataset.hour)]}, ${label}`
  );

  td.title =
    `${td.dataset.group} · ${hours[Number(td.dataset.hour)]} · ${label} — натисни, щоб змінити`;
}

// Відображення даних вибраної дати
function renderDate() {
  const data = readData(selectedDate);

  document.querySelectorAll("td.cell").forEach(td => {
    const key =
      `${td.dataset.group}-${td.dataset.hour}`;

    const state = data[key] ?? 0;

    applyCell(td, state);
  });

  updateDates();
}

// Кнопка «Сьогодні»
$("#todayBtn").addEventListener("click", () => {
  selectedDate = getLocalDate(new Date());
  renderDate();
});

// Кнопка «Завтра»
$("#tomorrowBtn").addEventListener("click", () => {
  selectedDate = shiftDate(
    getLocalDate(new Date()),
    1
  );

  renderDate();
});

// Вибір довільної дати
$("#datePicker").addEventListener("change", event => {
  if (event.target.value) {
    selectedDate = event.target.value;
    renderDate();
  }
});

// Зміна часу оновлення
$("#updateTime").addEventListener("change", updateDates);

// Очистити графік лише для вибраної дати
$("#clearBtn").addEventListener("click", () => {
  if (
    confirm(
      `Очистити всі клітинки графіка на ${formatDate(selectedDate)}?`
    )
  ) {
    localStorage.removeItem(storageKey(selectedDate));
    renderDate();
  }
});

// Запуск
buildTable();
renderDate();
