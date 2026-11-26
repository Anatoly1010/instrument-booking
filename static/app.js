"use strict";

const $ = (selector) => document.querySelector(selector);
const calendar = $("#calendar");
const expandCalendarButton = $("#expand-calendar");
const datePicker = $("#calendar-date");
const datePickerDialog = $("#date-picker");
const pickerTriggers = Array.from(document.querySelectorAll("[data-pick]"));
const accountAccess = $("#account-access");
const accountDialog = $("#account-dialog");
const accountForm = $("#account-form");
const changePassword = $("#change-password");
const passwordDialog = $("#password-dialog");
const passwordForm = $("#password-form");
const bookingAccountAccess = $("#booking-account-access");
const accountRoutes = { login: "login", register: "register", admin: "admin/login" };
const instrumentDialog = $("#instrument-dialog");
const instrumentForm = $("#instrument-form");
const instrumentName = instrumentForm.elements.namedItem("name");
const renameInstrument = $("#rename-instrument");
const dayBookingsDialog = $("#day-bookings-dialog");
const utilizationDialog = $("#utilization-dialog");
const openUtilizationButton = $("#open-utilization");
const directoryDialog = $("#directory-dialog");
const resonatorDialog = $("#resonator-dialog");
const resonatorForm = $("#resonator-form");
const directoryLab = $("#directory-lab");
const labForm = $("#lab-form");
const employeeForm = $("#employee-form");
const bookingLab = $("#booking-lab");
const bookingDialog = $("#booking-dialog");
const bookingForm = $("#booking-form");
const bookingMenu = $("#booking-menu");
const bookingStartDate = $("#booking-start-date");
const bookingEndDate = $("#booking-end-date");
const bookingStartTime = $("#booking-start-time");
const bookingEndTime = $("#booking-end-time");
const bookingAllDay = $("#booking-all-day");
const cancelBookingButton = $("#cancel-booking");
const weekdayFormat = new Intl.DateTimeFormat("ru", { weekday: "short" });
const dayFormat = new Intl.DateTimeFormat("ru", { dateStyle: "full" });
const rangeFormat = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("ru", { month: "long", year: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat("ru", { day: "2-digit", month: "2-digit", year: "numeric" });
const percentFormat = new Intl.NumberFormat("ru", { style: "percent", maximumFractionDigits: 2 });
const defaultView = "rolling";
const instrumentColors = [
  "#17449a", "#a34813", "#13766e", "#8f285f", "#806000", "#5133a0",
  "#ad272d", "#406622", "#374456", "#70543f", "#156582", "#59263c",
];
const namedInstrumentColors = new Map([
  ["#a01a1a", ["EMX"]],
  ["#2951b9", ["ELEXSYSOLD", "OLDELEXSYS", "THEELDERELEXSYS"]],
  ["#ca7609", ["CRYOMECH", "LIQUIFIER"]],
  ["#b586e2", ["IR", "IRVERTEX", "IRSPECTROMETER"]],
  ["#d2b53b", ["ELEXSYSNEW", "NEWELEXSYS"]],
  ["#2eaa62", ["SORPTION", "SORPTIONSTATION"]],
  ["#633710", ["FEL", "EPRENDSTATIONFEL", "TREPRFEL"]],
].flatMap(([color, names]) => names.map((name) => [name, color])));

const state = {
  date: new Date(),
  view: defaultView,
  instruments: [],
  resonators: [],
  labs: [],
  employees: [],
  activeId: null,
  allInstruments: false,
  bookings: [],
  editingInstrumentId: null,
  editingEmployeeId: null,
  editingResonatorId: null,
  editingId: null,
  bookingAction: "open",
  session: { role: "guest", username: null, employee_id: null, admin_configured: false, read_only: false },
  requestId: 0,
};

const picker = { input: null, month: null };
let previousBookingStart = "";
let menuBookingId;
let menuTrigger;

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key) {
  return new Date(`${key}T12:00`);
}

function addDays(date, count) {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function firstOfMonth(date, offset = 0) {
  const result = new Date(date);
  result.setDate(1);
  result.setMonth(result.getMonth() + offset);
  return result;
}

function mondayOffset(date) {
  return (date.getDay() + 6) % 7;
}

function setDateControl(input, value) {
  input.value = value;
  const trigger = pickerTriggers.find((button) => button.dataset.pick === input.id);
  const text = value ? shortDateFormat.format(fromKey(value)) : "";
  trigger.textContent = text || trigger.dataset.label;
  trigger.setAttribute("aria-label", text ? `${trigger.dataset.label}, ${text}` : trigger.dataset.label);
}

function renderPickerDays() {
  const minimum = picker.input.dataset.min;
  const currentMonth = dateKey(picker.month).slice(0, 7);
  const next = firstOfMonth(picker.month, 1);
  const count = addDays(next, -1).getDate();
  const today = dateKey(new Date());
  $("#picker-month").textContent = monthFormat.format(picker.month);
  $("#picker-previous").disabled = picker.month.getFullYear() === 1 && picker.month.getMonth() === 0
    || Boolean(minimum && currentMonth <= minimum.slice(0, 7));
  $("#picker-next").disabled = next.getFullYear() > 9999;

  const days = Array.from({ length: mondayOffset(picker.month) }, () => element("span"));
  for (let index = 0; index < count; index += 1) {
    const date = addDays(picker.month, index);
    const day = dateKey(date);
    const button = element("button", day === today ? "picker-option picker-today" : "picker-option", String(index + 1));
    button.type = "button";
    button.dataset.pickerDay = day;
    button.disabled = Boolean(minimum && day < minimum);
    button.setAttribute("aria-label", dayFormat.format(date));
    button.setAttribute("aria-pressed", String(day === picker.input.value));
    days.push(button);
  }
  $("#picker-days").replaceChildren(...days);
}

function openDatePicker(trigger) {
  picker.input = document.getElementById(trigger.dataset.pick);
  const minimum = picker.input.dataset.min || "";
  const value = picker.input.value >= minimum ? picker.input.value : minimum;
  picker.month = firstOfMonth(fromKey(value || dateKey(new Date())));
  $("#picker-title").textContent = trigger.dataset.label;
  renderPickerDays();
  datePickerDialog.showModal();
  $("#picker-days button[aria-pressed='true']:not(:disabled)")?.focus();
}

function isOverview(view) {
  return view === "month" || view === "rolling";
}

function visibleDays() {
  if (state.view === "day") return [state.date];
  if (state.view === "month") {
    const first = firstOfMonth(state.date);
    const count = addDays(firstOfMonth(state.date, 1), -1).getDate();
    return Array.from({ length: count }, (_, index) => addDays(first, index));
  }
  const monday = addDays(state.date, -mondayOffset(state.date));
  return Array.from({ length: state.view === "rolling" ? 28 : 7 }, (_, index) => addDays(monday, index));
}

function setStatus(message = "") {
  const status = $("#status");
  status.textContent = message;
  status.hidden = !message;
}

async function api(path, method = "GET", payload) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      headers: method === "GET" ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch {
    throw new Error("Сервер недоступен. Проверьте, что приложение запущено.");
  }
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && method !== "GET"
        && !Object.values(accountRoutes).includes(path)) {
      const session = await api("session").catch(() => null);
      if (session && updateSession(session) && bookingDialog.open && state.editingId !== null) await refreshCalendar();
    }
    throw new Error(data.error || "Не удалось выполнить запрос.");
  }
  return data;
}

