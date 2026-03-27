const LOW_STOCK_THRESHOLD = 5;
const API_BASE = (() => {
  const { protocol, hostname, port } = window.location;
  if (protocol === "file:") {
    return "http://localhost:4000/api";
  }
  const origin = port ? `${protocol}//${hostname}:${port}` : window.location.origin;
  return `${origin}/api`;
})();

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  // include token for protected auth and API routes
  // The backend expects /api/... routes, but API_BASE already has /api.
  // Public routes: /api/health, /api/auth/register, /api/auth/login
  const publicPaths = ["/health", "/auth/register", "/auth/login"];
  const needsAuth = !publicPaths.includes(path);
  
  if (needsAuth) {
    const token = sessionStorage.getItem("authToken");
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

function formatMoney(n) {
  return "₹" + Number(n).toFixed(2);
}

function formatDateTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString("hi-IN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function calculateLineTotal(price, qty) {
  return price * qty;
}

const state = {
  items: [],
  /** @type {{ itemId: number, qty: number, unit: string }[]} */
  cart: [],
  customers: [],
};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + (type || "");
  el.hidden = !text;
  if (text) {
    clearTimeout(showMsg._t);
    showMsg._t = setTimeout(() => {
      el.hidden = true;
      el.textContent = "";
    }, 4000);
  }
}

async function renderTodaySales(date = "now") {
  const el = $("#today-sales-summary");
  if (!el) return;
  try {
    const summary = await api(`/sales/today?date=${date}`);
    const bills = Number(summary.bills || 0);
    const rupees = Number(summary.total || 0);
    if (!bills) {
      el.textContent = "No completed sales on this date.";
      el.style.color = "var(--muted)";
      return;
    }
    el.innerHTML = `<strong style="color:var(--accent)">${bills}</strong> bill(s) · Total <strong style="color:var(--accent)">${formatMoney(
      rupees
    )}</strong>`;
    el.style.color = "var(--text)";
  } catch {
    el.textContent = "Could not load sales summary.";
    el.style.color = "var(--muted)";
  }
}

async function renderKhata() {
  const tbody = $("#khata-body");
  const empty = $("#khata-empty");
  if (!tbody) return;

  tbody.innerHTML = "";
  try {
    state.customers = await api("/customers");
    if (!state.customers.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    for (const cust of state.customers) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escapeHtml(cust.name)}</strong></td>
        <td>${cust.mobile || "-"}</td>
        <td style="text-align: right; font-weight: 600; color: ${cust.total_udhaar > 0 ? 'var(--warn)' : 'var(--accent)'}">
          ${formatMoney(cust.total_udhaar)}
        </td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 0.25rem; justify-content: center;">
            <button type="button" class="btn btn-sm btn-primary pay-udhaar" data-id="${cust.id}">Deposit</button>
            <button type="button" class="btn btn-sm btn-secondary view-history" data-id="${cust.id}">History</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll(".pay-udhaar").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const cust = state.customers.find(c => c.id === id);
        if (cust) showUdhaarPaymentModal(cust);
      });
    });

    tbody.querySelectorAll(".view-history").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const cust = state.customers.find(c => c.id === id);
        if (cust) showUdhaarHistoryModal(cust);
      });
    });
  } catch (error) {
    showMsg($("#khata-msg"), "Could not load credit accounts.", "error");
  }
}

function showUdhaarPaymentModal(cust) {
  const modal = $("#udhaar-payment-modal");
  $("#udhaar-cust-id").value = cust.id;
  $("#udhaar-cust-name").textContent = cust.name;
  $("#udhaar-cust-balance").textContent = formatMoney(cust.total_udhaar);
  $("#udhaar-pay-amount").value = "";
  $("#udhaar-pay-note").value = "";
  modal.hidden = false;
}

