(() => {

const TRANSACTION_TYPES = Object.freeze({
  PMT: {
    label: "Regular Payment",
    affectsPrincipal: true,
    affectsInterest: true
  },
  DEF: {
    label: "Deferral",
    affectsPrincipal: false,
    affectsInterest: true
  },
  MISS: {
    label: "Missed Payment",
    affectsPrincipal: false,
    affectsInterest: true
  },
  XTRA: {
    label: "Extra Payment",
    affectsPrincipal: true,
    affectsInterest: false
  }
});


const frequency = document.getElementById('frequency');
const frequencyExtras = document.createElement('div');
frequencyExtras.id = 'frequency-extras';

// Insert the extras div after the frequency select's parent div
frequency.closest('div').insertAdjacentElement('afterend', frequencyExtras);

frequency.addEventListener('change', updateFrequencyExtras);
updateFrequencyExtras(); // run on load in case of a default selection

function updateFrequencyExtras() {
    const val = frequency.value;
    frequencyExtras.innerHTML = '';

    if (val === 'semimonthly') {
        frequencyExtras.innerHTML = `
            <div>
                <label>First Payment Day:</label>
                <select id="firstPayDay">
                    ${dayOptions(1, 30)}
                </select>
            </div>
            <div>
                <label>Second Payment Day:</label>
                <select id="secondPayDay">
                    ${dayOptions(1, 30)}
                    <option value="last">Last Day</option>
                </select>
            </div>
        `;
    } else if (val === 'monthly') {
        frequencyExtras.innerHTML = `
            <div>
                <label>Payment Day:</label>
                <select id="monthlyPayDay">
                    ${dayOptions(1, 30)}
                    <option value="last">Last Day</option>
                </select>
            </div>
        `;
    }
}

function dayOptions(start, end) {
    let options = '';
    for (let i = start; i <= end; i++) {
        options += `<option value="${i}">${i}</option>`;
    }
    return options;
}




/*

Transaction table

| Transaction Date | Transaction Number | Transaction Code | Amount | New Per Diem | Interest Amount | Addon Amount | Principal Amount | Past Due Interest | Past Due Addons | Past Due NSF | Total Interest Paid To Date | Total Addon Paid To Date | Total Principal Paid To Date |
|------------------|--------------------|------------------|--------|--------------|-----------------|--------------|------------------|-------------------|-----------------|--------------|-----------------------------|--------------------------|------------------------------|


*/

const TABLE_HEADERS = Object.freeze({
  tranDate: { label: "Transaction Date" },
  tranNum: { label: "Transaction Number" },
  tranCode: { label: "Transaction Code" },
  tranAmount: { label: "Transaction Amount" },
  perdiem: { label: "Per Diem" },
  interestAmount: { label: "Interest Amount" },
  addonAmount: { label: "Addon Amount" },
  principalAmount: { label: "Principal Amount" },
  newPrincipalBalance: { label: "New Principal Balance" },
  pastInterestDue: { label: "Past Due Interest" },
  pastAddonDue: { label: "Past Due Addons" },
  pastNSFDue: { label: "Past Due NSF" },
  totalInterestPaid: { label: "Total Interest Paid to Date" },
  totalAddonPaid: { label: "Total Addon Paid to Date" },
  totalPrincipalPaid: { label: "Total Principal Paid to Date" }
});

var columnState = {
  tranDate: true,
  tranNum: true,
  tranCode: true,
  newPrincipalBalance: true,
  tranAmount: true,
  perdiem: true,
  interestAmount: true,
  addonAmount: true,
  principalAmount: true,
  pastInterestDue: true,
  pastAddonDue: true,
  pastNSFDue: true,
  totalInterestPaid: true,
  totalAddonPaid: true,
  totalPrincipalPaid: true
};


/**
 * generateSchedule
 * 
 * @param {number} principal        - Original loan amount
 * @param {number} apr              - Annual Percentage Rate (e.g. 6.5 for 6.5%)
 * @param {number} payment          - Regular payment amount
 * @param {number} addonPerPayment  - Addon fee charged each period
 * @param {string} fundingDate      - ISO date string (YYYY-MM-DD)
 * @param {string} firstPaymentDate - ISO date string (YYYY-MM-DD)
 * @param {string} frequency        - "weekly" | "biweekly" | "semimonthly" | "monthly"
 * @param {Array}  transactions     - Optional override transactions [{date, type, amount}]
 * @returns {Array} schedule rows
 */
function generateSchedule(
  principal,
  apr,
  payment,
  addonPerPayment,
  fundingDate,
  firstPaymentDate,
  frequency,
  transactions = []
) {
  const schedule = [];

  // ── State ──────────────────────────────────────────────────────────────────
  let balance          = principal;
  let pastInterestDue  = 0;
  let pastAddonDue     = 0;
  let pastNSFDue       = 0;
  let totalInterestPaid = 0;
  let totalAddonPaid    = 0;
  let totalPrincipalPaid = 0;
  let tranNum           = 1;

  // ── Helpers ────────────────────────────────────────────────────────────────

  // Daily interest rate
  const dailyRate = (apr / 100) / 365;

  // Days between two ISO date strings
  function daysBetween(dateA, dateB) {
    const msPerDay = 86400000;
    return Math.round((new Date(dateB) - new Date(dateA)) / msPerDay);
  }

  // Advance a date by N days, return ISO string
  function addDays(dateStr, n) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  }

  // Given a date, return the next scheduled payment date
  function nextPaymentDate(currentDate, freq) {
    const d = new Date(currentDate);
    switch (freq) {
      case "weekly":
        return addDays(currentDate, 7);
      case "biweekly":
        return addDays(currentDate, 14);
      case "monthly": {
        const next = new Date(d);
        next.setMonth(next.getMonth() + 1);
        return next.toISOString().split("T")[0];
      }
      case "semimonthly": {
        // Alternate between +15 days and end of month alignment
        const next = new Date(d);
        next.setDate(next.getDate() + 15);
        return next.toISOString().split("T")[0];
      }
      default:
        return addDays(currentDate, 30);
    }
  }

  // Apply a cash amount to buckets in order: addon -> nsf -> interest -> principal
  // Returns an object describing how much went to each bucket
  function applyPayment(amount, interestDue, type) {
    let remaining = amount;
    const applied = {
      addonPaid:     0,
      nsfPaid:       0,
      interestPaid:  0,
      principalPaid: 0,
    };

    // 1. Past due addon
    const toAddon = Math.min(remaining, pastAddonDue);
    applied.addonPaid  += toAddon;
    pastAddonDue       -= toAddon;
    remaining          -= toAddon;

    // 2. Past due NSF
    const toNSF = Math.min(remaining, pastNSFDue);
    applied.nsfPaid  += toNSF;
    pastNSFDue       -= toNSF;
    remaining        -= toNSF;

    // 3. Current period addon (only on regular payments)
    if (type === "PMT" && remaining > 0) {
      const toCurrentAddon = Math.min(remaining, addonPerPayment);
      applied.addonPaid += toCurrentAddon;
      remaining         -= toCurrentAddon;
    }

    // 4. Past due interest
    const toPastInterest = Math.min(remaining, pastInterestDue);
    applied.interestPaid += toPastInterest;
    pastInterestDue      -= toPastInterest;
    remaining            -= toPastInterest;

    // 5. Current period interest
    const toInterest = Math.min(remaining, interestDue);
    applied.interestPaid += toInterest;
    remaining            -= toInterest;

    // 6. Principal (only for PMT and XTRA)
    if (type === "PMT" || type === "XTRA") {
      const toPrincipal = Math.min(remaining, balance);
      applied.principalPaid += toPrincipal;
      balance               -= toPrincipal;
      remaining             -= toPrincipal;
    }

    return applied;
  }

  // ── Build a merged, sorted list of events ─────────────────────────────────
  // Start with generated payment dates, then overlay any manual transactions
  const paymentDates = [];
  let cursor = firstPaymentDate;

  // Safety cap — max 1200 payments (100 years of monthly)
  for (let i = 0; i < 1200; i++) {
    paymentDates.push({ date: cursor, type: "PMT", amount: payment });
    cursor = nextPaymentDate(cursor, frequency);
    // Stop generating future dates once we've gone way past a reasonable term
    if (i > 10 && new Date(cursor) > new Date(addDays(firstPaymentDate, 365 * 50))) break;
  }

  // Merge manual transactions, replacing or inserting as needed
  // Manual transactions take priority over generated ones on the same date
  const transactionMap = new Map();
  for (const p of paymentDates) {
    transactionMap.set(p.date, { ...p });
  }
  for (const t of transactions) {
    // Manual entries override or add
    transactionMap.set(t.date, { date: t.date, type: t.type, amount: t.amount });
  }

  // Sort all events chronologically
  const allEvents = [...transactionMap.values()].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  );

  // ── Process each event ────────────────────────────────────────────────────
  let prevDate = fundingDate;

  for (const event of allEvents) {
    if (balance <= 0.005) break; // loan paid off

    const { date, type, amount } = event;
    const days = daysBetween(prevDate, date);

    // Per diem and interest accrued since last transaction
    const perdiem     = parseFloat((balance * dailyRate).toFixed(6));
    const interestDue = parseFloat((perdiem * days).toFixed(2));

    let applied = {
      addonPaid:     0,
      nsfPaid:       0,
      interestPaid:  0,
      principalPaid: 0,
    };

    if (type === "PMT") {
      applied = applyPayment(amount, interestDue, "PMT");

      // If payment didn't cover full interest, the shortfall becomes past due
      const interestShortfall = interestDue - applied.interestPaid;
      if (interestShortfall > 0.005) pastInterestDue += interestShortfall;

      // If payment didn't cover addon, shortfall becomes past due
      const addonShortfall = addonPerPayment - Math.max(0, applied.addonPaid - pastAddonDue);
      if (addonShortfall > 0.005) pastAddonDue += addonShortfall;

    } else if (type === "DEF" || type === "MISS") {
      // No payment — interest and addon accrue as past due
      pastInterestDue += interestDue;
      pastAddonDue    += addonPerPayment;

    } else if (type === "XTRA") {
      applied = applyPayment(amount, 0, "XTRA"); // extra goes straight to principal
    }

    totalInterestPaid  += applied.interestPaid;
    totalAddonPaid     += applied.addonPaid;
    totalPrincipalPaid += applied.principalPaid;
const actuallyUsed = parseFloat(
      (applied.addonPaid + applied.nsfPaid + applied.interestPaid + applied.principalPaid).toFixed(2)
    );

    schedule.push({
      tranDate:            date,
      tranNum:             tranNum++,
      tranCode:            type,
      tranAmount:          type === "MISS" || type === "DEF"
                             ? 0
                             : (balance <= 0.005 ? actuallyUsed : parseFloat(amount.toFixed(2))),
      perdiem:             perdiem,
      interestAmount:      parseFloat(interestDue.toFixed(2)),
      addonAmount:         parseFloat(applied.addonPaid.toFixed(2)),
      principalAmount:     parseFloat(applied.principalPaid.toFixed(2)),
      pastInterestDue:     parseFloat(pastInterestDue.toFixed(2)),
      pastAddonDue:        parseFloat(pastAddonDue.toFixed(2)),
      pastNSFDue:          parseFloat(pastNSFDue.toFixed(2)),
      totalInterestPaid:   parseFloat(totalInterestPaid.toFixed(2)),
      totalAddonPaid:      parseFloat(totalAddonPaid.toFixed(2)),
      totalPrincipalPaid:  parseFloat(totalPrincipalPaid.toFixed(2)),
      newPrincipalBalance: parseFloat(balance.toFixed(2)),
    });

    prevDate = date;
  }

  return schedule;
}