function instrumentColor(id) {
  const instrument = state.instruments.find((item) => item.id === id);
  const name = instrument?.name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return namedInstrumentColors.get(name) ?? instrumentColors[(id - 1) % instrumentColors.length];
}

function renderInstruments() {
  const items = state.instruments.map((instrument) => {
    const button = element("button", "instrument");
    button.type = "button";
    button.dataset.id = instrument.id;
    button.title = instrument.name;
    const swatch = element("span", "swatch");
    swatch.setAttribute("aria-hidden", "true");
    button.style.setProperty("--instrument-accent", instrumentColor(instrument.id));
    button.append(swatch, element("span", "instrument-name", instrument.name));
    return button;
  });
  if (items.length) {
    const all = element("button", "instrument all-instruments", "Все приборы");
    all.type = "button";
    all.dataset.id = "all";
    items.unshift(all);
  }
  $("#instruments").replaceChildren(...items);
  markInstrumentSelection();
}

function markInstrumentSelection() {
  const active = state.allInstruments ? "all" : String(state.activeId);
  for (const button of $("#instruments").children) {
    button.setAttribute("aria-pressed", String(button.dataset.id === active));
  }
}

function setView(view) {
  state.view = view;
  if (!isOverview(view)) state.allInstruments = false;
  for (const button of document.querySelectorAll(".view-picker button[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  markInstrumentSelection();
  refreshCalendar(true);
}

function minutes(timestamp) {
  return Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16));
}

function clock(timestamp) {
  return timestamp.slice(11, 16);
}

function dateAndClock(timestamp) {
  return `${timestamp.slice(8, 10)}.${timestamp.slice(5, 7)} ${clock(timestamp)}`;
}

function daySegment(booking, day, nextDay) {
  const start = booking.start.slice(0, 10) < day ? 0 : minutes(booking.start);
  const end = booking.end.slice(0, 10) >= nextDay ? 1440 : minutes(booking.end);
  const label = booking.all_day ? "Весь день"
    : `${start === 0 ? "00:00" : clock(booking.start)}–${end === 1440 ? "24:00" : clock(booking.end)}`;
  return { start, end, label };
}

function bookingRangeLabel(booking) {
  if (!booking.all_day) return `${dateAndClock(booking.start)}–${dateAndClock(booking.end)}`;
  const first = fromKey(booking.start.slice(0, 10));
  const last = addDays(fromKey(booking.end.slice(0, 10)), -1);
  return `Весь день, ${rangeFormat.formatRange(first, last)}`;
}

function bookingsOnDay(bookings, day, nextDay) {
  return bookings.filter((booking) => booking.start < `${nextDay}T00:00` && booking.end > `${day}T00:00`);
}

function bookingPeople(booking) {
  const names = booking.employee_ids.map((id) => state.employees.find((employee) => employee.id === id)?.name);
  return [...names, booking.person].filter(Boolean).join(", ") || "Участники";
}

function bookingResources(booking) {
  return booking.instrument_ids.map((id) => ({
    instrument: state.instruments.find((item) => item.id === id)?.name,
    resonator: state.resonators.find((item) => item.id === booking.resonators?.[id])?.name,
  })).filter(({ instrument }) => instrument);
}

function resourceLabel(resources) {
  return resources.map(({ instrument, resonator }) =>
    resonator ? `${instrument} / ${resonator}` : instrument).join(" + ");
}

function bookingSummary(booking, resources) {
  const resonators = resources.map(({ resonator }) => resonator).filter(Boolean).join(" + ");
  return [resonators, bookingPeople(booking)].filter(Boolean).join(" · ");
}

function renderEvent(booking, day, nextDay) {
  const { start, end, label: timeLabel } = daySegment(booking, day, nextDay);
  const button = element("button", end - start < 28 ? "event compact" : "event");
  button.type = "button";
  button.dataset.booking = booking.id;
  button.style.top = `${start / 14.4}%`;
  button.style.height = `${(end - start) / 14.4}%`;
  const resources = bookingResources(booking);
  const details = `${timeLabel} · ${bookingPeople(booking)} · ${resourceLabel(resources)}`;
  button.title = `${details}${booking.comment ? `\n${booking.comment}` : ""}`;
  button.setAttribute("aria-label", `${details}. Открыть бронь`);
  button.append(element("strong", "", bookingSummary(booking, resources)), element("span", "", timeLabel));
  return button;
}

function renderTimeGrid(days, bookings) {
  calendar.style.setProperty("--days", days.length);
  calendar.style.setProperty("--instrument-accent", instrumentColor(state.activeId));
  const headings = element("div", "day-headings");
  const grid = element("div", "time-grid");
  const hours = element("div", "hours");
  const today = dateKey(new Date());

  headings.append(element("div", "corner", "Время"));
  for (let hour = 0; hour < 24; hour += 1) {
    hours.append(element("span", "hour", `${pad(hour)}:00`));
  }
  grid.append(hours);

  for (const date of days) {
    const day = dateKey(date);
    const nextDay = dateKey(addDays(date, 1));
    const heading = element("div", day === today ? "date-heading today" : "date-heading", weekdayFormat.format(date));
    const time = element("time", "", `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`);
    time.dateTime = day;
    heading.append(time);
    headings.append(heading);

    const weekend = date.getDay() === 0 || date.getDay() === 6;
    const column = element("div", weekend ? "calendar-day weekend" : "calendar-day");
    const fullDate = dayFormat.format(date);
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = element("button", "slot");
      const timeLabel = `${pad(hour)}:00`;
      slot.type = "button";
      slot.disabled = Boolean(state.session.read_only);
      if (!slot.disabled) slot.dataset.start = `${day}T${timeLabel}`;
      slot.setAttribute("aria-label", `${fullDate}, ${timeLabel}${slot.disabled ? "" : ". Создать бронь"}`);
      column.append(slot);
    }
    for (const booking of bookingsOnDay(bookings, day, nextDay)) {
      column.append(renderEvent(booking, day, nextDay));
    }
    grid.append(column);
  }

  calendar.replaceChildren(headings, grid);
}

