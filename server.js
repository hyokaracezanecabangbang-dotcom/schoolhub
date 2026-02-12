const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const bcrypt = require("bcryptjs");
console.log("bcrypt hash type:", typeof bcrypt.hash);

const Class = require("./models/Class");
const Student = require("./models/Student");
const Attendance = require("./models/Attendance");
const TeacherAccount = require("./models/TeacherAccount");
const AdminAccount = require("./models/AdminAccount");
const StudentAccount = require("./models/StudentAccount");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   MIDDLEWARE
========================= */
app.use(cors());
app.use(express.json());

// Serve the real app
app.use(express.static(path.join(__dirname, "public")));

app.post("/dev/create-admin", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");

    if (!email || !name || !password) {
      return res.status(400).json({ message: "email, name, password required" });
    }

    const exists = await AdminAccount.findOne({ email });
    if (exists) return res.status(200).json({ message: "Admin already exists", email });

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await AdminAccount.create({ email, name, passwordHash });

    res.status(201).json({ message: "Admin created", email: doc.email, name: doc.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create admin", error: err.message });
  }
});

app.use((req, res, next) => {
  console.log("➡️", req.method, req.url);
  next();
});
/* =========================
   DATABASE
========================= */
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is missing. Check your .env (local) or Railway Variables (deploy).");
  process.exit(1);
}

mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ Mongo error:", err.message));

/* =========================
   HELPERS
========================= */
function normalizeCat(cat) {
  const c = String(cat || "").trim().toUpperCase();
  if (c === "WW" || c.includes("WRITTEN")) return "WW";
  if (c === "PT" || c.includes("PERFORMANCE")) return "PT";
  if (c === "QE" || c.includes("QUARTER")) return "QE";
  return c;
}

function requireTeacher(req, res, next) {
  const role = String(req.headers["x-role"] || "").toLowerCase();
  if (role !== "teacher") return res.status(403).json({ message: "Teacher only" });
  next();
}

function requireAdmin(req, res, next) {
  const role = String(req.headers["x-role"] || "").toLowerCase();
  if (role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
}

// ✅ ADMIN: Create Teacher Account
app.post("/api/admin/teachers", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !username || !password) {
      return res.status(400).json({ message: "name, username, password required" });
    }

    const exists = await TeacherAccount.findOne({
      $or: [{ username }, ...(email ? [{ email }] : [])],
    });

    if (exists) {
      return res.status(409).json({ message: "Teacher already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const doc = await TeacherAccount.create({
      name,
      username,
      email,
      passwordHash,
      disabled: false,
    });

    res.status(201).json({
      message: "Teacher created",
      teacher: { name: doc.name, username: doc.username, email: doc.email },
    });
  } catch (err) {
    console.error("Create teacher error:", err);
    res.status(500).json({ message: "Failed to create teacher", error: err.message });
  }
});

app.get("/api/admin/me", requireAdmin, async (req, res) => {
  res.json({ ok: true, role: "admin" });
});

function getWeightsObj(cls) {
  // default
  const w = { ww: 40, pt: 30, qe: 30 };
  const raw = cls?.weights;

  // weights stored as object: { ww, pt, qe }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    if (raw.ww != null) w.ww = Number(raw.ww) || 0;
    if (raw.pt != null) w.pt = Number(raw.pt) || 0;
    if (raw.qe != null) w.qe = Number(raw.qe) || 0;
    return w;
  }

  // weights stored as array: [{category, percentage}]
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const cat = normalizeCat(item.category);
      const pct = Number(item.percentage) || 0;
      if (cat === "WW") w.ww = pct;
      if (cat === "PT") w.pt = pct;
      if (cat === "QE") w.qe = pct;
    }
  }

  return w;
}

function getScore(student, key) {
  // supports Map OR plain object
  return Number(student?.scores?.get?.(key) ?? student?.scores?.[key] ?? 0) || 0;
}