async function showUdhaarHistoryModal(cust) {
  const modal = $("#udhaar-history-modal");
  const tbody = $("#history-body");
  $("#history-cust-name").textContent = cust.name;
  tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>Loading...</td></tr>";
  modal.hidden = false;

  try {
    const transactions = await api(`/customers/${cust.id}/transactions`);
    tbody.innerHTML = "";
    if (!transactions.length) {
      tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;'>No transactions found.</td></tr>";
      return;
    }

    for (const tx of transactions) {
      const tr = document.createElement("tr");
      const isDebit = tx.type === 'debit';
      tr.innerHTML = `
        <td><small>${formatDateTime(tx.created_at)}</small></td>
        <td>
          <span class="badge ${isDebit ? 'warn' : 'success'}">
            ${isDebit ? 'Credit Taken' : 'Payment Made'}
          </span>
        </td>
        <td style="text-align: right; font-weight: 600;">${formatMoney(tx.amount)}</td>
        <td><small>${escapeHtml(tx.note || "-")}</small></td>
      `;
      tbody.appendChild(tr);
    }
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan='4' style='text-align:center; color:var(--warn);'>Error: ${error.message}</td></tr>`;
  }
}

function refreshCustomerSelectors() {
  const sel = $("#bill-customer-select");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select from list —</option>';
  for (const cust of state.customers) {
    const opt = document.createElement("option");
    opt.value = String(cust.id);
    opt.textContent = `${cust.name} ${cust.mobile ? `(${cust.mobile})` : ""}`;
    sel.appendChild(opt);
  }
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function initCustomerSearch() {
  const searchInput = $("#bill-customer-search");
  const dropdown = $("#bill-customer-dropdown");
  const hiddenInput = $("#bill-customer-id");
  const selectDropdown = $("#bill-customer-select");

  if (!searchInput || !dropdown || !hiddenInput || !selectDropdown) return;

  const renderDropdown = (filteredCustomers) => {
    dropdown.innerHTML = "";
    if (!filteredCustomers.length) {
      dropdown.hidden = true;
      return;
    }
    filteredCustomers.forEach(cust => {
      const item = document.createElement("div");
      item.className = "searchable-select-item";
      item.dataset.id = cust.id;
      item.dataset.name = cust.name;
      item.innerHTML = `<strong>${escapeHtml(cust.name)}</strong><small>${cust.mobile || ""}</small>`;
      item.addEventListener("click", () => {
        hiddenInput.value = cust.id;
        searchInput.value = cust.name;
        selectDropdown.value = cust.id; // Sync with select
        dropdown.hidden = true;
      });
      dropdown.appendChild(item);
    });
    dropdown.hidden = false;
  };

  // Sync select dropdown -> search input
  selectDropdown.addEventListener("change", () => {
    const id = selectDropdown.value;
    if (!id) {
      hiddenInput.value = "";
      searchInput.value = "";
      return;
    }
    const cust = state.customers.find(c => String(c.id) === id);
    if (cust) {
      hiddenInput.value = cust.id;
      searchInput.value = cust.name;
    }
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase();
    if (!query) {
      hiddenInput.value = "";
      selectDropdown.value = "";
      dropdown.hidden = true;
      return;
    }
    const filtered = state.customers.filter(c => 
      c.name.toLowerCase().includes(query) || 
      c.mobile?.includes(query)
    );
    renderDropdown(filtered);
  });

  searchInput.addEventListener("focus", () => {
    if (searchInput.value) {
      const filtered = state.customers.filter(c => c.name.toLowerCase().includes(searchInput.value.toLowerCase()));
      renderDropdown(filtered);
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".searchable-select-wrapper")) {
      dropdown.hidden = true;
    }
  });
}

async function initKhata() {
  $("#khata-add-customer-btn")?.addEventListener("click", () => {
    $("#customer-modal").hidden = false;
  });

  $("#add-customer-btn")?.addEventListener("click", () => {
    $("#customer-modal").hidden = false;
  });

  $("#customer-close-btn")?.addEventListener("click", () => {
    $("#customer-modal").hidden = true;
  });

  $("#add-customer-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#new-customer-name").value.trim();
    const mobile = $("#new-customer-mobile").value.trim();
    try {
      const created = await api("/customers", {
        method: "POST",
        body: JSON.stringify({ name, mobile })
      });
      state.customers.push(created);
      refreshCustomerSelectors();
      
      // Auto-select the newly created customer
      const searchInput = $("#bill-customer-search");
      const hiddenInput = $("#bill-customer-id");
      const selectDropdown = $("#bill-customer-select");
      if (searchInput && hiddenInput && selectDropdown) {
        searchInput.value = created.name;
        hiddenInput.value = created.id;
        selectDropdown.value = created.id;
      }

      if ($("#panel-khata").classList.contains("active")) renderKhata();
      $("#customer-modal").hidden = true;
      $("#add-customer-form").reset();
      showMsg($("#bill-msg") || $("#khata-msg"), "Customer added successfully.", "success");
    } catch (error) {
      showMsg($("#auth-msg"), error.message, "error");
    }
  });

  $("#udhaar-payment-close-btn")?.addEventListener("click", () => {
    $("#udhaar-payment-modal").hidden = true;
  });

  $("#udhaar-history-close-btn")?.addEventListener("click", () => {
    $("#udhaar-history-modal").hidden = true;
  });

  $("#udhaar-payment-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#udhaar-cust-id").value;
    const amount = parseFloat($("#udhaar-pay-amount").value);
    const method = $("#udhaar-pay-method").value;
    const note = $("#udhaar-pay-note").value.trim();

    const fullNote = method + (note ? `: ${note}` : "");

    try {
      await api(`/customers/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount, note: fullNote })
      });
      $("#udhaar-payment-modal").hidden = true;
      renderKhata();
      showMsg($("#khata-msg"), "Payment settled successfully.", "success");
    } catch (error) {
      showMsg($("#khata-msg"), error.message, "error");
    }
  });
}

