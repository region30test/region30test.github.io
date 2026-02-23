(() => {

// ===============================
// DOM ELEMENTS
// ===============================
const loadBtn = document.getElementById("loadTemplates");
const passwordInput = document.getElementById("password");
const templateSelect = document.getElementById("templateSelect");
const dynamicForm = document.getElementById("dynamicForm");
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

    //LIVE UPDATE HOOK
    input.addEventListener("input", renderEmail);

    dynamicForm.appendChild(label);
    dynamicForm.appendChild(input);
  });

  // Initial render (empty fields)
  renderEmail();
};




// ===============================
// TEMPLATE LOADING (OPTION A)
// ===============================
async function loadTemplates(password) {
  const res = await fetch("./templates.enc");
  const fileText = (await res.text()).trim().replace(/^\uFEFF/, "");

  console.log("Raw file length:", fileText.length);
  console.log("First 100 chars:", fileText.substring(0, 100));
  console.log("Starts with { or [:", fileText.startsWith("{") || fileText.startsWith("["));

  if (fileText.startsWith("{") || fileText.startsWith("[")) {
    return JSON.parse(fileText);
  }

  try {
    const key = CryptoJS.enc.Utf8.parse(
      password.padEnd(16).slice(0, 16)
    );

    console.log("Key hex:", key.toString());
    console.log("Password used:", JSON.stringify(password.padEnd(16).slice(0, 16)));

    const wordArray = CryptoJS.enc.Base64.parse(fileText);
    console.log("Parsed ciphertext word count:", wordArray.words.length);

    const cipherParams = CryptoJS.lib.CipherParams.create({
      ciphertext: wordArray
    });

    const decrypted = CryptoJS.AES.decrypt(
      cipherParams,
      key,
      {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    console.log("Decrypted sigBytes:", decrypted.sigBytes);
    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    console.log("Plaintext length:", plaintext.length);
    console.log("Plaintext first 100:", plaintext.substring(0, 100));

    if (!plaintext) throw new Error("Decryption failed");

    return JSON.parse(plaintext);

  } catch (err) {
    console.error("Decryption error:", err);
    throw new Error("Invalid template file or incorrect password.");
  }
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

    const result = new Function("scope", `return ${safeExpr}`)(scope);
    const rounded = Math.round((result + Number.EPSILON) * 100) / 100;
    return rounded.toFixed(2);
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

    const result = new Function("scope", `return ${safeExpr}`)(scope);
    const rounded = Math.round((result + Number.EPSILON) * 100) / 100;
    return rounded.toFixed(2);
    } catch {
      return `{${expr}}`;
    }
  });

    subjectText = subjectText.replace(/\{(.-?)\}/g, (_, expr) => {
    try {
      const scope = {};
      formData.forEach((val, key) => {
        scope[key] = parseFloat(val) || 0;
      });

      const safeExpr = expr.replace(/\b[\w ]-\b/g, match => {
        if (!match.trim()) return match;
        return `scope['${match.trim()}']`;
      });

    const result = new Function("scope", `return ${safeExpr}`)(scope);
    const rounded = Math.round((result + Number.EPSILON) * 100) / 100;
    return rounded.toFixed(2);
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
    const bodyHTML = output.innerHTML;

    // Create a temporary container to copy HTML
    const container = document.createElement("div");
    container.innerHTML = `${bodyHTML}`;

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

})();