function openDayBookings(name, day, nextDay, bookings) {
  $("#day-bookings-title").textContent = name;
  $("#day-bookings-date").textContent = dayFormat.format(fromKey(day));
  const entries = bookings.map((booking) => {
    const label = daySegment(booking, day, nextDay).label;
    const item = element("button", "button day-booking", `${label} · ${resourceLabel(bookingResources(booking))} · ${bookingPeople(booking)}`);
    item.type = "button";
    item.dataset.booking = booking.id;
    item.addEventListener("click", () => {
      dayBookingsDialog.close();
      openBookingForm(booking);
    });
    return item;
  });
  $("#day-bookings-list").replaceChildren(...entries);
  dayBookingsDialog.showModal();
}

function weekSpans(week, bookings) {
  const groups = new Map();
  for (const booking of bookings) {
    const columns = week.flatMap((day, index) => day && booking.start < `${day.next}T00:00`
      && booking.end > `${day.key}T00:00` ? [index] : []);
    if (!columns.length) continue;
    const first = columns[0];
    const last = columns.at(-1);
    const singleDay = first === last && booking.start >= `${week[first].key}T00:00` && booking.end <= `${week[last].next}T00:00`;
    const key = state.allInstruments && singleDay
      ? `${first}:${[...booking.instrument_ids].sort((a, b) => a - b)
        .map((id) => `${id}:${booking.resonators?.[id] ?? ""}`).join(",")}` : booking.id;
    if (!groups.has(key)) groups.set(key, { first, last, bookings: [] });
    groups.get(key).bookings.push(booking);
  }
  return Array.from(groups.values()).sort((first, second) => first.first - second.first || second.last - first.last);
}

function lightBackground(color) {
  const [red, green, blue] = color.slice(1).match(/../g).map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * red + .7152 * green + .0722 * blue > .183;
}

function stripeBackground(colors) {
  if (colors.length === 1) return colors[0];
  const bandWidth = Math.min(40, 80 / colors.length);
  const bands = colors.map((color, index) => `${color} ${index * bandWidth}px ${(index + 1) * bandWidth}px`);
  return `repeating-linear-gradient(135deg, ${bands.join(", ")})`;
}

function renderSpan(span, week, lane, labeled) {
  const { first, last, bookings } = span;
  const booking = bookings[0];
  const { key, next } = week[first];
  const resources = bookingResources(booking);
  const details = resourceLabel(resources);
  const item = element("button", "overview-booking");
  item.type = "button";
  item.style.gridColumn = `${first + 1} / ${last + 2}`;
  item.style.gridRow = String(lane + 1);
  const colors = booking.instrument_ids.map(instrumentColor);
  item.style.background = stripeBackground(colors);
  if (colors.some(lightBackground)) item.classList.add(colors.length === 1 ? "light-booking" : "striped-label");
  item.classList.toggle("continues-previous", booking.start < `${key}T00:00`);
  item.classList.toggle("continues-next", booking.end > `${week[last].next}T00:00`);
  item.title = [details, ...bookings.map((entry) => `${bookingPeople(entry)} · ${bookingRangeLabel(entry)}`)].join("\n");
  if (!labeled.has(booking.id)) {
    const long = first !== last || booking.start < `${key}T00:00` || booking.end > `${next}T00:00`;
    const time = long ? "" : daySegment(booking, key, next).label.replaceAll(":00", "");
    const names = resources.map(({ instrument }) => instrument).join(" + ");
    const label = [bookingSummary(booking, resources), time, names].filter(Boolean).join(" · ");
    item.append(element("span", "overview-name", label));
    for (const entry of bookings) labeled.add(entry.id);
  }
  if (bookings.length === 1) {
    item.dataset.booking = booking.id;
    item.setAttribute("aria-label", `${item.title}. Открыть бронь`);
  } else {
    item.append(element("span", "overview-count", String(bookings.length)));
    item.setAttribute("aria-label", `${item.title}. Открыть список броней`);
    const openGroup = () => openDayBookings(details, key, next, bookings);
    item.addEventListener("click", openGroup);
    item.addEventListener("contextmenu", (event) => {
      if (state.session.read_only) return;
      event.preventDefault();
      openGroup();
    });
  }
  return item;
}

function renderMonthWeek(week, bookings, today, labeled) {
  const row = element("div", "month-week");
  const bars = element("div", "month-bars");
  const overflow = week.map(() => []);
  const occupiedUntil = Array(7).fill(-1);
  for (const span of weekSpans(week, bookings)) {
    const lane = occupiedUntil.findIndex((last) => last < span.first);
    if (lane < 0) {
      for (let column = span.first; column <= span.last; column += 1) overflow[column].push(...span.bookings);
    } else {
      occupiedUntil[lane] = span.last;
      bars.append(renderSpan(span, week, lane, labeled));
    }
  }

  for (const [column, day] of week.entries()) {
    const cell = element("div", "month-cell");
    if (!day) {
      cell.classList.add("outside-month");
      cell.setAttribute("aria-hidden", "true");
    } else {
      const { key, next, label, date } = day;
      cell.classList.toggle("today", key === today);
      cell.dataset.day = key;
      const dayButton = element("button", "month-date", label);
      dayButton.type = "button";
      dayButton.disabled = Boolean(state.session.read_only);
      dayButton.setAttribute("aria-label", `${dayFormat.format(date)}${dayButton.disabled ? "" : ". Создать бронь"}`);
      cell.append(dayButton);
      if (overflow[column].length) {
        const extra = element("button", "month-more", `+${overflow[column].length}`);
        extra.type = "button";
        extra.setAttribute("aria-label", "Показать остальные брони за день");
        extra.addEventListener("click", () => openDayBookings("Другие брони", key, next, overflow[column]));
        cell.append(extra);
      }
    }
    row.append(cell);
  }
  row.append(bars);
  return row;
}

function renderMonth(days, bookings) {
  const headings = element("div", "month-headings");
  const grid = element("div", "month-grid");
  const today = dateKey(new Date());
  const offset = mondayOffset(days[0]);
  const monday = addDays(days[0], -offset);
  for (let index = 0; index < 7; index += 1) {
    headings.append(element("div", "date-heading", weekdayFormat.format(addDays(monday, index))));
  }

  const labeled = new Set();
  for (let start = -offset; start < days.length; start += 7) {
    const week = Array.from({ length: 7 }, (_, column) => {
      const index = start + column;
      const date = days[index];
      if (!date) return null;
      const key = dateKey(date);
      const next = dateKey(addDays(date, 1));
      const withMonth = state.view === "rolling" && (index === 0 || date.getDate() === 1);
      const label = withMonth ? `${pad(date.getDate())}.${pad(date.getMonth() + 1)}` : String(date.getDate());
      return { key, next, label, date };
    });
    grid.append(renderMonthWeek(week, bookings, today, labeled));
  }
  calendar.replaceChildren(headings, grid);
}