function computeFinalFromLessons(student, cls) {
  const lessons = Array.isArray(cls?.lessons) ? cls.lessons : [];
  const weights = getWeightsObj(cls);

  let final = 0;

  const buckets = {
    WW: lessons.filter((l) => normalizeCat(l.category) === "WW"),
    PT: lessons.filter((l) => normalizeCat(l.category) === "PT"),
    QE: lessons.filter((l) => normalizeCat(l.category) === "QE"),
  };

  for (const cat of ["WW", "PT", "QE"]) {
    const catLessons = buckets[cat];
    if (!catLessons.length) continue;

    let earned = 0;
    let maxTotal = 0;

    for (const l of catLessons) {
      earned += getScore(student, l.dbKey);
      maxTotal += Number(l.max) || 0;
    }

    const percent = maxTotal ? (earned / maxTotal) * 100 : 0;

    const weightPct =
      cat === "WW" ? weights.ww : cat === "PT" ? weights.pt : weights.qe;

    final += percent * (weightPct / 100);
  }

  return Math.round(final);
}

console.log("✅ ensureStudentAccount BODY START");
console.log("bcrypt.hash exists?", typeof bcrypt.hash);
async function ensureStudentAccount(lrn, name) {
  lrn = String(lrn || "").trim();
  name = String(name || "").trim();

  const existing = await StudentAccount.findOne({ lrn });
  if (existing) return existing;

  const passwordHash = await bcrypt.hash("Student123", 10);

  return await StudentAccount.create({
    lrn,
    name,
    passwordHash,
    mustChangePassword: true,
  });
}

/* =========================
   LOGIN (MOCK)
========================= */

app.post("/login", async (req, res) => {
  console.log("LOGIN BODY:", req.body);
  const { role, username, email, password, lrn } = req.body;

  if (role === "teacher") {
    const u = String(username || "").trim(); // this input can be username OR email
    const account = await TeacherAccount.findOne({
      $or: [
        { username: u },
        { email: u.toLowerCase() }
      ]
    });

    if (!account) return res.status(401).json({ message: "Teacher not found" });

    if (account.disabled) {
      return res.status(403).json({ message: "Account disabled" });
    }

    const ok = await bcrypt.compare(String(password || ""), account.passwordHash);
    if (!ok) return res.status(401).json({ message: "Wrong password" });

    return res.json({
      user: { name: account.name, role: "teacher", username: account.username }
    });
  }

  if (String(role || "").toLowerCase() === "admin") {
    const adminEmail = String(req.body.email || "")
      .trim()
      .toLowerCase();

    console.log("ADMIN LOGIN email used:", adminEmail);

    const account = await AdminAccount.findOne({ email: adminEmail }).lean();
    console.log("ADMIN FOUND?", !!account);

    if (!account) {
      return res.status(401).json({ message: "Admin not found" });
    }

    const ok = await bcrypt.compare(String(req.body.password || ""), account.passwordHash);
    console.log("ADMIN PASSWORD OK?", ok);

    if (!ok) {
      return res.status(401).json({ message: "Wrong password" });
    }

    return res.json({
      user: { name: account.name, role: "admin", email: account.email }
    });
  }

  if (role === "student") {
    const account = await StudentAccount.findOne({ lrn: String(lrn || "").trim() });
    if (!account) return res.status(401).json({ message: "Student not found" });

    if (account.disabled) {
      return res.status(403).json({ message: "Account disabled" });
    }

    const ok = await bcrypt.compare(String(password || ""), account.passwordHash);
    if (!ok) return res.status(401).json({ message: "Wrong password" });

    return res.json({
      user: {
        name: account.name,
        role: "student",
        lrn: account.lrn,
        mustChangePassword: account.mustChangePassword,
      }
    });
  }

  return res.status(400).json({ message: "Invalid role" });
});

