/* ===================================================================
   Budget Planner Final Build
   Functional single-page planner with saved cycles, month-based data,
   income/bills/goals/spark tracking, assignment math, reports,
   history, backup import/export, and a pink/black/white plan layout.
   =================================================================== */

const STORAGE_KEY = "budgetPlannerStateV1";
const THEME_STORAGE_KEY = "budgetPlannerThemeV1";
const DEFAULT_ACCENT_COLOR = "#d81b6b";
const DEFAULT_BACKGROUND_COLOR = "#ffffff";
const DEFAULT_PATTERN_COLOR = "#ff5fbf";
const DEFAULT_PANEL_COLOR = "#ffffff";
const DEFAULT_TAB_COLOR = "#ffffff";
const DEFAULT_BACKGROUND_STYLE = "checkered";
const DEFAULT_CARD_OPACITY = 0.6;
const ACTIVITY_LOG_LIMIT = 40;
const UNDO_STACK_LIMIT = 30;
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
const DEFAULT_CAR_FUND_LABEL = "Car Fund";

function createGoalId() {
  return `goal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeGoalName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sourceMatchesCategory(sourceValue, category) {
  const source = String(sourceValue || "").trim().toLowerCase();
  const target = String(category || "").trim().toLowerCase();

  if (target === "main job") {
    return /main job|home health/.test(source);
  }
  if (target === "child support") {
    return /child support/.test(source);
  }
  return source === target;
}

/* ===================================================================
   Firebase setup. Each signed-in user gets their own document at
   users/{uid} in Firestore holding { plannerState, themePrefs } —
   this is what makes accounts private and synced across devices.
   =================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyDRV1q0VikSg9YRgEnR5KLRygLH6Qk6zAY",
  authDomain: "budget-planner-fcc3c.firebaseapp.com",
  projectId: "budget-planner-fcc3c",
  storageBucket: "budget-planner-fcc3c.firebasestorage.app",
  messagingSenderId: "609210922234",
  appId: "1:609210922234:web:cd2fdf2c1d1b1a51684543"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let plannerState = null;
let activeCycleId = null;
let activeMonthName = null;
let activeMonthSection = "overview";
let activeWeeklyIndex = -1;
let activeSparkOrderIndex = -1;
let activeSparkSection = "shifts";

let currentUserId = null;
let authMode = "signIn";
let themePrefs = {
  mode: "light",
  accent: DEFAULT_ACCENT_COLOR,
  backgroundStyle: DEFAULT_BACKGROUND_STYLE,
  background: DEFAULT_BACKGROUND_COLOR,
  pattern: DEFAULT_PATTERN_COLOR,
  panelColor: DEFAULT_BACKGROUND_COLOR,
  tabColor: DEFAULT_BACKGROUND_COLOR,
  cardOpacity: DEFAULT_CARD_OPACITY
};
let saveStateTimeout = null;
let saveThemeTimeout = null;
let pendingActivityMessage = "";
let undoStack = [];
let lastCommittedState = null;
let isApplyingUndo = false;
let bankSyncClickCount = 0;
let weeklyDetailUiState = {};

function openAuthPage(defaultMode = "signIn") {
  authMode = defaultMode;
  updateAuthModeUI();
  document.getElementById("authGate").classList.remove("hidden");
}

function showWelcomePage() {
  document.getElementById("authGate").classList.add("hidden");
}

function toggleAuthMode() {
  authMode = authMode === "signIn" ? "signUp" : "signIn";
  clearAuthError();
  clearAuthStatus();
  updateAuthModeUI();
}

function updateAuthModeUI() {
  const submitButton = document.getElementById("authSubmitButton");
  const modeText = document.getElementById("authModeText");
  const modeToggle = document.getElementById("authModeToggle");

  if (authMode === "signUp") {
    submitButton.textContent = "Create Account";
    modeText.textContent = "Already have an account?";
    modeToggle.textContent = "Sign In";
  } else {
    submitButton.textContent = "Sign In";
    modeText.textContent = "Don't have an account?";
    modeToggle.textContent = "Create one";
  }
}

function initializeAuth() {
  bindImportListener();
  bindBackToTop();
  bindBankSyncActions();
  showWelcomePage();
  auth.onAuthStateChanged((user) => {
    if (user) {
      startAppForUser(user);
    } else {
      stopAppForSignedOutUser();
    }
  });
}

function bindBankSyncActions() {
  document.addEventListener("click", (event) => {
    const applyButton = event.target.closest("#bankSyncApplyButton");
    if (applyButton) {
      event.preventDefault();
      applyBankSyncDifference();
      return;
    }

    const clearButton = event.target.closest("#bankSyncClearButton");
    if (clearButton) {
      event.preventDefault();
      clearBankSyncAdjustment();
    }
  });
}

function handleAuthSubmit(event) {
  event.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  clearAuthError();
  setAuthStatus(authMode === "signUp" ? "Creating account..." : "Signing in...");

  if (authMode === "signUp") {
    auth.createUserWithEmailAndPassword(email, password)
      .then(() => {
        clearAuthStatus();
      })
      .catch((error) => {
        clearAuthStatus();
        setAuthError(friendlyAuthError(error));
      });
    return;
  }

  auth.signInWithEmailAndPassword(email, password)
    .then(() => {
      clearAuthStatus();
    })
    .catch((error) => {
      if (error.code === "auth/user-not-found") {
        clearAuthStatus();
        setAuthError("No account found. Switch to Create Account to register.");
      } else {
        clearAuthStatus();
        setAuthError(friendlyAuthError(error));
      }
    });
}

function getUserDocRef() {
  return db.collection("users").doc(currentUserId);
}

async function startAppForUser(user) {
  currentUserId = user.uid;
  document.getElementById("authGate").classList.add("hidden");
  document.getElementById("welcomePage").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("signOutBottom").classList.remove("hidden");
  const emailDisplay = document.getElementById("userEmailDisplay");
  if (emailDisplay) {
    emailDisplay.textContent = user.email || "";
  }

  try {
    const docSnap = await getUserDocRef().get();
    const data = docSnap.exists ? docSnap.data() : null;

    if (data && data.plannerState) {
      plannerState = normalizeState(data.plannerState);
      themePrefs = data.themePrefs || { mode: "light", accent: DEFAULT_ACCENT_COLOR };
    } else {
      const legacyState = loadLegacyLocalState();
      plannerState = legacyState ? normalizeState(legacyState) : buildDefaultState();
      themePrefs = loadLegacyThemePrefs();
      await getUserDocRef().set({ plannerState, themePrefs }, { merge: true });
    }
  } catch (error) {
    console.error("Failed to load budget data", error);
    plannerState = buildDefaultState();
  }

  ensureActiveCycle();
  activeCycleId = plannerState.currentCycleId;
  activeMonthName = plannerState.lastOpenedMonth || getCurrentMonthName();
  resetUndoTracking();

  applyTheme();
  renderApp();
}

function stopAppForSignedOutUser() {
  currentUserId = null;
  plannerState = null;
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("signOutBottom").classList.add("hidden");
  document.getElementById("authGate").classList.add("hidden");
  document.getElementById("welcomePage").classList.remove("hidden");
  const form = document.getElementById("authForm");
  if (form) {
    form.reset();
  }
  clearAuthError();
  clearAuthStatus();
  undoStack = [];
  lastCommittedState = null;
}

function loadLegacyLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function loadLegacyThemePrefs() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) {
      return {
        mode: "light",
        accent: DEFAULT_ACCENT_COLOR,
        backgroundStyle: DEFAULT_BACKGROUND_STYLE,
        background: DEFAULT_BACKGROUND_COLOR,
        pattern: DEFAULT_PATTERN_COLOR
      };
    }
    const parsed = JSON.parse(raw);
    return {
      mode: parsed.mode === "dark" ? "dark" : "light",
      accent: parsed.accent || DEFAULT_ACCENT_COLOR,
      backgroundStyle: ["checkered", "solid", "gradient", "stripes", "dots", "waves", "sunburst", "grid"].includes(parsed.backgroundStyle)
        ? parsed.backgroundStyle
        : DEFAULT_BACKGROUND_STYLE,
      background: parsed.background || DEFAULT_BACKGROUND_COLOR,
      pattern: parsed.pattern || DEFAULT_PATTERN_COLOR,
      panelColor: parsed.panelColor || DEFAULT_PANEL_COLOR,
      tabColor: parsed.tabColor || DEFAULT_TAB_COLOR,
      cardOpacity: typeof parsed.cardOpacity === "number" ? parsed.cardOpacity : DEFAULT_CARD_OPACITY
    };
  } catch (error) {
    return {
      mode: "light",
      accent: DEFAULT_ACCENT_COLOR,
      backgroundStyle: DEFAULT_BACKGROUND_STYLE,
      background: DEFAULT_BACKGROUND_COLOR,
      pattern: DEFAULT_PATTERN_COLOR,
      panelColor: DEFAULT_PANEL_COLOR,
      tabColor: DEFAULT_TAB_COLOR,
      cardOpacity: DEFAULT_CARD_OPACITY
    };
  }
}

function handleSignOut() {
  auth.signOut();
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "That email already has an account — try Sign In instead.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found with that email.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — please wait a bit and try again."
  };
  return messages[error.code] || error.message;
}

function setAuthError(message) {
  const el = document.getElementById("authError");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

function clearAuthError() {
  const el = document.getElementById("authError");
  if (el) {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

function setAuthStatus(message) {
  const el = document.getElementById("authStatus");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
  }
}

function clearAuthStatus() {
  const el = document.getElementById("authStatus");
  if (el) {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

/* ===================================================================
   Appearance (theme mode + accent color)
   =================================================================== */
function hexToRgbString(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function applyTheme() {
  document.body.classList.toggle("theme-dark", themePrefs.mode === "dark");
  document.documentElement.style.setProperty("--color-accent", themePrefs.accent);
  document.documentElement.style.setProperty("--color-accent-rgb", hexToRgbString(themePrefs.accent));
  document.documentElement.style.setProperty("--color-bg", themePrefs.background);
  document.documentElement.style.setProperty("--color-bg-pattern", themePrefs.pattern);
  document.documentElement.style.setProperty("--panel-bg", themePrefs.panelColor);
  document.documentElement.style.setProperty("--panel-bg-rgb", hexToRgbString(themePrefs.panelColor));
  document.documentElement.style.setProperty("--panel-text", getContrastColor(themePrefs.panelColor));
  document.documentElement.style.setProperty("--tab-bg", themePrefs.tabColor);
  document.documentElement.style.setProperty("--tab-bg-rgb", hexToRgbString(themePrefs.tabColor));
  document.documentElement.style.setProperty("--tab-text", getContrastColor(themePrefs.tabColor));
  document.documentElement.style.setProperty("--tab-active-text", getContrastColor(themePrefs.accent));
  document.documentElement.style.setProperty("--card-opacity", themePrefs.cardOpacity);
  document.body.setAttribute("data-background-style", themePrefs.backgroundStyle || DEFAULT_BACKGROUND_STYLE);

  const modeSelect = document.getElementById("themeModeSelect");
  if (modeSelect) {
    modeSelect.value = themePrefs.mode;
  }
  const accentPicker = document.getElementById("accentColorPicker");
  if (accentPicker) {
    accentPicker.value = themePrefs.accent;
  }
  const backgroundStyleSelect = document.getElementById("backgroundStyleSelect");
  if (backgroundStyleSelect) {
    backgroundStyleSelect.value = themePrefs.backgroundStyle;
  }
  const backgroundColorPicker = document.getElementById("backgroundColorPicker");
  if (backgroundColorPicker) {
    backgroundColorPicker.value = themePrefs.background;
  }
  const patternColorPicker = document.getElementById("patternColorPicker");
  if (patternColorPicker) {
    patternColorPicker.value = themePrefs.pattern;
  }
  const panelColorPicker = document.getElementById("panelColorPicker");
  if (panelColorPicker) {
    panelColorPicker.value = themePrefs.panelColor;
  }
  const tabColorPicker = document.getElementById("tabColorPicker");
  if (tabColorPicker) {
    tabColorPicker.value = themePrefs.tabColor;
  }
  const cardOpacityRange = document.getElementById("cardOpacityRange");
  if (cardOpacityRange) {
    cardOpacityRange.value = Math.round((themePrefs.cardOpacity || DEFAULT_CARD_OPACITY) * 100);
  }
  const cardOpacityValue = document.getElementById("cardOpacityValue");
  if (cardOpacityValue) {
    cardOpacityValue.textContent = `${Math.round((themePrefs.cardOpacity || DEFAULT_CARD_OPACITY) * 100)}%`;
  }
}

function queueThemeSave() {
  if (!currentUserId) {
    return;
  }
  clearTimeout(saveThemeTimeout);
  saveThemeTimeout = setTimeout(() => {
    getUserDocRef().set({ themePrefs }, { merge: true }).catch((error) => {
      console.error("Failed to save theme", error);
    });
  }, 500);
}

function setThemeMode(mode) {
  themePrefs.mode = mode === "dark" ? "dark" : "light";
  applyTheme();
  queueThemeSave();
}

function setAccentColor(color) {
  themePrefs.accent = color;
  applyTheme();
  queueThemeSave();
}

function setBackgroundStyle(style) {
  themePrefs.backgroundStyle = ["checkered", "solid", "gradient", "stripes", "dots", "waves", "sunburst", "grid"].includes(style)
    ? style
    : DEFAULT_BACKGROUND_STYLE;
  applyTheme();
  queueThemeSave();
}

function setBackgroundColor(color) {
  themePrefs.background = color;
  applyTheme();
  queueThemeSave();
}

function getContrastColor(hex) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#000000" : "#ffffff";
}

function setPatternColor(color) {
  themePrefs.pattern = color;
  applyTheme();
  queueThemeSave();
}

function setPanelColor(color) {
  themePrefs.panelColor = color;
  applyTheme();
  queueThemeSave();
}

function setTabColor(color) {
  themePrefs.tabColor = color;
  applyTheme();
  queueThemeSave();
}

function setCardOpacity(value) {
  const opacity = Math.min(0.95, Math.max(0.3, Number(value) / 100));
  themePrefs.cardOpacity = opacity;
  applyTheme();
  queueThemeSave();
}

function resetTheme() {
  themePrefs = {
    mode: "light",
    accent: DEFAULT_ACCENT_COLOR,
    backgroundStyle: DEFAULT_BACKGROUND_STYLE,
    background: DEFAULT_BACKGROUND_COLOR,
    pattern: DEFAULT_PATTERN_COLOR,
    panelColor: DEFAULT_PANEL_COLOR,
    tabColor: DEFAULT_TAB_COLOR,
    cardOpacity: DEFAULT_CARD_OPACITY
  };
  applyTheme();
  queueThemeSave();
}

/* ===================================================================
   Back to top button
   =================================================================== */
function bindBackToTop() {
  const button = document.getElementById("backToTopBtn");
  if (!button) {
    return;
  }
  window.addEventListener("scroll", () => {
    const shouldShow = window.scrollY > 320;
    button.classList.toggle("hidden", !shouldShow);
  });
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function saveState() {
  const actionLabel = pendingActivityMessage;
  commitPendingActivity();

  if (plannerState) {
    if (!lastCommittedState) {
      lastCommittedState = cloneState(plannerState);
    } else {
      const currentSerialized = JSON.stringify(plannerState);
      const lastSerialized = JSON.stringify(lastCommittedState);
      if (currentSerialized !== lastSerialized) {
        if (!isApplyingUndo) {
          undoStack.unshift({
            state: cloneState(lastCommittedState),
            label: actionLabel || "Update",
            createdAt: new Date().toISOString()
          });
          undoStack = undoStack.slice(0, UNDO_STACK_LIMIT);
        }
        lastCommittedState = cloneState(plannerState);
      }
    }
  }

  if (isApplyingUndo) {
    isApplyingUndo = false;
  }

  if (!currentUserId) {
    return;
  }
  clearTimeout(saveStateTimeout);
  saveStateTimeout = setTimeout(() => {
    getUserDocRef().set({ plannerState }, { merge: true }).catch((error) => {
      console.error("Failed to save budget data", error);
    });
  }, 500);
}

function buildDefaultState() {
  const today = new Date();
  const cycle = createCycleForDate(today);
  return {
    currentCycleId: cycle.id,
    lastOpenedMonth: cycle.months[0].name,
    cycles: [cycle],
    priorities: ["Bills", "Savings", "Goals", "Fun", "Other"],
    activityLog: [],
    settings: {
      defaultCategories: DEFAULT_SPENDING_CATEGORIES.slice(),
      lockCompletedGoals: false,
      carFundLabel: DEFAULT_CAR_FUND_LABEL
    }
  };
}

function normalizeState(state) {
  if (!state.cycles || !state.cycles.length) {
    return buildDefaultState();
  }

  state.cycles = state.cycles.map((cycle) => normalizeCycle(cycle));
  state.cycles.forEach((cycle) => {
    cycle.months.forEach((month) => {
      month.income.forEach((entry) => {
        if (entry.source === "Home Health") {
          entry.source = "Main Job";
        }
      });
    });
  });
  state.currentCycleId = state.currentCycleId || state.cycles[0].id;
  state.lastOpenedMonth = state.lastOpenedMonth || getCurrentMonthName();
  state.priorities = Array.isArray(state.priorities) && state.priorities.length
    ? state.priorities
    : ["Bills", "Savings", "Goals", "Fun", "Other"];
  state.activityLog = Array.isArray(state.activityLog) ? state.activityLog.slice(0, ACTIVITY_LOG_LIMIT) : [];
  state.settings = state.settings || {};
  state.settings.defaultCategories = Array.isArray(state.settings.defaultCategories) && state.settings.defaultCategories.length
    ? state.settings.defaultCategories
    : DEFAULT_SPENDING_CATEGORIES.slice();
  state.settings.lockCompletedGoals = Boolean(state.settings.lockCompletedGoals);
  state.settings.carFundLabel = typeof state.settings.carFundLabel === "string"
    ? state.settings.carFundLabel
    : DEFAULT_CAR_FUND_LABEL;
  return state;
}

function getCarFundLabel() {
  const rawLabel = plannerState && plannerState.settings ? plannerState.settings.carFundLabel : "";
  const cleanLabel = String(rawLabel || "").trim();
  return cleanLabel || DEFAULT_CAR_FUND_LABEL;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function resetUndoTracking() {
  undoStack = [];
  lastCommittedState = plannerState ? cloneState(plannerState) : null;
}

function queueActivity(message) {
  pendingActivityMessage = String(message || "").trim();
}

function commitPendingActivity() {
  if (!plannerState || !pendingActivityMessage) {
    return;
  }

  plannerState.activityLog = Array.isArray(plannerState.activityLog) ? plannerState.activityLog : [];
  plannerState.activityLog.unshift({
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: pendingActivityMessage,
    month: activeMonthName || "",
    cycleId: activeCycleId || "",
    createdAt: new Date().toISOString()
  });
  plannerState.activityLog = plannerState.activityLog.slice(0, ACTIVITY_LOG_LIMIT);
  pendingActivityMessage = "";
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
      goals: Array.isArray(month.goals) ? month.goals.map((g) => ({ completed: false, ...g })) : [],
      carFund: Array.isArray(month.carFund) ? month.carFund : [],
      spark: Array.isArray(month.spark) ? month.spark.map((entry) => ({ ...entry, collapsed: entry.collapsed ?? false })) : [],
      sparkTips: Array.isArray(month.sparkTips) ? month.sparkTips : [],
      weeks: Array.isArray(month.weeks) && month.weeks.length ? month.weeks : createDefaultWeeks(month.name || month.month || month.title || monthNames[0], month.year || cycle.year || new Date().getFullYear()),
      assignmentCategories: Array.isArray(month.assignmentCategories) ? month.assignmentCategories : [],
      spending: Array.isArray(month.spending) ? month.spending : [],
      notesArchive: Array.isArray(month.notesArchive) ? month.notesArchive : [],
      notes: month.notes || ""
    }));
  }

  if (!cycle.label) {
    cycle.label = cycle.id === "cycle-2" ? "Cycle 2" : "Cycle 1";
  }

  cycle.months = cycle.months.slice(0, 6);
  cycle.months.forEach(ensureGoalMetadata);
  cycle.months.forEach(migrateUntouchedJuly2026Weeks);
  return cycle;
}

function ensureGoalMetadata(month) {
  month.goals = Array.isArray(month.goals) ? month.goals : [];
  month.goals.forEach((goal) => {
    if (!goal.id) {
      goal.id = createGoalId();
    }
    if (typeof goal.completed !== "boolean") {
      goal.completed = false;
    }
  });

  const goalMap = new Map(month.goals.map((goal) => [normalizeGoalName(goal.name), goal.id]));
  ensureWeekData(month).forEach((week) => {
    week.goals = Array.isArray(week.goals) ? week.goals : [];
    week.goals.forEach((entry) => {
      if (!entry.goalId) {
        entry.goalId = goalMap.get(normalizeGoalName(entry.name)) || "";
      }
    });
  });
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
      { source: "Main Job", date: "", amount: "", notes: "" },
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
      { id: createGoalId(), name: "Past Due Car Payment", targetAmount: 5000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Car Fund", targetAmount: 1000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Credit Cards", targetAmount: 3000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Mom", targetAmount: 1000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Aunt Mary", targetAmount: 1000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Dogs", targetAmount: 1500, currentAmount: 0, addedAmount: 0, completed: false, notes: "" },
      { id: createGoalId(), name: "Other", targetAmount: 1000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" }
    ],
    carFund: [],
    carFundTargetAmount: 1000,
    spark: [],
    sparkTips: [],
    weeks: createDefaultWeeks(name, year),
    assignmentCategories: DEFAULT_SPENDING_CATEGORIES.map((category) => ({ name: category, amount: "", notes: "" })),
    bankSync: {
      startingBalance: "",
      accountOneName: "Bank App 1",
      accountOneBalance: "",
      accountTwoName: "Bank App 2",
      accountTwoBalance: "",
      accountThreeName: "Bank App 3",
      accountThreeBalance: "",
      currentBankBalance: "",
      reconciliationAdjustment: "",
      statusMessage: "",
      debugMessage: ""
    },
    spending: [],
    notesArchive: [],
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
      return formatShortDate(date);
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return formatShortDate(parsed);
  }

  return trimmed;
}

function formatShortDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function createDefaultWeeks(monthName, year) {
  // July 2026 starts partway through the month. Future Julys use the
  // normal full-month schedule below.
  if (monthName === "July" && year === 2026) {
    return [
      createWeekData("Week 1", "2026-07-20", "2026-07-27"),
      createWeekData("Week 2", "2026-07-28", "2026-07-31")
    ];
  }

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
    weeks.push(createWeekData(
      `Week ${index + 1}`,
      formatDateInput(weekStart),
      formatDateInput(weekEnd)
    ));
    currentStart.setDate(weekStart.getDate() + 7);
  }

  return weeks;
}

function createWeekData(name, startDate, endDate) {
  return {
    name,
    startDate,
    endDate,
    homeHealthIncome: "",
    childSupportIncome: "",
    income: [],
    bills: [],
    savingsDeposits: [],
    goals: [],
    expenses: [],
    notes: ""
  };
}

// Convert the old automatic July schedule only if no entries have been added.
function migrateUntouchedJuly2026Weeks(month) {
  if (month.name !== "July" || month.year !== 2026 || !Array.isArray(month.weeks)) {
    return;
  }

  const originalStartDates = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"];
  const isUntouchedDefaultSchedule = month.weeks.length === 5 && month.weeks.every((week, index) => {
    return week.startDate === originalStartDates[index]
      && !week.homeHealthIncome
      && !week.childSupportIncome
      && !(week.income || []).length
      && !(week.bills || []).length
      && !(week.savingsDeposits || []).length
      && !(week.goals || []).length
      && !(week.expenses || []).length
      && !week.notes;
  });

  if (isUntouchedDefaultSchedule) {
    month.weeks = createDefaultWeeks("July", 2026);
  }
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

  const weekBasePay = month.spark.reduce((sum, entry) => {
    const acceptedDate = parseDateInput(entry.acceptedDate);
    if (!acceptedDate) {
      return sum;
    }

    if (acceptedDate >= weekStart && acceptedDate <= weekEnd) {
      const basePay = Number(entry.actualBasePay) || Number(entry.estimatedBasePay) || 0;
      return sum + basePay;
    }

    return sum;
  }, 0);

  const weekReceivedTips = Array.isArray(month.sparkTips)
    ? month.sparkTips.reduce((sum, tip) => {
      if (!tip || !tip.receivedDate) {
        return sum;
      }
      const receivedDate = parseDateInput(tip.receivedDate);
      if (!receivedDate || receivedDate < weekStart || receivedDate > weekEnd) {
        return sum;
      }
      return sum + (Number(tip.amount) || 0);
    }, 0)
    : 0;

  return weekBasePay + weekReceivedTips;
}

function getWeeklyIncomeEntriesTotal(month, week) {
  const weekStart = parseDateInput(week.startDate);
  const weekEnd = parseDateInput(week.endDate);
  if (!weekStart || !weekEnd || !Array.isArray(month.income)) {
    return 0;
  }

  return month.income.reduce((sum, entry) => {
    if (!entry || !entry.date) {
      return sum;
    }
    const entryDate = parseDateInput(entry.date);
    if (!entryDate || entryDate < weekStart || entryDate > weekEnd) {
      return sum;
    }
    if (/spark/i.test(entry.source || "")) {
      return sum;
    }
    return sum + (Number(entry.amount) || 0);
  }, 0);
}

function getWeeklyIncomeEntriesTotalBySource(month, week, sourceCategory) {
  const weekStart = parseDateInput(week.startDate);
  const weekEnd = parseDateInput(week.endDate);
  if (!weekStart || !weekEnd || !Array.isArray(month.income)) {
    return 0;
  }

  return month.income.reduce((sum, entry) => {
    if (!entry || !entry.date) {
      return sum;
    }
    const entryDate = parseDateInput(entry.date);
    if (!entryDate || entryDate < weekStart || entryDate > weekEnd) {
      return sum;
    }
    if (/spark/i.test(entry.source || "")) {
      return sum;
    }
    if (!sourceMatchesCategory(entry.source, sourceCategory)) {
      return sum;
    }
    return sum + (Number(entry.amount) || 0);
  }, 0);
}

function getWeekIncomeBySource(month, week, sourceCategory) {
  if (sourceMatchesCategory(sourceCategory, "Spark")) {
    return getWeeklySparkIncome(month, week);
  }

  let total = getWeeklyIncomeEntriesTotalBySource(month, week, sourceCategory);
  if (sourceMatchesCategory(sourceCategory, "Main Job")) {
    total += Number(week.homeHealthIncome) || 0;
  }
  if (sourceMatchesCategory(sourceCategory, "Child Support")) {
    total += Number(week.childSupportIncome) || 0;
  }
  return total;
}

function getWeekIncomeTotal(month, week) {
  return (Number(week.homeHealthIncome) || 0)
    + (Number(week.childSupportIncome) || 0)
    + getWeeklySparkIncome(month, week)
    + getWeeklyIncomeEntriesTotal(month, week);
}

function getWeeklyIncomeTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + getWeekIncomeTotal(month, week), 0);
}

function getWeekOtherIncome(month, week) {
  const weekStart = parseDateInput(week.startDate);
  const weekEnd = parseDateInput(week.endDate);
  if (!weekStart || !weekEnd || !Array.isArray(month.income)) {
    return 0;
  }

  return month.income.reduce((sum, entry) => {
    if (!entry || !entry.date) {
      return sum;
    }

    const entryDate = parseDateInput(entry.date);
    if (!entryDate || entryDate < weekStart || entryDate > weekEnd) {
      return sum;
    }

    const source = entry.source || "";
    if (/spark/i.test(source)) {
      return sum;
    }
    if (sourceMatchesCategory(source, "Main Job") || sourceMatchesCategory(source, "Child Support")) {
      return sum;
    }

    return sum + (Number(entry.amount) || 0);
  }, 0);
}

function getOtherIncome(month) {
  if (hasWeeklyIncomeEntries(month)) {
    return ensureWeekData(month).reduce((sum, week) => sum + getWeekOtherIncome(month, week), 0);
  }

  return (month.income || []).reduce((sum, entry) => {
    const source = entry.source || "";
    if (/spark/i.test(source)) {
      return sum;
    }
    if (sourceMatchesCategory(source, "Main Job") || sourceMatchesCategory(source, "Child Support")) {
      return sum;
    }
    return sum + (Number(entry.amount) || 0);
  }, 0);
}

function getWeekBillsTotal(week) {
  return week.bills.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getWeeklyBillsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + getWeekBillsTotal(week), 0);
}

function getWeekSavingsTotal(week) {
  return week.savingsDeposits.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getWeeklySavingsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + getWeekSavingsTotal(week), 0);
}

function getWeekExpensesTotal(week) {
  return week.expenses.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getWeeklyExpensesTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + getWeekExpensesTotal(week), 0);
}

function getWeeklyGoalContributionTotal(month, goal) {
  const targetGoalId = goal && goal.id ? goal.id : "";
  const targetName = normalizeGoalName(goal && goal.name ? goal.name : "");
  return ensureWeekData(month).reduce((sum, week) => sum + week.goals.reduce((weekSum, entry) => {
    const entryGoalId = entry.goalId || "";
    if (targetGoalId && entryGoalId && targetGoalId === entryGoalId) {
      return weekSum + (Number(entry.amount) || 0);
    }
    if (targetName && !entryGoalId && normalizeGoalName(entry.name) === targetName) {
      return weekSum + (Number(entry.amount) || 0);
    }
    if (targetGoalId && !entryGoalId && normalizeGoalName(entry.name) === targetName) {
      return weekSum + (Number(entry.amount) || 0);
    }
    return weekSum;
  }, 0), 0);
}

function hasWeeklyGoalEntries(month) {
  return ensureWeekData(month).some((week) => week.goals.some((entry) => (Number(entry.amount) || 0) > 0));
}

function getWeeklyGoalContributionsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => sum + week.goals.reduce((weekSum, entry) => weekSum + (Number(entry.amount) || 0), 0), 0);
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
  renderAuditPage();
  renderBankSyncPage();
  renderSparkTrackerPage();
  renderDashboard();
  renderHistory();
  renderReports();
  renderSettings();
  updateCycleTitle();
  showPage("dashboard");
}

function showPage(pageId) {
  if (pageId === "budgetCycle") {
    activeWeeklyIndex = -1;
    renderMonthView();
  }
  if (pageId === "audit") {
    renderAuditPage();
  }
  if (pageId === "bankSync") {
    renderBankSyncPage();
  }
  if (pageId === "sparkTracker") {
    renderSparkTrackerPage();
  }

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
  activeWeeklyIndex = -1;
  plannerState.lastOpenedMonth = monthName;
  saveState();
  renderMonthButtons();
  renderMonthView();
  renderAuditPage();
  renderBankSyncPage();
  renderDashboard();
}

function renderMonthView() {
  const month = getSelectedMonthData();
  const monthArea = document.getElementById("monthArea");
  if (!monthArea || !month) {
    return;
  }

  const weeks = ensureWeekData(month);
  const carFundLabel = getCarFundLabel();
  const showMonthlySections = activeWeeklyIndex < 0;

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

      ${showMonthlySections ? `
      <div class="month-tab-buttons">
        <button data-section="overview" class="tab-button ${activeMonthSection === "overview" ? "active" : ""}" onclick="showMonthSection('overview')">Overview</button>
        <button data-section="income" class="tab-button ${activeMonthSection === "income" ? "active" : ""}" onclick="showMonthSection('income')">Income</button>
        <button data-section="bills" class="tab-button ${activeMonthSection === "bills" ? "active" : ""}" onclick="showMonthSection('bills')">Bills</button>
        <button data-section="goals" class="tab-button ${activeMonthSection === "goals" ? "active" : ""}" onclick="showMonthSection('goals')">Goals</button>
        <button data-section="carFund" class="tab-button ${activeMonthSection === "carFund" ? "active" : ""}" onclick="showMonthSection('carFund')">${escapeHtml(carFundLabel)}</button>
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
        <h4>${escapeHtml(carFundLabel)}</h4>
        <div id="carFundArea"></div>
        <button onclick="addCarFundEntry()">Add Contribution</button>
      </section>

      <section id="monthSection-assignment" class="month-section hidden">
        <h4>Monthly Money Assignment</h4>
        <p>Left to Assign: <span id="leftToAssign">$0</span></p>
        <div id="assignmentArea"></div>
        <button onclick="addAssignmentCategory()">Add Category</button>
      </section>

      <section id="monthSection-notes" class="month-section hidden">
        <h4>Notes</h4>
        <details id="monthNotesToggle" class="note-toggle">
          <summary class="note-toggle-summary">Add Note</summary>
          <textarea id="monthNotes" placeholder="Anything you want to remember about this month..." oninput="updateMonthNotes(this.value)"></textarea>
        </details>
        <div class="entry-actions">
          <button class="ghost-button" onclick="archiveCurrentMonthNote()">Archive Current Note</button>
        </div>
        <div id="monthNotesArchive"></div>
      </section>
      ` : ""}
    </div>
  `;

  if (showMonthlySections) {
    renderMonthSections();
  }
  renderWeeklyTracker();
  if (showMonthlySections) {
    showMonthSection(activeMonthSection);
  }
}