var lastSchedule = [];

document.getElementById("calcBtn").addEventListener("click", () => {
    const principal = parseFloat(document.getElementById("principal").value);
    const APR = parseFloat(document.getElementById("rate").value);
    const payment = parseFloat(document.getElementById("payment").value);
    const fundingDate = document.getElementById("fundingDate").value;
    const addonAmount = parseFloat(document.getElementById("addon").value);
    const firstPayment = document.getElementById("firstPayDate").value;
    if(frequency=="semimonthly"){
        const firstMonthPayDay = document.getElementById("firstPayDay");
        const secondMonthPayDay = document.getElementById("secondPayDay");
        if(firstPayment.getDay() == firstMonthPayDay){
            var schedule = generateSchedule(principal, APR, payment, addonAmount, fundingDate, firstPayment, secondMonthPayDay);
        } else {
            var schedule = generateSchedule(principal, APR, payment, addonAmount, fundingDate, firstPayment, firstMonthPayDay);
        }
    } else {
        var schedule = generateSchedule(principal, APR, payment, addonAmount, fundingDate, firstPayment);
    }

    
    
    lastSchedule = schedule; // save it
    
    const tableContainer = document.getElementById("tableContainer");
    tableContainer.innerHTML = "";
    tableContainer.appendChild(renderTable(schedule));

    //principal * (rate * Math.pow(1 + rate, years)) / (Math.pow(1 + rate, years) - 1);
});

