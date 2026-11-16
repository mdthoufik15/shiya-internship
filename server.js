require("dotenv").config();
const express = require("express");
const multer = require("multer");
const nodemailer = require("nodemailer");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || "shiyatechsolutions@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

// ---------- Storage: database + resumes ----------
const DATA_DIR = path.join(__dirname, "data");
const RESUME_DIR = path.join(DATA_DIR, "resumes");
fs.mkdirSync(RESUME_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "applications.db"));
db.exec(`CREATE TABLE IF NOT EXISTS applications(
  id TEXT PRIMARY KEY, role TEXT, name TEXT, email TEXT, phone TEXT,
  college TEXT, link TEXT, why TEXT, resume_file TEXT, resume_name TEXT,
  status TEXT DEFAULT 'Received', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);

const upload = multer({
  storage: multer.diskStorage({
    destination: RESUME_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(/\.(pdf|doc|docx)$/i.test(file.originalname) ? null : new Error("Resume must be a PDF, DOC or DOCX file."), true),
});

// ---------- Email ----------
const mailReady = process.env.SMTP_USER && process.env.SMTP_PASS;
const transporter = mailReady
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_PORT || "465") === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;
const FROM = `"Shiya Tech Solutions" <${process.env.SMTP_USER || COMPANY_EMAIL}>`;
const SIGNATURE = `\nShiya Tech Solutions\nInvent. Innovate. Integrate.\nPlot no: 236, 38th street, Shankar Nagar, Pammal, Chennai - 600075, Tamilnadu.\nMobile: 9885433796 | ${COMPANY_EMAIL}`;

async function sendMail(opts) {
  if (!transporter) { console.log("[mail skipped: SMTP not configured]", opts.subject); return false; }
  try { await transporter.sendMail({ from: FROM, ...opts }); return true; }
  catch (e) { console.error("Mail error:", e.message); return false; }
}

// ---------- App ----------
const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

const clean = (v, max = 500) => String(v || "").trim().slice(0, max);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

app.post("/api/apply", upload.single("resume"), async (req, res) => {
  const b = req.body, file = req.file;
  const a = { role: clean(b.role, 100), name: clean(b.name, 100), email: clean(b.email, 150), phone: clean(b.phone, 20),
              college: clean(b.college, 200), link: clean(b.link, 300), why: clean(b.why, 2000) };
  const bad =
    !file ? "Please upload your resume." :
    a.name.length < 2 ? "Enter your full name." :
    !/^\S+@\S+\.\S+$/.test(a.email) ? "Enter a valid email address." :
    !/^[+\d][\d\s-]{8,14}$/.test(a.phone) ? "Enter a valid phone number." :
    !a.role || !a.college || a.why.length < 20 ? "Please fill in all required fields." : "";
  if (bad) { if (file) fs.unlink(file.path, () => {}); return res.status(400).json({ error: bad }); }

  let id;
  do { id = "STS-" + (10000 + crypto.randomInt(90000)); } while (db.prepare("SELECT 1 FROM applications WHERE id=?").get(id));

  db.prepare(`INSERT INTO applications(id,role,name,email,phone,college,link,why,resume_file,resume_name)
              VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(id, a.role, a.name, a.email, a.phone, a.college, a.link, a.why, file.filename, file.originalname);

  // 1) Confirmation to the applicant
  const emailSent = await sendMail({
    to: a.email,
    subject: `We received your application (${id}) – ${a.role}`,
    text: `Dear ${a.name},\n\nThank you for applying for the ${a.role} internship at Shiya Tech Solutions.\n\nYour application ID is ${id}. Please keep it to track your status on our internship portal.\n\nOur team will review your application and contact you by email or phone.\n\nThanks,${SIGNATURE}`,
  });
  // 2) Notification to the company, with resume attached
  await sendMail({
    to: COMPANY_EMAIL,
    subject: `New application ${id}: ${a.name} – ${a.role}`,
    text: `ID: ${id}\nRole: ${a.role}\nName: ${a.name}\nEmail: ${a.email}\nPhone: ${a.phone}\nCollege: ${a.college}\nLink: ${a.link || "-"}\n\nWhy this role:\n${a.why}`,
    attachments: [{ filename: file.originalname, path: file.path }],
  });

  res.json({ id, emailSent });
});