app.post("/change-password", async (req, res) => {
  try {
    const role = String(req.body.role || "").toLowerCase();
    const newPassword = String(req.body.newPassword || "");
    const currentPassword = String(req.body.currentPassword || "");

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters." });
    }

    // STUDENT
    if (role === "student") {
      const lrn = String(req.body.lrn || "").trim();
      if (!lrn) return res.status(400).json({ message: "LRN required." });

      const account = await StudentAccount.findOne({ lrn });
      if (!account) return res.status(404).json({ message: "Student not found." });

      if (!account.passwordHash) {
        return res.status(400).json({ message: "Student account has no password set. Ask admin to reset." });
      }

      const ok = await bcrypt.compare(currentPassword, account.passwordHash);
      if (!ok) return res.status(401).json({ message: "Current password is incorrect." });

      account.passwordHash = await bcrypt.hash(newPassword, 10);
      account.mustChangePassword = false;
      await account.save();

      return res.json({ message: "Password updated." });
    }

    // TEACHER
    if (role === "teacher") {
      const username = String(req.body.username || "").trim();
      if (!username) return res.status(400).json({ message: "username required." });

      const account = await TeacherAccount.findOne({ username });
      if (!account) return res.status(404).json({ message: "Teacher not found." });

      if (!account.passwordHash) {
        return res.status(400).json({ message: "Teacher account has no password set. Ask admin to reset." });
      }

      const ok = await bcrypt.compare(currentPassword, account.passwordHash);
      if (!ok) return res.status(401).json({ message: "Current password is incorrect." });

      account.passwordHash = await bcrypt.hash(newPassword, 10);
      await account.save();

      return res.json({ message: "Password updated." });
    }

    return res.status(400).json({ message: "Invalid role." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error changing password." });
  }
});

/* =========================
   CLASSES
========================= */
app.get("/api/classes", async (req, res) => {
  const role = String(req.headers["x-role"] || "").toLowerCase();

  // Admin sees all
  if (role === "admin") {
    const classes = await Class.find().sort({ createdAt: -1 });
    return res.json(classes);
  }

  // Teacher sees only own classes
  if (role === "teacher") {
    const username = String(req.headers["x-username"] || "").trim();
    const classes = await Class.find({ teacherUsername: username }).sort({ createdAt: -1 });
    return res.json(classes);
  }

  // Student (keep your existing student-side filtering in frontend)
  const classes = await Class.find().sort({ createdAt: -1 });
  return res.json(classes);
});

app.post("/api/classes", requireTeacher, async (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ message: "Class name required" });

  const cls = await Class.create({
    name,
    teacherUsername: String(req.headers["x-username"] || "").trim(),
    weights: { ww: 40, pt: 30, qe: 30 },
    lessons: [],
  });

  res.status(201).json(cls);
});

app.put("/api/classes/:id", requireTeacher, async (req, res) => {
  try {
    const update = {};

    if (typeof req.body.name === "string") update.name = req.body.name.trim();

    // lessons array
    if (Array.isArray(req.body.lessons)) update.lessons = req.body.lessons;

    // weights accept BOTH formats
    if (req.body.weights) {
      // object { ww, pt, qe }
      if (typeof req.body.weights === "object" && !Array.isArray(req.body.weights)) {
        update.weights = {
          ww: Number(req.body.weights.ww) || 0,
          pt: Number(req.body.weights.pt) || 0,
          qe: Number(req.body.weights.qe) || 0,
        };
      }

      // array [{category, percentage}]
      if (Array.isArray(req.body.weights)) {
        const w = { ww: 0, pt: 0, qe: 0 };
        for (const item of req.body.weights) {
          const cat = normalizeCat(item.category);
          const pct = Number(item.percentage) || 0;
          if (cat === "WW") w.ww = pct;
          if (cat === "PT") w.pt = pct;
          if (cat === "QE") w.qe = pct;
        }
        update.weights = w;
      }
    }

    const updated = await Class.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: "Class not found." });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating class.", error: err.message });
  }
});

app.delete("/api/classes/:id", requireTeacher, async (req, res) => {
  await Student.deleteMany({ classId: req.params.id });
  await Class.findByIdAndDelete(req.params.id);
  res.json({ message: "Class deleted" });
});

// Add a lesson (optional route)
app.post("/api/classes/:id/lessons", async (req, res) => {
  try {
    const { name, max, category } = req.body;
    if (!name || !max || !category) {
      return res.status(400).json({ message: "name, max, category are required" });
    }

    const cls = await Class.findById(req.params.id);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    const lesson = {
      name: String(name).trim(),
      max: Number(max) || 0,
      category: normalizeCat(category),
      dbKey: "L" + Date.now(),
    };

    cls.lessons.push(lesson);
    await cls.save();

    res.json(cls);
  } catch (err) {
    res.status(500).json({ message: "Error adding lesson", error: err.message });
  }
});