function showWeek(index) {
  activeWeeklyIndex = index;
  renderMonthView();
}

function showWeeklyOverview() {
  activeWeeklyIndex = -1;
  renderMonthView();
}

function updateWeekNavigation() {
  document.querySelectorAll(".week-nav-buttons .week-button").forEach((button, index) => {
    button.classList.toggle("active", index === activeWeeklyIndex + 1);
  });
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
  renderAssignmentSection();
  renderNotesSection();
}

function renderAuditPage() {
  const month = getSelectedMonthData();
  const pageTitle = document.getElementById("auditPageTitle");
  const buttons = document.getElementById("auditMonthButtons");
  const area = document.getElementById("auditPageArea");
  const cycle = getActiveCycle();
  if (!month || !pageTitle || !buttons || !area || !cycle) {
    return;
  }

  pageTitle.textContent = `Audit • ${month.name} ${month.year}`;
  buttons.innerHTML = cycle.months.map((cycleMonth) => `
    <button class="${cycleMonth.name === activeMonthName ? "active" : ""}" onclick="openMonth('${cycleMonth.name}')">${cycleMonth.name}</button>
  `).join("");

  renderAuditSection("auditPageArea");
}

function renderBankSyncPage() {
  const month = getSelectedMonthData();
  const pageTitle = document.getElementById("bankSyncPageTitle");
  const buttons = document.getElementById("bankSyncMonthButtons");
  const area = document.getElementById("bankSyncPageArea");
  const cycle = getActiveCycle();
  if (!month || !pageTitle || !buttons || !area || !cycle) {
    return;
  }

  pageTitle.textContent = `Bank Sync • ${month.name} ${month.year}`;
  buttons.innerHTML = cycle.months.map((cycleMonth) => `
    <button class="${cycleMonth.name === activeMonthName ? "active" : ""}" onclick="openMonth('${cycleMonth.name}')">${cycleMonth.name}</button>
  `).join("");

  renderBankSyncSection("bankSyncPageArea");
}