app.get("/api/status", (req, res) => {
  const row = db.prepare("SELECT role,status,created_at FROM applications WHERE id=? AND lower(email)=lower(?)")
    .get(clean(req.query.id, 20).toUpperCase(), clean(req.query.email, 150));
  if (!row) return res.status(404).json({ error: "No application found for that ID and email." });
  res.json({ role: row.role, status: row.status, date: new Date(row.created_at + "Z").toLocaleDateString("en-IN") });
});

// ---------- Admin (password protected) ----------
function admin(req, res, next) {
  const pass = Buffer.from((req.headers.authorization || "").split(" ")[1] || "", "base64").toString().split(":").slice(1).join(":");
  if (ADMIN_PASSWORD && pass === ADMIN_PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="Shiya Admin"').status(401).send(ADMIN_PASSWORD ? "Login required" : "Set ADMIN_PASSWORD in .env to use the admin page.");
}
const STATUSES = ["Received", "Shortlisted", "Interview", "Offered", "Not selected"];

app.get("/admin", admin, (req, res) => {
  const rows = db.prepare("SELECT * FROM applications ORDER BY created_at DESC").all();
  res.send(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Applications</title>
<style>body{font:15px system-ui;margin:20px;color:#1c2538}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d5e0f3;padding:8px;text-align:left;vertical-align:top}th{background:#14305f;color:#fff}.w{overflow-x:auto}button{cursor:pointer}</style>
<h1>Applications (${rows.length})</h1><div class="w"><table><tr><th>ID</th><th>Role</th><th>Applicant</th><th>College</th><th>Why</th><th>Resume</th><th>Date</th><th>Status</th></tr>
${rows.map((r) => `<tr><td>${r.id}</td><td>${esc(r.role)}</td><td>${esc(r.name)}<br>${esc(r.email)}<br>${esc(r.phone)}${r.link ? `<br><a href="${esc(r.link)}">link</a>` : ""}</td><td>${esc(r.college)}</td><td>${esc(r.why)}</td>
<td><a href="/admin/resume/${r.id}">${esc(r.resume_name)}</a></td><td>${esc(r.created_at)}</td>
<td><form method="post" action="/admin/status"><input type="hidden" name="id" value="${r.id}"><select name="status">${STATUSES.map((s) => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("")}</select> <button>Save</button></form></td></tr>`).join("")}
</table></div>`);
});

app.get("/admin/resume/:id", admin, (req, res) => {
  const r = db.prepare("SELECT resume_file,resume_name FROM applications WHERE id=?").get(req.params.id);
  if (!r) return res.status(404).send("Not found");
  res.download(path.join(RESUME_DIR, r.resume_file), r.resume_name);
});

app.post("/admin/status", admin, async (req, res) => {
  const status = STATUSES.includes(req.body.status) ? req.body.status : null;
  const r = db.prepare("SELECT * FROM applications WHERE id=?").get(clean(req.body.id, 20));
  if (!status || !r) return res.status(400).send("Invalid request");
  db.prepare("UPDATE applications SET status=? WHERE id=?").run(status, r.id);
  await sendMail({
    to: r.email,
    subject: `Update on your application ${r.id}: ${status}`,
    text: `Dear ${r.name},\n\nThe status of your ${r.role} internship application (${r.id}) is now: ${status}.\n\nYou can check it anytime on our internship portal.\n\nThanks,${SIGNATURE}`,
  });
  res.redirect("/admin");
});

// ---------- Errors ----------
app.use((err, req, res, next) => {
  const msg = err.code === "LIMIT_FILE_SIZE" ? "Resume is larger than 5 MB." : err.message || "Something went wrong.";
  res.status(400).json({ error: msg });
});

app.listen(PORT, () => console.log(`Portal running at http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`));