// Build the checkbox panel from TABLE_HEADERS
function buildColPanel() {
  const container = document.getElementById("colCheckboxes");
  container.innerHTML = "";

  for (const key of Object.keys(TABLE_HEADERS)) {
    const label = document.createElement("label");
    label.style.cssText = "display:flex; align-items:center; gap:8px; font-weight:400; cursor:pointer;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = columnState[key];
    cb.dataset.key = key;
    cb.style.cssText = "width:16px; height:16px; cursor:pointer;";

    cb.addEventListener("change", () => {
      columnState[key] = cb.checked;
      // Ensure at least one column stays visible
      const anyActive = Object.values(columnState).some(Boolean);
      if (!anyActive) {
        cb.checked = true;
        columnState[key] = true;
        return;
      }
      rerenderTable();
    });

    label.appendChild(cb);
    label.appendChild(document.createTextNode(TABLE_HEADERS[key].label));
    container.appendChild(label);
  }
}

function toggleColPanel() {
  const panel = document.getElementById("colPanel");
  const isHidden = panel.style.display === "none";
  panel.style.display = isHidden ? "block" : "none";
  if (isHidden) buildColPanel(); // rebuild each time so it reflects current state
}

function selectAllCols(checked) {
  for (const key of Object.keys(columnState)) {
    columnState[key] = checked;
  }
  // If deselecting all, force first column back on
  if (!checked) columnState[Object.keys(columnState)[0]] = true;
  buildColPanel();     // update checkboxes
  rerenderTable();     // update table
}