async function renderTodayBills(date = "now") {
  const list = $("#bills-list");
  const empty = $("#bills-empty");
  if (!list) return;

  list.innerHTML = "";
  try {
    const bills = await api(`/sales/today/bills?date=${date}`);
    
    if (!bills.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    for (const bill of bills) {
      const div = document.createElement("div");
      div.className = "bill-card";
      const dateStr = formatDateTime(bill.soldAt);
      const itemCount = bill.lines.length;
      div.innerHTML = `
        <div class="bill-header">
          <div>
            <strong>Bill #${bill.saleId}</strong>
            <small>${dateStr}</small>
          </div>
          <div style="text-align: right">
            <div class="bill-amount">${formatMoney(bill.totalAmount)}</div>
            <div style="margin: 0.25rem 0;"><span class="badge ${bill.paymentMode === 'udhaar' ? 'warn' : 'success'}">${bill.paymentMode.toUpperCase()}</span></div>
            <small>${itemCount} item${itemCount !== 1 ? "s" : ""}</small>
          </div>
        </div>
        <div class="bill-actions">
          <button type="button" class="btn btn-sm btn-primary view-receipt" data-bill-id="${bill.saleId}">
            👁️ View Receipt
          </button>
        </div>
      `;
      list.appendChild(div);
    }

    list.querySelectorAll(".view-receipt").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const saleId = Number(btn.dataset.billId);
        await showReceipt(saleId);
      });
    });
  } catch (error) {
    showMsg($("#owner-msg") || $("#dash-msg"), error.message || "Could not load bills.", "error");
  }
}