app.delete("/api/classes/:id/lessons/:dbKey", async (req, res) => {
  try {
    const cls = await Class.findById(req.params.id);
    if (!cls) return res.status(404).json({ message: "Class not found" });

    cls.lessons = (cls.lessons || []).filter((l) => l.dbKey !== req.params.dbKey);
    await cls.save();

    res.json(cls);
  } catch (err) {
    res.status(500).json({ message: "Error deleting lesson", error: err.message });
  }
});

/* =========================
   STUDENTS
========================= */
app.get("/api/students/:classId", async (req, res) => {
  res.json(await Student.find({ classId: req.params.classId }).sort({ name: 1 }));
});

app.post("/api/students/:classId", requireTeacher, async (req, res) => {
  try {
    const classId = String(req.params.classId || "").trim();
    const students = Array.isArray(req.body) ? req.body : [req.body];

    if (!classId) return res.status(400).json({ message: "Missing classId" });

    const created = [];
    const skipped = [];

    for (const s of students) {
      const name = String(s?.name || "").trim();
      const lrn = String(s?.lrn || "").trim();

      if (!name || !lrn) {
        return res.status(400).json({ message: "Name and LRN are required" });
      }

      // ✅ 1) ensure account exists (one per LRN)
      await ensureStudentAccount(lrn, name);

      // ✅ 2) create enrollment ONLY if not already enrolled in this class
      const exists = await Student.findOne({ classId, lrn });
      if (exists) {
        skipped.push(lrn);
        continue;
      }

      const doc = await Student.create({
        classId,
        name,
        lrn,
        scores: {},
        finalGrade: 0,
      });

      created.push(doc);
    }

    return res.status(201).json({ createdCount: created.length, skipped, created });
  } catch (err) {
    console.error("Enlist error:", err);
    return res.status(500).json({ message: "Enlist failed", error: err.message });
  }
});

app.delete("/api/students/:classId/:lrn", requireTeacher, async (req, res) => {
  const { classId, lrn } = req.params;

  const result = await Student.findOneAndDelete({ classId, lrn });
  if (!result) return res.status(404).json({ message: "Student not found" });

  // ✅ ALSO remove attendance records for this student in this class (all dates)
  const key = `records.${String(lrn).trim()}`;
  await Attendance.updateMany(
    { classId },
    { $unset: { [key]: "" } }
  );

  res.json({ message: "Student deleted + attendance cleared" });
});

// Update ONE score field and recompute final grade
app.put("/api/students/:classId", requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;
    const { lrn, scoreKey, scoreValue } = req.body;

    if (!lrn || !scoreKey) {
      return res.status(400).json({ message: "lrn and scoreKey are required" });
    }

    const student = await Student.findOne({ classId, lrn });
    if (!student) return res.status(404).json({ message: "Student not found for this class" });

    // set score
    student.scores.set(scoreKey, Number(scoreValue) || 0);

    // compute final grade based on class lessons + weights
    const cls = await Class.findById(classId);
    if (cls) student.finalGrade = computeFinalFromLessons(student, cls);

    await student.save();

    res.json({ message: "Score updated", finalGrade: student.finalGrade, student });
  } catch (err) {
    console.error("PUT /api/students/:classId error:", err);
    res.status(500).json({ message: "Failed to update score" });
  }
});

app.get("/api/enrollments/by-lrn/:lrn", async (req, res) => {
  const lrn = String(req.params.lrn || "").trim();

  const enrollments = await Student.find({ lrn }).sort({ createdAt: -1 });
  const classIds = [...new Set(enrollments.map(e => String(e.classId)))];
  const classes = await Class.find({ _id: { $in: classIds } });

  const classMap = new Map(classes.map(c => [String(c._id), c]));

  res.json(enrollments.map(e => {
    const cls = classMap.get(String(e.classId));
    return {
      classId: String(e.classId),
      className: cls?.name || "Unnamed Class",
      lrn: e.lrn,
      name: e.name,
      finalGrade: e.finalGrade,
      scores: e.scores,
    };
  }));
});

