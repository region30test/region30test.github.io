// ===============================
// DOM ELEMENTS
// ===============================
const loadBtn = document.getElementById("loadTemplates");
const passwordInput = document.getElementById("password");
const templateSelect = document.getElementById("templateSelect");
const dynamicForm = document.getElementById("dynamicForm");
const generateBtn = document.getElementById("generateEmail");
const output = document.getElementById("output");
const modeIndicator = document.getElementById("modeIndicator");

// ===============================
// STATE
// ===============================
let templates = [];
let isEncrypted = false;

// ===============================
// LOAD TEMPLATES
// ===============================
loadBtn.onclick = async () => {
  const password = passwordInput.value;

  try {
    const result = await loadTemplates(password);
    templates = result.templates;
    isEncrypted = result.encrypted;

    populateTemplateSelect();
    templateSelect.disabled = false;

    modeIndicator.textContent = isEncrypted
      ? "🔐 Encrypted templates loaded"
      : "⚠ Plaintext templates loaded";
  } catch (err) {
    alert("Failed to load templates");
    console.error(err);
  }
};

// ===============================
// TEMPLATE SELECT
// ===============================
templateSelect.onchange = () => {
  const template = templates.find(t => t.id === templateSelect.value);
  if (!template) return;

  dynamicForm.innerHTML = "";
  output.innerHTML = "";

  document.getElementById("emailSubject").textContent =
    `Subject: ${template.subject || ""}`;

  const placeholders = extractPlaceholders(template.body);

  placeholders.forEach(name => {
    const label = document.createElement("label");
    label.textContent = name;

    const input = document.createElement("input");
    input.type = "text";
    input.name = name;

    // 🔴 LIVE UPDATE HOOK
    input.addEventListener("input", renderEmail);

    dynamicForm.appendChild(label);
    dynamicForm.appendChild(input);
  });

  // Initial render (empty fields)
  renderEmail();
};


// ===============================
// GENERATE EMAIL
// ===============================
generateBtn.onclick = () => {
  const template = templates.find(t => t.id === templateSelect.value);
  if (!template) return;

  let emailHTML = template.body;
  const formData = new FormData(dynamicForm);

  formData.forEach((value, key) => {
    emailHTML = emailHTML.replaceAll(
      `[${key}]`,
      escapeHTML(value)
    );
  });

// Replace {Computed Expressions}
emailHTML = emailHTML.replace(/\{(.+?)\}/g, (_, expr) => {
  try {
    const scope = {};
    formData.forEach((val, key) => {
      scope[key] = parseFloat(val) || 0;
    });

    // Replace variable names in expression with scope references
    // e.g. "Current Payment + Partial Payment" → "scope['Current Payment'] + scope['Partial Payment']"
    const safeExpr = expr.replace(/\b[\w ]+\b/g, match => {
      if (match.trim() === "") return match; // skip empty
      return `scope['${match.trim()}']`;
    });

    return new Function("scope", `return ${safeExpr}`)(scope);
  } catch {
    return `{${expr}}`;
  }
});



  output.innerHTML = emailHTML;
};

// ===============================
// TEMPLATE LOADING (OPTION A)
// ===============================
async function loadTemplates(password) {
  const res = await fetch("./templates.enc");
  console.log("Grabbed file")
  const encryptedBase64 = (await res.text()).trim();

  // Parse base64 ciphertext
  const ciphertext = CryptoJS.enc.Base64.parse(encryptedBase64);
  console.log("Cipher text: ", ciphertext)
  // Convert password → 16-byte AES-128 key
  const key = CryptoJS.enc.Utf8.parse(
    password.padEnd(16).slice(0, 16)
  );

  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext },
    key,
    {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7
    }
  );

  const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
  if (!plaintext) {
    throw new Error("Decryption failed (wrong password or corrupted file)");
  }

  return JSON.parse(plaintext);
}


// ===============================
// AES DECRYPTION (AES-256-GCM)
// ===============================
async function decryptAES(buffer, password) {
  const data = new Uint8Array(buffer);

  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const tag = data.slice(28, 44);
  const ciphertext = data.slice(44);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

// ===============================
// HELPERS
// ===============================
function populateTemplateSelect() {
  templateSelect.innerHTML = `<option value="">Select a template</option>`;
  templates.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    templateSelect.appendChild(opt);
  });
}

function extractPlaceholders(html) {
  const matches = html.match(/\[(.+?)\]/g) || [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

function escapeHTML(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderEmail() {
  const template = templates.find(t => t.id === templateSelect.value);
  if (!template) return;

  const formData = new FormData(dynamicForm);

  // ---------- BODY ----------
  let emailHTML = template.body;

  // Replace [Placeholders]
  formData.forEach((value, key) => {
    emailHTML = emailHTML.replaceAll(
      `[${key}]`,
      escapeHTML(value)
    );
  });

  // Evaluate {Expressions}
  emailHTML = emailHTML.replace(/\{(.+?)\}/g, (_, expr) => {
    try {
      const scope = {};
      formData.forEach((val, key) => {
        scope[key] = parseFloat(val) || 0;
      });

      const safeExpr = expr.replace(/\b[\w ]+\b/g, match => {
        if (!match.trim()) return match;
        return `scope['${match.trim()}']`;
      });

      return new Function("scope", `return ${safeExpr}`)(scope);
    } catch {
      return `{${expr}}`;
    }
  });

  output.innerHTML = emailHTML;

  // ---------- SUBJECT ----------
  let subjectText = template.subject || "";

  subjectText = subjectText.replace(/\{(.+?)\}/g, (_, expr) => {
    try {
      const scope = {};
      formData.forEach((val, key) => {
        scope[key] = parseFloat(val) || 0;
      });

      const safeExpr = expr.replace(/\b[\w ]+\b/g, match => {
        if (!match.trim()) return match;
        return `scope['${match.trim()}']`;
      });

      return new Function("scope", `return ${safeExpr}`)(scope);
    } catch {
      return `{${expr}}`;
    }
  });

  document.getElementById("emailSubject").textContent =
    `Subject: ${subjectText}`;
}

const copyBtn = document.getElementById("copyEmailBtn");

copyBtn.onclick = async () => {
  try {
    const subjectText = document.getElementById("emailSubject").innerText;
    const bodyHTML = output.innerHTML;

    // Create a temporary container to copy HTML
    const container = document.createElement("div");
    container.innerHTML = `<div>${subjectText}</div>${bodyHTML}`;

    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    document.execCommand("copy");

    selection.removeAllRanges();
    document.body.removeChild(container);

    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
  } catch (err) {
    console.error("Copy failed", err);
    alert("Failed to copy email");
  }
};