async function showReceipt(saleId, autoPrint = false) {
  try {
    const bill = await api(`/sales/${saleId}/receipt`);
    const modal = $("#receipt-modal");
    const content = $("#receipt-content");
    const dateStr = formatDateTime(bill.soldAt);

    let html = `
      <div class="receipt-header">
        <h3>🛒 Grocery Shop</h3>
        <p>Receipt</p>
      </div>
      <div class="receipt-details">
        <p><strong>Bill #:</strong> ${bill.saleId}</p>
        <p><strong>Date & Time:</strong> ${dateStr}</p>
        <p><strong>Payment:</strong> <span class="badge ${bill.paymentMode === 'udhaar' ? 'warn' : 'success'}">${bill.paymentMode.toUpperCase()}</span></p>
      </div>
      <table class="receipt-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="text-align: center">Qty</th>
            <th style="text-align: right">Rate</th>
            <th style="text-align: right">Total</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const line of bill.lines) {
      html += `
        <tr>
          <td><strong>${escapeHtml(line.itemName)}</strong></td>
          <td style="text-align: center">${line.qty} ${escapeHtml(line.unit)}</td>
          <td style="text-align: right">${formatMoney(line.unitPrice)}</td>
          <td style="text-align: right">${formatMoney(line.lineTotal)}</td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
      <div class="receipt-total">
        <strong>Total:</strong>
        <strong>${formatMoney(bill.totalAmount)}</strong>
      </div>
      <div class="receipt-footer">
        <p>Thank you for your visit!</p>
      </div>
    `;

    content.innerHTML = html;
    modal.hidden = false;

    if (autoPrint) {
      setTimeout(() => {
        window.print();
      }, 100);
    }
  } catch (error) {
    // Show error on the current active panel's message area
    const activePanelId = $(".panel.active")?.id;
    const msgEl = activePanelId === "panel-billing" ? $("#bill-msg") : ($("#owner-msg") || $("#dash-msg"));
    showMsg(msgEl, error.message || "Could not load receipt.", "error");
  }
}

function initReceiptModal() {
  const modal = $("#receipt-modal");
  const closeBtn = $("#receipt-close-btn");
  const closeModalBtn = $("#receipt-close-modal-btn");

  closeBtn?.addEventListener("click", () => {
    modal.hidden = true;
  });

  closeModalBtn?.addEventListener("click", () => {
    modal.hidden = true;
  });

  $("#receipt-print-btn")?.addEventListener("click", () => {
    window.print();
  });
}

function renderStock() {
  const tbody = $("#stock-body");
  const empty = $("#stock-empty");
  if (!tbody) return;

  tbody.innerHTML = "";
  const items = [...state.items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  if (!items.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const it of items) {
    const low = it.stock <= LOW_STOCK_THRESHOLD;
    const tr = document.createElement("tr");
    if (low) tr.classList.add("low-stock");
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(it.name)}</strong>
        ${low ? '<span class="badge warn">Low</span>' : ""}
      </td>
      <td class="stock-cell" data-id="${it.id}">
        <div class="stock-edit">
          <span class="stock-display">${it.stock}</span>
          <input type="number" class="stock-input" min="0" step="0.01" value="${it.stock}" hidden style="width: 60px" />
          <button type="button" class="btn btn-sm btn-secondary edit-stock-btn">Edit</button>
        </div>
      </td>
      <td>${escapeHtml(it.unit)}</td>
      <td class="price-cell" data-id="${it.id}">
        <div class="price-edit">
          <span class="price-display">${formatMoney(it.price)}</span>
          <input type="number" class="price-input" min="0" step="0.01" value="${it.price}" hidden style="width: 80px" />
          <button type="button" class="btn btn-sm btn-secondary edit-price-btn">Edit</button>
        </div>
      </td>
      <td>
        <button type="button" class="btn btn-sm btn-danger del-item" data-id="${it.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".edit-stock-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cell = btn.closest(".stock-cell");
      const disp = cell.querySelector(".stock-display");
      const inp = cell.querySelector(".stock-input");
      const id = Number(cell.dataset.id);
      try {
        if (inp.hidden) {
          inp.hidden = false;
          disp.hidden = true;
          btn.textContent = "Save";
          inp.focus();
          inp.select();
        } else {
          const v = parseFloat(inp.value);
          if (Number.isNaN(v) || v < 0) {
            showMsg($("#dash-msg"), "Valid stock daaliye.", "error");
            return;
          }
          const updated = await api(`/items/${id}/stock`, {
            method: "PATCH",
            body: JSON.stringify({ stock: v }),
          });
          const item = state.items.find((x) => x.id === id);
          if (item) item.stock = Number(updated.stock);
          disp.textContent = updated.stock;
          inp.hidden = true;
          disp.hidden = false;
          btn.textContent = "Edit";
        }
        showMsg($("#dash-msg"), "Stock update ho gaya.", "success");
        refreshBillingSelectors();
        renderCart();
      } catch (error) {
        showMsg($("#dash-msg"), error.message || "Stock update fail hua.", "error");
      }
    });
  });

  tbody.querySelectorAll(".edit-price-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const cell = btn.closest(".price-cell");
      const disp = cell.querySelector(".price-display");
      const inp = cell.querySelector(".price-input");
      const id = Number(cell.dataset.id);
      try {
        if (inp.hidden) {
          inp.hidden = false;
          disp.hidden = true;
          btn.textContent = "Save";
          inp.focus();
          inp.select();
        } else {
          const v = parseFloat(inp.value);
          if (Number.isNaN(v) || v < 0) {
            showMsg($("#dash-msg"), "Valid price daaliye.", "error");
            return;
          }
          const updated = await api(`/items/${id}/price`, {
            method: "PATCH",
            body: JSON.stringify({ price: v }),
          });
          const item = state.items.find((x) => x.id === id);
          if (item) item.price = Number(updated.price);
          disp.textContent = formatMoney(updated.price);
          inp.hidden = true;
          disp.hidden = false;
          btn.textContent = "Edit";
        }
        showMsg($("#dash-msg"), "Price update ho gayi.", "success");
        refreshBillingSelectors();
        renderCart();
      } catch (error) {
        showMsg($("#dash-msg"), error.message || "Price update fail hua.", "error");
      }
    });
  });

  tbody.querySelectorAll(".del-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      if (!confirm("Ye item hata dena hai?")) return;
      try {
        await api(`/items/${id}`, { method: "DELETE" });
        state.items = state.items.filter((x) => x.id !== id);
        state.cart = state.cart.filter((l) => l.itemId !== id);
        renderStock();
        renderCart();
        refreshBillingSelectors();
        showMsg($("#dash-msg"), "Item delete ho gaya.", "success");
      } catch (error) {
        showMsg($("#dash-msg"), error.message || "Item delete fail hua.", "error");
      }
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function refreshBillingSelectors() {
  const sel = $("#bill-item-select");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select Item —</option>';
  for (const it of [...state.items].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )) {
    const opt = document.createElement("option");
    opt.value = String(it.id);
    opt.textContent = `${it.name} (${formatMoney(it.price)}/${it.unit}, stock ${it.stock})`;
    sel.appendChild(opt);
  }
  if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function renderCart() {
  const list = $("#bill-lines");
  const empty = $("#bill-empty");
  const totalEl = $("#bill-total");
  if (!list || !totalEl) return;

  list.innerHTML = "";
  let total = 0;

  if (!state.cart.length) {
    empty.hidden = false;
    totalEl.textContent = formatMoney(0);
    return;
  }
  empty.hidden = true;

  state.cart.forEach((line, idx) => {
    const it = state.items.find((x) => x.id === line.itemId);
    if (!it) return;

    let baseQty = line.qty;
    if (it.unit === "kg" && line.unit === "gram") {
      baseQty = line.qty / 1000;
    } else if (it.unit === "gram" && line.unit === "kg") {
      baseQty = line.qty * 1000;
    }

    const lineTotal = calculateLineTotal(it.price, baseQty);
    total += lineTotal;
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(it.name)}</strong>
        <small>${line.qty} ${escapeHtml(line.unit)} × ${formatMoney(it.price)} / ${escapeHtml(it.unit)}</small>
      </div>
      <div style="text-align:right">
        <div>${formatMoney(lineTotal)}</div>
        <button type="button" class="btn btn-sm btn-danger rm-line" data-i="${idx}">Remove</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll(".rm-line").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      state.cart.splice(i, 1);
      renderCart();
    });
  });

  totalEl.textContent = formatMoney(total);
}

function addLineToCart(itemId, qty, unit) {
  const it = state.items.find((x) => x.id === itemId);
  if (!it) {
    showMsg($("#bill-msg"), "Item not found.", "error");
    return false;
  }
  if (qty <= 0 || Number.isNaN(qty)) {
    showMsg($("#bill-msg"), "Please enter a valid quantity.", "error");
    return false;
  }

  // Handle conversion for stock check
  let baseQty = qty;
  if (it.unit === "kg" && unit === "gram") {
    baseQty = qty / 1000;
  } else if (it.unit === "gram" && unit === "kg") {
    baseQty = qty * 1000;
  }

  const existingInBase = state.cart.filter((l) => l.itemId === itemId).reduce((acc, l) => {
    let q = l.qty;
    if (it.unit === "kg" && l.unit === "gram") q /= 1000;
    else if (it.unit === "gram" && l.unit === "kg") q *= 1000;
    return acc + q;
  }, 0);

  if (existingInBase + baseQty > it.stock) {
    showMsg(
      $("#bill-msg"),
      `Low stock. ${it.name} only has ${it.stock} ${it.unit} available.`,
      "error"
    );
    return false;
  }
  
  state.cart.push({ itemId, qty, unit });
  showMsg($("#bill-msg"), "Item added to bill.", "success");
  return true;
}

async function completeSale() {
  if (!state.cart.length) {
    showMsg($("#bill-msg"), "Please add items to the bill first.", "error");
    return;
  }

  const paymentMode = $('input[name="payment-mode"]:checked')?.value || 'cash';
  const customerId = $("#bill-customer-id")?.value || null;

  if (paymentMode === 'udhaar' && !customerId) {
    showMsg($("#bill-msg"), "Please select a customer for credit (Udhaar).", "error");
    return;
  }

  for (const line of state.cart) {
    const it = state.items.find((x) => x.id === line.itemId);
    if (!it) {
      showMsg($("#bill-msg"), "Stock check failed — item not found.", "error");
      return;
    }
    let baseQty = line.qty;
    if (it.unit === "kg" && line.unit === "gram") baseQty = line.qty / 1000;
    else if (it.unit === "gram" && line.unit === "kg") baseQty = line.qty * 1000;
    
    if (baseQty > it.stock) {
      showMsg($("#bill-msg"), `Stock check failed — low stock for ${it.name}.`, "error");
      return;
    }
  }

  try {
    const payload = { 
      lines: state.cart.map((line) => ({ itemId: line.itemId, qty: line.qty, unit: line.unit })),
      paymentMode,
      customerId
    };
    const sale = await api("/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.items = await api("/items");
    state.cart = [];
    renderCart();
    renderStock();
    renderTodaySales();
    renderTodayBills();
    refreshBillingSelectors();
    
    // Refresh sales summary for the currently selected date in picker
    const selectedDate = $("#sales-date-picker")?.value || "now";
    renderTodaySales(selectedDate);
    renderTodayBills(selectedDate);
    
    // Reset payment selection
    const cashRadio = $('input[name="payment-mode"][value="cash"]');
    if (cashRadio) {
      cashRadio.checked = true;
      $("#customer-select-wrap").hidden = true;
      if ($("#bill-customer-search")) $("#bill-customer-search").value = "";
      if ($("#bill-customer-id")) $("#bill-customer-id").value = "";
      if ($("#bill-customer-select")) $("#bill-customer-select").value = "";
    }

    showMsg($("#bill-msg"), `Sale complete! Total ${formatMoney(sale.grandTotal)}`, "success");
    // Show receipt modal but do NOT trigger print automatically
    await showReceipt(sale.saleId, false);
  } catch (error) {
    showMsg($("#bill-msg"), error.message || "Could not complete sale.", "error");
  }
}


function initNav() {
  const tabs = document.querySelectorAll(".nav-tabs button");
  const panels = document.querySelectorAll(".panel");
  const datePicker = $("#sales-date-picker");

  // Set default date to today for the picker
  if (datePicker) {
    const today = new Date().toISOString().split('T')[0];
    datePicker.value = today;
    datePicker.addEventListener("change", (e) => {
      const selectedDate = e.target.value;
      renderTodaySales(selectedDate);
      renderTodayBills(selectedDate);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      if (target === "owner" && !sessionStorage.getItem("authToken")) {
        showAuthModal();
        return;
      }
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      panels.forEach((p) => p.classList.toggle("active", p.id === "panel-" + target));
      if (target === "billing") {
        refreshBillingSelectors();
        refreshCustomerSelectors();
        initCustomerSearch();
        renderCart();
      }
      if (target === "owner") {
        const selectedDate = $("#sales-date-picker")?.value || "now";
        renderTodaySales(selectedDate);
        renderTodayBills(selectedDate);
      }
      if (target === "khata") {
        renderKhata();
      }
    });
  });
}

function initAddForm() {
  const form = $("#add-item-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#item-name").value.trim();
    const price = parseFloat($("#item-price").value);
    const unit = $("#item-unit").value;
    const stock = parseFloat($("#item-stock").value);

    if (!name) {
      showMsg($("#dash-msg"), "Item ka naam likhiye.", "error");
      return;
    }
    if (Number.isNaN(price) || price < 0) {
      showMsg($("#dash-msg"), "Price sahi daaliye.", "error");
      return;
    }
    if (Number.isNaN(stock) || stock < 0) {
      showMsg($("#dash-msg"), "Stock sahi daaliye.", "error");
      return;
    }

    try {
      const created = await api("/items", {
        method: "POST",
        body: JSON.stringify({ name, price, unit, stock }),
      });
      state.items.push(created);
      form.reset();
      renderStock();
      refreshBillingSelectors();
      showMsg($("#dash-msg"), "Item added successfully.", "success");
    } catch (error) {
      showMsg($("#dash-msg"), error.message || "Could not save item.", "error");
    }
  });
}

function initBilling() {
  const sel = $("#bill-item-select");
  const qtyIn = $("#bill-qty");
  const unitSel = $("#bill-unit-select");
  
  sel?.addEventListener("change", () => {
    const id = Number(sel.value);
    const item = state.items.find(it => it.id === id);
    if (item && unitSel) {
      unitSel.value = item.unit; // Set default unit of the item
    }
  });

  // Payment mode toggle
  document.querySelectorAll('input[name="payment-mode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const wrap = $("#customer-select-wrap");
      if (wrap) wrap.hidden = (e.target.value !== 'udhaar');
    });
  });

  $("#add-line-btn")?.addEventListener("click", () => {
    const id = sel.value ? Number(sel.value) : NaN;
    const qty = parseFloat(qtyIn.value);
    const unit = unitSel ? unitSel.value : "piece";

    if (!sel.value) {
      showMsg($("#bill-msg"), "Please select an item first.", "error");
      return;
    }
    if (addLineToCart(id, qty, unit)) {
      qtyIn.value = "";
      sel.value = ""; // Reset item selection too
      if (unitSel) unitSel.value = "kg"; // Reset unit to first option
      renderCart();
    }
  });

  $("#complete-sale-btn")?.addEventListener("click", () => completeSale());

  $("#clear-cart-btn")?.addEventListener("click", () => {
    if (state.cart.length && !confirm("Clear the entire bill?")) return;
    state.cart = [];
    sel.value = "";
    qtyIn.value = "";
    if (unitSel) unitSel.value = "kg";
    renderCart();
  });
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

async function bootstrap() {
  state.items = await api("/items");
  try {
    state.customers = await api("/customers");
  } catch (e) {
    console.error("Customers load failed", e);
  }
  renderStock();
  refreshBillingSelectors();
  refreshCustomerSelectors();
  initCustomerSearch();
  renderCart();
  const selectedDate = $("#sales-date-picker")?.value || "now";
  renderTodaySales(selectedDate);
  renderTodayBills(selectedDate);
}

async function updateHeader() {
  try {
    const user = await api("/auth/me");
    if (user) {
      $("#header-username").textContent = user.name || "User";
      $("#header-avatar").src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name || 'John'}`;
      $("#header-user-role").textContent = user.is_admin ? "Administrator" : "Shop Owner";
    }
  } catch (err) {
    console.error("Header update failed:", err);
  }
}