function utilizationRows(days) {
  const minute = (timestamp) => Date.parse(`${timestamp}Z`) / 60000;
  const periodStart = minute(`${dateKey(days[0])}T00:00`);
  const periodEnd = minute(`${dateKey(addDays(days.at(-1), 1))}T00:00`);
  const rows = new Map(state.instruments.map((instrument) => [
    instrument.id, { instrument, count: 0, minutes: 0, lastEnd: periodStart },
  ]));
  const bookings = [...state.bookings].sort((a, b) => a.start.localeCompare(b.start));
  for (const booking of bookings) {
    const start = Math.max(minute(booking.start), periodStart);
    const end = Math.min(minute(booking.end), periodEnd);
    if (end <= start) continue;
    for (const id of booking.instrument_ids) {
      const row = rows.get(id);
      if (!row) continue;
      row.count += 1;
      row.minutes += Math.max(0, end - Math.max(start, row.lastEnd));
      row.lastEnd = Math.max(row.lastEnd, end);
    }
  }
  const total = periodEnd - periodStart;
  return Array.from(rows.values(), ({ instrument, count, minutes }) => ({
    instrument, count, minutes, share: minutes / total,
  })).sort((a, b) => b.minutes - a.minutes || a.instrument.name.localeCompare(b.instrument.name, "ru"));
}

function durationLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} мин`;
  return remainder ? `${hours} ч ${remainder} мин` : `${hours} ч`;
}

function openUtilization() {
  const days = visibleDays();
  $("#utilization-period").textContent = rangeFormat.formatRange(days[0], days.at(-1));
  const rows = utilizationRows(days).map(({ instrument, count, minutes, share }) => {
    const row = element("tr");
    row.style.setProperty("--instrument-accent", instrumentColor(instrument.id));
    const heading = element("th");
    heading.scope = "row";
    const name = element("span", "utilization-instrument");
    const swatch = element("span", "swatch");
    swatch.setAttribute("aria-hidden", "true");
    name.append(swatch, element("span", "", instrument.name));
    heading.append(name);
    const percent = share > 0 && share < 0.0001 ? "<0,01 %" : percentFormat.format(share);
    const occupancy = element("td", "", percent);
    const track = element("span", "utilization-track");
    track.setAttribute("aria-hidden", "true");
    const fill = element("span");
    fill.style.width = `${share * 100}%`;
    track.append(fill);
    occupancy.append(track);
    row.append(heading, element("td", "", durationLabel(minutes)), element("td", "", String(count)), occupancy);
    return row;
  });
  $("#utilization-rows").replaceChildren(...rows);
  utilizationDialog.showModal();
}

function renderCalendar(days, resetScroll) {
  const previousScroll = calendar.scrollTop;
  const previousLeft = calendar.scrollLeft;
  const bookings = state.allInstruments ? state.bookings
    : state.bookings.filter((booking) => booking.instrument_ids.includes(state.activeId));
  calendar.dataset.view = state.view;
  if (isOverview(state.view)) renderMonth(days, bookings);
  else renderTimeGrid(days, bookings);
  calendar.scrollTop = resetScroll ? (calendar.querySelector(".hour")?.offsetHeight ?? 0) * 8 : previousScroll;
  calendar.scrollLeft = resetScroll ? 0 : previousLeft;
}

async function refreshCalendar(resetScroll = false) {
  const requestId = ++state.requestId;
  const instrument = state.instruments.find((item) => item.id === state.activeId);
  const days = visibleDays();
  const first = days[0];
  const last = days.at(-1);
  $("#calendar-title").textContent = state.allInstruments ? "Все приборы" : instrument?.name || "Календарь";
  renameInstrument.hidden = state.session.role !== "admin" || !instrument || state.allInstruments;
  let period = "";
  if (instrument) {
    if (state.view === "month") period = monthFormat.format(first);
    else if (state.view === "day") period = dayFormat.format(first);
    else period = rangeFormat.formatRange(first, last);
  }
  $("#period").textContent = period;
  setDateControl(datePicker, dateKey(state.date));
  $("#new-booking").disabled = !instrument || Boolean(state.session.read_only);
  openUtilizationButton.disabled = true;
  $("#empty").hidden = Boolean(instrument);
  calendar.hidden = !instrument;
  if (!instrument) return;

  setStatus();
  state.bookings = [];
  renderCalendar(days, resetScroll);
  calendar.setAttribute("aria-busy", "true");
  try {
    const data = await api(`bookings?from=${dateKey(first)}&to=${dateKey(addDays(last, 1))}`);
    if (requestId !== state.requestId) return;
    state.bookings = data;
    renderCalendar(days, false);
    openUtilizationButton.disabled = false;
    if (bookingDialog.open) updateBookingPermissions();
  } catch (error) {
    if (requestId === state.requestId) setStatus(error.message);
  } finally {
    if (requestId === state.requestId) calendar.removeAttribute("aria-busy");
  }
}

function formError(form, message = "") {
  const target = form.querySelector(".form-error");
  target.textContent = message;
  target.hidden = !message;
}

async function submit(form, action) {
  formError(form);
  const buttons = Array.from(form.querySelectorAll("button"));
  buttons.forEach((button) => { button.disabled = true; });
  form.dataset.pending = "true";
  try {
    await action();
  } catch (error) {
    formError(form, error.message);
  } finally {
    delete form.dataset.pending;
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function openInstrumentForm(instrument = null) {
  state.editingInstrumentId = instrument?.id ?? null;
  instrumentName.value = instrument?.name ?? "";
  $("#instrument-dialog-title").textContent = instrument ? "Переименовать прибор" : "Добавить прибор";
  $("#save-instrument").textContent = instrument ? "Сохранить" : "Добавить";
  formError(instrumentForm);
  instrumentDialog.showModal();
  if (instrument) instrumentName.select();
}

function choice(name, value, text, checked) {
  const label = element("label", "choice");
  const input = element("input");
  input.type = "checkbox";
  input.name = name;
  input.value = value;
  input.checked = checked;
  label.append(input, element("span", "", text));
  return label;
}

function selectAccountEmployee() {
  if (state.session.role !== "user") return;
  let id = state.session.employee_id;
  if (!id) {
    const nameKey = (name) => name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
    const username = nameKey(state.session.username);
    const matches = state.employees.filter(({ name }) => nameKey(name) === username);
    if (matches.length !== 1) return;
    id = matches[0].id;
  }
  const input = $(`#booking-employees input[value="${id}"]`);
  if (input) input.checked = true;
}