/* =========================
   ATTENDANCE
========================= */
// Teacher view: all attendance issues (ABSENT/TARDY) for a class across dates
app.get("/api/attendance/issues/:classId", requireTeacher, async (req, res) => {
  try {
    const { classId } = req.params;

    const docs = await Attendance.find({ classId }).sort({ dateKey: -1 }).lean();

    const students = await Student.find({ classId }).select("lrn name").lean();
    const nameMap = new Map(students.map(s => [String(s.lrn), s.name]));

    const out = [];

    for (const d of docs) {
      const dateKey = d.dateKey;

      // records might be Map or object
      const recordsObj = d.records?.toObject?.() || d.records || {};

      for (const [lrn, rec] of Object.entries(recordsObj)) {
        // ✅ skip if student is no longer enrolled in this class
        if (!nameMap.has(String(lrn))) continue;

        const status = String(rec?.status || "").toUpperCase();
        if (status !== "ABSENT" && status !== "TARDY") continue;

        out.push({
          dateKey,
          lrn,
          name: nameMap.get(String(lrn)) || "",
          status,
          time: rec?.time || ""
        });
      }
    }

    res.json(out);
  } catch (err) {
    console.error("GET /api/attendance/issues error:", err);
    res.status(500).json({ message: "Failed to load attendance issues", error: err.message });
  }
});

// Get attendance for a class + dateKey
app.get("/api/attendance/:classId/:dateKey", async (req, res) => {
  try {
    const { classId, dateKey } = req.params;

    const doc = await Attendance.findOne({ classId, dateKey });
    // if no doc yet, return empty
    if (!doc) return res.json({ classId, dateKey, records: {} });

    res.json({ classId, dateKey, records: doc.records || {} });
  } catch (err) {
    console.error("GET /api/attendance error:", err);
    res.status(500).json({ message: "Failed to load attendance" });
  }
});

// Upsert ONE student's attendance status
app.put("/api/attendance/:classId/:dateKey", requireTeacher, async (req, res) => {
  try {
    const { classId, dateKey } = req.params;
    const { lrn, status, time } = req.body;

    if (!lrn) return res.status(400).json({ message: "lrn is required" });

    const cleanStatus = String(status || "").toUpperCase();
    if (!["PRESENT", "TARDY", "ABSENT"].includes(cleanStatus)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const updatePath = `records.${lrn}`;

    // ✅ ONLY store issues:
    // - PRESENT => remove record (so it doesn't appear in history)
    // - TARDY/ABSENT => save record
    const update =
      cleanStatus === "PRESENT"
        ? { $unset: { [updatePath]: "" } }
        : {
          $set: {
            classId,
            dateKey,
            [updatePath]: { status: cleanStatus, time: String(time || "") },
          },
        };

    const doc = await Attendance.findOneAndUpdate(
      { classId, dateKey },
      update,
      { upsert: true, new: true }
    );

    res.json({ message: "Attendance saved", classId, dateKey, records: doc.records || {} });
  } catch (err) {
    console.error("PUT /api/attendance error:", err);
    res.status(500).json({ message: "Failed to save attendance" });
  }
});

// History of ONLY issues (Absent/Tardy) for one student in one class
app.get("/api/attendance/history/:classId/:lrn", async (req, res) => {
  try {
    const { classId, lrn } = req.params;
    const key = `records.${String(lrn).trim()}`;

    const docs = await Attendance.find({
      classId,
      [key]: { $exists: true } // only days where this student has an issue saved
    })
      .sort({ dateKey: -1 })
      .lean();

    const out = docs.map(d => {
      const rec = d.records?.[lrn] || d.records?.get?.(lrn);
      return {
        dateKey: d.dateKey,
        status: rec?.status || "",
        time: rec?.time || ""
      };
    });

    res.json(out);
  } catch (err) {
    console.error("GET /api/attendance/history error:", err);
    res.status(500).json({ message: "Failed to load attendance history" });
  }
});

/* =========================
   FRONTEND ROUTES
========================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   ADMIN API (DAY 2)
========================= */

// List admins (for debugging - not linked in frontend)
app.get("/dev/list-admins", async (req, res) => {
  const admins = await AdminAccount.find().select("email name createdAt");
  res.json(admins);
});

// List teachers
app.get("/api/admin/teachers", requireAdmin, async (req, res) => {
  const teachers = await TeacherAccount.find()
    .sort({ createdAt: -1 })
    .select("username name email disabled createdAt");
  res.json(teachers);
});

// List students (accounts)
app.get("/api/admin/students", requireAdmin, async (req, res) => {
  const students = await StudentAccount.find()
    .sort({ createdAt: -1 })
    .select("lrn name mustChangePassword disabled createdAt");

  res.json(students);
});

// Reset student password -> Student123 + force change
app.patch("/api/admin/students/:lrn/reset-password", requireAdmin, async (req, res) => {
  const lrn = String(req.params.lrn || "").trim();
  const newHash = await bcrypt.hash("Student123", 10);

  const updated = await StudentAccount.findOneAndUpdate(
    { lrn },
    { $set: { passwordHash: newHash, mustChangePassword: true } },
    { new: true }
  );

  if (!updated) return res.status(404).json({ message: "Student not found" });
  res.json({ message: "Reset to Student123", lrn: updated.lrn });
});

// Reset teacher password -> Teacher123
app.patch("/api/admin/teachers/:username/reset-password", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  const newHash = await bcrypt.hash("Teacher123", 10);

  const updated = await TeacherAccount.findOneAndUpdate(
    { username },
    { $set: { passwordHash: newHash } },
    { new: true }
  );

  if (!updated) return res.status(404).json({ message: "Teacher not found" });
  res.json({ message: "Reset to Teacher123", username: updated.username });
});

