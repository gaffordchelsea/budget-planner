/* ===================================================================
   Budget Planner Final Build
   Functional single-page planner with saved cycles, month-based data,
   income/bills/goals/spark tracking, assignment math, reports,
   history, backup import/export, and a pink/black/white plan layout.
   =================================================================== */

const STORAGE_KEY = "budgetPlannerStateV1";
const DEFAULT_SPENDING_CATEGORIES = [
  "Gas",
  "Groceries",
  "Medical",
  "Household",
  "Kids",
  "Pets/Dogs",
  "Entertainment",
  "Other"
];

let plannerState = null;
let activeCycleId = null;
let activeMonthName = null;
let activeMonthSection = "overview";
let activeWeeklyIndex = 0;
let activeSparkOrderIndex = -1;

function initializePlanner() {
  plannerState = loadState();
  if (!plannerState) {
    plannerState = buildDefaultState();
  } else {
    plannerState = normalizeState(plannerState);
  }

  ensureActiveCycle();
  activeCycleId = plannerState.currentCycleId;
  activeMonthName = plannerState.lastOpenedMonth || getCurrentMonthName();

  bindImportListener();
  renderApp();
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse planner state", error);
    return null;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plannerState));
}

function buildDefaultState() {
  const today = new Date();
  const cycle = createCycleForDate(today);
  return {
    currentCycleId: cycle.id,
    lastOpenedMonth: cycle.months[0].name,
    cycles: [cycle],
    priorities: ["Bills", "Savings", "Goals", "Fun", "Other"],
    settings: {
      defaultCategories: DEFAULT_SPENDING_CATEGORIES.slice()
    }
  };
}

function normalizeState(state) {
  if (!state.cycles || !state.cycles.length) {
    return buildDefaultState();
  }

  state.cycles = state.cycles.map((cycle) => normalizeCycle(cycle));
  state.currentCycleId = state.currentCycleId || state.cycles[0].id;
  state.lastOpenedMonth = state.lastOpenedMonth || getCurrentMonthName();
  state.priorities = Array.isArray(state.priorities) && state.priorities.length
    ? state.priorities
    : ["Bills", "Savings", "Goals", "Fun", "Other"];
  state.settings = state.settings || {};
  state.settings.defaultCategories = Array.isArray(state.settings.defaultCategories) && state.settings.defaultCategories.length
    ? state.settings.defaultCategories
    : DEFAULT_SPENDING_CATEGORIES.slice();
  return state;
}

function normalizeCycle(cycle) {
  const monthNames = getCycleMonthNames(cycle.label || cycle.type || "cycle-1");
  if (!cycle.months || !cycle.months.length) {
    cycle.months = monthNames.map((name) => createMonthData(name, cycle.year || new Date().getFullYear()));
  } else {
    cycle.months = cycle.months.map((month) => ({
      ...createMonthData(month.name || month.month || month.title || monthNames[0], month.year || cycle.year || new Date().getFullYear()),
      ...month,
      income: Array.isArray(month.income) ? month.income : [],
      bills: Array.isArray(month.bills) ? month.bills : [],
      goals: Array.isArray(month.goals) ? month.goals : [],
      carFund: Array.isArray(month.carFund) ? month.carFund : [],
      spark: Array.isArray(month.spark) ? month.spark.map((entry) => ({ ...entry, collapsed: entry.collapsed ?? false })) : [],
      sparkTips: Array.isArray(month.sparkTips) ? month.sparkTips : [],
      weeks: Array.isArray(month.weeks) && month.weeks.length ? month.weeks : createDefaultWeeks(month.name || month.month || month.title || monthNames[0], month.year || cycle.year || new Date().getFullYear()),
      assignmentCategories: Array.isArray(month.assignmentCategories) ? month.assignmentCategories : [],
      spending: Array.isArray(month.spending) ? month.spending : [],
      notes: month.notes || ""
    }));
  }

  if (!cycle.label) {
    cycle.label = cycle.id === "cycle-2" ? "Cycle 2" : "Cycle 1";
  }

  cycle.months = cycle.months.slice(0, 6);
  return cycle;
}

function createCycleForDate(date) {
  const monthIndex = date.getMonth();
  const year = date.getFullYear();
  const cycleLabel = monthIndex >= 6 && monthIndex <= 11 ? "Cycle 1" : "Cycle 2";
  const monthNames = getCycleMonthNames(cycleLabel);
  return {
    id: `cycle-${cycleLabel.toLowerCase().replace(/\s+/g, "-")}-${year}`,
    label: cycleLabel,
    year,
    months: monthNames.map((name) => createMonthData(name, year))
  };
}

function getCycleMonthNames(cycleLabel) {
  if (cycleLabel === "Cycle 2") {
    return ["January", "February", "March", "April", "May", "June"];
  }
  return ["July", "August", "September", "October", "November", "December"];
}

function createMonthData(name, year) {
  return {
    name,
    year,
    income: [
      { source: "Home Health", date: "", amount: "", notes: "" },
      { source: "Walmart/Spark", date: "", amount: "", notes: "" },
      { source: "Child Support", date: "", amount: "", notes: "" },
      { source: "Other Income", date: "", amount: "", notes: "" }
    ],
    bills: [
      { name: "Rent", dueDate: "", amount: "", paid: false, recurring: true, notes: "" },
      { name: "Phone", dueDate: "", amount: "", paid: false, recurring: false, notes: "" },
      { name: "Insurance", dueDate: "", amount: "", paid: false, recurring: true, notes: "" },
      { name: "Health Insurance", dueDate: "", amount: "", paid: false, recurring: true, notes: "" },
      { name: "Internet", dueDate: "", amount: "", paid: false, recurring: true, notes: "" },
      { name: "Electric", dueDate: "", amount: "", paid: false, recurring: false, notes: "" },
      { name: "Water", dueDate: "", amount: "", paid: false, recurring: false, notes: "" },
      { name: "Car Payment", dueDate: "", amount: "", paid: false, recurring: true, notes: "" },
      { name: "Other", dueDate: "", amount: "", paid: false, recurring: false, notes: "" }
    ],
    goals: [
      { name: "Past Due Car Payment", targetAmount: 5000, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Car Fund", targetAmount: 1000, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Credit Cards", targetAmount: 3000, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Mom", targetAmount: 1000, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Aunt Mary", targetAmount: 1000, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Dogs", targetAmount: 1500, currentAmount: 0, addedAmount: 0, notes: "" },
      { name: "Other", targetAmount: 1000, currentAmount: 0, addedAmount: 0, notes: "" }
    ],
    carFund: [],
    carFundTargetAmount: 1000,
    spark: [],
    sparkTips: [],
    weeks: createDefaultWeeks(name, year),
    assignmentCategories: DEFAULT_SPENDING_CATEGORIES.map((category) => ({ name: category, amount: "", notes: "" })),
    spending: [],
    notes: ""
  };
}

function getMonthIndex(name) {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(name);
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }

  const parts = trimmed.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts.map((part) => Number(part));
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  return trimmed;
}