function ensureMonthBankSync(month) {
  month.bankSync = {
    startingBalance: "",
    accountOneName: "Bank App 1",
    accountOneBalance: "",
    accountTwoName: "Bank App 2",
    accountTwoBalance: "",
    accountThreeName: "Bank App 3",
    accountThreeBalance: "",
    currentBankBalance: "",
    reconciliationAdjustment: "",
    statusMessage: "",
    debugMessage: "",
    ...(month.bankSync || {})
  };
  return month.bankSync;
}

function getCurrentBankSyncBalance(month) {
  const bankSync = ensureMonthBankSync(month);
  const accountOne = Number(bankSync.accountOneBalance) || 0;
  const accountTwo = Number(bankSync.accountTwoBalance) || 0;
  const accountThree = Number(bankSync.accountThreeBalance) || 0;
  const combined = accountOne + accountTwo + accountThree;
  if (combined > 0) {
    return combined;
  }
  return Number(bankSync.currentBankBalance) || 0;
}

function syncBankSyncInputsFromDom() {
  const month = getSelectedMonthData();
  const bankSync = ensureMonthBankSync(month);
  const fieldIds = [
    ["startingBalance", "bankSyncStartingBalance"],
    ["accountOneName", "bankSyncAccountOneName"],
    ["accountOneBalance", "bankSyncAccountOneBalance"],
    ["accountTwoName", "bankSyncAccountTwoName"],
    ["accountTwoBalance", "bankSyncAccountTwoBalance"],
    ["accountThreeName", "bankSyncAccountThreeName"],
    ["accountThreeBalance", "bankSyncAccountThreeBalance"],
    ["currentBankBalance", "bankSyncCurrentBankBalance"],
    ["reconciliationAdjustment", "bankSyncReconciliationAdjustment"]
  ];

  fieldIds.forEach(([field, id]) => {
    const input = document.getElementById(id);
    if (!input) {
      return;
    }
    bankSync[field] = /Name$/.test(field) ? String(input.value || "") : Number(input.value) || 0;
  });

  return bankSync;
}

function updateBankSyncField(field, value) {
  const month = getSelectedMonthData();
  const bankSync = ensureMonthBankSync(month);
  bankSync[field] = /Name$/.test(field) ? String(value || "") : Number(value) || 0;
  bankSync.statusMessage = "";
  bankSync.debugMessage = "";
  saveState();
  renderDashboard();
  renderReports();
}