// ===============================
// TABLE GENERATION CODE
// ===============================

const columnOrder = Object.keys(TABLE_HEADERS);

function buildTableHeader(tableElement) {
  const thead = document.createElement("thead");
  const row = document.createElement("tr");

  for (const key of columnOrder) {
    if (!columnState[key]) continue;

    const th = document.createElement("th");
    th.textContent = TABLE_HEADERS[key].label;

    th.draggable = true;
    th.dataset.key = key;

    addDragEvents(th);

    row.appendChild(th);
  }

  thead.appendChild(row);
  tableElement.appendChild(thead);
}

let draggedKey = null;

function addDragEvents(th) {
  th.addEventListener("dragstart", (e) => {
    draggedKey = th.dataset.key;
  });

  th.addEventListener("dragover", (e) => {
    e.preventDefault();
  });

  th.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetKey = th.dataset.key;

    reorderColumns(draggedKey, targetKey);
    rerenderTable(); // your render function
  });
}

function reorderColumns(dragKey, targetKey) {
  const dragIndex = columnOrder.indexOf(dragKey);
  const targetIndex = columnOrder.indexOf(targetKey);

  columnOrder.splice(dragIndex, 1);
  columnOrder.splice(targetIndex, 0, dragKey);
}

function buildTableBody(tableElement, data) {
  const tbody = document.createElement("tbody");

  for (const record of data) {
    const row = document.createElement("tr");

    for (const key of columnOrder) {        // <-- was Object.keys(TABLE_HEADERS)
      if (columnState[key]) {
        const td = document.createElement("td");
        td.textContent = record[key] ?? "";
        row.appendChild(td);
      }
    }

    tbody.appendChild(row);
  }

  tableElement.appendChild(tbody);
}

function renderTable(data) {
  const table = document.createElement("table");
  table.classList.add("amort-table");

  buildTableHeader(table);
  buildTableBody(table, data);

  return table;
}

function rerenderTable() {
  const tableContainer = document.getElementById("tableContainer");
  tableContainer.innerHTML = "";
  tableContainer.appendChild(renderTable(lastSchedule));
}

})();