function createDefaultWeeks(monthName, year) {
  const weeks = [];
  const monthStart = new Date(year, getMonthIndex(monthName), 1);
  const monthEnd = new Date(year, getMonthIndex(monthName) + 1, 0);
  const totalDays = monthEnd.getDate();
  let currentStart = new Date(monthStart);

  const weekCount = Math.min(5, Math.ceil(totalDays / 7));

  for (let index = 0; index < weekCount; index += 1) {
    const weekStart = new Date(currentStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    if (weekEnd.getMonth() !== monthStart.getMonth()) {
      weekEnd.setMonth(monthStart.getMonth(), Math.min(weekEnd.getDate(), monthEnd.getDate()));
    }
    weeks.push({
      name: `Week ${index + 1}`,
      startDate: formatDateInput(weekStart),
      endDate: formatDateInput(weekEnd),
      homeHealthIncome: "",
      childSupportIncome: "",
      income: [],
      bills: [],
      savingsDeposits: [],
      goals: [],
      expenses: [],
      notes: ""
    });
    currentStart.setDate(weekStart.getDate() + 7);
  }

  return weeks;
}

function ensureWeekData(month) {
  if (!Array.isArray(month.weeks) || !month.weeks.length) {
    month.weeks = createDefaultWeeks(month.name, month.year);
  }
  return month.weeks;
}

function hasWeeklyIncomeEntries(month) {
  return ensureWeekData(month).some((week) => {
    const homeHealth = Number(week.homeHealthIncome) || 0;
    const childSupport = Number(week.childSupportIncome) || 0;
    const spark = getWeeklySparkIncome(month, week);
    return homeHealth > 0 || childSupport > 0 || spark > 0 || week.income.some((entry) => (Number(entry.amount) || 0) > 0);
  });
}

function hasWeeklyBillEntries(month) {
  return ensureWeekData(month).some((week) => week.bills.some((entry) => (Number(entry.amount) || 0) > 0));
}

function hasWeeklySavingsEntries(month) {
  return ensureWeekData(month).some((week) => week.savingsDeposits.some((entry) => (Number(entry.amount) || 0) > 0));
}

function getSelectedWeekData() {
  const month = getSelectedMonthData();
  const weeks = ensureWeekData(month);
  if (activeWeeklyIndex < 0 || activeWeeklyIndex >= weeks.length) {
    activeWeeklyIndex = 0;
  }
  return weeks[activeWeeklyIndex];
}

function parseDateInput(value) {
  if (!value) {
    return null;
  }

  const parts = String(value).split("-").map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getWeeklySparkIncome(month, week) {
  const weekStart = parseDateInput(week.startDate);
  const weekEnd = parseDateInput(week.endDate);

  if (!weekStart || !weekEnd) {
    return 0;
  }

  return month.spark.reduce((sum, entry) => {
    const acceptedDate = parseDateInput(entry.acceptedDate);
    if (!acceptedDate) {
      return sum;
    }

    if (acceptedDate >= weekStart && acceptedDate <= weekEnd) {
      const payout = Number(entry.estimatedPayout) || (Number(entry.estimatedBasePay) || 0) + (Number(entry.estimatedTip) || 0);
      return sum + payout;
    }

    return sum;
  }, 0);
}

function getWeeklyIncomeTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + (Number(week.homeHealthIncome) || 0) + (Number(week.childSupportIncome) || 0) + getWeeklySparkIncome(month, week), 0);
}

function getWeeklyBillsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + week.bills.reduce((weekSum, entry) => weekSum + (Number(entry.amount) || 0), 0), 0);
}

function getWeeklySavingsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + week.savingsDeposits.reduce((weekSum, entry) => weekSum + (Number(entry.amount) || 0), 0), 0);
}

function getWeeklyExpensesTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + week.expenses.reduce((weekSum, entry) => weekSum + (Number(entry.amount) || 0), 0), 0);
}

function getWeeklyGoalContributionTotal(month, goalName) {
  const targetName = (goalName || "").toLowerCase();
  return ensureWeekData(month).reduce((sum, week) => sum + week.goals.reduce((weekSum, entry) => {
    return weekSum + ((entry.name || "").toLowerCase() === targetName ? (Number(entry.amount) || 0) : 0);
  }, 0), 0);
}

function ensureActiveCycle() {
  const today = new Date();
  const expectedCycle = createCycleForDate(today);
  const existingCycle = plannerState.cycles.find((cycle) => cycle.label === expectedCycle.label && cycle.year === expectedCycle.year);

  if (!existingCycle) {
    plannerState.cycles.push(expectedCycle);
  }

  const currentCycle = plannerState.cycles.find((cycle) => cycle.id === plannerState.currentCycleId);
  if (!currentCycle) {
    plannerState.currentCycleId = plannerState.cycles[plannerState.cycles.length - 1].id;
  }
}

function getActiveCycle() {
  return plannerState.cycles.find((cycle) => cycle.id === activeCycleId) || plannerState.cycles[0];
}

function getSelectedMonthData() {
  const cycle = getActiveCycle();
  return cycle.months.find((month) => month.name === activeMonthName) || cycle.months[0];
}

function getCurrentMonthName() {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  return month;
}

function renderApp() {
  renderMonthButtons();
  renderMonthView();
  renderDashboard();
  renderHistory();
  renderReports();
  renderSettings();
  updateCycleTitle();
  showPage("dashboard");
}

function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => page.classList.add("hidden"));
  const target = document.getElementById(pageId);
  if (target) {
    target.classList.remove("hidden");
  }

  document.querySelectorAll(".main-navigation button").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-page") === pageId);
  });
}

function renderMonthButtons() {
  const container = document.getElementById("monthButtons");
  const cycle = getActiveCycle();
  if (!container || !cycle) {
    return;
  }

  container.innerHTML = cycle.months.map((month) => `
    <button class="${month.name === activeMonthName ? "active" : ""}" onclick="openMonth('${month.name}')">${month.name}</button>
  `).join("");
}

function openMonth(monthName) {
  activeMonthName = monthName;
  plannerState.lastOpenedMonth = monthName;
  saveState();
  renderMonthButtons();
  renderMonthView();
  renderDashboard();
}

function renderMonthView() {
  const month = getSelectedMonthData();
  const monthArea = document.getElementById("monthArea");
  if (!monthArea || !month) {
    return;
  }

  const weeks = ensureWeekData(month);

  monthArea.innerHTML = `
    <div class="month-view">
      <h3>${month.name} ${month.year}</h3>

      <div class="week-nav-buttons">
        <button class="week-button ${activeWeeklyIndex < 0 ? "active" : ""}" onclick="showWeeklyOverview()">Monthly Overview</button>
        ${weeks.map((week, index) => `
          <button class="week-button ${activeWeeklyIndex === index ? "active" : ""}" onclick="showWeek(${index})">${week.name}</button>
        `).join("")}
      </div>

      <div id="weeklyTrackerArea"></div>

      <div class="month-tab-buttons">
        <button data-section="overview" class="tab-button ${activeMonthSection === "overview" ? "active" : ""}" onclick="showMonthSection('overview')">Overview</button>
        <button data-section="income" class="tab-button ${activeMonthSection === "income" ? "active" : ""}" onclick="showMonthSection('income')">Income</button>
        <button data-section="bills" class="tab-button ${activeMonthSection === "bills" ? "active" : ""}" onclick="showMonthSection('bills')">Bills</button>
        <button data-section="goals" class="tab-button ${activeMonthSection === "goals" ? "active" : ""}" onclick="showMonthSection('goals')">Goals</button>
        <button data-section="carFund" class="tab-button ${activeMonthSection === "carFund" ? "active" : ""}" onclick="showMonthSection('carFund')">Car Fund</button>
        <button data-section="spark" class="tab-button ${activeMonthSection === "spark" ? "active" : ""}" onclick="showMonthSection('spark')">Spark Tracker</button>
        <button data-section="assignment" class="tab-button ${activeMonthSection === "assignment" ? "active" : ""}" onclick="showMonthSection('assignment')">Monthly Money Assignment</button>
        <button data-section="notes" class="tab-button ${activeMonthSection === "notes" ? "active" : ""}" onclick="showMonthSection('notes')">Notes</button>
      </div>

      <section id="monthSection-overview" class="month-section">
        <div class="dashboard-cards" id="overviewCards"></div>
      </section>

      <section id="monthSection-income" class="month-section hidden">
        <h4>Income</h4>
        <div id="monthIncomeArea"></div>
        <button onclick="addIncomeRow()">Add Income</button>
      </section>

      <section id="monthSection-bills" class="month-section hidden">
        <h4>Bills</h4>
        <div id="monthBillsArea"></div>
        <button onclick="addBillRow()">Add Bill</button>
      </section>

      <section id="monthSection-goals" class="month-section hidden">
        <h4>Goals</h4>
        <div id="monthGoalsArea"></div>
        <button onclick="addGoal()">Add Goal</button>
      </section>

      <section id="monthSection-carFund" class="month-section hidden">
        <h4>Car Fund</h4>
        <div id="carFundArea"></div>
        <button onclick="addCarFundEntry()">Add Contribution</button>
      </section>

      <section id="monthSection-spark" class="month-section hidden">
        <h4>Spark Tracker</h4>
        <p>Spark Earnings This Month: <span id="sparkMonthTotal">$0</span></p>
        <div class="entry-actions">
          <button class="ghost-button" onclick="showMonthSection('income')">Back to Income</button>
          <button onclick="addSparkShift()">Add Spark Shift</button>
        </div>
        <div id="sparkArea"></div>
      </section>

      <section id="monthSection-assignment" class="month-section hidden">
        <h4>Monthly Money Assignment</h4>
        <p>Left to Assign: <span id="leftToAssign">$0</span></p>
        <div id="assignmentArea"></div>
        <button onclick="addAssignmentCategory()">Add Category</button>
      </section>

      <section id="monthSection-notes" class="month-section hidden">
        <h4>Notes</h4>
        <textarea id="monthNotes" placeholder="Anything you want to remember about this month..." oninput="updateMonthNotes(this.value)"></textarea>
      </section>
    </div>
  `;

  renderMonthSections();
  renderWeeklyTracker();
  showMonthSection(activeMonthSection);
}