function initPasswordToggles() {
  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrapper = btn.closest('.password-input-wrapper');
      const input = wrapper?.querySelector('input');
      if (!input) return;

      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
      }
    });
  });
}

async function init() {
  initNav();
  initAddForm();
  initBilling();
  initKhata();
  initReceiptModal();
  registerSW();
  initAuth();
  initPasswordToggles();
  
  // Dropdown Toggle
  const profile = $("#header-profile");
  const dropdown = $("#profile-dropdown");
  if (profile && dropdown) {
    profile.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("show");
    });
    document.addEventListener("click", () => {
      dropdown.classList.remove("show");
    });
  }
  
  // Check auth
  const token = sessionStorage.getItem("authToken");
  if (!token) {
    showAuthModal();
    return;
  }
  
  // Verify token
  try {
    await api("/auth/me");
    await updateHeader();
  } catch {
    sessionStorage.removeItem("authToken");
    showAuthModal();
    return;
  }
  
  // Add logout functionality
  const logoutBtn = $("#logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      sessionStorage.removeItem("authToken");
      location.reload();
    });
  }
  
  try {
    await bootstrap();
  } catch {
    showMsg($("#dash-msg"), "Backend connect nahi hua. API start karein.", "error");
  }
}

function initAuth() {
  // Signup form
  $("#signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#signup-name").value.trim();
    const mobile = $("#signup-mobile").value.trim();
    const password = $("#signup-password").value;
    const confirmPassword = $("#signup-confirm-password").value;

    if (!name) {
      showAuthMsg("Name daaliye.", "error");
      return;
    }
    if (!/^\d{10}$/.test(mobile)) {
      showAuthMsg("Valid 10-digit mobile number daaliye.", "error");
      return;
    }
    if (password.length < 6) {
      showAuthMsg("Password kam se kam 6 characters ka hona chahiye.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showAuthMsg("Password aur confirm password match karein.", "error");
      return;
    }

    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, mobile, password }),
      });
      // Registration successful, show login step
      showAuthStep("login");
      showAuthMsg("Registration successful! Ab login karein.", "success");
      // Clear signup form
      $("#signup-form").reset();
    } catch (error) {
      showAuthMsg(error.message || "Registration failed.", "error");
    }
  });

  // Login form
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const identity = $("#login-identity").value.trim();
    const password = $("#login-password").value;

    if (!identity) {
      showAuthMsg("Name ya mobile daaliye.", "error");
      return;
    }
    try {
      const res = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identity, password }),
      });
      sessionStorage.setItem("authToken", res.token);
      hideAuthModal();
      location.reload();
    } catch (error) {
      showAuthMsg(error.message || "Login failed.", "error");
    }
  });

  // Switch to signup/login
  $("#switch-to-signup").addEventListener("click", () => {
    showAuthStep("signup");
  });
  $("#switch-to-login").addEventListener("click", () => {
    showAuthStep("login");
  });

  // Forgot Password trigger
  $("#forgot-pass-trigger")?.addEventListener("click", () => {
    $("#auth-modal").hidden = true;
    $("#forgot-password-modal").hidden = false;
  });

  $("#forgot-pass-close-btn")?.addEventListener("click", () => {
    $("#forgot-password-modal").hidden = true;
    $("#auth-modal").hidden = false;
  });

  $("#forgot-pass-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const mobile = $("#fp-mobile").value.trim();
    const name = $("#fp-name").value.trim();
    const newPassword = $("#fp-new").value;
    const msg = $("#fp-msg");

    try {
      const res = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ mobile, name, newPassword })
      });
      showMsg(msg, res.message, "success");
      setTimeout(() => {
        $("#forgot-password-modal").hidden = true;
        $("#auth-modal").hidden = false;
      }, 2000);
    } catch (err) {
      showMsg(msg, err.message, "error");
    }
  });

  // Change Password logic
  $("#change-pass-btn")?.addEventListener("click", () => {
    $("#change-password-modal").hidden = false;
  });

  $("#change-pass-close-btn")?.addEventListener("click", () => {
    $("#change-password-modal").hidden = true;
    $("#cp-msg").hidden = true;
    $("#change-pass-form").reset();
  });

  $("#change-pass-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = $("#cp-current").value;
    const newPassword = $("#cp-new").value;
    const msg = $("#cp-msg");

    try {
      const res = await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      showMsg(msg, res.message, "success");
      setTimeout(() => {
        $("#change-password-modal").hidden = true;
        $("#change-pass-form").reset();
      }, 2000);
    } catch (err) {
      showMsg(msg, err.message, "error");
    }
  });
}

function showAuthModal() {
  $("#auth-modal").hidden = false;
  showAuthStep("login");
}

function hideAuthModal() {
  $("#auth-modal").hidden = true;
}

function showAuthStep(step) {
  document.querySelectorAll(".auth-step").forEach(el => el.hidden = true);
  $(`#auth-step-${step}`).hidden = false;
  showAuthMsg("");
}

function showAuthMsg(msg, type = "") {
  const el = $("#auth-msg");
  el.textContent = msg;
  el.className = "msg";
  if (type) el.classList.add(type);
  el.hidden = !msg;
}

document.removeEventListener("DOMContentLoaded", init);
document.addEventListener("DOMContentLoaded", init);