function updateEmployeeChoices() {
  const list = $("#booking-employees");
  const labId = Number(bookingLab.value);
  for (const group of list.querySelectorAll("[data-lab]")) {
    group.hidden = labId !== 0 && Number(group.dataset.lab) !== labId;
  }
  const empty = $("#no-employees");
  empty.hidden = Boolean(list.querySelector("[data-lab]:not([hidden])"));
  empty.textContent = labId ? "В этом подразделении пока нет сотрудников." : "В справочнике пока нет сотрудников.";
  const names = Array.from(list.querySelectorAll("input:checked"), (input) => input.nextElementSibling.textContent);
  const selection = $("#employee-selection");
  selection.textContent = names.length ? `Выбран(ы) ${names.join(", ")}` : "";
  selection.hidden = names.length === 0;
}

function directoryOptions() {
  const labs = element("optgroup");
  labs.label = "Лаборатории";
  const departments = element("optgroup");
  departments.label = "Отделы";
  for (const { id, name, kind } of state.labs) {
    // Older server processes omit kind and have four reserved laboratory IDs.
    const isDepartment = kind === undefined ? id > 4 : kind === "department";
    const group = isDepartment ? departments : labs;
    group.append(new Option(name, id));
  }
  return [labs, departments].filter((group) => group.childElementCount);
}

function fillBookingChoices(booking) {
  const instrumentIds = booking?.instrument_ids ?? [state.activeId];
  $("#booking-instruments").replaceChildren(...state.instruments.map(({ id, name }) => {
    const label = choice("instrument_ids", id, name, instrumentIds.includes(id));
    label.classList.add("instrument-choice");
    label.style.setProperty("--instrument-accent", instrumentColor(id));
    return label;
  }));
  const resonators = state.instruments.map(({ id, name }) => {
    const label = element("label", "", name);
    const select = element("select");
    select.dataset.instrument = id;
    select.append(new Option("Без резонатора", ""), ...state.resonators.map((item) => new Option(item.name, item.id)));
    select.value = booking?.resonators?.[id] ?? "";
    label.append(select);
    return label;
  });
  $("#booking-resonators").replaceChildren(...resonators);
  updateResonatorChoices();
  bookingLab.replaceChildren(new Option("Все подразделения", 0), ...directoryOptions());

  const employeeIds = booking?.employee_ids ?? [];
  const groups = [];
  for (const lab of state.labs) {
    const members = state.employees.filter(({ lab_id }) => lab_id === lab.id);
    if (!members.length) continue;
    const group = element("div", "employee-group");
    group.dataset.lab = lab.id;
    group.append(element("h3", "", lab.name), ...members.map(({ id, name }) =>
      choice("employee_ids", id, name, employeeIds.includes(id))));
    groups.push(group);
  }
  const empty = element("p", "selection");
  empty.id = "no-employees";
  $("#booking-employees").replaceChildren(...groups, empty);
  if (!booking) selectAccountEmployee();
  updateEmployeeChoices();
}

function updateResonatorChoices() {
  const selected = new Set(Array.from($("#booking-instruments").querySelectorAll("input:checked"), (input) => input.value));
  for (const select of $("#booking-resonators").querySelectorAll("select")) {
    select.disabled = !selected.has(select.dataset.instrument);
    select.parentElement.hidden = select.disabled;
  }
  $("#booking-resonator-fields").hidden = !state.resonators.length || !selected.size;
}

function resetEmployeeForm() {
  state.editingEmployeeId = null;
  employeeForm.reset();
  formError(employeeForm);
  $("#save-employee").textContent = "Добавить";
  $("#cancel-employee-edit").hidden = true;
}

function renderDirectoryEmployees() {
  const list = $("#directory-employees");
  const employees = state.employees.filter(({ lab_id }) => lab_id === Number(directoryLab.value));
  const items = employees.map((employee) => {
    const row = element("div", "directory-employee");
    const edit = element("button", "button", "Изменить");
    edit.type = "button";
    edit.setAttribute("aria-label", `Изменить имя сотрудника ${employee.name}`);
    edit.addEventListener("click", () => {
      state.editingEmployeeId = employee.id;
      const input = employeeForm.elements.namedItem("name");
      input.value = employee.name;
      $("#save-employee").textContent = "Сохранить";
      $("#cancel-employee-edit").hidden = false;
      formError(employeeForm);
      input.focus();
      input.select();
    });
    row.append(element("span", "", employee.name), edit);
    return row;
  });
  list.replaceChildren(...(items.length ? items : [element("p", "selection", "Список пока пуст.")]));
}

function selectDirectoryLab() {
  const lab = state.labs.find(({ id }) => id === Number(directoryLab.value));
  labForm.elements.namedItem("name").value = lab?.name ?? "";
  formError(labForm);
  resetEmployeeForm();
  renderDirectoryEmployees();
}

function fillDirectoryLabs() {
  const labId = directoryLab.value;
  directoryLab.replaceChildren(...directoryOptions());
  if (labId) directoryLab.value = labId;
}

function resetResonatorForm() {
  state.editingResonatorId = null;
  resonatorForm.reset();
  formError(resonatorForm);
  $("#save-resonator").textContent = "Добавить";
  $("#cancel-resonator-edit").hidden = true;
}

function renderResonators() {
  const items = state.resonators.map(({ id, name }) => {
    const row = element("div", "directory-employee");
    const edit = element("button", "button", "Изменить");
    edit.type = "button";
    edit.setAttribute("aria-label", `Переименовать резонатор ${name}`);
    edit.addEventListener("click", () => {
      state.editingResonatorId = id;
      const input = resonatorForm.elements.namedItem("name");
      input.value = name;
      $("#save-resonator").textContent = "Сохранить";
      $("#cancel-resonator-edit").hidden = false;
      formError(resonatorForm);
      input.focus();
      input.select();
    });
    row.append(element("span", "", name), edit);
    return row;
  });
  $("#resonator-list").replaceChildren(...(items.length ? items : [element("p", "selection", "Список пока пуст.")]));
}

const DAY_MS = 86400000;

function shiftTime(value, milliseconds) {
  const time = new Date(Date.parse(`${value}Z`) + milliseconds);
  const year = time.getUTCFullYear();
  return year >= 1 && year <= 9999 ? time.toISOString().slice(0, 16) : "";
}