function showWeek(index) {
  activeWeeklyIndex = index;
  renderWeeklyTracker();
}

function showWeeklyOverview() {
  activeWeeklyIndex = -1;
  renderWeeklyTracker();
}

function showMonthSection(name) {
  activeMonthSection = name;
  document.querySelectorAll(".month-section").forEach((section) => section.classList.add("hidden"));
  const target = document.getElementById("monthSection-" + name);
  if (target) {
    target.classList.remove("hidden");
  }

  document.querySelectorAll(".month-tab-buttons button").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-section") === name);
  });
}

function renderMonthSections() {
  renderOverviewSection();
  renderIncomeSection();
  renderBillsSection();
  renderGoalsSection();
  renderCarFundSection();
  renderSparkSection();
  renderAssignmentSection();
  renderNotesSection();
}

function renderWeeklyTracker() {
  const month = getSelectedMonthData();
  const container = document.getElementById("weeklyTrackerArea");
  if (!container || !month) {
    return;
  }

  const weeks = ensureWeekData(month);
  if (activeWeeklyIndex < 0 || activeWeeklyIndex >= weeks.length) {
    activeWeeklyIndex = -1;
  }
  const selectedWeek = activeWeeklyIndex >= 0 ? weeks[activeWeeklyIndex] : null;
  const incomeTotal = getWeeklyIncomeTotal(month);
  const billsTotal = getWeeklyBillsTotal(month);
  const savingsTotal = getWeeklySavingsTotal(month);
  const expensesTotal = getWeeklyExpensesTotal(month);

  container.innerHTML = `
    <div class="report-card">
      <h4>${activeWeeklyIndex < 0 ? "Monthly Overview" : selectedWeek.name}</h4>
      ${activeWeeklyIndex >= 0 && selectedWeek ? `<p class="spark-note">${selectedWeek.startDate} to ${selectedWeek.endDate}</p>` : ""}
      <div class="dashboard-cards">
        <div class="card"><h4>Weekly Income</h4><p>${formatCurrency(incomeTotal)}</p></div>
        <div class="card"><h4>Weekly Bills</h4><p>${formatCurrency(billsTotal)}</p></div>
        <div class="card"><h4>Weekly Savings</h4><p>${formatCurrency(savingsTotal)}</p></div>
        <div class="card"><h4>Weekly Expenses</h4><p>${formatCurrency(expensesTotal)}</p></div>
      </div>

      ${activeWeeklyIndex < 0 ? `
        <div class="dashboard-cards">
          <div class="card"><h4>Monthly Income</h4><p>${formatCurrency(getMonthlyIncome(month))}</p></div>
          <div class="card"><h4>Monthly Bills</h4><p>${formatCurrency(getMonthlyBills(month))}</p></div>
          <div class="card"><h4>Monthly Savings</h4><p>${formatCurrency(getMonthlySavings(month))}</p></div>
          <div class="card"><h4>Remaining</h4><p>${formatCurrency(getRemainingAmount(month))}</p></div>
        </div>
      ` : `
        <div class="week-detail-grid">
          <div class="entry-card">
            <h4>Income</h4>
            <div class="entry-fields">
              <label>Home Health
                <input type="number" min="0" step="0.01" value="${escapeHtml(selectedWeek.homeHealthIncome || "")}" onchange="updateWeeklyIncomeCategory('homeHealthIncome', this.value)" />
              </label>
              <label>Child Support
                <input type="number" min="0" step="0.01" value="${escapeHtml(selectedWeek.childSupportIncome || "")}" onchange="updateWeeklyIncomeCategory('childSupportIncome', this.value)" />
              </label>
              <label>Spark
                <div class="spark-note">${formatCurrency(getWeeklySparkIncome(month, selectedWeek))} from Spark tracker</div>
              </label>
            </div>
            <p class="spark-note">Home Health and Child Support are editable here. Spark is pulled from your Spark tracker entries for this week.</p>
          </div>

          <div class="entry-card">
            <h4>Bills</h4>
            ${selectedWeek.bills.map((entry, index) => `
              <div class="entry-fields">
                <label>Bill Name
                  <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateWeeklyBillEntry(${index}, 'name', this.value)" />
                </label>
                <label>Amount
                  <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyBillEntry(${index}, 'amount', this.value)" />
                </label>
                <label class="checkbox-label">
                  <input type="checkbox" ${entry.paid ? "checked" : ""} onchange="updateWeeklyBillEntry(${index}, 'paid', this.checked)" />
                  Paid
                </label>
                <label>Notes
                  <textarea onchange="updateWeeklyBillEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
                </label>
              </div>
              <button class="ghost-button" onclick="removeWeeklyBillEntry(${index})">Remove</button>
            `).join("")}
            <button onclick="addWeeklyBillEntry()">Add Bill</button>
          </div>

          <div class="entry-card">
            <h4>Savings</h4>
            ${selectedWeek.savingsDeposits.map((entry, index) => `
              <div class="entry-fields">
                <label>Amount
                  <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklySavingsEntry(${index}, 'amount', this.value)" />
                </label>
                <label>Date
                  <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateWeeklySavingsEntry(${index}, 'date', this.value)" />
                </label>
                <label>Notes
                  <textarea onchange="updateWeeklySavingsEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
                </label>
              </div>
              <button class="ghost-button" onclick="removeWeeklySavingsEntry(${index})">Remove</button>
            `).join("")}
            <button onclick="addWeeklySavingsEntry()">Add Deposit</button>
          </div>

          <div class="entry-card">
            <h4>Goals</h4>
            ${selectedWeek.goals.map((entry, index) => `
              <div class="entry-fields">
                <label>Goal Name
                  <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateWeeklyGoalEntry(${index}, 'name', this.value)" />
                </label>
                <label>Amount
                  <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyGoalEntry(${index}, 'amount', this.value)" />
                </label>
                <label>Notes
                  <textarea onchange="updateWeeklyGoalEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
                </label>
              </div>
              <button class="ghost-button" onclick="removeWeeklyGoalEntry(${index})">Remove</button>
            `).join("")}
            <button onclick="addWeeklyGoalEntry()">Add Goal Contribution</button>
          </div>

          <div class="entry-card">
            <h4>Expenses</h4>
            ${selectedWeek.expenses.map((entry, index) => `
              <div class="entry-fields">
                <label>Expense Name
                  <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateWeeklyExpenseEntry(${index}, 'name', this.value)" />
                </label>
                <label>Amount
                  <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyExpenseEntry(${index}, 'amount', this.value)" />
                </label>
                <label>Notes
                  <textarea onchange="updateWeeklyExpenseEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
                </label>
              </div>
              <button class="ghost-button" onclick="removeWeeklyExpenseEntry(${index})">Remove</button>
            `).join("")}
            <button onclick="addWeeklyExpenseEntry()">Add Expense</button>
          </div>

          <div class="entry-card">
            <h4>Notes</h4>
            <textarea oninput="updateWeeklyNotes(this.value)">${escapeHtml(selectedWeek.notes || "")}</textarea>
          </div>
        </div>
      `}
    </div>
  `;
}