function roundCurrencyAmount(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function applyBankSyncDifference() {
  const month = getSelectedMonthData();
  const bankSync = syncBankSyncInputsFromDom() || ensureMonthBankSync(month);
  try {
    bankSyncClickCount += 1;
    const bankBalance = roundCurrencyAmount(getCurrentBankSyncBalance(month));
    const existingAdjustment = roundCurrencyAmount(Number(bankSync.reconciliationAdjustment) || 0);
    const currentAppBalance = roundCurrencyAmount(getRemainingAmount(month));
    const unadjustedAppBalance = roundCurrencyAmount(currentAppBalance - existingAdjustment);
    const nextAdjustment = roundCurrencyAmount(bankBalance - unadjustedAppBalance);

    bankSync.reconciliationAdjustment = nextAdjustment;
    bankSync.statusMessage = `Applied. Adjustment set to ${formatCurrency(bankSync.reconciliationAdjustment)}.`;
    bankSync.debugMessage = `Click ${bankSyncClickCount}. Bank ${formatCurrency(bankBalance)} | App ${formatCurrency(currentAppBalance)} | Existing Adj ${formatCurrency(existingAdjustment)} | Unadjusted App ${formatCurrency(unadjustedAppBalance)} | New Adj ${formatCurrency(nextAdjustment)}`;
    queueActivity("Applied bank sync difference.");
    saveState();
    renderMonthSections();
    renderBankSyncPage();
    renderDashboard();
    renderReports();
  } catch (error) {
    bankSyncClickCount += 1;
    bankSync.statusMessage = "Apply failed.";
    bankSync.debugMessage = `Click ${bankSyncClickCount} failed: ${error && error.message ? error.message : "Unknown error"}`;
    saveState();
    renderBankSyncPage();
  }
}

function clearBankSyncAdjustment() {
  const month = getSelectedMonthData();
  const bankSync = syncBankSyncInputsFromDom() || ensureMonthBankSync(month);
  bankSyncClickCount += 1;
  bankSync.reconciliationAdjustment = 0;
  bankSync.statusMessage = "Adjustment cleared.";
  bankSync.debugMessage = `Click ${bankSyncClickCount}. Clear clicked. Adjustment reset to $0.00.`;
  queueActivity("Cleared bank sync adjustment.");
  saveState();
  renderMonthSections();
  renderBankSyncPage();
  renderDashboard();
  renderReports();
}

function renderBankSyncSection(containerId = "bankSyncPageArea") {
  const month = getSelectedMonthData();
  const container = document.getElementById(containerId);
  if (!container || !month) {
    return;
  }

  const bankSync = ensureMonthBankSync(month);
  const startingBalance = Number(bankSync.startingBalance) || 0;
  const accountOneName = String(bankSync.accountOneName || "").trim() || "Bank App 1";
  const accountOneBalance = Number(bankSync.accountOneBalance) || 0;
  const accountTwoName = String(bankSync.accountTwoName || "").trim() || "Bank App 2";
  const accountTwoBalance = Number(bankSync.accountTwoBalance) || 0;
  const accountThreeName = String(bankSync.accountThreeName || "").trim() || "Bank App 3";
  const accountThreeBalance = Number(bankSync.accountThreeBalance) || 0;
  const manualBankBalance = Number(bankSync.currentBankBalance) || 0;
  const currentBankBalance = getCurrentBankSyncBalance(month);
  const reconciliationAdjustment = Number(bankSync.reconciliationAdjustment) || 0;
  const appBalance = getRemainingAmount(month);
  const difference = roundCurrencyAmount(currentBankBalance - appBalance);
  const existingAdjustment = roundCurrencyAmount(reconciliationAdjustment);
  const unadjustedAppBalance = roundCurrencyAmount(appBalance - existingAdjustment);
  const adjustmentNeeded = roundCurrencyAmount(currentBankBalance - unadjustedAppBalance);
  const isUsingCombinedBalances = accountOneBalance > 0 || accountTwoBalance > 0 || accountThreeBalance > 0;

  container.innerHTML = `
    <div class="report-card">
      <p class="spark-note">Use this if you had money in your account before using the app, or if you want app totals to reconcile to your bank. This section is manual entry only.</p>
      <div class="entry-fields">
        <label>Starting Bank Balance
          <input id="bankSyncStartingBalance" type="number" step="0.01" value="${escapeHtml(startingBalance || "")}" oninput="updateBankSyncField('startingBalance', this.value)" />
        </label>
        <label>Account 1 Name
          <input id="bankSyncAccountOneName" type="text" value="${escapeHtml(accountOneName)}" oninput="updateBankSyncField('accountOneName', this.value)" />
        </label>
        <label>${escapeHtml(accountOneName)} Balance
          <input id="bankSyncAccountOneBalance" type="number" step="0.01" value="${escapeHtml(accountOneBalance || "")}" oninput="updateBankSyncField('accountOneBalance', this.value)" />
        </label>
        <label>Account 2 Name
          <input id="bankSyncAccountTwoName" type="text" value="${escapeHtml(accountTwoName)}" oninput="updateBankSyncField('accountTwoName', this.value)" />
        </label>
        <label>${escapeHtml(accountTwoName)} Balance
          <input id="bankSyncAccountTwoBalance" type="number" step="0.01" value="${escapeHtml(accountTwoBalance || "")}" oninput="updateBankSyncField('accountTwoBalance', this.value)" />
        </label>
        <label>Account 3 Name
          <input id="bankSyncAccountThreeName" type="text" value="${escapeHtml(accountThreeName)}" oninput="updateBankSyncField('accountThreeName', this.value)" />
        </label>
        <label>${escapeHtml(accountThreeName)} Balance
          <input id="bankSyncAccountThreeBalance" type="number" step="0.01" value="${escapeHtml(accountThreeBalance || "")}" oninput="updateBankSyncField('accountThreeBalance', this.value)" />
        </label>
        <label>Manual Combined Balance
          <input id="bankSyncCurrentBankBalance" type="number" step="0.01" value="${escapeHtml(manualBankBalance || "")}" oninput="updateBankSyncField('currentBankBalance', this.value)" />
        </label>
        <label>Combined Bank Balance
          <input type="text" value="${escapeHtml(formatCurrency(currentBankBalance))}" readonly />
        </label>
        <label>Reconciliation Adjustment
          <input id="bankSyncReconciliationAdjustment" type="number" step="0.01" value="${escapeHtml(reconciliationAdjustment || "")}" oninput="updateBankSyncField('reconciliationAdjustment', this.value)" />
        </label>
      </div>
      <p class="spark-note">${isUsingCombinedBalances ? "Combined Bank Balance is using the three bank app fields above." : "If you do not enter all three app balances yet, you can use Manual Combined Balance."}</p>
      <p class="spark-note">Type the Adjustment Needed amount into Reconciliation Adjustment.</p>
      <div class="dashboard-cards">
        <div class="card"><h4>App Balance</h4><p>${formatCurrency(appBalance)}</p></div>
        <div class="card"><h4>Bank Balance</h4><p>${formatCurrency(currentBankBalance)}</p></div>
        <div class="card"><h4>Difference</h4><p>${formatCurrency(difference)}</p></div>
        <div class="card"><h4>Adjustment Needed</h4><p>${formatCurrency(adjustmentNeeded)}</p></div>
      </div>
      <p class="spark-note">After you type the adjustment, the App Balance should move toward your Bank Balance automatically.</p>
    </div>
  `;
}

function renderWeekEntryToggle(summary, content, isOpen = false) {
  const [entryKey, openState] = Array.isArray(isOpen) ? isOpen : ["", isOpen];
  return `
    <details class="week-entry-toggle" ${openState ? "open" : ""} ${entryKey ? `data-week-entry-key="${escapeHtml(entryKey)}"` : ""}>
      <summary class="week-entry-summary">${summary}</summary>
      <div class="week-entry-body">${content}</div>
    </details>
  `;
}

function renderWeekPanel(title, total, content, isOpen = false) {
  const [panelKey, openState] = Array.isArray(isOpen) ? isOpen : ["", isOpen];
  return `
    <details class="week-panel-toggle" ${openState ? "open" : ""} ${panelKey ? `data-week-panel-key="${escapeHtml(panelKey)}"` : ""}>
      <summary class="week-panel-summary">
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(formatCurrency(total))}</strong>
      </summary>
      <div class="week-panel-body">${content}</div>
    </details>
  `;
}

function getSparkAuditAmount(entry) {
  return Number(entry.finalPayout)
    || Number(entry.actualBasePay)
    || Number(entry.estimatedBasePay)
    || Number(entry.estimatedPayout)
    || 0;
}
function getWeeklyDetailStateKey(monthName, weekName) {
  return `${monthName}::${weekName}`;
}

function snapshotWeeklyDetailUiState(container, stateKey) {
  if (!container) {
    return;
  }

  weeklyDetailUiState[stateKey] = weeklyDetailUiState[stateKey] || { panels: {}, entries: {} };
  const targetState = weeklyDetailUiState[stateKey];

  container.querySelectorAll("[data-week-panel-key]").forEach((element) => {
    const key = element.getAttribute("data-week-panel-key");
    if (key) {
      targetState.panels[key] = element.open;
    }
  });

  container.querySelectorAll("[data-week-entry-key]").forEach((element) => {
    const key = element.getAttribute("data-week-entry-key");
    if (key) {
      targetState.entries[key] = element.open;
    }
  });
}

function getWeeklyPanelOpenState(stateKey, panelKey, defaultValue) {
  return weeklyDetailUiState[stateKey] && panelKey in weeklyDetailUiState[stateKey].panels
    ? weeklyDetailUiState[stateKey].panels[panelKey]
    : defaultValue;
}

function getWeeklyEntryOpenState(stateKey, entryKey, defaultValue) {
  return weeklyDetailUiState[stateKey] && entryKey in weeklyDetailUiState[stateKey].entries
    ? weeklyDetailUiState[stateKey].entries[entryKey]
    : defaultValue;
}

function buildMonthAuditEntries(month) {
  const entries = [];
  let nextId = 1;

  function pushEntry(date, type, label, amount, impactsRemaining = true) {
    const numericAmount = Number(amount) || 0;
    if (!numericAmount) {
      return;
    }
    entries.push({
      id: `audit-${nextId++}`,
      date: date || "",
      type,
      label,
      amount: numericAmount,
      impactsRemaining: Boolean(impactsRemaining)
    });
  }

  (month.income || []).forEach((entry) => {
    if (/spark/i.test(entry.source || "")) {
      return;
    }
    pushEntry(entry.date || "", "Income", entry.source || "Income", Number(entry.amount) || 0, true);
  });

  (month.spark || []).forEach((entry, index) => {
    const sparkAmount = getSparkAuditAmount(entry);
    const sparkLabel = Number(entry.finalPayout) || Number(entry.estimatedPayout)
      ? `Spark order ${index + 1} payout`
      : `Spark order ${index + 1} base pay`;
    pushEntry(entry.acceptedDate || "", "Income", sparkLabel, sparkAmount, true);

    const gasAmount = Number(entry.gasExpense) || 0;
    pushEntry(entry.acceptedDate || "", "Spark Gas", `Spark order ${index + 1} gas`, -Math.abs(gasAmount), true);

    const otherCost = Number(entry.otherExpense) || 0;
    pushEntry(entry.acceptedDate || "", "Spark Cost", `Spark order ${index + 1} other expense`, -Math.abs(otherCost), true);
  });

  (month.sparkTips || []).forEach((tip, index) => {
    pushEntry(tip.receivedDate || "", "Income", `Spark tip ${index + 1} received`, Number(tip.amount) || 0, true);
  });

  if (hasWeeklyBillEntries(month)) {
    ensureWeekData(month).forEach((week) => {
      (week.bills || []).forEach((entry) => {
        const isPaid = Boolean(entry.paid);
        const label = `${week.name}: ${entry.name || "Bill"}${isPaid ? "" : " (Unpaid)"}`;
        pushEntry(entry.date || week.endDate || week.startDate || "", "Bill", label, -Math.abs(Number(entry.amount) || 0), isPaid);
      });
    });
  } else {
    (month.bills || []).forEach((entry) => {
      const isPaid = Boolean(entry.paid);
      const label = `${entry.name || "Bill"}${isPaid ? "" : " (Unpaid)"}`;
      pushEntry(entry.dueDate || "", "Bill", label, -Math.abs(Number(entry.amount) || 0), isPaid);
    });
  }

  ensureWeekData(month).forEach((week) => {
    (week.expenses || []).forEach((entry) => {
      pushEntry(entry.date || week.endDate || week.startDate || "", "Expense", `${week.name}: ${entry.name || "Expense"}`, -Math.abs(Number(entry.amount) || 0), true);
    });

    (week.goals || []).forEach((entry) => {
      pushEntry(entry.date || week.endDate || week.startDate || "", "Goal", `${week.name}: ${entry.name || "Goal contribution"}`, -Math.abs(Number(entry.amount) || 0), true);
    });

    (week.savingsDeposits || []).forEach((entry) => {
      pushEntry(entry.date || week.endDate || week.startDate || "", "Savings", `${week.name}: Savings deposit`, -Math.abs(Number(entry.amount) || 0), true);
    });
  });

  (month.assignmentCategories || []).forEach((entry) => {
    pushEntry("", "Assignment", `${entry.name || "Assignment"} (plan only)`, -Math.abs(Number(entry.amount) || 0), false);
  });

  return entries.sort((a, b) => {
    const dateA = parseDateInput(a.date);
    const dateB = parseDateInput(b.date);
    if (!dateA && !dateB) {
      return 0;
    }
    if (!dateA) {
      return 1;
    }
    if (!dateB) {
      return -1;
    }
    return dateB.getTime() - dateA.getTime();
  });
}

function sortAuditRowsByDateDesc(rows) {
  return rows.sort((a, b) => {
    const dateA = parseDateInput(a.date);
    const dateB = parseDateInput(b.date);
    if (!dateA && !dateB) {
      return 0;
    }
    if (!dateA) {
      return 1;
    }
    if (!dateB) {
      return -1;
    }
    return dateB.getTime() - dateA.getTime();
  });
}

function buildDetailedAuditGroups(month) {
  const groups = {
    mainJob: [],
    sparkDaily: [],
    childSupport: [],
    sparkGas: [],
    expenses: [],
    goals: [],
    bills: []
  };

  function pushRow(group, date, label, amount, note = "") {
    const numericAmount = Number(amount) || 0;
    if (!numericAmount) {
      return;
    }
    group.push({
      date: date || "",
      label,
      amount: Math.abs(numericAmount),
      note
    });
  }

  (month.income || []).forEach((entry) => {
    const amount = Number(entry.amount) || 0;
    if (!amount) {
      return;
    }
    if (sourceMatchesCategory(entry.source, "Main Job")) {
      pushRow(groups.mainJob, entry.date || "", entry.source || "Main Job", amount, "Monthly income entry");
      return;
    }
    if (sourceMatchesCategory(entry.source, "Child Support")) {
      pushRow(groups.childSupport, entry.date || "", entry.source || "Child Support", amount, "Monthly income entry");
    }
  });

  ensureWeekData(month).forEach((week) => {
    const weekDate = week.endDate || week.startDate || "";

    const mainJobIncome = Number(week.homeHealthIncome) || 0;
    if (mainJobIncome > 0) {
      pushRow(groups.mainJob, weekDate, `${week.name} Main Job`, mainJobIncome, "Weekly income field");
    }

    const childSupportIncome = Number(week.childSupportIncome) || 0;
    if (childSupportIncome > 0) {
      pushRow(groups.childSupport, weekDate, `${week.name} Child Support`, childSupportIncome, "Weekly income field");
    }

    (week.expenses || []).forEach((entry) => {
      pushRow(groups.expenses, weekDate, `${week.name}: ${entry.name || "Expense"}`, Number(entry.amount) || 0);
    });

    (week.goals || []).forEach((entry) => {
      pushRow(groups.goals, weekDate, `${week.name}: ${entry.name || "Goal contribution"}`, Number(entry.amount) || 0);
    });

    if (hasWeeklyBillEntries(month)) {
      (week.bills || []).forEach((entry) => {
        pushRow(groups.bills, weekDate, `${week.name}: ${entry.name || "Bill"}`, Number(entry.amount) || 0);
      });
    }
  });

  if (!hasWeeklyBillEntries(month)) {
    (month.bills || []).forEach((entry) => {
      pushRow(groups.bills, entry.dueDate || "", entry.name || "Bill", Number(entry.amount) || 0);
    });
  }

  (month.spark || []).forEach((entry, index) => {
    const basePay = Number(entry.actualBasePay) || Number(entry.estimatedBasePay) || 0;
    if (!basePay) {
      return;
    }
    pushRow(groups.sparkDaily, entry.acceptedDate || "", `Spark order ${index + 1} base pay`, basePay, "Included in daily Spark total");
  });

  (month.spark || []).forEach((entry, index) => {
    const gasAmount = Number(entry.gasExpense) || 0;
    if (!gasAmount) {
      return;
    }
    pushRow(groups.sparkGas, entry.acceptedDate || "", `Spark order ${index + 1} gas`, gasAmount, "Separate gas entry");
  });

  (month.sparkTips || []).forEach((tip, index) => {
    const tipAmount = Number(tip.amount) || 0;
    if (!tipAmount) {
      return;
    }
    pushRow(groups.sparkDaily, tip.receivedDate || "", `Spark tip ${index + 1} received`, tipAmount, "Included in daily Spark total");
  });

  const sparkByDate = new Map();
  groups.sparkDaily.forEach((row) => {
    const key = row.date || "No date";
    if (!sparkByDate.has(key)) {
      sparkByDate.set(key, {
        date: row.date || "",
        amount: 0,
        basePay: 0,
        tips: 0
      });
    }
    const target = sparkByDate.get(key);
    target.amount += Number(row.amount) || 0;
    if (/tip/i.test(row.label || "")) {
      target.tips += Number(row.amount) || 0;
    } else {
      target.basePay += Number(row.amount) || 0;
    }
  });

  groups.sparkDaily = Array.from(sparkByDate.values()).map((row) => ({
    date: row.date,
    label: "Spark total",
    amount: row.amount,
    note: `Base ${formatCurrency(row.basePay)} + Tips ${formatCurrency(row.tips)}`
  }));

  groups.mainJob = sortAuditRowsByDateDesc(groups.mainJob);
  groups.sparkDaily = sortAuditRowsByDateDesc(groups.sparkDaily);
  groups.childSupport = sortAuditRowsByDateDesc(groups.childSupport);
  groups.sparkGas = sortAuditRowsByDateDesc(groups.sparkGas);
  groups.expenses = sortAuditRowsByDateDesc(groups.expenses);
  groups.goals = sortAuditRowsByDateDesc(groups.goals);
  groups.bills = sortAuditRowsByDateDesc(groups.bills);

  return groups;
}

function renderAuditSection(containerId = "auditPageArea") {
  const month = getSelectedMonthData();
  const container = document.getElementById(containerId);
  if (!container || !month || !plannerState) {
    return;
  }

  const auditEntries = buildMonthAuditEntries(month).slice(0, 120);
  const openingBalance = getStartingBankBalance(month) + getReconciliationAdjustment(month);
  const timelineEntries = openingBalance !== 0
    ? [{
      id: "bank-sync-opening",
      date: "",
      type: "Bank Sync",
      label: "Opening balance / reconciliation",
      amount: openingBalance,
      impactsRemaining: true
    }, ...auditEntries]
    : auditEntries;

  const balanceByEntryId = new Map();
  const balanceMetaByEntryId = new Map();
  let runningIncludedBalance = 0;
  const chronological = [...timelineEntries].sort((a, b) => {
    const dateA = parseDateInput(a.date);
    const dateB = parseDateInput(b.date);
    if (!dateA && !dateB) {
      return 0;
    }
    if (!dateA) {
      return 1;
    }
    if (!dateB) {
      return -1;
    }
    return dateA.getTime() - dateB.getTime();
  });
  chronological.forEach((item) => {
    if (item.impactsRemaining) {
      runningIncludedBalance += Number(item.amount) || 0;
      balanceByEntryId.set(item.id, runningIncludedBalance);
      balanceMetaByEntryId.set(item.id, "New total after this entry");
      return;
    }
    balanceByEntryId.set(item.id, runningIncludedBalance);
    balanceMetaByEntryId.set(item.id, "No change (excluded from Remaining)");
  });

  const ledgerHtml = chronological.length
    ? `<div class="bank-ledger">${chronological.map((item) => {
      const when = item.date ? formatDisplayDate(item.date) : "No date";
      const amountClass = item.amount >= 0 ? "credit" : "debit";
      const amountLabel = `${item.amount >= 0 ? "+" : "-"}${formatCurrency(Math.abs(item.amount))}`;
      const runningBalance = formatCurrency(balanceByEntryId.get(item.id) || 0);
      const runningMeta = balanceMetaByEntryId.get(item.id) || "New total after this entry";
      return `
        <div class="bank-row">
          <div class="bank-date">${escapeHtml(when)}</div>
          <div class="bank-main">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${escapeHtml(item.type)}</span>
          </div>
          <div class="bank-amount ${amountClass}">${escapeHtml(amountLabel)}</div>
          <div class="bank-balance">
            <strong>${escapeHtml(runningBalance)}</strong>
            <span>${escapeHtml(runningMeta)}</span>
          </div>
        </div>
      `;
    }).join("")}</div>`
    : "<p class=\"spark-note\">No dated financial entries yet.</p>";

  container.innerHTML = `
    <div class="report-card">
      <h5>Audit Timeline</h5>
      <p class="spark-note">Single list in order: each entry updates the running total for Remaining.</p>
      <div class="bank-ledger-header">
        <span>Date</span>
        <span>Transaction</span>
        <span>Amount</span>
        <span>Running Balance</span>
      </div>
      ${ledgerHtml}
    </div>
  `;
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

  if (activeWeeklyIndex < 0) {
    container.innerHTML = "";
    return;
  }

  const selectedWeek = weeks[activeWeeklyIndex];
  const uiStateKey = getWeeklyDetailStateKey(month.name, selectedWeek.name);
  snapshotWeeklyDetailUiState(container, uiStateKey);
  const incomeTotal = getWeekIncomeTotal(month, selectedWeek);
  const billsTotal = getWeekBillsTotal(selectedWeek);
  const savingsTotal = getWeekSavingsTotal(selectedWeek);
  const expensesTotal = getWeekExpensesTotal(selectedWeek);
  const goalsTotal = selectedWeek.goals.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const summaryLabel = "Weekly";

  const incomeEntriesHtml = month.income.map((entry, index) => {
    const isSparkSource = /spark/i.test(entry.source || "");
    const displayAmount = isSparkSource ? getWeeklySparkIncome(month, selectedWeek) : Number(entry.amount) || 0;
    const summary = isSparkSource
      ? `Spark • ${escapeHtml(formatCurrency(displayAmount || 0))}`
      : `${escapeHtml(entry.source || "Income")} • ${escapeHtml(formatDisplayDate(entry.date || "") || "No date")} • ${escapeHtml(formatCurrency(displayAmount || 0))}`;
    const entryKey = `income-${index}`;
    if (isSparkSource) {
      return renderWeekEntryToggle(summary, `
        <div class="entry-fields">
          <label>Source
            <input type="text" value="Spark" disabled />
          </label>
          <label>Amount
            <input type="text" value="${escapeHtml(formatCurrency(displayAmount || 0))}" readonly />
          </label>
        </div>
        <p class="spark-note">Spark income is calculated from the Spark Tracker and cannot be edited here.</p>
      `, [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, index === 0)]);
    }
    return renderWeekEntryToggle(summary, `
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
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateIncomeField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeIncomeRow(${index})">Remove</button>
    `, [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, false)]);
  }).join("");

  const billsEntriesHtml = selectedWeek.bills.map((entry, index) => {
    const entryKey = `bill-${index}`;
    return renderWeekEntryToggle(
      `${escapeHtml(entry.name || "Bill")} • ${escapeHtml(formatDisplayDate(entry.date || "") || "No date")} • ${escapeHtml(formatCurrency(entry.amount || 0))}${entry.paid ? " • Paid" : ""}`,
      `
      <div class="entry-fields">
        <label>Bill Name
          <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateWeeklyBillEntry(${index}, 'name', this.value)" />
        </label>
        <label>Date
          <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateWeeklyBillEntry(${index}, 'date', this.value)" />
        </label>
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyBillEntry(${index}, 'amount', this.value)" />
        </label>
        <label class="checkbox-label">
          <input type="checkbox" ${entry.paid ? "checked" : ""} onchange="updateWeeklyBillEntry(${index}, 'paid', this.checked)" />
          Paid
        </label>
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateWeeklyBillEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeWeeklyBillEntry(${index})">Remove</button>
    `,
      [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, false)]
    );
  }).join("");

  const savingsEntriesHtml = selectedWeek.savingsDeposits.map((entry, index) => {
    const entryKey = `savings-${index}`;
    return renderWeekEntryToggle(
      `${escapeHtml(formatDisplayDate(entry.date || "") || "No date")} • ${escapeHtml(formatCurrency(entry.amount || 0))}`,
      `
      <div class="entry-fields">
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklySavingsEntry(${index}, 'amount', this.value)" />
        </label>
        <label>Date
          <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateWeeklySavingsEntry(${index}, 'date', this.value)" />
        </label>
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateWeeklySavingsEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeWeeklySavingsEntry(${index})">Remove</button>
    `,
      [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, false)]
    );
  }).join("");

  const goalsEntriesHtml = selectedWeek.goals.map((entry, index) => {
    const entryKey = `goal-${index}`;
    return renderWeekEntryToggle(
      `${escapeHtml(entry.name || "Goal contribution")} • ${escapeHtml(formatDisplayDate(entry.date || "") || "No date")} • ${escapeHtml(formatCurrency(entry.amount || 0))}`,
      `
      <div class="entry-fields">
        <label>Goal
          <select onchange="updateWeeklyGoalEntry(${index}, 'goalId', this.value)">
            <option value="">Select goal</option>
            ${month.goals.map((goal) => {
              const selected = entry.goalId
                ? entry.goalId === goal.id
                : normalizeGoalName(entry.name) === normalizeGoalName(goal.name);
              return `<option value="${escapeHtml(goal.id || "")}" ${selected ? "selected" : ""}>${escapeHtml(goal.name || "Goal")}</option>`;
            }).join("")}
          </select>
        </label>
        <label>Date
          <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateWeeklyGoalEntry(${index}, 'date', this.value)" />
        </label>
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyGoalEntry(${index}, 'amount', this.value)" />
        </label>
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateWeeklyGoalEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeWeeklyGoalEntry(${index})">Remove</button>
    `,
      [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, false)]
    );
  }).join("");

  const expensesEntriesHtml = selectedWeek.expenses.map((entry, index) => {
    const entryKey = `expense-${index}`;
    return renderWeekEntryToggle(
      `${escapeHtml(entry.name || "Expense")} • ${escapeHtml(formatDisplayDate(entry.date || "") || "No date")} • ${escapeHtml(formatCurrency(entry.amount || 0))}`,
      `
      <div class="entry-fields">
        <label>Expense Name
          <input type="text" value="${escapeHtml(entry.name || "")}" onchange="updateWeeklyExpenseEntry(${index}, 'name', this.value)" />
        </label>
        <label>Date
          <input type="date" value="${escapeHtml(entry.date || "")}" onchange="updateWeeklyExpenseEntry(${index}, 'date', this.value)" />
        </label>
        <label>Amount
          <input type="number" min="0" step="0.01" value="${escapeHtml(entry.amount || "")}" onchange="updateWeeklyExpenseEntry(${index}, 'amount', this.value)" />
        </label>
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateWeeklyExpenseEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeWeeklyExpenseEntry(${index})">Remove</button>
    `,
      [entryKey, getWeeklyEntryOpenState(uiStateKey, entryKey, false)]
    );
  }).join("");

  container.innerHTML = `
    <div class="report-card">
      <h4>${selectedWeek.name}</h4>
      <p class="spark-note">${formatDisplayDate(selectedWeek.startDate)} to ${formatDisplayDate(selectedWeek.endDate)}</p>
      <div class="dashboard-cards">
        <div class="card"><h4>${summaryLabel} Income</h4><p>${formatCurrency(incomeTotal)}</p></div>
        <div class="card"><h4>${summaryLabel} Bills</h4><p>${formatCurrency(billsTotal)}</p></div>
        <div class="card"><h4>${summaryLabel} Savings</h4><p>${formatCurrency(savingsTotal)}</p></div>
        <div class="card"><h4>${summaryLabel} Expenses</h4><p>${formatCurrency(expensesTotal)}</p></div>
      </div>

        <div class="dashboard-cards">
          <div class="card"><h4>Main Job</h4><p>${formatCurrency(getWeekIncomeBySource(month, selectedWeek, "Main Job"))}</p></div>
          <div class="card"><h4>Child Support</h4><p>${formatCurrency(getWeekIncomeBySource(month, selectedWeek, "Child Support"))}</p></div>
          <div class="card"><h4>Spark</h4><p>${formatCurrency(getWeeklySparkIncome(month, selectedWeek))}</p></div>
          <div class="card"><h4>Total Income</h4><p>${formatCurrency(getWeekIncomeTotal(month, selectedWeek))}</p></div>
        </div>
        <div class="week-detail-grid">
              ${renderWeekPanel("Weekly Income Entries", incomeTotal, `${incomeEntriesHtml}<button onclick="addIncomeRow()">Add Income</button>`, ["panel-income", getWeeklyPanelOpenState(uiStateKey, "panel-income", true)])}
              ${renderWeekPanel("Bills", billsTotal, `${billsEntriesHtml}<button onclick="addWeeklyBillEntry()">Add Bill</button>`, ["panel-bills", getWeeklyPanelOpenState(uiStateKey, "panel-bills", false)])}
              ${renderWeekPanel("Savings", savingsTotal, `${savingsEntriesHtml}<button onclick="addWeeklySavingsEntry()">Add Deposit</button>`, ["panel-savings", getWeeklyPanelOpenState(uiStateKey, "panel-savings", false)])}
              ${renderWeekPanel("Goals", goalsTotal, `${goalsEntriesHtml}<button onclick="addWeeklyGoalEntry()">Add Goal Contribution</button>`, ["panel-goals", getWeeklyPanelOpenState(uiStateKey, "panel-goals", false)])}
              ${renderWeekPanel("Expenses", expensesTotal, `${expensesEntriesHtml}<button onclick="addWeeklyExpenseEntry()">Add Expense</button>`, ["panel-expenses", getWeeklyPanelOpenState(uiStateKey, "panel-expenses", false)])}
              ${renderWeekPanel("Notes", 0, renderNotesToggle(selectedWeek.notes, `<textarea oninput="updateWeeklyNotes(this.value)">${escapeHtml(selectedWeek.notes || "")}</textarea>`, "Week Note"), ["panel-notes", getWeeklyPanelOpenState(uiStateKey, "panel-notes", false)])}
        </div>
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
  queueActivity(`Updated weekly income in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklyBillEntry() {
  const week = getSelectedWeekData();
  week.bills.push({ name: "", date: "", amount: "", paid: false, notes: "" });
  queueActivity(`Added weekly bill in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyBillEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.bills[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  queueActivity(`Updated weekly bill in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklyBillEntry(index) {
  const week = getSelectedWeekData();
  week.bills.splice(index, 1);
  queueActivity(`Removed weekly bill from ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklySavingsEntry() {
  const week = getSelectedWeekData();
  week.savingsDeposits.push({ amount: "", date: "", notes: "" });
  queueActivity(`Added weekly savings in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklySavingsEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.savingsDeposits[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  queueActivity(`Updated weekly savings in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklySavingsEntry(index) {
  const week = getSelectedWeekData();
  week.savingsDeposits.splice(index, 1);
  queueActivity(`Removed weekly savings from ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addWeeklyGoalEntry() {
  const month = getSelectedMonthData();
  const week = getSelectedWeekData();
  const firstGoal = month.goals.find((goal) => !goal.completed) || month.goals[0];
  week.goals.push({ goalId: firstGoal ? firstGoal.id : "", name: firstGoal ? firstGoal.name : "", date: "", amount: "", notes: "" });
  queueActivity(`Added weekly goal contribution in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function updateWeeklyGoalEntry(index, field, value) {
  const month = getSelectedMonthData();
  const week = getSelectedWeekData();
  if (!week.goals[index]) {
    return;
  }

  if (field === "amount") {
    week.goals[index].amount = Number(value) || 0;
  } else if (field === "goalId") {
    const selectedGoal = month.goals.find((goal) => goal.id === value);
    week.goals[index].goalId = value;
    week.goals[index].name = selectedGoal ? selectedGoal.name : "";
  } else {
    week.goals[index][field] = value;
  }
  queueActivity(`Updated weekly goal contribution in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function removeWeeklyGoalEntry(index) {
  const week = getSelectedWeekData();
  week.goals.splice(index, 1);
  queueActivity(`Removed weekly goal contribution from ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function addWeeklyExpenseEntry() {
  const week = getSelectedWeekData();
  week.expenses.push({ name: "", date: "", amount: "", notes: "" });
  queueActivity(`Added weekly expense in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateWeeklyExpenseEntry(index, field, value) {
  const week = getSelectedWeekData();
  week.expenses[index][field] = ["amount"].includes(field) ? Number(value) || 0 : value;
  queueActivity(`Updated weekly expense in ${week.name}.`);
  saveState();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeWeeklyExpenseEntry(index) {
  const week = getSelectedWeekData();
  week.expenses.splice(index, 1);
  queueActivity(`Removed weekly expense from ${week.name}.`);
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

  const mainJob = getSourceIncome(month, "Main Job");
  const spark = getSourceIncome(month, "Walmart/Spark");
  const childSupport = getSourceIncome(month, "Child Support");
  const other = getOtherIncome(month);

  const entryRows = month.income.map((entry, index) => {
    const isSparkSource = /spark/i.test(entry.source || "");
    if (isSparkSource) {
      return `
        <div class="entry-card">
          <div class="entry-fields">
            <label>Source
              <input type="text" value="${escapeHtml(entry.source || "Walmart/Spark")}" disabled />
            </label>
            <label>Amount
              <input type="text" value="${escapeHtml(formatCurrency(spark))}" readonly />
            </label>
          </div>
          <p class="spark-note">Spark income is calculated from the Spark Tracker and cannot be edited here.</p>
        </div>
      `;
    }
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
          ${renderNotesToggle(entry.notes, `<textarea onchange="updateIncomeField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
        </div>
        <button class="ghost-button" onclick="removeIncomeRow(${index})">Remove</button>
      </div>
    `;
  }).join("");

  container.innerHTML = `
    <div class="dashboard-cards">
      <div class="card"><h4>Main Job</h4><p>${formatCurrency(mainJob)}</p></div>
      <div class="card"><h4>Child Support</h4><p>${formatCurrency(childSupport)}</p></div>
      <div class="card"><h4>Spark</h4><p>${formatCurrency(spark)}</p></div>
      <div class="card"><h4>Other Income</h4><p>${formatCurrency(other)}</p></div>
      <div class="card"><h4>Total Income</h4><p>${formatCurrency(getMonthlyIncome(month))}</p></div>
    </div>
    ${entryRows}
  `;
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
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateBillField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
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

  const colors = ["#d81b6b", "#7c3aed", "#0f766e", "#2563eb", "#f59e0b", "#dc2626", "#0891b2"];
  const lockCompletedGoals = Boolean(plannerState && plannerState.settings && plannerState.settings.lockCompletedGoals);

  function buildGoalCard(goal, realIndex) {
    const contributionAmount = getWeeklyGoalContributionTotal(month, goal);
    const totalSaved = getGoalCurrentAmount(month, goal);
    const progress = getGoalProgressForMonth(month, goal);
    const barColor = colors[realIndex % colors.length];
    const isLockedCompletedGoal = lockCompletedGoals && goal.completed;
    const disabledAttr = isLockedCompletedGoal ? "disabled" : "";
    return `
      <div class="entry-card${goal.completed ? " goal-completed" : ""}">
        <div class="entry-fields">
          <label>Goal Name
            <input type="text" value="${escapeHtml(goal.name || "")}" onchange="updateGoalField(${realIndex}, 'name', this.value)" ${disabledAttr} />
          </label>
          <label>Target Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(goal.targetAmount || "")}" onchange="updateGoalField(${realIndex}, 'targetAmount', this.value)" ${disabledAttr} />
          </label>
          <label>Current Amount
            <input type="number" min="0" step="0.01" value="${escapeHtml(totalSaved || "")}" onchange="updateGoalTotalAmount(${realIndex}, this.value)" ${disabledAttr} />
          </label>
          <label>Added from Weekly Contributions
            <input type="number" value="${escapeHtml(contributionAmount || "")}" readonly />
          </label>
          ${renderNotesToggle(goal.notes, `<textarea onchange="updateGoalField(${realIndex}, 'notes', this.value)" ${disabledAttr}>${escapeHtml(goal.notes || "")}</textarea>`)}
        </div>
        <div class="progress-block">
          <div class="progress-bar"><span style="width:${progress}%; background:${barColor};"></span></div>
          <p>${formatCurrency(totalSaved)} saved • ${progress}% complete</p>
          ${isLockedCompletedGoal ? '<p class="spark-note goal-locked-note">Completed goal is locked. Turn off Lock Completed Goals to edit.</p>' : ""}
        </div>
        <div class="goal-footer">
          <label class="checkbox-label">
            <input type="checkbox" ${goal.completed ? "checked" : ""} onchange="toggleGoalCompleted(${realIndex})" ${disabledAttr} />
            Mark as Done
          </label>
          <button class="ghost-button" onclick="removeGoal(${realIndex})" ${disabledAttr}>Remove</button>
        </div>
      </div>
    `;
  }

  const activeHtml = month.goals
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => !goal.completed)
    .map(({ goal, index }) => buildGoalCard(goal, index))
    .join("");

  const completedItems = month.goals
    .map((goal, index) => ({ goal, index }))
    .filter(({ goal }) => goal.completed);

  const completedHtml = completedItems.length
    ? `<div class="completed-goals-section">
        <h5>Completed Goals (${completedItems.length})</h5>
        ${completedItems.map(({ goal, index }) => buildGoalCard(goal, index)).join("")}
      </div>`
    : "";

  const lockControls = `
    <div class="goal-lock-row">
      <label class="checkbox-label">
        <input type="checkbox" ${lockCompletedGoals ? "checked" : ""} onchange="setLockCompletedGoals(this.checked)" />
        Lock Completed Goals
      </label>
      <p class="spark-note">When locked, completed goals stay visible but cannot be changed.</p>
    </div>
  `;

  container.innerHTML = lockControls + activeHtml + completedHtml;
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
          ${renderNotesToggle(entry.notes, `<textarea onchange="updateCarFundEntry(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
        </div>
        <button class="ghost-button" onclick="removeCarFundEntry(${index})">Remove</button>
      </div>
    `).join("")}
  `;
}

function renderSparkTrackerPage() {
  const container = document.getElementById("sparkTrackerArea");
  const cycle = getActiveCycle();
  const month = getSelectedMonthData();
  if (!container || !cycle || !month) {
    return;
  }

  container.innerHTML = `
    <h2>Spark Tracker</h2>
    <p>Choose the month, then add each shift. A shift's accepted date automatically counts its earnings in the matching budget week.</p>

    <div class="month-buttons">
      ${cycle.months.map((cycleMonth) => `
        <button class="${cycleMonth.name === activeMonthName ? "active" : ""}" onclick="openSparkMonth('${cycleMonth.name}')">${cycleMonth.name}</button>
      `).join("")}
    </div>

    <h3>${month.name} ${month.year}</h3>
    <p>Spark Received This Month: <span id="sparkMonthTotal">$0</span></p>

    <div class="month-tab-buttons">
      <button data-spark-section="shifts" class="${activeSparkSection === "shifts" ? "active" : ""}" onclick="showSparkTrackerTab('shifts')">Shifts</button>
      <button data-spark-section="tips" class="${activeSparkSection === "tips" ? "active" : ""}" onclick="showSparkTrackerTab('tips')">Tips</button>
    </div>

    <div id="sparkShiftActions" class="entry-actions">
      <button onclick="addSparkShift()">Add Spark Shift</button>
    </div>
    <div id="sparkArea"></div>
  `;

  renderSparkSection();
}

function openSparkMonth(monthName) {
  activeMonthName = monthName;
  activeWeeklyIndex = -1;
  plannerState.lastOpenedMonth = monthName;
  saveState();
  renderMonthButtons();
  renderMonthView();
  renderSparkTrackerPage();
  renderDashboard();
  renderReports();
}

function showSparkTrackerTab(section) {
  activeSparkSection = section;
  updateSparkTrackerTabUi();
}

function updateSparkTrackerTabUi() {
  document.querySelectorAll(".month-tab-buttons [data-spark-section]").forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-spark-section") === activeSparkSection);
  });

  const shiftActions = document.getElementById("sparkShiftActions");
  if (shiftActions) {
    shiftActions.classList.toggle("hidden", activeSparkSection !== "shifts");
  }

  document.querySelectorAll("#sparkArea > *").forEach((element) => {
    const isTipsPanel = element.classList.contains("spark-tips-panel");
    element.classList.toggle("hidden", activeSparkSection === "tips" ? !isTipsPanel : isTipsPanel);
  });
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
      <div class="card"><h4>Received Earnings</h4><p>${formatCurrency(summary.totalEarnings)}</p></div>
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

    <div class="report-card spark-tips-panel">
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
            ${renderNotesToggle(entry.notes, `<textarea onchange="updateSparkField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
          </div>
        `}
      </div>
    `).join("")}
  `;

  updateSparkTrackerTabUi();
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
        ${renderNotesToggle(entry.notes, `<textarea onchange="updateAssignmentField(${index}, 'notes', this.value)">${escapeHtml(entry.notes || "")}</textarea>`)}
      </div>
      <button class="ghost-button" onclick="removeAssignmentCategory(${index})">Remove</button>
    </div>
  `).join("");
}

function renderNotesSection() {
  const month = getSelectedMonthData();
  const textarea = document.getElementById("monthNotes");
  const monthNotesToggle = document.getElementById("monthNotesToggle");
  const monthNotesArchive = document.getElementById("monthNotesArchive");
  if (!textarea || !month) {
    return;
  }
  textarea.value = month.notes || "";
  if (monthNotesToggle) {
    monthNotesToggle.open = Boolean(String(month.notes || "").trim());
  }

  if (monthNotesArchive) {
    const archiveItems = Array.isArray(month.notesArchive) ? month.notesArchive : [];
    monthNotesArchive.innerHTML = archiveItems.length
      ? `
        <div class="report-card archived-notes-card">
          <h5>Archived Notes</h5>
          <ul class="archived-notes-list">
            ${archiveItems.map((item, index) => {
              const when = item.createdAt ? new Date(item.createdAt).toLocaleString("en-US") : "";
              return `
                <li>
                  <div>
                    <p>${escapeHtml(item.text || "")}</p>
                    <span>${escapeHtml(when)}</span>
                  </div>
                  <div class="entry-actions">
                    <button class="ghost-button" onclick="restoreArchivedNote(${index})">Use</button>
                    <button class="ghost-button" onclick="deleteArchivedNote(${index})">Delete</button>
                  </div>
                </li>
              `;
            }).join("")}
          </ul>
        </div>
      `
      : "<p class=\"spark-note\">No archived notes yet.</p>";
  }
}

function renderRecentActivity() {
  const container = document.getElementById("recentActivity");
  if (!container || !plannerState) {
    return;
  }

  const items = Array.isArray(plannerState.activityLog) ? plannerState.activityLog.slice(0, 10) : [];
  if (!items.length) {
    container.innerHTML = "<p class=\"spark-note\">No activity yet. Start editing your budget and entries will appear here.</p>";
    return;
  }

  container.innerHTML = `
    <ul class="activity-list">
      ${items.map((item) => {
        const when = item.createdAt ? new Date(item.createdAt).toLocaleString("en-US") : "";
        const monthLabel = item.month ? ` • ${escapeHtml(item.month)}` : "";
        return `<li><strong>${escapeHtml(item.message || "Updated budget")}</strong><span>${escapeHtml(when)}${monthLabel}</span></li>`;
      }).join("")}
    </ul>
  `;
}

function clearActivityLog() {
  if (!plannerState) {
    return;
  }
  plannerState.activityLog = [];
  pendingActivityMessage = "";
  saveState();
  renderRecentActivity();
}

function undoLastAction() {
  if (!undoStack.length) {
    const result = document.getElementById("recalculateCheckResult");
    if (result) {
      result.innerHTML = "<p class=\"spark-note\">No previous action is available to undo.</p>";
    }
    return;
  }

  const currentPage = document.querySelector(".main-navigation button.active")?.getAttribute("data-page") || "dashboard";
  const previous = undoStack.shift();
  isApplyingUndo = true;
  plannerState = normalizeState(cloneState(previous.state));
  ensureActiveCycle();
  activeCycleId = plannerState.currentCycleId;
  activeMonthName = plannerState.lastOpenedMonth || getCurrentMonthName();

  saveState();
  renderMonthButtons();
  renderMonthView();
  renderSparkTrackerPage();
  renderDashboard();
  renderHistory();
  renderReports();
  renderSettings();
  updateCycleTitle();
  showPage(currentPage);
}

function setLockCompletedGoals(checked) {
  plannerState.settings.lockCompletedGoals = Boolean(checked);
  queueActivity(plannerState.settings.lockCompletedGoals
    ? "Locked completed goals."
    : "Unlocked completed goals.");
  saveState();
  renderGoalsSection();
}

function archiveCurrentMonthNote() {
  const month = getSelectedMonthData();
  const noteText = String(month.notes || "").trim();
  if (!noteText) {
    return;
  }

  month.notesArchive = Array.isArray(month.notesArchive) ? month.notesArchive : [];
  month.notesArchive.unshift({
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text: noteText,
    createdAt: new Date().toISOString()
  });
  month.notesArchive = month.notesArchive.slice(0, 60);
  month.notes = "";

  queueActivity("Archived a monthly note.");
  saveState();
  renderNotesSection();
  renderDashboard();
}

function restoreArchivedNote(index) {
  const month = getSelectedMonthData();
  if (!Array.isArray(month.notesArchive) || !month.notesArchive[index]) {
    return;
  }

  month.notes = month.notesArchive[index].text || "";
  queueActivity("Restored an archived note to current notes.");
  saveState();
  renderNotesSection();
}

function deleteArchivedNote(index) {
  const month = getSelectedMonthData();
  if (!Array.isArray(month.notesArchive) || !month.notesArchive[index]) {
    return;
  }

  month.notesArchive.splice(index, 1);
  queueActivity("Deleted an archived note.");
  saveState();
  renderNotesSection();
}

function runRecalculateCheck() {
  const result = document.getElementById("recalculateCheckResult");
  const month = getSelectedMonthData();
  if (!result || !month) {
    return;
  }

  const warnings = [];
  const notes = [];

  const totalIncome = getMonthlyIncome(month);
  const totalBills = getMonthlyBills(month);
  const totalAssigned = getAssignmentSpend(month);
  const remaining = getRemainingAmount(month);
  const availableAfterBills = totalIncome - totalBills;

  if (totalAssigned > availableAfterBills) {
    warnings.push("Assigned money is higher than Income minus Bills.");
  }

  if (remaining < 0) {
    warnings.push("Remaining balance is negative. Check assignments, expenses, or goal contributions.");
  }

  if (hasWeeklyIncomeEntries(month)) {
    const weeklyIncome = getWeeklyIncomeTotal(month);
    const weeklyCategoryIncome = ensureWeekData(month).reduce((sum, week) => {
      return sum + (Number(week.homeHealthIncome) || 0) + (Number(week.childSupportIncome) || 0);
    }, 0);
    const weeklySparkIncome = ensureWeekData(month).reduce((sum, week) => sum + getWeeklySparkIncome(month, week), 0);
    const monthlyEntryIncome = (month.income || []).reduce((sum, entry) => {
      if (/spark/i.test(entry.source || "")) {
        return sum;
      }
      return sum + (Number(entry.amount) || 0);
    }, 0) + weeklySparkIncome + weeklyCategoryIncome;
    if (Math.abs(weeklyIncome - monthlyEntryIncome) > 0.01) {
      warnings.push("Monthly income total does not match weekly-tracked income total.");
    }

    const sparkReceivedIncome = getSparkSummary(month).totalEarnings;
    if (Math.abs(weeklySparkIncome - sparkReceivedIncome) > 0.01) {
      notes.push("Spark weekly-tracked income uses order payouts, which can differ from received Spark earnings if tips are still pending.");
    }

    const undatedIncome = (month.income || []).some((entry) => {
      const amount = Number(entry.amount) || 0;
      return amount > 0 && !/spark/i.test(entry.source || "") && !entry.date;
    });
    if (undatedIncome) {
      warnings.push("Some income entries have amounts but no date. In weekly mode, undated income is excluded.");
    }
  }

  if (hasWeeklyBillEntries(month)) {
    const weeklyBills = getWeeklyBillsTotal(month);
    const monthlyBills = (month.bills || []).reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
    if (Math.abs(weeklyBills - monthlyBills) > 0.01) {
      warnings.push("Monthly bills total does not match weekly-tracked bills total.");
    }
  }

  if (hasWeeklyGoalEntries(month)) {
    const unlinkedWeeklyGoals = ensureWeekData(month).some((week) => {
      return (week.goals || []).some((entry) => (Number(entry.amount) || 0) > 0 && !entry.goalId);
    });
    if (unlinkedWeeklyGoals) {
      warnings.push("Some weekly goal contributions are not linked to a monthly goal.");
    }
  }

  const overTargetGoals = (month.goals || []).filter((goal) => {
    const target = Number(goal.targetAmount) || 0;
    return target > 0 && getGoalCurrentAmount(month, goal) > target;
  });
  if (overTargetGoals.length) {
    notes.push(`${overTargetGoals.length} goal(s) are above target, which might be intentional.`);
  }

  const paidNoAmount = (month.bills || []).filter((bill) => bill.paid && (Number(bill.amount) || 0) <= 0).length;
  if (paidNoAmount > 0) {
    warnings.push(`${paidNoAmount} paid bill(s) have no amount entered.`);
  }

  if (!warnings.length && !notes.length) {
    result.innerHTML = "<p class=\"check-ok\">No issues found. Totals look consistent for this month.</p>";
  } else {
    result.innerHTML = `
      ${warnings.length ? `<p class="check-warning-title">Warnings</p><ul class="check-warning-list">${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${notes.length ? `<p class="check-note-title">Notes</p><ul class="check-note-list">${notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    `;
  }

  queueActivity(`Ran recalculation check (${warnings.length} warning${warnings.length === 1 ? "" : "s"}).`);
  saveState();
  renderRecentActivity();
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
  const dashboardGasTotal = document.getElementById("dashboardGasTotal");
  const dashboardSparkGas = document.getElementById("dashboardSparkGas");
  const dashboardExpenseGas = document.getElementById("dashboardExpenseGas");
  const dashboardGoalsTotal = document.getElementById("dashboardGoalsTotal");
  const dashboardGoalsRemaining = document.getElementById("dashboardGoalsRemaining");
  const dashboardSavingsTabTitle = document.getElementById("dashboardSavingsTabTitle");
  const dashboardSavingsTabTotal = document.getElementById("dashboardSavingsTabTotal");
  const dashboardSavingsTabRemaining = document.getElementById("dashboardSavingsTabRemaining");
  const homeHealthIncome = document.getElementById("homeHealthIncome");
  const sparkIncome = document.getElementById("sparkIncome");
  const childSupportIncome = document.getElementById("childSupportIncome");
  const dashboardGoalProgress = document.getElementById("dashboardGoalProgress");
  const healthScore = document.getElementById("healthScore");

  const goalsContributedAmount = getGoalsAmount(month);
  const goalsTargetAmount = (month.goals || []).reduce((sum, goal) => sum + (Number(goal.targetAmount) || 0), 0);
  const goalsRemainingAmount = Math.max(0, goalsTargetAmount - goalsContributedAmount);
  const savingsTabLabel = getCarFundLabel();
  const savingsTabContributedAmount = getCarFundTotal(month);
  const savingsTabTargetAmount = Number(month.carFundTargetAmount || 0);
  const savingsTabRemainingAmount = Math.max(0, savingsTabTargetAmount - savingsTabContributedAmount);

  if (dashboardIncome) dashboardIncome.textContent = formatCurrency(getMonthlyIncome(month));
  if (dashboardBills) dashboardBills.textContent = formatCurrency(getMonthlyBills(month));
  if (dashboardSavings) dashboardSavings.textContent = formatCurrency(getMonthlySavings(month));
  if (dashboardRemaining) dashboardRemaining.textContent = formatCurrency(getRemainingAmount(month));
  if (dashboardGasTotal) dashboardGasTotal.textContent = formatCurrency(getTotalGasSpend(month));
  if (dashboardSparkGas) dashboardSparkGas.textContent = formatCurrency(getSparkGasTotal(month));
  if (dashboardExpenseGas) dashboardExpenseGas.textContent = formatCurrency(getExpenseGasTotal(month));
  if (dashboardGoalsTotal) dashboardGoalsTotal.textContent = formatCurrency(goalsTargetAmount);
  if (dashboardGoalsRemaining) dashboardGoalsRemaining.textContent = formatCurrency(goalsRemainingAmount);
  if (dashboardSavingsTabTitle) dashboardSavingsTabTitle.textContent = savingsTabLabel;
  if (dashboardSavingsTabTotal) dashboardSavingsTabTotal.textContent = formatCurrency(savingsTabTargetAmount);
  if (dashboardSavingsTabRemaining) dashboardSavingsTabRemaining.textContent = formatCurrency(savingsTabRemainingAmount);
  if (homeHealthIncome) homeHealthIncome.textContent = formatCurrency(getSourceIncome(month, "Main Job"));
  if (sparkIncome) sparkIncome.textContent = formatCurrency(getSourceIncome(month, "Walmart/Spark"));
  if (childSupportIncome) childSupportIncome.textContent = formatCurrency(getSourceIncome(month, "Child Support"));

  if (dashboardGoalProgress) {
    dashboardGoalProgress.innerHTML = month.goals.map((goal) => `
      <div class="goal-row">
        <div class="goal-labels">
          <span>${escapeHtml(goal.name || "Goal")}</span>
          <span>${getGoalProgressForMonth(month, goal)}%</span>
        </div>
        <div class="progress-bar"><span style="width:${getGoalProgressForMonth(month, goal)}%"></span></div>
      </div>
    `).join("");
  }

  if (healthScore) {
    healthScore.textContent = `${getHealthScore(month)} / 100`;
  }

  renderRecentActivity();

  const checkResult = document.getElementById("recalculateCheckResult");
  if (checkResult && !checkResult.innerHTML.trim()) {
    checkResult.innerHTML = "<p class=\"spark-note\">Run Recalculate Check to scan this month for mismatches and missing links.</p>";
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
  const settingsLockCompletedGoals = document.getElementById("settingsLockCompletedGoals");
  const settingsCarFundLabel = document.getElementById("settingsCarFundLabel");
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

  if (settingsLockCompletedGoals) {
    settingsLockCompletedGoals.checked = Boolean(plannerState.settings.lockCompletedGoals);
  }

  if (settingsCarFundLabel) {
    settingsCarFundLabel.value = getCarFundLabel();
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
  queueActivity("Added monthly income row.");
  saveState();
  renderIncomeSection();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function updateIncomeField(index, field, value) {
  const month = getSelectedMonthData();
  const entry = month.income[index];
  if (!entry) {
    return;
  }
  if (/spark/i.test(entry.source || "")) {
    return; // Spark income is computed from Spark Tracker and cannot be edited here.
  }
  month.income[index][field] = field === "amount" ? Number(value) || 0 : value;
  queueActivity("Updated monthly income entry.");
  saveState();
  renderIncomeSection();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function removeIncomeRow(index) {
  const month = getSelectedMonthData();
  const entry = month.income[index];
  if (entry && /spark/i.test(entry.source || "")) {
    return; // Spark income row should stay and remain tracker-driven.
  }
  month.income.splice(index, 1);
  queueActivity("Removed monthly income row.");
  saveState();
  renderIncomeSection();
  renderWeeklyTracker();
  renderDashboard();
  renderReports();
}

function addBillRow() {
  getSelectedMonthData().bills.push({ name: "New Bill", dueDate: "", amount: "", paid: false, recurring: false, notes: "" });
  queueActivity("Added monthly bill.");
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
  queueActivity("Updated monthly bill.");
  saveState();
  renderDashboard();
  renderReports();
}

function removeBillRow(index) {
  getSelectedMonthData().bills.splice(index, 1);
  queueActivity("Removed monthly bill.");
  saveState();
  renderBillsSection();
  renderDashboard();
  renderReports();
}

function addGoal() {
  getSelectedMonthData().goals.push({ id: createGoalId(), name: "New Goal", targetAmount: 1000, currentAmount: 0, addedAmount: 0, completed: false, notes: "" });
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function updateGoalField(index, field, value) {
  const month = getSelectedMonthData();
  if (plannerState.settings.lockCompletedGoals && month.goals[index] && month.goals[index].completed) {
    return;
  }
  month.goals[index][field] = ["targetAmount", "currentAmount", "addedAmount"].includes(field) ? Number(value) || 0 : value;
  queueActivity("Updated monthly goal.");
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function updateGoalTotalAmount(index, value) {
  const month = getSelectedMonthData();
  const goal = month.goals[index];
  if (!goal) {
    return;
  }
  if (plannerState.settings.lockCompletedGoals && goal.completed) {
    return;
  }

  const desiredTotal = Number(value) || 0;
  const weeklyContribution = getWeeklyGoalContributionTotal(month, goal);
  goal.currentAmount = Math.max(0, desiredTotal - weeklyContribution);

  queueActivity("Updated monthly goal total amount.");
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function removeGoal(index) {
  const month = getSelectedMonthData();
  if (plannerState.settings.lockCompletedGoals && month.goals[index] && month.goals[index].completed) {
    return;
  }
  month.goals.splice(index, 1);
  queueActivity("Removed monthly goal.");
  saveState();
  renderGoalsSection();
  renderDashboard();
  renderReports();
}

function toggleGoalCompleted(index) {
  const month = getSelectedMonthData();
  if (!month.goals[index]) {
    return;
  }
  if (plannerState.settings.lockCompletedGoals && month.goals[index].completed) {
    return;
  }
  month.goals[index].completed = !month.goals[index].completed;
  queueActivity(month.goals[index].completed ? "Marked goal as done." : "Moved goal back to active.");
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
  queueActivity("Added Spark order.");
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
  queueActivity("Updated Spark order.");
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

  queueActivity("Added Spark tip entry.");
  saveState();
  renderSparkSection();
  renderIncomeSection();
  renderDashboard();
  renderReports();
}

function updateSparkTipEntry(index, field, value) {
  const month = getSelectedMonthData();
  month.sparkTips[index][field] = field === "amount" ? Number(value) || 0 : value;
  queueActivity("Updated Spark tip entry.");
  saveState();
  renderSparkSection();
  renderDashboard();
  renderReports();
}

function removeSparkTipEntry(index) {
  getSelectedMonthData().sparkTips.splice(index, 1);
  queueActivity("Removed Spark tip entry.");
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
  queueActivity("Added assignment category.");
  saveState();
  renderAssignmentSection();
  renderDashboard();
  renderReports();
}

function updateAssignmentField(index, field, value) {
  const month = getSelectedMonthData();
  month.assignmentCategories[index][field] = field === "amount" ? Number(value) || 0 : value;
  queueActivity("Updated assignment category.");
  saveState();
  renderAssignmentSection();
  renderDashboard();
  renderReports();
}

function removeAssignmentCategory(index) {
  getSelectedMonthData().assignmentCategories.splice(index, 1);
  queueActivity("Removed assignment category.");
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

function updateCarFundLabel(value) {
  plannerState.settings.carFundLabel = String(value || "");
  saveState();
  renderMonthView();
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
          resetUndoTracking();
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
  const nonSparkIncome = month.income.reduce((sum, entry) => {
    if (/spark/i.test(entry.source || "")) {
      return sum;
    }
    return sum + (Number(entry.amount) || 0);
  }, 0);
  return nonSparkIncome + getSparkSummary(month).totalEarnings;
}

function getMonthlyBills(month) {
  const weeklyBills = getWeeklyBillsTotal(month);
  if (hasWeeklyBillEntries(month)) {
    return weeklyBills;
  }
  return month.bills.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getWeeklyPaidBillsTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => {
    return sum + (week.bills || []).reduce((weekSum, entry) => {
      if (!entry || !entry.paid) {
        return weekSum;
      }
      return weekSum + (Number(entry.amount) || 0);
    }, 0);
  }, 0);
}

function getMonthlyPaidBills(month) {
  if (hasWeeklyBillEntries(month)) {
    return getWeeklyPaidBillsTotal(month);
  }
  return (month.bills || []).reduce((sum, entry) => {
    if (!entry || !entry.paid) {
      return sum;
    }
    return sum + (Number(entry.amount) || 0);
  }, 0);
}

function getSourceIncome(month, source) {
  if ((source || "").toLowerCase().includes("spark")) {
    if (hasWeeklyIncomeEntries(month)) {
      return ensureWeekData(month).reduce((sum, week) => sum + getWeeklySparkIncome(month, week), 0);
    }
    return getSparkSummary(month).totalEarnings;
  }

  if (hasWeeklyIncomeEntries(month)) {
    return ensureWeekData(month).reduce((sum, week) => sum + getWeekIncomeBySource(month, week, source), 0);
  }

  return month.income
    .filter((entry) => sourceMatchesCategory(entry.source, source))
    .reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getMonthlySavings(month) {
  return getWeeklySavingsTotal(month);
}

function getAssignmentSpend(month) {
  return month.assignmentCategories.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getSparkGasTotal(month) {
  return (month.spark || []).reduce((sum, entry) => sum + (Number(entry.gasExpense) || 0), 0);
}

function getExpenseGasTotal(month) {
  return ensureWeekData(month).reduce((sum, week) => {
    return sum + (week.expenses || []).reduce((weekSum, entry) => {
      if (!entry || !/gas/i.test(String(entry.name || "").trim())) {
        return weekSum;
      }
      return weekSum + (Number(entry.amount) || 0);
    }, 0);
  }, 0);
}

function getTotalGasSpend(month) {
  return getSparkGasTotal(month) + getExpenseGasTotal(month);
}

function getSparkOtherExpenseTotal(month) {
  return (month.spark || []).reduce((sum, entry) => sum + (Number(entry.otherExpense) || 0), 0);
}

function getStartingBankBalance(month) {
  return Number((month.bankSync && month.bankSync.startingBalance) || 0);
}

function getReconciliationAdjustment(month) {
  return Number((month.bankSync && month.bankSync.reconciliationAdjustment) || 0);
}

function getRemainingAmount(month) {
  const actualSavings = hasWeeklySavingsEntries(month) ? getWeeklySavingsTotal(month) : 0;
  const goalContributions = hasWeeklyGoalEntries(month)
    ? getWeeklyGoalContributionsTotal(month)
    : month.goals.reduce((sum, goal) => sum + (Number(goal.currentAmount) || 0), 0);
  return getMonthlyIncome(month)
    - getMonthlyPaidBills(month)
    - getWeeklyExpensesTotal(month)
    - actualSavings
    - goalContributions
    - getSparkGasTotal(month)
    - getSparkOtherExpenseTotal(month)
    + getStartingBankBalance(month)
    + getReconciliationAdjustment(month);
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
  if (!target) {
    return 0;
  }
  return Math.min(100, Math.round(getGoalCurrentAmount(month, goal) / target * 100));
}

function getGoalCurrentAmount(month, goal) {
  return (Number(goal.currentAmount) || 0) + getWeeklyGoalContributionTotal(month, goal);
}

function getGoalProgressValue(month) {
  if (!month.goals.length) {
    return 0;
  }
  return Math.round(month.goals.reduce((sum, goal) => sum + getGoalProgressForMonth(month, goal), 0) / month.goals.length);
}

function getGoalsAmount(month) {
  return month.goals.reduce((sum, goal) => sum + getGoalCurrentAmount(month, goal), 0);
}

function getCarFundTotal(month) {
  return month.carFund.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
}

function getHealthScore(month) {
  const paidBills = month.bills.filter((bill) => bill.paid).length;
  const paidRatio = month.bills.length ? paidBills / month.bills.length : 0;
  const savingsRatio = getMonthlyIncome(month) > 0 ? Math.min(1, getMonthlySavings(month) / getMonthlyIncome(month)) : 0;
  const goalsRatio = month.goals.length ? month.goals.filter((goal) => getGoalProgressForMonth(month, goal) >= 100).length / month.goals.length : 0;
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
  return getMonthlyIncome(month) - getMonthlyBills(month);
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
    drawBarChart(sparkCanvas, cycle.months.map((month) => abbreviateMonthLabel(month.name)), sparkTotals, ["#ec4899"]);
  }
}

function abbreviateMonthLabel(label) {
  const text = String(label || "").trim();
  if (!text) {
    return "";
  }
  return text.slice(0, 3);
}

function drawBarChart(canvas, labels, values, colors) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const clientWidth = Math.max(220, Math.round(canvas.clientWidth || 260));
  const clientHeight = Math.max(170, Math.round(canvas.clientHeight || 180));
  canvas.width = Math.floor(clientWidth * dpr);
  canvas.height = Math.floor(clientHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const width = clientWidth;
  const height = clientHeight;
  context.clearRect(0, 0, width, height);

  const series = Array.isArray(values) && values.length ? values : [0];
  const maxValue = Math.max(...series, 1);
  const count = Math.max(series.length, 1);

  const paddingTop = 22;
  const paddingBottom = 36;
  const paddingX = 20;
  const innerWidth = Math.max(1, width - paddingX * 2);
  const innerHeight = Math.max(1, height - paddingTop - paddingBottom);
  const slotWidth = innerWidth / count;
  const barWidth = Math.min(44, Math.max(18, slotWidth * 0.6));

  context.strokeStyle = "rgba(17, 24, 39, 0.25)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(paddingX, height - paddingBottom + 0.5);
  context.lineTo(width - paddingX, height - paddingBottom + 0.5);
  context.stroke();

  series.forEach((rawValue, index) => {
    const value = Number(rawValue) || 0;
    const barHeight = Math.max(0, (value / maxValue) * innerHeight);
    const centerX = paddingX + slotWidth * index + slotWidth / 2;
    const x = centerX - barWidth / 2;
    const y = height - paddingBottom - barHeight;

    context.fillStyle = colors[index] || colors[0] || "#ec4899";
    context.fillRect(x, y, barWidth, barHeight);

    context.fillStyle = "#111827";
    context.font = "11px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(formatCompactCurrency(value), centerX, Math.max(12, y - 2));

    context.textBaseline = "alphabetic";
    context.fillText(labels[index] || "", centerX, height - 12);
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

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
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

function renderNotesToggle(noteValue, textareaHtml, summaryLabel = "Add Note") {
  const hasNote = Boolean(String(noteValue || "").trim());
  return `
    <details class="note-toggle" ${hasNote ? "open" : ""}>
      <summary class="note-toggle-summary">${escapeHtml(summaryLabel)}</summary>
      ${textareaHtml}
    </details>
  `;
}

window.showPage = showPage;
window.openMonth = openMonth;
window.showMonthSection = showMonthSection;
window.openSparkMonth = openSparkMonth;
window.showSparkTrackerTab = showSparkTrackerTab;
window.addIncomeRow = addIncomeRow;
window.updateIncomeField = updateIncomeField;
window.removeIncomeRow = removeIncomeRow;
window.addBillRow = addBillRow;
window.updateBillField = updateBillField;
window.removeBillRow = removeBillRow;
window.addGoal = addGoal;
window.updateGoalField = updateGoalField;
window.updateGoalTotalAmount = updateGoalTotalAmount;
window.removeGoal = removeGoal;
window.toggleGoalCompleted = toggleGoalCompleted;
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
window.updateBankSyncField = updateBankSyncField;
window.applyBankSyncDifference = applyBankSyncDifference;
window.clearBankSyncAdjustment = clearBankSyncAdjustment;
window.updateMonthNotes = updateMonthNotes;
window.addPriority = addPriority;
window.updatePriority = updatePriority;
window.removePriority = removePriority;
window.updateDefaultCategories = updateDefaultCategories;
window.updateCarFundLabel = updateCarFundLabel;
window.exportBudget = exportBudget;
window.openImport = openImport;
window.setThemeMode = setThemeMode;
window.setAccentColor = setAccentColor;
window.setBackgroundStyle = setBackgroundStyle;
window.setBackgroundColor = setBackgroundColor;
window.setPatternColor = setPatternColor;
window.setPanelColor = setPanelColor;
window.setTabColor = setTabColor;
window.setCardOpacity = setCardOpacity;
window.resetTheme = resetTheme;
window.scrollToTop = scrollToTop;
window.handleAuthSubmit = handleAuthSubmit;
window.openAuthPage = openAuthPage;
window.showWelcomePage = showWelcomePage;
window.handleSignOut = handleSignOut;
window.runRecalculateCheck = runRecalculateCheck;
window.clearActivityLog = clearActivityLog;
window.undoLastAction = undoLastAction;
window.setLockCompletedGoals = setLockCompletedGoals;
window.archiveCurrentMonthNote = archiveCurrentMonthNote;
window.restoreArchivedNote = restoreArchivedNote;
window.deleteArchivedNote = deleteArchivedNote;

document.addEventListener("DOMContentLoaded", initializeAuth);