function bookingTime(input) {
  const match = /^([0-9]{1,2}):?([0-9]{2})$/.exec(input.value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return "";
  return `${pad(Number(match[1]))}:${match[2]}`;
}

function bookingTimestamp(dateInput, timeInput) {
  const time = bookingAllDay.checked ? "00:00" : bookingTime(timeInput);
  return dateInput.value && time ? `${dateInput.value}T${time}` : "";
}

function updateBookingTimeFields() {
  for (const input of [bookingStartTime, bookingEndTime]) {
    input.hidden = bookingAllDay.checked;
    input.disabled = bookingAllDay.checked;
    input.required = !bookingAllDay.checked;
    input.setCustomValidity("");
  }
  previousBookingStart = bookingTimestamp(bookingStartDate, bookingStartTime);
}

function moveBookingStart() {
  bookingEndDate.dataset.min = bookingStartDate.value;
  const start = bookingTimestamp(bookingStartDate, bookingStartTime);
  if (!start) return;
  const end = bookingTimestamp(bookingEndDate, bookingEndTime);
  const duration = Date.parse(`${end}Z`) - Date.parse(`${previousBookingStart}Z`);
  if (duration >= 0) {
    const shiftedEnd = shiftTime(start, duration);
    if (shiftedEnd) {
      setDateControl(bookingEndDate, shiftedEnd.slice(0, 10));
      if (!bookingAllDay.checked) bookingEndTime.value = clock(shiftedEnd);
    }
  }
  previousBookingStart = start;
}

function canEditBooking(bookingId = state.editingId) {
  return !state.session.read_only && state.session.role !== "guest"
    && Boolean(state.bookings.find(({ id }) => id === bookingId)?.can_edit);
}

function updateBookingPermissions() {
  const existing = state.editingId !== null;
  const readOnly = existing && !canEditBooking();
  const guest = state.session.role === "guest";
  let title = existing ? "Изменить бронь" : "Новая бронь";
  if (state.bookingAction === "copy") title = "Копировать бронь";
  if (state.bookingAction === "move") title = "Перенести бронь";
  $("#booking-dialog-title").textContent = readOnly ? "Бронь" : title;
  for (const fieldset of bookingForm.querySelectorAll("[data-booking-fields]")) fieldset.disabled = readOnly;
  bookingForm.elements.person.readOnly = readOnly;
  bookingForm.elements.comment.readOnly = readOnly;
  const saveButton = $("#save-booking");
  saveButton.hidden = readOnly;
  saveButton.textContent = state.bookingAction === "copy" ? "Создать копию" : "Сохранить";
  cancelBookingButton.hidden = !existing || readOnly;
  $("#booking-access").hidden = Boolean(state.session.read_only) || (!readOnly && (existing || !guest));
  bookingAccountAccess.hidden = !guest;
  if (readOnly) {
    const booking = state.bookings.find(({ id }) => id === state.editingId);
    $("#booking-access-message").textContent = booking?.has_owner
      ? "Изменить или отменить эту бронь может её автор или администратор."
      : "Бронь без учётной записи может изменить или отменить администратор.";
  } else if (guest && !existing) {
    $("#booking-access-message").textContent = "Войдите перед сохранением, чтобы потом изменить или отменить свою бронь.";
  }
}

function updateSession(session) {
  const changed = state.session.role !== session.role || state.session.username !== session.username;
  state.session = session;
  if (changed) {
    for (const booking of state.bookings) booking.can_edit = false;
  }
  const admin = session.role === "admin";
  $("#view-only-label").hidden = !session.read_only;
  accountAccess.hidden = Boolean(session.read_only);
  $("#new-booking").hidden = Boolean(session.read_only);
  accountAccess.textContent = admin ? "Выйти из режима администратора"
    : session.username ? `Выйти (${session.username})` : "Войти";
  changePassword.hidden = session.role !== "user";
  for (const selector of ["#new-instrument", "#empty-add", "#manage-directory", "#manage-resonators"]) {
    $(selector).hidden = !admin;
  }
  renameInstrument.hidden = !admin || state.activeId === null || state.allInstruments;
  $("#empty-message").hidden = admin;
  if (bookingDialog.open) {
    updateBookingPermissions();
    if (changed && state.editingId === null) {
      selectAccountEmployee();
      updateEmployeeChoices();
    }
  }
  return changed;
}

function openBookingForm(booking, slotStart, action = "open") {
  if (state.activeId === null || (state.session.read_only && (!booking || action !== "open"))) return;
  const start = booking?.start || slotStart || `${dateKey(state.date)}T09:00`;
  const workdayEnd = `${start.slice(0, 10)}T20:00`;
  const end = booking?.end ?? (start < workdayEnd ? workdayEnd : shiftTime(start, 3600000));
  const fields = bookingForm.elements;
  state.bookingAction = action;
  state.editingId = action === "copy" ? null : booking?.id ?? null;
  fillBookingChoices(booking);
  const startDate = start.slice(0, 10);
  bookingAllDay.checked = Boolean(booking?.all_day);
  setDateControl(bookingStartDate, startDate);
  setDateControl(bookingEndDate, bookingAllDay.checked ? shiftTime(end, -DAY_MS).slice(0, 10) : end.slice(0, 10));
  bookingStartTime.value = bookingAllDay.checked ? "09:00" : clock(start);
  bookingEndTime.value = bookingAllDay.checked ? "20:00" : clock(end);
  bookingEndDate.dataset.min = startDate;
  updateBookingTimeFields();
  updateBookingPermissions();
  fields.person.value = booking?.person || "";
  fields.comment.value = booking?.comment || "";
  formError(bookingForm);
  bookingDialog.showModal();
  if (action !== "open") $('[data-pick="booking-start-date"]').focus();
}

function showBookingMenu(event) {
  const trigger = event.target.closest("button[data-booking]");
  if (!trigger || state.session.read_only) return;
  const bookingId = Number(trigger.dataset.booking);
  if (!state.bookings.some(({ id }) => id === bookingId)) return;
  event.preventDefault();
  const container = trigger.closest("dialog") || document.body;
  if (bookingMenu.parentElement !== container) {
    bookingMenu.hidePopover();
    container.append(bookingMenu);
  }
  menuBookingId = bookingId;
  menuTrigger = trigger;
  const canEdit = canEditBooking(bookingId);
  for (const button of bookingMenu.querySelectorAll("[data-booking-action]:not([data-booking-action='copy'])")) {
    button.hidden = !canEdit;
  }
  const anchor = trigger.getBoundingClientRect();
  const pointer = event.clientX || event.clientY;
  bookingMenu.style.left = `${pointer ? event.clientX : anchor.left}px`;
  bookingMenu.style.top = `${pointer ? event.clientY : anchor.bottom}px`;
  bookingMenu.showPopover();
  const rect = bookingMenu.getBoundingClientRect();
  bookingMenu.style.left = `${Math.max(0, Math.min(rect.left, innerWidth - rect.width))}px`;
  bookingMenu.style.top = `${Math.max(0, Math.min(rect.top, innerHeight - rect.height))}px`;
  bookingMenu.querySelector("button:not([hidden])").focus();
}

calendar.addEventListener("contextmenu", showBookingMenu);
$("#day-bookings-list").addEventListener("contextmenu", showBookingMenu);
bookingMenu.addEventListener("keydown", (event) => {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End", "Escape"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") {
    bookingMenu.hidePopover();
    menuTrigger?.focus();
    return;
  }
  const buttons = Array.from(bookingMenu.querySelectorAll("button:not([hidden])"));
  if (event.key === "Home") buttons[0].focus();
  else if (event.key === "End") buttons.at(-1).focus();
  else {
    const step = event.key === "ArrowDown" ? 1 : -1;
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + buttons.length + step) % buttons.length].focus();
  }
});
bookingMenu.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-booking-action]")?.dataset.bookingAction;
  if (!action || state.session.read_only) return;
  const booking = state.bookings.find(({ id }) => id === menuBookingId);
  bookingMenu.hidePopover();
  if (!booking || (action !== "copy" && !canEditBooking(booking.id))) return;
  if (action !== "delete") {
    dayBookingsDialog.close();
    openBookingForm(booking, undefined, action);
  } else if (window.confirm("Отменить эту бронь?")) {
    dayBookingsDialog.close();
    try {
      await removeBooking(booking.id);
    } catch (error) {
      setStatus(error.message);
    }
  }
});