function renderOverviewSection() {
  const month = getSelectedMonthData();
  const overviewCards = document.getElementById("overviewCards");
  if (!overviewCards || !month) {
    return;
  }

  const incomeTotal = getMonthlyIncome(month);
  const billsTotal = getMonthlyBills(month);
  const savingsTotal = getMonthlySavings(month);
  const goalValue = getGoalProgressValue(month);
  const remaining = getRemainingAmount(month);
  const health = getHealthScore(month);

  overviewCards.innerHTML = `
    <div class="card"><h4>Income</h4><p>${formatCurrency(incomeTotal)}</p></div>
    <div class="card"><h4>Bills</h4><p>${formatCurrency(billsTotal)}</p></div>
    <div class="card"><h4>Savings</h4><p>${formatCurrency(savingsTotal)}</p></div>
    <div class="card"><h4>Remaining</h4><p>${formatCurrency(remaining)}</p></div>
    <div class="card"><h4>Goal Progress</h4><p>${goalValue}%</p></div>
    <div class="card"><h4>Health Score</h4><p>${health} / 100</p></div>
  `;
}

function updateWeeklyIncomeCategory(field, value) {
  const week = getSelectedWeekData();
  week[field] = Number(value) || 0;
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklyBillEntry() {
  const week = getSelectedWeekData();
  week.bills.push({ name: "", amount: "", paid: false, notes: "" });
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyBillEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.bills[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklyBillEntry(index) {
  getSelectedWeekData().bills.splice(index, 1);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklySavingsEntry() {
  const week = getSelectedWeekData();
  week.savingsDeposits.push({ amount: "", date: "", notes: "" });
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklySavingsEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.savingsDeposits[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklySavingsEntry(index) {
  getSelectedWeekData().savingsDeposits.splice(index, 1);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklyGoalEntry() {
  const week = getSelectedWeekData();
  week.goals.push({ name: "", amount: "", notes: "" });
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyGoalEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.goals[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklyGoalEntry(index) {
  getSelectedWeekData().goals.splice(index, 1);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklyExpenseEntry() {
  const week = getSelectedWeekData();
  week.expenses.push({ name: "", amount: "", notes: "" });
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyExpenseEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.expenses[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklyExpenseEntry(index) {
  getSelectedWeekData().expenses.splice(index, 1);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyNotes(value) {
  getSelectedWeekData().notes = value;
  saveState();
}

function renderIncomeSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("monthIncomeArea");
  if (!container || !month) {
    return;
  }

  container.innerHTML = month.income.map((entry, index) => {
    const isSparkSource = /spark/i.test(entry.source || "");
    return `
      <div class="entry-card">
        <div class="entry-fields">
          <label>Source
            <input type="text" value="${escapeHtml(entry.source || "")}" onchange="updateIncomeField(${index}, 'source', this.value)" />
          </label>
          <label>Date
            <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateIncomeField(${index}, 'date', this.value)" />
          </label>
          <label>Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateIncomeField(${index}, 'amount', this.value)" />
          </label>
          <label>Notes
            <textarea onchange="updateIncomeField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
          </label>
        </div>
        <div class="entry-actions">
          ${isSparkSource ? `<button class="ghost-button" onclick="showMonthSection('spark')">Open Spark Tracker</button>` : ""}
          <button class="ghost-button" onclick="removeIncomeRow(${index})">Remove</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderBillsSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("monthBillsArea");
  if (!container || !month) {
    return;
  }

  container.innerHTML = month.bills.map((entry, index) => `
    <div class="entry-card">
      <div class="entry-fields">
        <label>Bill Name
          <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateBillField(${index}, 'name', this.value)" />
        </label>
        <label>Due Date
          <input type="date" value="${escapeHtml(entry.dueDate || "")}" onchange="updateBillField(${index}, 'dueDate', this.value)" />
        </label>
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateBillField(${index}, 'amount', this.value)" />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" ${entry.paid ? "checked" : ""} onchange="updateBillField(${index}, 'paid', this.checked)" />
          Paid
        </label>
        <label class="checkbox-label">
          <input type="checkbox" ${entry.recurring ? "checked" : ""} onchange="updateBillField(${index}, 'recurring', this.checked)" />
          Recurring
        </label>
        <label>Notes
          <textarea onchange="updateBillField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
        </label>
      </div>
      <button class="ghost-button" onclick="removeBillRow(${index})">Remove</button>
    </div>
  `).join("");
}

function renderGoalsSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("monthGoalsArea");
  if (!container || !month) {
    return;
  }

  container.innerHTML = month.goals.map((goal, index) => {
    const progress = getGoalProgress(goal);
    const colors = ["#d81b6b", "#7c3aed", "#0f766e", "#2563eb", "#f59e0b", "#dc2626", "#0891b2"];
    const barColor = colors[index % colors.length];
    return `
      <div class="entry-card">
        <div class="entry-fields">
          <label>Goal Name
            <input type="text" value="${escapeHtml(goal.name || "")}" onchange="updateGoalField(${index}, 'name', this.value)" />
          </label>
          <label>Target Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(goal.targetAmount || "")}" onchange="updateGoalField(${index}, 'targetAmount', this.value)" />
          </label>
          <label>Current Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(goal.currentAmount || "")}" onchange="updateGoalField(${index}, 'currentAmount', this.value)" />
          </label>
          <label>Amount Added
            <input type="number" min="0" step="0.01" value="${escapeHtml(goal.addedAmount || "")}" onchange="updateGoalField(${index}, 'addedAmount', this.value)" />
          </label>
          <label>Notes
            <textarea onchange="updateGoalField(${index}, 'notes', this.value)">${escapeHtml(goal.notes || "")}</textarea>
          </label>
        </div>
        <div class="progress-block">
          <div class="progress-bar"><span style="width:${progress}%; background:${barColor};"></span></div>
          <p>${progress}% complete</p>
        </div>
        <button class="ghost-button" onclick="removeGoal(${index})">Remove</button>
      </div>
    `;
  }).join("");
}

function renderCarFundSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("carFundArea");
  if (!container || !month) {
    return;
  }

  const totalSaved = getCarFundTotal(month);
  const target = Number(month.carFundTargetAmount || 0);
  const progress = target > 0 ? Math.min(100, Math.round((totalSaved / target) * 100)) : 0;
  const forecast = getForecastDate(totalSaved, target, month.carFund);

  container.innerHTML = `
    <div class="report-card">
      <div class="entry-fields">
        <label>Target Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(target || "")}" onchange="updateCarFundTarget(this.value)" />
        </label>
      </div>
      <div class="dashboard-cards">
        <div class="card"><h4>Total Saved</h4><p>${formatCurrency(totalSaved)}</p></div>
        <div class="card"><h4>Progress</h4><p>${progress}%</p></div>
        <div class="card"><h4>Forecast</h4><p>${forecast}</p></div>
      </div>
      <div class="progress-bar"><span style="width:${progress}%; background:#0f766e;"></span></div>
    </div>
    ${month.carFund.map((entry, index) => `
      <div class="entry-card">
        <div class="entry-fields">
          <label>Date
            <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateCarFundEntry(${index}, 'date', this.value)" />
          </label>
          <label>Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateCarFundEntry(${index}, 'amount', this.value)" />
          </label>
          <label>Notes
            <textarea onchange="updateCarFundEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
          </label>
        </div>
        <button class="ghost-button" onclick="removeCarFundEntry(${index})">Remove</button>
      </div>
    `).join("")}
  `;
}

function renderSparkSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("sparkArea");
  const total = document.getElementById("sparkMonthTotal");
  if (!container || !month) {
    return;
  }

  const summary = getSparkSummary(month);
  if (total) {
    total.textContent = formatCurrency(summary.totalEarnings);
  }

  container.innerHTML = `
    <div class="dashboard-cards">
      <div class="card"><h4>Orders</h4><p>${summary.orders}</p></div>
      <div class="card"><h4>Total Base Pay</h4><p>${formatCurrency(summary.totalBasePay)}</p></div>
      <div class="card"><h4>Tips Received</h4><p>${formatCurrency(summary.tipsReceived)}</p></div>
      <div class="card"><h4>Pending Tips</h4><p>${formatCurrency(summary.pendingTips)}</p></div>
      <div class="card"><h4>Available Earnings</h4><p>${formatCurrency(summary.totalEarnings)}</p></div>
      <div class="card"><h4>Net Profit</h4><p>${formatCurrency(summary.netProfit)}</p></div>
    </div>

    <div class="report-card">
      <h4>Spark Calculations</h4>
      <div class="dashboard-cards">
        <div class="card"><h4>Average / Order</h4><p>${formatCurrency(summary.averageEarningsPerOrder)}</p></div>
        <div class="card"><h4>Estimated Miles</h4><p>${summary.estimatedMiles}</p></div>
        <div class="card"><h4>Actual Miles</h4><p>${summary.actualMiles}</p></div>
        <div class="card"><h4>Earnings / Mile</h4><p>${formatCurrency(summary.earningsPerMile)}</p></div>
        <div class="card"><h4>Earnings / Hour</h4><p>${formatCurrency(summary.earningsPerHour)}</p></div>
        <div class="card"><h4>Gas Total</h4><p>${formatCurrency(summary.gasTotal)}</p></div>
      </div>
    </div>

    <div class="report-card">
      <h4>Spark Tip Tracker</h4>
      <div class="dashboard-cards">
        <div class="card"><h4>Pending Tips</h4><p>${formatCurrency(summary.pendingTips)}</p></div>
        <div class="card"><h4>Tips Received</h4><p>${formatCurrency(summary.tipsReceived)}</p></div>
        <div class="card"><h4>Projected Total</h4><p>${formatCurrency(summary.projectedEarnings)}</p></div>
      </div>

      <div class="entry-fields">
        <label>Existing Tip Amount
          <input id="sparkTipExistingAmount" type="number" min="0" step="0.01" />
        </label>
        <button onclick="addSparkTipReceived()">Add Existing Tip</button>
      </div>
      <p class="spark-note">Use this section for tips you already have and want to record now.</p>

      <div class="entry-fields">
        <label>Received Tip Amount
          <input id="sparkTipReceivedAmount" type="number" min="0" step="0.01" />
        </label>
        <label>Received Date
          <input id="sparkTipReceivedDate" type="date" />
        </label>
        <button onclick="addSparkTipReceived()">Add Received Tip</button>
      </div>

      <div class="tip-ledger">
        <div class="tip-bucket">
          <h5>Pending Tips</h5>
          <p class="spark-note">${formatCurrency(summary.pendingTips)} still waiting to come through.</p>
        </div>
        <div class="tip-bucket">
          <h5>Received Tips</h5>
          ${Array.isArray(month.sparkTips) && month.sparkTips.length
            ? month.sparkTips.map((tip, index) => `
                <div class="tip-entry">
                  <div class="entry-fields">
                    <label>Amount
                      <input type="number" min="0" step="0.01" value="${escapeHtml(tip.amount || "")}" onchange="updateSparkTipEntry(${index}, 'amount', this.value)" />
                    </label>
                    <label>Date
                      <input type="date" value="${escapeHtml(tip.receivedDate || "")}" onchange="updateSparkTipEntry(${index}, 'receivedDate', this.value)" />
                    </label>
                  </div>
                  <button class="ghost-button" onclick="removeSparkTipEntry(${index})">Remove</button>
                </div>
              `).join("")
            : '<p class="spark-note">No received tips yet.</p>'}
        </div>
      </div>
      <p class="spark-note">Add a received tip here and it will count toward your Spark income for the month.</p>
    </div>

    ${month.spark.map((entry, index) => `
      <div class="entry-card spark-order-card" id="spark-order-${index}">
        <div class="spark-order-header">
          <h4>Order ${index + 1}</h4>
          <div class="entry-actions">
            <button class="ghost-button" onclick="toggleSparkOrder(${index})">${entry.collapsed ? "Expand" : "Collapse"}</button>
            <button class="ghost-button" onclick="removeSparkShift(${index})">Remove</button>
          </div>
        </div>
        ${entry.collapsed ? `
          <p class="spark-note">${entry.acceptedDate ? `Accepted ${escapeHtml(formatDisplayDate(entry.acceptedDate))}` : "No accepted date yet"}</p>
        ` : `
          <div class="entry-fields">
            <label>Accepted Date
              <input type="date" value="${escapeHtml(entry.acceptedDate || "")}" onchange="updateSparkField(${index}, 'acceptedDate', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Total Pay
              <input type="text" value="${escapeHtml(entry.estimatedPayout || "")}" onchange="updateSparkField(${index}, 'estimatedPayout', this.value)" />
            </label>
            <label>Base Pay
              <input type="text" value="${escapeHtml(entry.estimatedBasePay || "")}" onchange="updateSparkField(${index}, 'estimatedBasePay', this.value)" />
            </label>
            <label>Tip Pay
              <input type="text" value="${escapeHtml(entry.estimatedTip || "")}" onchange="updateSparkField(${index}, 'estimatedTip', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Estimated Miles
              <input type="text" value="${escapeHtml(entry.estimatedMiles || "")}" onchange="updateSparkField(${index}, 'estimatedMiles', this.value)" />
            </label>
            <label>Estimated Hours
              <input type="text" value="${escapeHtml(entry.estimatedHours || "")}" onchange="updateSparkField(${index}, 'estimatedHours', this.value)" />
            </label>
            <label>Estimated Minutes
              <input type="text" value="${escapeHtml(entry.estimatedMinutes || "")}" onchange="updateSparkField(${index}, 'estimatedMinutes', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Actual Miles
              <input type="text" value="${escapeHtml(entry.actualMiles || "")}" onchange="updateSparkField(${index}, 'actualMiles', this.value)" />
            </label>
            <label>Actual Hours
              <input type="text" value="${escapeHtml(entry.actualHours || "")}" onchange="updateSparkField(${index}, 'actualHours', this.value)" />
            </label>
            <label>Actual Minutes
              <input type="text" value="${escapeHtml(entry.actualMinutes || "")}" onchange="updateSparkField(${index}, 'actualMinutes', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Gas
              <input type="text" value="${escapeHtml(entry.gasExpense || "")}" onchange="updateSparkField(${index}, 'gasExpense', this.value)" />
            </label>
            <label>Other Expenses
              <input type="text" value="${escapeHtml(entry.otherExpense || "")}" onchange="updateSparkField(${index}, 'otherExpense', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Stops
              <input type="text" value="${escapeHtml(entry.stops || "")}" onchange="updateSparkField(${index}, 'stops', this.value)" />
            </label>
          </div>

          <div class="entry-fields">
            <label>Notes
              <textarea onchange="updateSparkField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
            </label>
          </div>
        `}
      </div>
    `).join("")}
  `;
}

function renderAssignmentSection() {
  const month = getSelectedMonthData();
  const container = document.getElementById("assignmentArea");
  const leftToAssign = document.getElementById("leftToAssign");
  if (!container || !month) {
    return;
  }

  const available = getAvailableExtraMoney(month);
  const totalAssigned = month.assignmentCategories.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  if (leftToAssign) {
    leftToAssign.textContent = formatCurrency(available - totalAssigned);
  }

  container.innerHTML = month.assignmentCategories.map((entry, index) => `
    <div class="entry-card">
      <div class="entry-fields">
        <label>Category
          <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateAssignmentField(${index}, 'name', this.value)" />
        </label>
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateAssignmentField(${index}, 'amount', this.value)" />
        </label>
        <label>Notes
          <textarea onchange="updateAssignmentField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>
        </label>
      </div>
      <button class="ghost-button" onclick="removeAssignmentCategory(${index})">Remove</button>
    </div>
  `).join("");
}

function renderNotesSection() {
  const month = getSelectedMonthData();
  const textarea = document.getElementById("monthNotes");
  if (!textarea || !month) {
    return;
  }
  textarea.value = month.notes || "";
}

function renderDashboard() {
  const month = getSelectedMonthData();
  if (!month) {
    return;
  }

  const dashboardIncome = document.getElementById("dashboardIncome");
  const dashboardBills = document.getElementById("dashboardBills");
  const dashboardSavings = document.getElementById("dashboardSavings");
  const dashboardRemaining = document.getElementById("dashboardRemaining");
  const homeHealthIncome = document.getElementById("homeHealthIncome");
  const sparkIncome = document.getElementById("sparkIncome");
  const childSupportIncome = document.getElementById("childSupportIncome");
  const dashboardGoalProgress = document.getElementById("dashboardGoalProgress");
  const healthScore = document.getElementById("healthScore");

  if (dashboardIncome) dashboardIncome.textContent = formatCurrency(getMonthlyIncome(month));
  if (dashboardBills) dashboardBills.textContent = formatCurrency(getMonthlyBills(month));
  if (dashboardSavings) dashboardSavings.textContent = formatCurrency(getMonthlySavings(month));
  if (dashboardRemaining) dashboardRemaining.textContent = formatCurrency(getRemainingAmount(month));
  if (homeHealthIncome) homeHealthIncome.textContent = formatCurrency(getSourceIncome(month, "Home Health"));
  if (sparkIncome) sparkIncome.textContent = formatCurrency(getSourceIncome(month, "Walmart/Spark"));
  if (childSupportIncome) childSupportIncome.textContent = formatCurrency(getSourceIncome(month, "Child Support"));

  if (dashboardGoalProgress) {
    dashboardGoalProgress.innerHTML = month.goals.map((goal) => `
      <div class="goal-row">
        <div class="goal-labels">
          <span>${escapeHtml(goal.name || "Goal")}</span>
          <span>${getGoalProgress(goal)}%</span>
        </div>
        <div class="progress-bar"><span style="width:${getGoalProgress(goal)}%"></span></div>
      </div>
    `).join("");
  }

  if (healthScore) {
    healthScore.textContent = `${getHealthScore(month)} / 100`;
  }
}

function renderHistory() {
  const historyArea = document.getElementById("historyArea");
  if (!historyArea) {
    return;
  }

  const pastCycles = plannerState.cycles.filter((cycle) => cycle.id !== activeCycleId);
  historyArea.innerHTML = pastCycles.length ? pastCycles.map((cycle) => `
    <div class="report-card">
      <h4>${cycle.label} ${cycle.year}</h4>
      <p>Income: ${formatCurrency(sumCycleMetric(cycle, "income"))}</p>
      <p>Bills: ${formatCurrency(sumCycleMetric(cycle, "bills"))}</p>
      <p>Savings: ${formatCurrency(sumCycleMetric(cycle, "savings"))}</p>
      <p>Goals: ${formatCurrency(sumCycleMetric(cycle, "goals"))}</p>
    </div>
  `).join("") : "<p>No past cycles yet.</p>";
}

function renderReports() {
  const monthlyReports = document.getElementById("monthlyReports");
  const cycleReports = document.getElementById("cycleReports");
  if (!monthlyReports || !cycleReports) {
    return;
  }

  const month = getSelectedMonthData();
  monthlyReports.innerHTML = `
    <div class="report-card">
      <p>Income: ${formatCurrency(getMonthlyIncome(month))}</p>
      <p>Bills: ${formatCurrency(getMonthlyBills(month))}</p>
      <p>Savings: ${formatCurrency(getMonthlySavings(month))}</p>
      <p>Goals: ${formatCurrency(getGoalsAmount(month))}</p>
      <p>Spending: ${formatCurrency(getAssignmentSpend(month))}</p>
      <p>Remaining: ${formatCurrency(getRemainingAmount(month))}</p>
    </div>
  `;

  const cycle = getActiveCycle();
  const cycleIncome = cycle.months.reduce((sum, currentMonth) => sum + getMonthlyIncome(currentMonth), 0);
  const cycleBills = cycle.months.reduce((sum, currentMonth) => sum + getMonthlyBills(currentMonth), 0);
  const cycleSavings = cycle.months.reduce((sum, currentMonth) => sum + getMonthlySavings(currentMonth), 0);
  const cycleGoals = cycle.months.reduce((sum, currentMonth) => sum + getGoalsAmount(currentMonth), 0);
  const cycleAssignments = cycle.months.reduce((sum, currentMonth) => sum + getAssignmentSpend(currentMonth), 0);

  cycleReports.innerHTML = `
    <div class="report-card">
      <p>Total earned: ${formatCurrency(cycleIncome)}</p>
      <p>Total spent: ${formatCurrency(cycleBills + cycleAssignments)}</p>
      <p>Total saved: ${formatCurrency(cycleSavings)}</p>
      <p>Goal progress: ${Math.round(cycle.months.reduce((total, currentMonth) => total + getGoalProgressValue(currentMonth), 0) / cycle.months.length)}%</p>
      <p>Debt progress: ${formatCurrency(Math.max(0, cycleBills - cycleIncome))}</p>
    </div>
  `;

  drawCharts(cycle);
}

function renderSettings() {
  const prioritySettings = document.getElementById("prioritySettings");
  const settingsCategories = document.getElementById("settingsCategories");
  if (!prioritySettings) {
    return;
  }

  prioritySettings.innerHTML = plannerState.priorities.map((priority, index) => `
    <div class="priority-row">
      <input type="text" value="${escapeHtml(priority)}" onchange="updatePriority(${index}, this.value)" />
      <button class="ghost-button" onclick="removePriority(${index})">Remove</button>
    </div>
  `).join("");

  if (settingsCategories) {
    settingsCategories.value = plannerState.settings.defaultCategories.join(", ");
  }
}

function updateCycleTitle() {
  const title = document.getElementById("currentCycleTitle");
  const cycle = getActiveCycle();
  if (title && cycle) {
    title.textContent = `${cycle.label} • ${cycle.months[0].name} - ${cycle.months[cycle.months.length - 1].name}`;
  }
}

function addIncomeRow() {
  getSelectedMonthData().income.push({ source: "Other Income", date: "", amount: "", notes: "" });
  saveState();
  renderIncomeSection();
  renderDashboard();
  renderReports();
}

function updateIncomeField(index, field, value) {
  const month = getSelectedMonthData();
  month.income[index][field] = field === "amount" ? Number(value) || 0 : value;
  saveState();
  renderDashboard();
  renderReports();
}

function removeIncomeRow(index) {
  getSelectedMonthData().income.splice(index, 1);
  saveState();
  renderIncomeSection();
  renderDashboard();
  renderReports();
}

function addBillRow() {
  getSelectedMonthData().bills.push({ name: "New Bill", dueDate: "", amount: "", paid: false, recurring: false, notes: "" });
  saveState();
  renderBillsSection();
  renderDashboard();
  renderReports();
}

function updateBillField(index, field, value) {
  const month = getSelectedMonthData();
  month.bills[index][field] = field === "amount" ? Number(value) || 0 : value;
  if (field === "paid") {
    month.bills[index].paid = value;
  }
  if (field === "recurring") {
    month.bills[index].recurring = value;
  }
  saveState();
  renderDashboard();
  renderReports();
}

function removeBillRow(index) {
  getSelectedMonthData().bills.splice(index, 1);
  saveState();
  renderBillsSection();
  renderDashboard();
  renderReports();
}

function addGoal() {
  getSelectedMonthData().goals.push({ name: "New Goal", targetAmount: 1000, currentAmount: 0, addedAmount: 0, notes: "" });
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function updateGoalField(index, field, value) {
  const month = getSelectedMonthData();
  month.goals[index][field] = ["targetAmount", "currentAmount", "addedAmount"].includes(field) ? Number(value) || 0 : value;
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function removeGoal(index) {
  getSelectedMonthData().goals.splice(index, 1);
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function addCarFundEntry() {
  getSelectedMonthData().carFund.push({ date: "", amount: "", notes: "" });
  saveState();
  renderCarFundSection();
  renderDashboard();
  renderReports();
}

function updateCarFundTarget(value) {
  const month = getSelectedMonthData();
  month.carFundTargetAmount = Number(value) || 0;
  saveState();
  renderCarFundSection();
  renderDashboard();
  renderReports();
}

function updateCarFundEntry(index, field, value) {
  const month = getSelectedMonthData();
  month.carFund[index][field] = field === "amount" ? Number(value) || 0 : value;
  saveState();
  renderCarFundSection();
  renderDashboard();
  renderReports();
}

function removeCarFundEntry(index) {
  getSelectedMonthData().carFund.splice(index, 1);
  saveState();
  renderCarFundSection();
  renderDashboard();
  renderReports();
}

function addSparkShift() {
  const month = getSelectedMonthData();
  month.spark.push({
    acceptedDate: "",
    estimatedPayout: "",
    estimatedBasePay: "",
    estimatedTip: "",
    estimatedMiles: "",
    estimatedHours: "",
    estimatedMinutes: "",
    actualBasePay: "",
    actualTipReceived: "",
    tipPaymentDate: "",
    finalPayout: "",
    actualMiles: "",
    actualHours: "",
    actualMinutes: "",
    gasExpense: "",
    otherExpense: "",
    stops: "",
    notes: "",
    collapsed: false
  });
  activeSparkOrderIndex = month.spark.length - 1;
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
  setTimeout(() => {
    const target = document.getElementById(`spark-order-${activeSparkOrderIndex}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 0);
}

function updateSparkField(index, field, value) {
  const month = getSelectedMonthData();
  month.spark[index][field] = ["estimatedPayout", "estimatedBasePay", "estimatedTip", "estimatedMiles", "estimatedHours", "estimatedMinutes", "actualBasePay", "actualTipReceived", "finalPayout", "actualMiles", "actualHours", "actualMinutes", "gasExpense", "otherExpense"].includes(field)
    ? Number(value) || 0
    : value;
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
}

function toggleSparkOrder(index) {
  const month = getSelectedMonthData();
  if (!month.spark[index]) {
    return;
  }
  month.spark[index].collapsed = !month.spark[index].collapsed;
  saveState();
  renderSparkSection();
}

function resetSparkOrderFocus() {
  activeSparkOrderIndex = -1;
}

function addSparkTipReceived() {
  const month = getSelectedMonthData();
  const existingAmountInput = document.getElementById("sparkTipExistingAmount");
  const receivedAmountInput = document.getElementById("sparkTipReceivedAmount");
  const receivedDateInput = document.getElementById("sparkTipReceivedDate");
  if (!existingAmountInput || !receivedAmountInput || !receivedDateInput) {
    return;
  }

  const existingAmount = Number(existingAmountInput.value) || 0;
  const receivedAmount = Number(receivedAmountInput.value) || 0;
  const receivedDate = receivedDateInput.value;

  if (!existingAmount && !receivedAmount) {
    return;
  }

  if (existingAmount) {
    month.sparkTips = Array.isArray(month.sparkTips) ? month.sparkTips : [];
    month.sparkTips.push({
      amount: existingAmount,
      receivedDate: "",
      notes: ""
    });
  }

  if (receivedAmount) {
    month.sparkTips = Array.isArray(month.sparkTips) ? month.sparkTips : [];
    month.sparkTips.push({
      amount: receivedAmount,
      receivedDate,
      notes: ""
    });
  }

  existingAmountInput.value = "";
  receivedAmountInput.value = "";
  receivedDateInput.value = "";

  const sparkIncomeEntry = month.income.find((entry) => /spark/i.test(entry.source || ""));
  if (sparkIncomeEntry) {
    sparkIncomeEntry.amount = (Number(sparkIncomeEntry.amount) || 0) + existingAmount + receivedAmount;
  } else {
    month.income.push({ source: "Walmart/Spark", date: "", amount: existingAmount + receivedAmount, notes: "Spark tip added" });
  }

  saveState();
  renderSparkSection();
  renderIncomeSection();
  renderDashboard();
  renderReports();
}

function updateSparkTipEntry(index, field, value) {
  const month = getSelectedMonthData();
  month.sparkTips[index][field] = field === "amount" ? Number(value) || 0 : value;
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
}

function removeSparkTipEntry(index) {
  getSelectedMonthData().sparkTips.splice(index, 1);
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
}

function removeSparkShift(index) {
  getSelectedMonthData().spark.splice(index, 1);
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
}

function addAssignmentCategory() {
  getSelectedMonthData().assignmentCategories.push({ name: "New Category", amount: "", notes: "" });
  saveState();
  renderAssignmentSection();
  renderDashboard();
  renderReports();
}

function updateAssignmentField(index, field, value) {
  const month = getSelectedMonthData();
  month.assignmentCategories[index][field] = field === "amount" ? Number(value) || 0 : value;
  saveState();
  renderAssignmentSection();
  renderDashboard();
  renderReports();
}

function removeAssignmentCategory(index) {
  getSelectedMonthData().assignmentCategories.splice(index, 1);
  saveState();
  renderAssignmentSection();
  renderDashboard();
  renderReports();
}

function updateMonthNotes(value) {
  getSelectedMonthData().notes = value;
  saveState();
}

function addPriority() {
  plannerState.priorities.push("New Priority");
  saveState();
  renderSettings();
}

function updatePriority(index, value) {
  plannerState.priorities[index] = value;
  saveState();
  renderSettings();
}

function removePriority(index) {
  plannerState.priorities.splice(index, 1);
  saveState();
  renderSettings();
}

function updateDefaultCategories(value) {
  plannerState.settings.defaultCategories = value.split(",").map((item) => item.trim()).filter(Boolean);
  saveState();
}

function exportBudget() {
  const blob = new Blob([JSON.stringify(plannerState, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "budget-planner-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

function openImport() {
  document.getElementById("importInput").click();
}

function bindImportListener() {
  const input = document.getElementById("importInput");
  if (input) {
    input.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          plannerState = normalizeState(imported);
          activeCycleId = plannerState.currentCycleId;
          activeMonthName = plannerState.lastOpenedMonth || getCurrentMonthName();
          saveState();
          renderApp();
        } catch (error) {
          alert("The selected backup could not be imported.");
        }
      };
      reader.readAsText(file);
    });
  }
}

function getMonthlyIncome(month) {
  const weeklyIncome = getWeeklyIncomeTotal(month);
  if (hasWeeklyIncomeEntries(month)) {
    return weeklyIncome;
  }
  return month.income.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getMonthlyBills(month) {
  const weeklyBills = getWeeklyBillsTotal(month);
  if (hasWeeklyBillEntries(month)) {
    return weeklyBills;
  }
  return month.bills.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getSourceIncome(month, source) {
  return month.income
    .filter((entry) => (entry.source || "").toLowerCase() === source.toLowerCase())
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getMonthlySavings(month) {
  const weeklySavings = getWeeklySavingsTotal(month);
  if (hasWeeklySavingsEntries(month)) {
    return weeklySavings;
  }
  return Math.max(0, getMonthlyIncome(month) - getMonthlyBills(month) - getAssignmentSpend(month));
}

function getAssignmentSpend(month) {
  return month.assignmentCategories.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getRemainingAmount(month) {
  return getMonthlyIncome(month) - getMonthlyBills(month) - getAssignmentSpend(month);
}

function getGoalProgress(goal) {
  const target = Number(goal.targetAmount) || 0;
  if (!target) {
    return 0;
  }
  return Math.min(100, Math.round((Number(goal.currentAmount) || 0) / target * 100));
}

function getGoalProgressForMonth(month, goal) {
  const target = Number(goal.targetAmount) || 0;
  const weeklyContribution = getWeeklyGoalContributionTotal(month, goal.name);
  if (!target) {
    return 0;
  }
  const currentAmount = weeklyContribution || (Number(goal.currentAmount) || 0);
  return Math.min(100, Math.round(currentAmount / target * 100));
}

function getGoalProgressValue(month) {
  if (!month.goals.length) {
    return 0;
  }
  return Math.round(month.goals.reduce((sum, goal) => sum + getGoalProgressForMonth(month, goal), 0) / month.goals.length);
}

function getGoalsAmount(month) {
  const weeklyGoals = ensureWeekData(month).reduce((sum, week) => sum + week.goals.reduce((weekSum, entry) => weekSum + (Number(entry.amount) || 0), 0), 0);
  if (weeklyGoals || hasWeeklySavingsEntries(month)) {
    return weeklyGoals;
  }
  return month.goals.reduce((sum, goal) => sum + (Number(goal.currentAmount) || 0), 0);
}

function getCarFundTotal(month) {
  return month.carFund.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getHealthScore(month) {
  const paidBills = month.bills.filter((bill) => bill.paid).length;
  const paidRatio = month.bills.length ? paidBills / month.bills.length : 0;
  const savingsRatio = getMonthlyIncome(month) > 0 ? Math.min(1, getMonthlySavings(month) / getMonthlyIncome(month)) : 0;
  const goalsRatio = month.goals.length ? month.goals.filter((goal) => getGoalProgress(goal) >= 100).length / month.goals.length : 0;
  const remainingRatio = getRemainingAmount(month) >= 0 ? 1 : 0;
  const score = Math.round((paidRatio * 0.3 + savingsRatio * 0.25 + goalsRatio * 0.25 + remainingRatio * 0.2) * 100);
  return Math.max(0, Math.min(100, score));
}

function getSparkSummary(month) {
  const orders = month.spark.length;
  const totalBasePay = month.spark.reduce((sum, entry) => sum + (Number(entry.actualBasePay) || Number(entry.estimatedBasePay) || 0), 0);
  const estimatedTipTotal = month.spark.reduce((sum, entry) => sum + (Number(entry.estimatedTip) || 0), 0);
  const tipsReceived = Array.isArray(month.sparkTips)
    ? month.sparkTips.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0)
    : 0;
  const pendingTips = Math.max(0, estimatedTipTotal - tipsReceived);
  const totalEarnings = totalBasePay + tipsReceived;
  const projectedEarnings = totalBasePay + tipsReceived + pendingTips;
  const estimatedMiles = month.spark.reduce((sum, entry) => sum + (Number(entry.estimatedMiles) || 0), 0);
  const actualMiles = month.spark.reduce((sum, entry) => sum + (Number(entry.actualMiles) || 0), 0);
  const estimatedTime = month.spark.reduce((sum, entry) => sum + (Number(entry.estimatedHours) * 60 + Number(entry.estimatedMinutes) || 0), 0);
  const actualTime = month.spark.reduce((sum, entry) => sum + (Number(entry.actualHours) * 60 + Number(entry.actualMinutes) || 0), 0);
  const gasTotal = month.spark.reduce((sum, entry) => sum + (Number(entry.gasExpense) || 0), 0);
  const otherExpense = month.spark.reduce((sum, entry) => sum + (Number(entry.otherExpense) || 0), 0);
  return {
    orders,
    totalBasePay,
    tipsReceived,
    pendingTips,
    totalEarnings,
    projectedEarnings,
    averageEarningsPerOrder: orders ? totalEarnings / orders : 0,
    estimatedMiles,
    actualMiles,
    estimatedTime,
    actualTime,
    earningsPerMile: actualMiles > 0 ? totalEarnings / actualMiles : 0,
    earningsPerHour: actualTime > 0 ? totalEarnings / (actualTime / 60) : 0,
    gasTotal,
    otherExpense,
    netProfit: totalEarnings - gasTotal - otherExpense
  };
}

function getAvailableExtraMoney(month) {
  return getMonthlyIncome(month) - getMonthlyBills(month) - getAssignmentSpend(month);
}

function getForecastDate(totalSaved, target, contributions) {
  if (!target || totalSaved >= target) {
    return "Complete";
  }
  if (!contributions.length) {
    return "Add deposits";
  }
  const averageContribution = totalSaved / contributions.length;
  const remaining = target - totalSaved;
  const months = averageContribution > 0 ? Math.ceil(remaining / averageContribution) : 0;
  if (!months) {
    return "Add deposits";
  }
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function drawCharts(cycle) {
  const incomeCanvas = document.getElementById("incomeChart");
  const goalCanvas = document.getElementById("goalChart");
  const sparkCanvas = document.getElementById("sparkChart");

  if (incomeCanvas) {
    drawBarChart(incomeCanvas, ["Income", "Bills"], [
      cycle.months.reduce((sum, month) => sum + getMonthlyIncome(month), 0),
      cycle.months.reduce((sum, month) => sum + getMonthlyBills(month), 0)
    ], ["#ec4899", "#111827"]);
  }

  if (goalCanvas) {
    drawBarChart(goalCanvas, ["Saved", "Goal Target"], [
      cycle.months.reduce((sum, month) => sum + getGoalsAmount(month), 0),
      cycle.months.reduce((sum, month) => sum + month.goals.reduce((goalSum, goal) => goalSum + (Number(goal.targetAmount) || 0), 0), 0)
    ], ["#ec4899", "#111827"]);
  }

  if (sparkCanvas) {
    const sparkTotals = cycle.months.map((month) => getSparkSummary(month).totalEarnings);
    drawBarChart(sparkCanvas, cycle.months.map((month) => month.name), sparkTotals, ["#ec4899"]);
  }
}

function drawBarChart(canvas, labels, values, colors) {
  const context = canvas.getContext("2d");
  const width = canvas.width || 260;
  const height = canvas.height || 180;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  const maxValue = Math.max(...values, 1);
  const padding = 30;
  const barWidth = Math.max(20, (width - padding * 2) / Math.max(values.length, 1) - 16);

  values.forEach((value, index) => {
    const barHeight = (value / maxValue) * (height - padding * 2);
    const x = padding + index * (barWidth + 16);
    const y = height - padding - barHeight;
    context.fillStyle = colors[index] || colors[0] || "#ec4899";
    context.fillRect(x, y, barWidth, barHeight);
    context.fillStyle = "#111827";
    context.font = "12px sans-serif";
    context.fillText(labels[index] || "", x, height - 10);
  });
}

function sumCycleMetric(cycle, type) {
  if (type === "income") {
    return cycle.months.reduce((sum, month) => sum + getMonthlyIncome(month), 0);
  }
  if (type === "bills") {
    return cycle.months.reduce((sum, month) => sum + getMonthlyBills(month), 0);
  }
  if (type === "savings") {
    return cycle.months.reduce((sum, month) => sum + getMonthlySavings(month), 0);
  }
  if (type === "goals") {
    return cycle.months.reduce((sum, month) => sum + getGoalsAmount(month), 0);
  }
  return 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

window.showPage = showPage;
window.openMonth = openMonth;
window.showMonthSection = showMonthSection;
window.addIncomeRow = addIncomeRow;
window.updateIncomeField = updateIncomeField;
window.removeIncomeRow = removeIncomeRow;
window.addBillRow = addBillRow;
window.updateBillField = updateBillField;
window.removeBillRow = removeBillRow;
window.addGoal = addGoal;
window.updateGoalField = updateGoalField;
window.removeGoal = removeGoal;
window.addCarFundEntry = addCarFundEntry;
window.updateCarFundTarget = updateCarFundTarget;
window.updateCarFundEntry = updateCarFundEntry;
window.removeCarFundEntry = removeCarFundEntry;
window.addSparkShift = addSparkShift;
window.updateSparkField = updateSparkField;
window.toggleSparkOrder = toggleSparkOrder;
window.resetSparkOrderFocus = resetSparkOrderFocus;
window.removeSparkShift = removeSparkShift;
window.addAssignmentCategory = addAssignmentCategory;
window.updateAssignmentField = updateAssignmentField;
window.removeAssignmentCategory = removeAssignmentCategory;
window.updateMonthNotes = updateMonthNotes;
window.addPriority = addPriority;
window.updatePriority = updatePriority;
window.removePriority = removePriority;
window.updateDefaultCategories = updateDefaultCategories;
window.exportBudget = exportBudget;
window.openImport = openImport;

document.addEventListener("DOMContentLoaded", initializePlanner);