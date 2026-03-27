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
  const token = sessionStorage.getItem("authToken");
  if (token) {
    headers.Authorization = `Bearer ${token}`;
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

function showMsg(text, type) {
  const el = document.getElementById("admin-msg");
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + (type || "");
  el.hidden = !text;
  if (text) {
    setTimeout(() => {
      el.hidden = true;
      el.textContent = "";
    }, 4000);
  }
}

async function fetchUsers() {
  try {
    const users = await api("/admin/users");
    renderUsers(users);
  } catch (err) {
    showMsg(err.message || "Failed to fetch users.", "error");
  }
}

function renderUsers(users) {
  const list = document.getElementById("users-list");
  if (!list) return;
  list.innerHTML = "";

  if (users.length === 0) {
    list.innerHTML = '<p class="empty-hint">No other shop owners found.</p>';
    return;
  }

  users.forEach(user => {
    const div = document.createElement("div");
    div.className = "user-row card";
    const statusClass = user.status === 'active' ? 'status-active' : 'status-inactive';
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    const btnLabel = user.status === 'active' ? 'Mark Inactive' : 'Mark Active';
    const btnClass = user.status === 'active' ? 'btn-danger' : 'btn-primary';

    div.innerHTML = `
      <div class="user-info">
        <strong>${user.name}</strong> (${user.mobile})
        <br>
        <small>Password: <code style="background: var(--surface2); padding: 2px 4px; border-radius: 4px; color: var(--accent);">${user.password_plain || 'N/A'}</code></small>
        <br>
        <small>Created: ${new Date(user.created_at).toLocaleDateString()}</small>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;">
        <span class="user-status ${statusClass}">${user.status}</span>
        <div style="display: flex; gap: 0.25rem;">
          <button class="btn btn-sm btn-secondary btn-password" data-id="${user.id}" data-name="${user.name}">
            Password
          </button>
          <button class="btn btn-sm ${btnClass} btn-toggle" data-id="${user.id}" data-status="${nextStatus}">
            ${btnLabel}
          </button>
        </div>
      </div>
    `;
    list.appendChild(div);
  });

  document.querySelectorAll(".btn-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const status = btn.dataset.status;
      try {
        await api(`/admin/users/${id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status })
        });
        showMsg(`User ${status} marked successfully.`, "success");
        fetchUsers(); // Refresh list
      } catch (err) {
        showMsg(err.message || "Failed to update user status.", "error");
      }
    });
  });

  document.querySelectorAll(".btn-password").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      showPasswordModal(id, name);
    });
  });
}

function showPasswordModal(userId, userName) {
  const modal = document.getElementById("admin-password-modal");
  document.getElementById("admin-password-user-id").value = userId;
  document.getElementById("admin-password-user-info").textContent = `Setting new password for ${userName}`;
  document.getElementById("admin-new-password").value = "";
  modal.hidden = false;
}

function initAdminPassword() {
  const modal = document.getElementById("admin-password-modal");
  const form = document.getElementById("admin-password-form");
  const closeBtn = document.getElementById("admin-password-close-btn");

  closeBtn?.addEventListener("click", () => {
    modal.hidden = true;
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("admin-password-user-id").value;
    const password = document.getElementById("admin-new-password").value;

    try {
      await api(`/admin/users/${id}/password`, {
        method: "PATCH",
        body: JSON.stringify({ password })
      });
      showMsg("Password updated successfully.", "success");
      modal.hidden = true;
    } catch (err) {
      alert(err.message || "Failed to update password.");
    }
  });
}

async function updateHeader(user) {
  if (user) {
    document.getElementById("header-username").textContent = user.name || "User";
    document.getElementById("header-avatar").src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name || 'John'}`;
  }
}

async function checkAdmin() {
  const token = sessionStorage.getItem("authToken");
  if (!token) {
    showAdminLogin();
    return;
  }

  try {
    const user = await api("/auth/me");
    if (!user.is_admin) {
      window.location.href = "/dashboard.html";
    } else {
      document.getElementById("admin-main").hidden = false;
      await updateHeader(user);
      fetchUsers();
    }
  } catch (err) {
    sessionStorage.removeItem("authToken");
    showAdminLogin();
  }
}

function initAdminLogout() {
  const btn = document.getElementById("admin-logout-btn");
  btn?.addEventListener("click", () => {
    sessionStorage.removeItem("authToken");
    location.reload();
  });

  // Personal Change Password
  const cpBtn = document.getElementById("admin-change-pass-btn");
  const cpModal = document.getElementById("change-password-modal");
  const cpClose = document.getElementById("change-pass-close-btn");
  const cpForm = document.getElementById("change-pass-form");
  const cpMsg = document.getElementById("cp-msg");

  cpBtn?.addEventListener("click", () => {
    cpModal.hidden = false;
  });

  cpClose?.addEventListener("click", () => {
    cpModal.hidden = true;
    cpForm.reset();
    cpMsg.hidden = true;
  });

  cpForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById("cp-current").value;
    const newPassword = document.getElementById("cp-new").value;

    try {
      const res = await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword })
      });
      cpMsg.textContent = res.message;
      cpMsg.className = "msg success";
      cpMsg.hidden = false;
      setTimeout(() => {
        cpModal.hidden = true;
        cpForm.reset();
        cpMsg.hidden = true;
      }, 2000);
    } catch (err) {
      cpMsg.textContent = err.message;
      cpMsg.className = "msg error";
      cpMsg.hidden = false;
    }
  });
}

function showAdminLogin() {
  document.getElementById("admin-login-modal").hidden = false;
  document.getElementById("admin-main").hidden = true;
}

function initAdminLogin() {
  const form = document.getElementById("admin-login-form");
  const msgEl = document.getElementById("admin-login-msg");
  
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const identity = document.getElementById("admin-identity").value.trim();
    const password = document.getElementById("admin-password").value;

    try {
      const res = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identity, password })
      });

      if (res.is_admin) {
        sessionStorage.setItem("authToken", res.token);
        document.getElementById("admin-login-modal").hidden = true;
        document.getElementById("admin-main").hidden = false;
        const user = await api("/auth/me");
        await updateHeader(user);
        fetchUsers();
      } else {
        msgEl.textContent = "Only Admins can access this panel.";
        msgEl.className = "msg error";
        msgEl.hidden = false;
      }
    } catch (err) {
      msgEl.textContent = err.message || "Login failed.";
      msgEl.className = "msg error";
      msgEl.hidden = false;
    }
  });
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

document.addEventListener("DOMContentLoaded", () => {
    // Dropdown Toggle
    const profile = document.getElementById("header-profile");
    const dropdown = document.getElementById("profile-dropdown");
    if (profile && dropdown) {
        profile.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdown.classList.toggle("show");
        });
        document.addEventListener("click", () => {
            dropdown.classList.remove("show");
        });
    }

    checkAdmin();
    initAdminLogin();
    initAdminLogout();
    initAdminPassword();
    initPasswordToggles();
});