// Delete student account + remove enrollments in ALL classes (cleanup)
app.delete("/api/admin/students/:lrn", requireAdmin, async (req, res) => {
  try {
    const lrn = String(req.params.lrn || "").trim();

    // 1) delete the login account
    const acc = await StudentAccount.deleteOne({ lrn });

    // 2) delete all enrollments (Student docs) across all classes
    const enrollments = await Student.deleteMany({ lrn });

    return res.json({
      message: "Student account + enrollments deleted",
      lrn,
      deletedAccount: acc.deletedCount || 0,
      deletedEnrollments: enrollments.deletedCount || 0
    });
  } catch (err) {
    console.error("Admin delete student error:", err);
    res.status(500).json({ message: "Failed to delete student account" });
  }
});

// Disable/Enable STUDENT account
app.patch("/api/admin/students/:lrn/disable", requireAdmin, async (req, res) => {
  const lrn = String(req.params.lrn || "").trim();
  const updated = await StudentAccount.findOneAndUpdate(
    { lrn },
    { $set: { disabled: true } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: "Student not found" });
  res.json({ message: "Student disabled", lrn: updated.lrn, disabled: updated.disabled });
});

app.patch("/api/admin/students/:lrn/enable", requireAdmin, async (req, res) => {
  const lrn = String(req.params.lrn || "").trim();
  const updated = await StudentAccount.findOneAndUpdate(
    { lrn },
    { $set: { disabled: false } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: "Student not found" });
  res.json({ message: "Student enabled", lrn: updated.lrn, disabled: updated.disabled });
});

// Disable/Enable TEACHER account
app.patch("/api/admin/teachers/:username/disable", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  const updated = await TeacherAccount.findOneAndUpdate(
    { username },
    { $set: { disabled: true } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: "Teacher not found" });
  res.json({ message: "Teacher disabled", username: updated.username, disabled: updated.disabled });
});

app.patch("/api/admin/teachers/:username/enable", requireAdmin, async (req, res) => {
  const username = String(req.params.username || "").trim();
  const updated = await TeacherAccount.findOneAndUpdate(
    { username },
    { $set: { disabled: false } },
    { new: true }
  );
  if (!updated) return res.status(404).json({ message: "Teacher not found" });
  res.json({ message: "Teacher enabled", username: updated.username, disabled: updated.disabled });
});

app.post("/api/admin/teachers", requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const username = String(req.body.username || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !username || !password) {
      return res.status(400).json({ message: "name, username, password required" });
    }

    const exists = await TeacherAccount.findOne({
      $or: [{ username }, ...(email ? [{ email }] : [])]
    });
    if (exists) return res.status(409).json({ message: "Teacher already exists" });

    const passwordHash = await bcrypt.hash(password, 10);

    await TeacherAccount.create({
      name,
      username,
      email: email || undefined,
      passwordHash,
      disabled: false
    });

    res.status(201).json({ message: "Teacher created" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create teacher", error: err.message });
  }
});

/* =========================
   START
========================= */
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);