$("#instruments").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || button.getAttribute("aria-pressed") === "true") return;
  state.allInstruments = button.dataset.id === "all";
  if (state.allInstruments) {
    setView(isOverview(state.view) ? state.view : defaultView);
    return;
  }
  state.activeId = Number(button.dataset.id);
  markInstrumentSelection();
  refreshCalendar();
});

$("#new-instrument").addEventListener("click", () => openInstrumentForm());
$("#empty-add").addEventListener("click", () => openInstrumentForm());
renameInstrument.addEventListener("click", () => {
  const instrument = state.instruments.find(({ id }) => id === state.activeId);
  if (instrument) openInstrumentForm(instrument);
});
$("#new-booking").addEventListener("click", () => openBookingForm());
openUtilizationButton.addEventListener("click", openUtilization);
expandCalendarButton.addEventListener("click", () => {
  const expanded = $("#workspace").classList.toggle("calendar-wide");
  $("#instrument-sidebar").hidden = expanded;
  expandCalendarButton.setAttribute("aria-expanded", String(!expanded));
  expandCalendarButton.textContent = expanded ? "Показать приборы" : "На всю ширину";
});
$("#manage-resonators").addEventListener("click", () => {
  resetResonatorForm();
  renderResonators();
  resonatorDialog.showModal();
});
$("#cancel-resonator-edit").addEventListener("click", resetResonatorForm);
$("#booking-instruments").addEventListener("change", updateResonatorChoices);
bookingStartDate.addEventListener("change", moveBookingStart);
bookingAllDay.addEventListener("change", updateBookingTimeFields);
for (const input of [bookingStartTime, bookingEndTime]) {
  input.addEventListener("input", () => input.setCustomValidity(""));
  input.addEventListener("change", () => {
    const time = bookingTime(input);
    input.setCustomValidity(time ? "" : "Введите время в формате ЧЧ:ММ.");
    if (!time) return;
    input.value = time;
    if (input === bookingStartTime) moveBookingStart();
  });
}
$("#manage-directory").addEventListener("click", () => {
  fillDirectoryLabs();
  selectDirectoryLab();
  directoryDialog.showModal();
});
directoryLab.addEventListener("change", selectDirectoryLab);
$("#cancel-employee-edit").addEventListener("click", resetEmployeeForm);
bookingLab.addEventListener("change", updateEmployeeChoices);
$("#booking-employees").addEventListener("change", updateEmployeeChoices);
calendar.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.start) openBookingForm(null, button.dataset.start);
  if (button.dataset.booking) openBookingForm(state.bookings.find((booking) => booking.id === Number(button.dataset.booking)));
  if (button.classList.contains("month-date") && (event.detail === 0 || event.pointerType === "touch")) {
    openBookingForm(null, `${button.parentElement.dataset.day}T09:00`);
  }
});
calendar.addEventListener("dblclick", (event) => {
  if (event.target.closest("button:not(.month-date)")) return;
  const day = event.target.closest("[data-day]")?.dataset.day;
  if (day) openBookingForm(null, `${day}T09:00`);
});

for (const button of document.querySelectorAll(".view-picker button[data-view]")) {
  button.addEventListener("click", () => setView(button.dataset.view));
}

for (const [selector, direction] of [["#previous", -1], ["#next", 1]]) {
  $(selector).addEventListener("click", () => {
    const monthView = state.view === "month";
    state.date = monthView ? firstOfMonth(state.date, direction)
      : addDays(state.date, direction * (state.view === "day" ? 1 : 7));
    refreshCalendar(isOverview(state.view));
  });
}

$("#today").addEventListener("click", () => {
  state.date = new Date();
  refreshCalendar(true);
});

datePicker.addEventListener("change", () => {
  state.date = datePicker.value ? fromKey(datePicker.value) : new Date();
  refreshCalendar();
});

for (const trigger of pickerTriggers) {
  trigger.addEventListener("click", () => openDatePicker(trigger));
}
for (const [selector, delta] of [["#picker-previous", -1], ["#picker-next", 1]]) {
  $(selector).addEventListener("click", () => {
    picker.month = firstOfMonth(picker.month, delta);
    renderPickerDays();
  });
}
$("#picker-days").addEventListener("click", (event) => {
  const button = event.target.closest("[data-picker-day]");
  if (!button || button.disabled) return;
  setDateControl(picker.input, button.dataset.pickerDay);
  datePickerDialog.close();
  picker.input.dispatchEvent(new Event("change", { bubbles: true }));
});

for (const dialog of document.querySelectorAll("dialog")) {
  for (const button of dialog.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => dialog.close());
  }
  dialog.addEventListener("cancel", (event) => {
    if (dialog.querySelector("form[data-pending]")) event.preventDefault();
  });
}

function setAccountMode(mode) {
  accountForm.dataset.mode = mode;
  const registration = mode === "register";
  const admin = mode === "admin";
  const needsSetup = admin && !state.session.admin_configured;
  const { username, password } = accountForm.elements;
  password.value = "";
  for (const button of accountForm.querySelectorAll("[data-account-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.accountMode === mode));
  }
  $("#admin-setup").hidden = !needsSetup;
  $("#account-username-label").hidden = admin;
  $("#account-password-label").hidden = needsSetup;
  $("#register-name-hint").hidden = !registration;
  $("#register-password-hint").hidden = !registration;
  username.disabled = admin;
  password.disabled = needsSetup;
  password.autocomplete = registration ? "new-password" : "current-password";
  password.minLength = registration ? 5 : 1;
  const submitButton = $("#account-submit");
  submitButton.hidden = needsSetup;
  submitButton.textContent = registration ? "Создать учётную запись" : "Войти";
  formError(accountForm);
}

async function openAccountAccess(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (button === accountAccess && state.session.role !== "guest") {
      await api("logout", "POST", {});
      updateSession({ ...state.session, role: "guest", username: null, employee_id: null });
      await refreshCalendar();
      return;
    }
    const session = await api("session");
    updateSession(session);
    if (session.role !== "guest") {
      await refreshCalendar();
      return;
    }
    accountForm.reset();
    setAccountMode("login");
    accountDialog.showModal();
    accountForm.elements.username.focus();
  } catch (error) {
    if (bookingDialog.open) formError(bookingForm, error.message);
    else setStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

accountAccess.addEventListener("click", openAccountAccess);
bookingAccountAccess.addEventListener("click", openAccountAccess);
accountDialog.addEventListener("close", () => accountForm.reset());
for (const button of accountForm.querySelectorAll("[data-account-mode]")) {
  button.addEventListener("click", () => setAccountMode(button.dataset.accountMode));
}
accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(accountForm, async () => {
    const data = Object.fromEntries(new FormData(accountForm));
    await api(accountRoutes[accountForm.dataset.mode], "POST", data);
    const session = await api("session");
    updateSession(session);
    await refreshCalendar();
    if (bookingDialog.open) formError(bookingForm);
    accountDialog.close();
  });
});

changePassword.addEventListener("click", () => {
  passwordForm.reset();
  formError(passwordForm);
  $("#password-updated").hidden = true;
  passwordDialog.showModal();
});
passwordDialog.addEventListener("close", () => passwordForm.reset());
passwordForm.addEventListener("submit", (event) => {
  event.preventDefault();
  $("#password-updated").hidden = true;
  submit(passwordForm, async () => {
    const fields = new FormData(passwordForm);
    const replacement = fields.get("new_password");
    if (replacement !== fields.get("confirmation")) throw new Error("Новые пароли не совпадают.");
    await api("password", "POST", {
      current_password: fields.get("current_password"),
      new_password: replacement,
    });
    passwordForm.reset();
    $("#password-updated").hidden = false;
  });
});

instrumentForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(instrumentForm, async () => {
    const editingId = state.editingInstrumentId;
    const payload = { name: instrumentName.value };
    if (editingId === null) {
      const item = await api("instruments", "POST", payload);
      state.instruments.push(item);
      state.activeId = item.id;
      state.allInstruments = false;
    } else {
      const item = await api(`instruments/${editingId}`, "PUT", payload);
      state.instruments = state.instruments.map((instrument) => instrument.id === item.id ? item : instrument);
    }
    renderInstruments();
    instrumentDialog.close();
    refreshCalendar(editingId === null);
  });
});

labForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(labForm, async () => {
    const lab = await api(`labs/${directoryLab.value}`, "PUT", { name: labForm.elements.namedItem("name").value });
    state.labs = state.labs.map((item) => item.id === lab.id ? lab : item);
    fillDirectoryLabs();
    if (Number(directoryLab.value) === lab.id) labForm.elements.namedItem("name").value = lab.name;
  });
});

employeeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(employeeForm, async () => {
    const id = state.editingEmployeeId;
    const payload = { lab_id: Number(directoryLab.value), name: employeeForm.elements.namedItem("name").value };
    const employee = await api(id === null ? "employees" : `employees/${id}`, id === null ? "POST" : "PUT", payload);
    state.employees = [...state.employees.filter((item) => item.id !== employee.id), employee]
      .sort((first, second) => first.name.localeCompare(second.name, "ru"));
    resetEmployeeForm();
    renderDirectoryEmployees();
    if (id !== null) refreshCalendar();
  });
});

resonatorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submit(resonatorForm, async () => {
    const id = state.editingResonatorId;
    const payload = { name: resonatorForm.elements.namedItem("name").value };
    const item = await api(id === null ? "resonators" : `resonators/${id}`, id === null ? "POST" : "PUT", payload);
    if (id === null) state.resonators.push(item);
    else state.resonators = state.resonators.map((resonator) => resonator.id === item.id ? item : resonator);
    resetResonatorForm();
    renderResonators();
    if (id !== null) refreshCalendar();
  });
});

bookingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const editing = state.editingId !== null;
  if (editing && !canEditBooking()) return;
  if (bookingTimestamp(bookingStartDate, bookingStartTime) !== previousBookingStart) moveBookingStart();
  submit(bookingForm, async () => {
    const fields = new FormData(bookingForm);
    const payload = Object.fromEntries(fields);
    if (!editing) payload.expected_username = state.session.username;
    payload.all_day = bookingAllDay.checked;
    payload.start = bookingTimestamp(bookingStartDate, bookingStartTime);
    payload.end = bookingTimestamp(bookingEndDate, bookingEndTime);
    if (!payload.start || !payload.end) throw new Error("Укажите дату и время начала и окончания.");
    if (payload.all_day) payload.end = shiftTime(payload.end, DAY_MS);
    if (payload.end <= payload.start) throw new Error("Окончание должно быть позже начала.");
    payload.instrument_ids = fields.getAll("instrument_ids").map(Number);
    payload.employee_ids = fields.getAll("employee_ids").map(Number);
    const resonators = Array.from($("#booking-resonators").querySelectorAll("select:not(:disabled)"));
    payload.resonators = Object.fromEntries(resonators.filter((select) => select.value)
      .map((select) => [select.dataset.instrument, Number(select.value)]));
    const booking = await api(editing ? `bookings/${state.editingId}` : "bookings", editing ? "PUT" : "POST", payload);
    if (!booking.instrument_ids.includes(state.activeId)) state.activeId = booking.instrument_ids[0];
    state.date = fromKey(booking.start.slice(0, 10));
    renderInstruments();
    bookingDialog.close();
    refreshCalendar();
  });
});

async function removeBooking(bookingId) {
  await api(`bookings/${bookingId}`, "DELETE");
  if (bookingDialog.open && state.editingId === bookingId) bookingDialog.close();
  refreshCalendar();
}

cancelBookingButton.addEventListener("click", () => {
  if (!canEditBooking()) return;
  if (!window.confirm("Отменить эту бронь?")) return;
  submit(bookingForm, () => removeBooking(state.editingId));
});

async function start() {
  try {
    const [instruments, directory, resonators, session] = await Promise.all([
      api("instruments"), api("directory"), api("resonators"), api("session"),
    ]);
    state.instruments = instruments;
    state.resonators = resonators;
    state.labs = directory.labs;
    state.employees = directory.employees;
    state.activeId = state.instruments[0]?.id ?? null;
    state.allInstruments = state.activeId !== null;
    updateSession(session);
    renderInstruments();
  } catch (error) {
    setStatus(error.message);
  } finally {
    accountAccess.disabled = false;
    refreshCalendar(true);
  }
}

start();
