console.log("RUNNING: public/script.js", new Date().toLocaleTimeString());

// =========================================================
// 1. CORE STATE & CONFIG
// =========================================================
let currentClass = null;
let allClasses = [];
let currentStudents = [];
let loggedInUser = null;
function isStudent() {
  return loggedInUser?.role === "student";
}

function myLRN() {
  return String(loggedInUser?.lrn || "").trim();
}

function authHeaders() {
  const role = (loggedInUser?.role || "").toLowerCase();

  const h = {
    "Content-Type": "application/json",
    "x-role": role
  };

  // ✅ only teachers need x-username for class ownership
  if (role === "teacher") {
    h["x-username"] = String(loggedInUser?.username || "").trim();
  }

  return h;
}

async function loadStudentEnrollments() {
  if (!isStudent()) return;

  const card = document.getElementById("student-records-card");
  const listEl = document.getElementById("student-class-list");
  if (!card || !listEl) return;

  card.style.display = "block";
  listEl.innerHTML = "Loading...";

  try {
    const res = await fetch(`${BASE_URL}/api/enrollments/by-lrn/${myLRN()}`);
    const enrollments = await res.json();

    if (!Array.isArray(enrollments) || enrollments.length === 0) {
      listEl.innerHTML = "<div>No classes yet.</div>";
      return;
    }

    // render buttons
    listEl.innerHTML = "";
    enrollments.forEach(e => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-button";
      btn.style.textAlign = "left";
      btn.innerHTML = `
        <div style="font-weight:700;">${e.className || "Unnamed Class"}</div>
        <div style="font-size:12px; opacity:.8;">Final Grade: <b>${e.finalGrade ?? 0}</b></div>
      `;

      btn.onclick = async () => {
        // set currentClass so your existing gradebook UI works
        currentClass = { _id: e.classId, name: e.className };

        // get full class doc (lessons, weights) so gradebook columns appear
        const classesRes = await fetch(CLASS_API_URL);
        const classes = await classesRes.json();
        const full = (classes || []).find(c => String(c._id) === String(e.classId));
        if (full) currentClass = full;

        await fetchStudentsForCurrentClass(); // will filter to myLRN in renderGradebook()
        showPage("gradebook-view");
        renderGradebook();
        await loadStudentAttendanceHistory();
      };

      listEl.appendChild(btn);
    });

  } catch (err) {
    console.error(err);
    listEl.innerHTML = "<div>Failed to load records.</div>";
  }
}

let LESSONS = []; // currentClass lessons

const BASE_URL = window.location.origin;
const CLASS_API_URL = `${BASE_URL}/api/classes`;
const STUDENT_API_URL = `${BASE_URL}/api/students`;

console.log("Button exists right now?", !!document.getElementById("admin-create-teacher-btn"));
// =========================================================
// 2. PAGE MANAGEMENT
// =========================================================
function showPage(pageId) {
  // ✅ students cannot access teacher setup pages
  if (isStudent() && (pageId === 'class-management-view' || pageId === 'class-setup-view')) {
    pageId = 'dashboard-page';
  }

  document.querySelectorAll('.app-page').forEach(p => p.style.display = 'none');
  const page = document.getElementById(pageId);
  if (page) page.style.display = 'block';

  applyRoleRestrictions();
  updateCurrentClassUI();
}
window.showPage = showPage;

// =========================================================
// 3. LIVE DATE & TIME
// =========================================================
function updateDateTime() {
  const dateEl = document.getElementById('current-date');
  const timeEl = document.getElementById('current-time');
  if (!dateEl || !timeEl) return;

  const now = new Date();
  dateEl.textContent = now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  timeEl.textContent = now.toLocaleTimeString();

  setTimeout(updateDateTime, 1000);
}
window.addEventListener('load', updateDateTime);

// =========================================================
// 4. LOGIN
// =========================================================
function showLoginForm(role) {
  const adminForm = document.getElementById('admin-login-section');
  const teacherForm = document.getElementById('teacher-login-section');
  const studentForm = document.getElementById('student-login-section');
  if (!adminForm || !teacherForm || !studentForm) return;

  adminForm.style.display = role === 'admin' ? 'block' : 'none';
  teacherForm.style.display = role === 'teacher' ? 'block' : 'none';
  studentForm.style.display = role === 'student' ? 'block' : 'none';
}
document.getElementById('admin-select-btn')?.addEventListener('click', () => showLoginForm('admin'));
document.getElementById('teacher-select-btn')?.addEventListener('click', () => showLoginForm('teacher'));
document.getElementById('student-select-btn')?.addEventListener('click', () => showLoginForm('student'));

document.getElementById('admin-login-section')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('admin-email').value.trim().toLowerCase();
  const password = document.getElementById('admin-password').value;
  await performLogin({ role: 'admin', email, password });
});

document.getElementById('teacher-login-section')?.addEventListener('submit', async e => {
  e.preventDefault();
  const username = document.getElementById('teacher-username').value.trim();
  const password = document.getElementById('teacher-password').value;
  await performLogin({ role: 'teacher', username, password });
});

document.getElementById('student-login-section')?.addEventListener('submit', async e => {
  e.preventDefault();
  const lrn = document.getElementById('student-lrn').value;
  const password = document.getElementById('student-password').value;
  await performLogin({ role: 'student', lrn, password });
});

async function performLogin(payload) {
  try {
    const res = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.message || "Login failed");
      return; // ✅ stop
    }

    loggedInUser = data.user;

    const pwCard = document.getElementById("student-change-password-card");
    if (pwCard) pwCard.style.display = (loggedInUser.role === "student") ? "block" : "none";

    // ✅ ADMIN goes to admin dashboard ONLY
    if (loggedInUser.role === "admin") {
      const el = document.getElementById("admin-email-display");
      if (el) el.textContent = loggedInUser.email || "";
      showPage("admin-dashboard-view");
      return; // ⛔ stop here, do NOT load teacher/student logic
    }

    // ✅ teacher & student flow stays the same
    document.getElementById("user-display").textContent = loggedInUser.name;
    document.getElementById("user-role-display").textContent = loggedInUser.role;

    showPage("dashboard-page");
    await fetchClasses();
    await loadStudentEnrollments();

  } catch (err) {
    console.error(err);
    alert("Server error.");
  }
}

document.getElementById("change-password-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const currentPassword = document.getElementById("cp-current").value;
  const newPassword = document.getElementById("cp-new").value;
  const confirmPassword = document.getElementById("cp-confirm").value;

  if (newPassword !== confirmPassword) return alert("Passwords do not match.");
  if (newPassword.length < 6) return alert("New password must be at least 6 characters.");

  try {
    const res = await fetch(`${BASE_URL}/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "student",
        lrn: loggedInUser.lrn,
        currentPassword,
        newPassword
      })
    });

    const data = await res.json();
    if (!res.ok) return alert(data.message || "Failed to change password.");

    // update local state so it won't redirect again
    loggedInUser.mustChangePassword = false;

    alert("Password updated! Logging you in...");
    showPage("dashboard-page");

    await fetchClasses();
    await loadStudentEnrollments();

  } catch (err) {
    console.error(err);
    alert("Server error changing password.");
  }
});

// =========================================================
// 5. ROLE RESTRICTIONS
// =========================================================
function applyRoleRestrictions() {
  if (!loggedInUser) return;
  const student = isStudent();

  // teacher-only boxes
  document.querySelectorAll('.add-class-box, .enlistment-box').forEach(el => {
    el.style.display = student ? 'none' : 'block';
  });

  // teacher-only nav
  const manageBtn = document.getElementById('manage-classes-nav-button');
  if (manageBtn) manageBtn.style.display = student ? 'none' : 'inline-block';

  // gradebook controls (student = view-only)
  const addLessonBtn = document.getElementById('add-assignment-button');
  if (addLessonBtn) addLessonBtn.style.display = student ? 'none' : 'inline-block';

  // (Optional) if you add QR later, hide scan for students:
  const scanBtn = document.getElementById('open-qr-scanner');
  if (scanBtn) scanBtn.style.display = student ? 'none' : 'inline-block';

  // student-only records card
  const recordsCard = document.getElementById("student-records-card");
  if (recordsCard) recordsCard.style.display = isStudent() ? "block" : "none";

  // hide attendance & gradebook nav for students
  const attBtn = document.getElementById("attendance-nav-button");
  const gbBtn = document.getElementById("gradebook-nav-button");

  if (attBtn) attBtn.style.display = isStudent() ? "none" : "inline-block";
  if (gbBtn) gbBtn.style.display = isStudent() ? "none" : "inline-block";

  // student-only change password card
  const pwCard = document.getElementById("student-change-password-card");
  if (pwCard) pwCard.style.display = isStudent() ? "block" : "none";
}

// =========================================================
// 6. CLASSES & SECTION NAME UPDATE
// =========================================================
async function fetchClasses() {
  if (!loggedInUser) return;
  try {
    const res = await fetch(CLASS_API_URL, { headers: authHeaders() });
    allClasses = await res.json();

    // ✅ Student should only see their enrolled classes
    if (isStudent()) {
      const allowed = new Set((loggedInUser.classIds || []).map(String));
      allClasses = allClasses.filter(c => allowed.has(String(c._id)));

      // auto-select first class
      currentClass = allClasses[0] || null;
      if (currentClass) {
        LESSONS = currentClass.lessons || [];
        await fetchStudentsForCurrentClass();
        updateCurrentClassUI();
      }
    }


    renderClassesList();

  } catch (err) {
    console.error('Error fetching classes:', err);
    alert('Cannot fetch classes. Check backend.');
  }
}

function renderClassesList() {
  const list = document.getElementById('class-list');
  if (!list) return;
  list.innerHTML = '';

  allClasses.forEach(cls => {
    const li = document.createElement('li');
    const isSelected = currentClass && currentClass._id === cls._id;

    const student = isStudent();

    li.innerHTML = `
          <span>${cls.name}</span>

          <button class="select-class-button" data-id="${cls._id}">
            ${isSelected ? 'Selected' : 'Select'}
          </button>

          ${student ? "" : `
            <button class="edit-class-button" style="margin-left:10px;">
              ✏️ Edit
            </button>

            <button class="delete-class-button" style="margin-left:10px;color:red;">
              Delete
            </button>
          `}
        `;

    if (isSelected) li.style.borderLeft = '5px solid #f3a03b';

    // SELECT CLASS
    li.querySelector('.select-class-button').onclick = async () => {
      currentClass = cls;
      LESSONS = currentClass.lessons || [];
      await fetchStudentsForCurrentClass();
      renderClassesList();
      updateCurrentClassUI();
      // ✅ no page change here
    };

    // EDIT CLASS NAME & WEIGHTS
    li.querySelector('.edit-class-button').onclick = async () => {
      currentClass = cls;
      LESSONS = currentClass.lessons || [];

      await fetchStudentsForCurrentClass();
      renderClassesList();
      updateCurrentClassUI();

      showPage('class-setup-view');
      loadWeightsIntoUI(currentClass);

      const sectionInput = document.getElementById('className');
      if (sectionInput) {
        sectionInput.value = currentClass.name;
        sectionInput.removeAttribute('readonly');
      }

      const enlistBox = document.querySelector('.enlistment-box');
      if (enlistBox && loggedInUser?.role === 'teacher') enlistBox.style.display = 'block';
    };

    // DELETE CLASS
    li.querySelector('.delete-class-button').onclick = async () => {
      if (!confirm('Delete this class and all its students?')) return;
      try {
        await fetch(`${CLASS_API_URL}/${cls._id}`, {
          method: "DELETE",
          headers: authHeaders()
        });
        if (currentClass && currentClass._id === cls._id) currentClass = null;
        await fetchClasses();
      } catch (err) {
        console.error('Error deleting class:', err);
        alert('Cannot delete class. Check backend.');
      }
    };

    list.appendChild(li);
  });
}

// UPDATE CLASS NAME & WEIGHTS
document.getElementById('save-weights-button')?.addEventListener('click', async () => {
  if (!currentClass) return;

  const sectionInput = document.getElementById('className');
  const weightWW = Number(document.getElementById('weight-ww').value) || 0;
  const weightPT = Number(document.getElementById('weight-pt').value) || 0;
  const weightQE = Number(document.getElementById('weight-qe').value) || 0;

  const totalWeight = weightWW + weightPT + weightQE;
  const weightTotalEl = document.getElementById('weight-total');
  weightTotalEl.textContent = totalWeight + '%';
  weightTotalEl.style.color = totalWeight !== 100 ? 'red' : 'black';
  if (totalWeight !== 100) return alert('Total weights must equal 100%');

  const newName = sectionInput.value.trim();
  if (!newName) return alert('Section name cannot be empty.');

  try {
    await fetch(`${CLASS_API_URL}/${currentClass._id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        name: newName,
        weights: [
          { category: 'Written Works', percentage: weightWW },
          { category: 'Performance Tasks', percentage: weightPT },
          { category: 'Quarterly Exam', percentage: weightQE }
        ]
      })
    });
    currentClass.name = newName;
    await fetchClasses();
    alert('Class name and weights updated!');
  } catch (err) {
    console.error('Error updating class:', err);
    alert('Cannot update class. Check backend.');
  }
});

// =========================================================
// 7. CURRENT CLASS UI
// =========================================================
function updateCurrentClassUI() {
  const title = document.querySelector('.class-title');
  const count = document.querySelector('.current-class-info p:last-child');
  if (!title || !count) return;

  if (!currentClass) {
    title.textContent = 'No Class Selected';
    count.textContent = 'Students Enrolled: 0';
    return;
  }
  title.textContent = currentClass.name;
  count.textContent = `Students Enrolled: ${currentStudents.length}`;
}

// =========================================================
// 8. ADD CLASS
// =========================================================
document.getElementById('add-class-button')?.addEventListener('click', async () => {
  const nameInput = document.getElementById('new-class-name');
  const name = nameInput.value.trim();
  if (!name) return alert('Class name required');

  try {
    await fetch(CLASS_API_URL, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name })
    });
    nameInput.value = '';
    await fetchClasses();
  } catch (err) {
    console.error('Error adding class:', err);
    alert('Cannot add class. Check backend.');
  }
});

// =========================================================
// 9. STUDENTS ENLIST / DELETE
// =========================================================
document.getElementById('enlist-student-button')?.addEventListener('click', async () => {
  if (!currentClass || !currentClass._id) return alert("Please select a class first.");

  const name = document.getElementById('enlist-name').value.trim();
  const lrn = document.getElementById('enlist-lrn').value.trim();
  if (!name || !lrn) return alert('Name and LRN are required');

  console.log("ENLISTING INTO CLASS:", currentClass._id, currentClass.name);

  try {
    await fetch(`${STUDENT_API_URL}/${currentClass._id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify([{ name, lrn }])
    });

    document.getElementById('enlist-name').value = '';
    document.getElementById('enlist-lrn').value = '';
    await fetchStudentsForCurrentClass();
  } catch (err) {
    console.error('Error enlisting student:', err);
    alert('Cannot enlist student. Check backend.');
  }
});

async function fetchStudentsForCurrentClass() {
  if (!currentClass) return;
  try {
    const res = await fetch(`${STUDENT_API_URL}/${currentClass._id}`);
    currentStudents = await res.json();
    renderEnrolledStudents();
    updateCurrentClassUI();
  } catch (err) {
    console.error('Error fetching students:', err);
  }
}

function renderEnrolledStudents() {
  const tbody = document.getElementById('enlisted-list-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  currentStudents.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
            <td>${s.name}</td>
            <td>${s.lrn}</td>
            <td><button class="delete-student-button" style="color:red;">Delete</button></td>
        `;
    tr.querySelector('button').onclick = async () => {
      if (!confirm('Delete this student?')) return;
      try {
        await fetch(`${STUDENT_API_URL}/${currentClass._id}/${s.lrn}`, {
          method: "DELETE",
          headers: authHeaders()
        });
        await fetchStudentsForCurrentClass();
      } catch (err) {
        console.error('Error deleting student:', err);
        alert('Cannot delete student. Check backend.');
      }
    };
    tbody.appendChild(tr);
  });
}

// =========================================================
// GRADEBOOK (LESSONS + WEIGHTED FINAL)  ✅ REPLACEMENT
// =========================================================

function normalizeCat(cat) {
  const c = String(cat || "").trim().toUpperCase();
  if (c === "WW" || c.includes("WRITTEN")) return "WW";
  if (c === "PT" || c.includes("PERFORMANCE")) return "PT";
  if (c === "QE" || c.includes("QUARTER") || c.includes("EXAM")) return "QE";
  return c;
}

// supports BOTH formats:
// A) weights object: { ww, pt, qe }
// B) weights array: [{category, percentage}]
function getWeightsWWPTQE() {
  const w = { WW: 40, PT: 30, QE: 30 };

  if (!currentClass || !currentClass.weights) return w;

  // A) object format
  if (typeof currentClass.weights === "object" && !Array.isArray(currentClass.weights)) {
    if (currentClass.weights.ww != null) w.WW = Number(currentClass.weights.ww) || 0;
    if (currentClass.weights.pt != null) w.PT = Number(currentClass.weights.pt) || 0;
    if (currentClass.weights.qe != null) w.QE = Number(currentClass.weights.qe) || 0;
    return w;
  }

  // B) array format
  if (Array.isArray(currentClass.weights)) {
    for (const item of currentClass.weights) {
      const cat = normalizeCat(item.category);
      const pct = Number(item.percentage) || 0;
      if (cat === "WW") w.WW = pct;
      if (cat === "PT") w.PT = pct;
      if (cat === "QE") w.QE = pct;
    }
  }

  return w;
}

function getScore(student, key) {
  return Number(student?.scores?.get?.(key) ?? student?.scores?.[key] ?? 0) || 0;
}

// ✅ Correct final grade: per-category % * weight
function computeFinal(student) {
  const lessons = Array.isArray(currentClass?.lessons) ? currentClass.lessons : [];
  const weights = getWeightsWWPTQE();

  let final = 0;

  for (const cat of ["WW", "PT", "QE"]) {
    const catLessons = lessons.filter(l => normalizeCat(l.category) === cat);
    if (!catLessons.length) continue;

    let earned = 0;
    let maxTotal = 0;

    for (const lesson of catLessons) {
      earned += getScore(student, lesson.dbKey);
      maxTotal += Number(lesson.max) || 0;
    }

    const percent = maxTotal ? (earned / maxTotal) * 100 : 0;
    final += percent * ((weights[cat] || 0) / 100);
  }

  return Math.round(final);
}

// ✅ Add lesson (instant UI update + saves to DB)
document.getElementById("add-assignment-button")?.addEventListener("click", async () => {
  if (!currentClass) return alert("Select a class first.");

  const name = prompt("Lesson name (e.g., Quiz 1):");
  if (!name) return;

  const category = prompt("Category: WW, PT, QE (example: WW)");
  if (!category) return;

  const cat = normalizeCat(category);
  if (!["WW", "PT", "QE"].includes(cat)) return alert("Invalid category. Use WW, PT, or QE.");

  const max = Number(prompt("Max score (e.g., 20, 50, 100):"));
  if (!max || max <= 0) return alert("Invalid max score.");

  const lesson = {
    name: name.trim(),
    category: cat,
    max,
    dbKey: "L" + Date.now()
  };

  try {
    const res = await fetch(`${CLASS_API_URL}/${currentClass._id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ lessons: [...(currentClass.lessons || []), lesson] })
    });

    const updated = await res.json();
    if (!res.ok) return alert(updated.message || "Failed to add lesson.");

    currentClass = updated;
    renderGradebook(); // ✅ shows immediately
  } catch (err) {
    console.error(err);
    alert("Backend error adding lesson.");
  }
});

// ✅ Delete lesson (instant UI update + saves to DB)
window.deleteLesson = async function (dbKey) {
  if (isStudent()) return alert("Students cannot delete lesson columns.");
  if (!currentClass) return;
  if (!confirm("Delete this lesson column?")) return;

  const updatedLessons = (currentClass.lessons || []).filter(l => l.dbKey !== dbKey);

  try {
    const res = await fetch(`${CLASS_API_URL}/${currentClass._id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ lessons: updatedLessons })
    });

    const updated = await res.json();
    if (!res.ok) return alert(updated.message || "Failed to delete lesson.");

    currentClass = updated;
    renderGradebook(); // ✅ disappears immediately
  } catch (err) {
    console.error(err);
    alert("Backend error deleting lesson.");
  }
};

// ✅ Render gradebook (dynamic columns + correct final)
function renderGradebook() {
  const head = document.getElementById("gradebook-head");
  const body = document.getElementById("gradebook-body");
  if (!head || !body) return;

  if (!currentClass) {
    head.innerHTML = `<tr><th>Please select a class first.</th></tr>`;
    body.innerHTML = "";
    return;
  }

  const lessons = Array.isArray(currentClass.lessons) ? currentClass.lessons : [];

  head.innerHTML = `
    <tr>
      <th>Name</th>
      <th>LRN</th>
      ${lessons.map(l => `
        <th>
          ${l.name} (${l.category}) / ${l.max}
          ${isStudent() ? "" : `<button onclick="deleteLesson('${l.dbKey}')" style="margin-left:6px;color:red;">🗑</button>`}
        </th>
      `).join("")}
      <th>Final</th>
      <th>Action</th>
    </tr>
  `;

  body.innerHTML = "";

  const list = isStudent()
    ? currentStudents.filter(s => String(s.lrn) === myLRN())
    : currentStudents;

  list.forEach(student => {

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${student.name}</td>
      <td>${student.lrn}</td>
      ${lessons.map(l => {
      const val = getScore(student, l.dbKey);
      return `<td>
        <input
        type="number"
        min="0"
        max="${l.max}"
        step="1"
        value="${val}"
        class="gb-score"
        data-lrn="${student.lrn}"
        data-key="${l.dbKey}"
        style="width:70px;"
        ${isStudent() ? "disabled" : ""}
        />
        </td>`;
    }).join("")}
      <td class="final-cell" style="font-weight:bold;">${computeFinal(student)}</td>
      <td>
        ${isStudent() ? "" : '<button class="save-row-btn">Save</button>'}
      </td>`;

    // live update final
    tr.querySelectorAll("input[data-key]").forEach(inp => {
      inp.addEventListener("input", () => {
        const key = inp.dataset.key;
        student.scores ??= {};
        student.scores[key] = Number(inp.value) || 0;
        tr.querySelector(".final-cell").textContent = computeFinal(student);
      });
    });

    // save to backend
    if (!isStudent()) {
      tr.querySelector(".save-row-btn").onclick = async () => {
        const inputs = tr.querySelectorAll("input[data-key]");

        try {
          for (const inp of inputs) {
            const key = inp.dataset.key;
            const value = Number(inp.value) || 0;

            const res = await fetch(`${STUDENT_API_URL}/${currentClass._id}`, {
              method: "PUT",
              headers: authHeaders(),
              body: JSON.stringify({
                lrn: student.lrn,
                scoreKey: key,
                scoreValue: value
              })
            });

            if (!res.ok) {
              const txt = await res.text();
              console.error("Save failed:", txt);
              alert("Failed saving scores. Check backend PUT /api/students/:classId");
              return;
            }
          }

          await fetchStudentsForCurrentClass(); // reload students
          renderGradebook();                    // redraw
        } catch (err) {
          console.error(err);
          alert("Backend error saving scores.");
        }
      };
    }
    body.appendChild(tr);

  });
}

// =========================================================
// ATTENDANCE (MVP: load/save per class per date)
// =========================================================
const ATTENDANCE_API_URL = `${BASE_URL}/api/attendance`;

let attendanceRecords = {}; // { [lrn]: {status, time} }

function todayKey() {
  // YYYY-MM-DD in local time
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getSelectedAttendanceDateKey() {
  const el = document.getElementById("attendance-date");
  if (!el) return todayKey();
  return el.value || todayKey();
}

function setAttendanceDateToTodayIfEmpty() {
  const el = document.getElementById("attendance-date");
  if (!el) return;
  if (!el.value) el.value = todayKey();
}

async function loadAttendanceForCurrentClass() {
  if (!currentClass) return;

  setAttendanceDateToTodayIfEmpty();
  const dateKey = getSelectedAttendanceDateKey();

  try {
    const res = await fetch(`${ATTENDANCE_API_URL}/${currentClass._id}/${dateKey}`);
    const data = await res.json();

    attendanceRecords = data.records || {};
    renderAttendance(); // draw rows
    updateAttendanceStats();
  } catch (err) {
    console.error("Failed to load attendance:", err);
    attendanceRecords = {};
    renderAttendance();
    updateAttendanceStats();
  }
}

async function saveAttendance(lrn, status, timeStr) {
  if (isStudent()) return; // students cannot save attendance
  if (!currentClass) return;

  const dateKey = getSelectedAttendanceDateKey();

  try {
    const res = await fetch(`${ATTENDANCE_API_URL}/${currentClass._id}/${dateKey}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ lrn, status, time: timeStr || "" }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.message || "Failed to save attendance.");
      return;
    }

    // Update local cache (so UI stays in sync)
    attendanceRecords[lrn] = { status, time: timeStr || "" };
    updateAttendanceStats();
  } catch (err) {
    console.error("Failed to save attendance:", err);
    alert("Server error saving attendance.");
  }

  await loadAttendanceHistoryForCurrentClass();
}

function renderAttendance() {
  const tbody = document.getElementById("attendance-body");
  if (!tbody) {
    console.warn("Missing #attendance-body in HTML.");
    return;
  }

  tbody.innerHTML = "";

  if (!currentClass) {
    tbody.innerHTML = `<tr><td colspan="5">Select a class first.</td></tr>`;
    return;
  }

  if (!currentStudents || currentStudents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5">No students enrolled.</td></tr>`;
    return;
  }

  const list = isStudent()
    ? currentStudents.filter(s => String(s.lrn) === myLRN())
    : currentStudents;

  for (const s of list) {

    const rec = attendanceRecords?.[s.lrn] || { status: "PRESENT", time: "" };
    const status = String(rec.status || "ABSENT").toUpperCase();
    const time = rec.time || "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.lrn}</td>
      <td>${s.name}</td>
      <td class="att-time">${time}</td>
      <td>
        <select class="att-status" ${isStudent() ? "disabled" : ""}>
          <option value="PRESENT" ${status === "PRESENT" ? "selected" : ""}>Present</option>
          <option value="TARDY" ${status === "TARDY" ? "selected" : ""}>Tardy</option>
          <option value="ABSENT" ${status === "ABSENT" ? "selected" : ""}>Absent</option>
        </select>
      </td>
      <td>${isStudent() ? "" : '<button class="att-save-btn">Save</button>'}</td>
    `;

    const statusEl = tr.querySelector(".att-status");
    const timeEl = tr.querySelector(".att-time");
    const btn = tr.querySelector(".att-save-btn");

    if (!isStudent() && btn) btn.addEventListener("click", async () => {
      const newStatus = statusEl.value;

      // If marking Present/Tardy and time is empty, set time to now
      let newTime = timeEl.textContent || "";
      if ((newStatus === "PRESENT" || newStatus === "TARDY") && !newTime) {
        newTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        timeEl.textContent = newTime;
      }
      if (newStatus === "ABSENT") {
        // optional: clear time when absent
        newTime = "";
        timeEl.textContent = "";
      }

      btn.disabled = true;
      btn.textContent = "Saving...";
      await saveAttendance(s.lrn, newStatus, newTime);
      btn.disabled = false;
      btn.textContent = "Save";
    });

    tbody.appendChild(tr);
  }
}

function updateAttendanceStats() {
  const total = currentStudents?.length || 0;
  if (!total) return;

  let present = 0;
  let tardy = 0;
  let absent = 0;

  for (const s of currentStudents) {
    const rec = attendanceRecords?.[s.lrn];
    const st = String(rec?.status || "PRESENT").toUpperCase();
    if (st === "PRESENT") present++;
    else if (st === "TARDY") tardy++;
    else absent++;
  }

  const presentPct = Math.round((present / total) * 100);

  // Your HTML has three stat boxes. We'll fill them in order.
  const statEls = document.querySelectorAll("#attendance-view .stat-number");
  if (statEls.length >= 3) {
    statEls[0].textContent = `${presentPct}%`;
    statEls[1].textContent = `${tardy}`;
    statEls[2].textContent = `${absent}`;
  }
}

document.getElementById("attendance-date")?.addEventListener("change", async () => {
  if (!currentClass) return;
  await loadAttendanceForCurrentClass();
});

async function loadStudentAttendanceHistory() {
  const card = document.getElementById("student-att-history-card");
  const body = document.getElementById("student-att-history-body");
  if (!card || !body) return;

  // only students see this
  if (!isStudent() || !currentClass?._id) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  body.innerHTML = `<tr><td colspan="3">Loading...</td></tr>`;

  try {
    const res = await fetch(`${BASE_URL}/api/attendance/history/${currentClass._id}/${myLRN()}`);
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      body.innerHTML = `<tr><td colspan="3">No Absent/Tardy records 🎉</td></tr>`;
      return;
    }

    body.innerHTML = rows.map(r => `
      <tr>
        <td>${r.dateKey}</td>
        <td><b>${r.status}</b></td>
        <td>${r.time || ""}</td>
      </tr>
    `).join("");
  } catch (err) {
    console.error(err);
    body.innerHTML = `<tr><td colspan="3">Failed to load history.</td></tr>`;
  }
}

async function loadAttendanceHistoryForCurrentClass() {
  const box = document.getElementById("attendance-history-box");
  if (!box) return;

  // only teachers should see this box filled
  if (!currentClass?._id || isStudent()) {
    box.innerHTML = "Select a class to view history.";
    return;
  }

  box.innerHTML = "Loading...";

  try {
    const res = await fetch(`${BASE_URL}/api/attendance/issues/${currentClass._id}`, {
      headers: authHeaders()
    });
    const rows = await res.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      box.innerHTML = "<div>No Absent/Tardy records 🎉</div>";
      return;
    }

    // group by dateKey
    const byDate = {};
    for (const r of rows) {
      byDate[r.dateKey] ??= [];
      byDate[r.dateKey].push(r);
    }

    const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

    box.innerHTML = dates.map(dateKey => {
      const items = byDate[dateKey]
        .map(r => `<li><b>${r.name || r.lrn}</b> (${r.lrn}) — <b>${r.status}</b> ${r.time ? `@ ${r.time}` : ""}</li>`)
        .join("");

      return `
        <div style="margin-top:10px;">
          <div style="font-weight:700;">${dateKey}</div>
          <ul style="margin:6px 0 0 18px;">${items}</ul>
        </div>
      `;
    }).join("");

  } catch (err) {
    console.error(err);
    box.innerHTML = "<div>Failed to load history.</div>";
  }
}

// =========================================================
// 10. NAVIGATION
// =========================================================
document.getElementById('manage-classes-nav-button')?.addEventListener('click', () => showPage('class-management-view'));
document.getElementById('attendance-nav-button')?.addEventListener('click', async () => {
  if (!currentClass) return alert('Select a class first (My Classes).');

  // make sure students are loaded
  await fetchStudentsForCurrentClass();

  showPage('attendance-view');

  // set date + load saved statuses
  setAttendanceDateToTodayIfEmpty();
  await loadAttendanceForCurrentClass();

  await loadAttendanceHistoryForCurrentClass();
});

document.getElementById('gradebook-nav-button')?.addEventListener('click', async () => {
  if (!currentClass) return alert('Select a class first (My Classes).');
  // make sure we have latest students before showing
  await fetchStudentsForCurrentClass();
  showPage('gradebook-view');
  renderGradebook(); // we will add this next
});

// =========================================================
// 11. LOGOUT
// =========================================================
document.getElementById('logout-button')?.addEventListener('click', () => {
  loggedInUser = null;
  currentClass = null;
  currentStudents = [];

  const pwCard = document.getElementById("student-change-password-card");
  if (pwCard) pwCard.style.display = "none";

  // clear student lists safely
  const classList = document.getElementById("student-class-list");
  if (classList) classList.innerHTML = "";

  const recordsCard = document.getElementById("student-records-card");
  if (recordsCard) recordsCard.style.display = "none";

  showPage('login-view');
});
// ADMIN LOGOUT
document.getElementById("admin-logout-btn")?.addEventListener("click", () => {
  loggedInUser = null;
  currentClass = null;
  currentStudents = [];

  const pwCard = document.getElementById("student-change-password-card");
  if (pwCard) pwCard.style.display = "none";

  showPage("login-view");
});

// =========================================================
// 12. LOAD SAVED WEIGHTS INTO UI
// =========================================================
function loadWeightsIntoUI(cls) {
  if (!cls || !cls.weights) return;

  let ww = 0, pt = 0, qe = 0;

  // weights stored as object: { ww, pt, qe }
  if (typeof cls.weights === "object" && !Array.isArray(cls.weights)) {
    ww = Number(cls.weights.ww) || 0;
    pt = Number(cls.weights.pt) || 0;
    qe = Number(cls.weights.qe) || 0;
  }

  // weights stored as array: [{category, percentage}]
  if (Array.isArray(cls.weights)) {
    const wwObj = cls.weights.find(w => (w.category || "").includes("Written"));
    const ptObj = cls.weights.find(w => (w.category || "").includes("Performance"));
    const qeObj = cls.weights.find(w => (w.category || "").includes("Quarterly"));
    ww = Number(wwObj?.percentage) || 0;
    pt = Number(ptObj?.percentage) || 0;
    qe = Number(qeObj?.percentage) || 0;
  }

  document.getElementById("weight-ww").value = ww;
  document.getElementById("weight-pt").value = pt;
  document.getElementById("weight-qe").value = qe;

  const total = ww + pt + qe;
  const totalEl = document.getElementById("weight-total");
  if (totalEl) {
    totalEl.textContent = total + "%";
    totalEl.style.color = total !== 100 ? "red" : "black";
  }
}

// =========================================================
// GRADEBOOK INPUT VALIDATION (NO > MAX)
// =========================================================
document.getElementById('gradebook-table')?.addEventListener('input', (e) => {
  const inp = e.target;
  if (!inp.classList?.contains('gb-score')) return;

  const value = Number(inp.value);
  const max = Number(inp.max);

  // reset style
  inp.style.border = '';

  if (!Number.isFinite(value)) return;

  if (value < 0) {
    inp.style.border = '2px solid red';
    alert('Score cannot be below 0.');
    inp.value = 0;
    return;
  }

  if (Number.isFinite(max) && value > max) {
    inp.style.border = '2px solid red';
    alert(`Invalid score: ${value} is higher than the max (${max}).`);
    inp.value = max; // snap back to max
    return;
  }
});

// =========================
// ADMIN UI (DAY 2)
// =========================
let ADMIN_TEACHERS_CACHE = [];

async function loadAdminTeachers() {
  const box = document.getElementById("admin-teachers-list");
  if (!box) return;

  box.innerHTML = "Loading...";

  try {
    const res = await fetch(`${BASE_URL}/api/admin/teachers`, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      box.innerHTML = `<div>${data.message || "Failed to load teachers"}</div>`;
      return;
    }

    ADMIN_TEACHERS_CACHE = Array.isArray(data) ? data : [];
    renderAdminTeachersList();
  } catch (e) {
    console.error(e);
    box.innerHTML = "<div>Server error loading teachers.</div>";
  }
}

function renderAdminTeachersList() {
  const box = document.getElementById("admin-teachers-list");
  if (!box) return;

  const q = (document.getElementById("admin-teacher-search")?.value || "")
    .toLowerCase()
    .trim();

  const list = (ADMIN_TEACHERS_CACHE || []).filter(t => {
    const name = String(t.name || "").toLowerCase();
    const username = String(t.username || "").toLowerCase();
    return !q || name.includes(q) || username.includes(q);
  });

  if (!list.length) {
    box.innerHTML = "<div>No matching teachers.</div>";
    return;
  }

  box.innerHTML = "";

  list.forEach(t => {
    const disabled = !!t.disabled;

    const row = document.createElement("div");
    row.className = "card";
    row.style.marginTop = "10px";

    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <div>
          <div style="font-weight:700;">${t.name || "Unnamed Teacher"}</div>
          <div style="font-size:12px;opacity:.8;">Username: <b>${t.username}</b></div>
        </div>
        <span style="font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid #ddd;">
          ${disabled ? "⛔ Disabled" : "✅ Active"}
        </span>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
        <button class="nav-button" data-action="t-reset" data-username="${t.username}">
          🔑 Reset (Teacher123)
        </button>

        <button class="nav-button" data-action="${disabled ? "t-enable" : "t-disable"}" data-username="${t.username}">
          ${disabled ? "✅ Enable" : "⛔ Disable"}
        </button>
      </div>
    `;

    box.appendChild(row);
  });
}

// Open teachers page
document.getElementById("admin-teachers-btn")?.addEventListener("click", async () => {
  showPage("admin-teachers-view");
  await loadAdminTeachers();
});

// Refresh teachers
document.getElementById("admin-refresh-teachers")?.addEventListener("click", loadAdminTeachers);

// Search teachers
document.getElementById("admin-teacher-search")?.addEventListener("input", renderAdminTeachersList);

// Handle teacher buttons (reset/disable/enable)
document.getElementById("admin-teachers-list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const username = btn.dataset.username;
  if (!username) return;

  try {
    if (action === "t-reset") {
      if (!confirm(`Reset teacher ${username} to Teacher123?`)) return;

      const r = await fetch(`${BASE_URL}/api/admin/teachers/${encodeURIComponent(username)}/reset-password`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const out = await r.json();
      alert(out.message || (r.ok ? "Reset!" : "Failed"));
      return;
    }

    if (action === "t-disable" || action === "t-enable") {
      const endpoint = action === "t-disable" ? "disable" : "enable";
      const verb = endpoint === "disable" ? "Disable" : "Enable";
      if (!confirm(`${verb} teacher ${username}?`)) return;

      const r = await fetch(`${BASE_URL}/api/admin/teachers/${encodeURIComponent(username)}/${endpoint}`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const out = await r.json();
      alert(out.message || (r.ok ? "Updated!" : "Failed"));
      if (r.ok) await loadAdminTeachers();
      return;
    }
  } catch (err) {
    console.error(err);
    alert("Server/client error. Check console.");
  }
});

let ADMIN_STUDENTS_CACHE = [];

async function loadAdminStudents() {
  const box = document.getElementById("admin-students-list");
  if (!box) return;

  box.innerHTML = "Loading...";

  try {
    const res = await fetch(`${BASE_URL}/api/admin/students`, { headers: authHeaders() });
    const data = await res.json();

    if (!res.ok) {
      box.innerHTML = `<div>${data.message || "Failed to load students"}</div>`;
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      box.innerHTML = "<div>No students found.</div>";
      return;
    }

    box.innerHTML = "";

    data.forEach(s => {
      const row = document.createElement("div");
      row.className = "card";
      row.style.marginTop = "10px";

      row.innerHTML = `
        <div style="font-weight:700;">${s.name || "Unnamed Student"}</div>
        <div style="font-size:12px;opacity:.8;">LRN: <b>${s.lrn}</b></div>
        <div style="font-size:12px;opacity:.8;">Disabled: <b>${s.disabled ? "YES" : "no"}</b></div>

        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px;">
          <button class="nav-button" data-action="reset" data-lrn="${s.lrn}">
            🔑 Reset (Student123)
          </button>

          <button class="nav-button" data-action="${s.disabled ? "enable" : "disable"}" data-lrn="${s.lrn}">
            ${s.disabled ? "✅ Enable" : "⛔ Disable"}
          </button>

          <button class="nav-button" data-action="delete" data-lrn="${s.lrn}" style="background:#dc3545;color:white;">
            🗑 Delete Account
          </button>
        </div>
      `;

      box.appendChild(row);
    });

  } catch (e) {
    console.error(e);
    box.innerHTML = "<div>Server error loading students.</div>";
  }
}

// Open students page
document.getElementById("admin-students-btn")?.addEventListener("click", async () => {
  showPage("admin-students-view");
  await loadAdminStudents();
});

document.getElementById("admin-refresh-students")?.addEventListener("click", loadAdminStudents);

document.getElementById("admin-students-list")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const lrn = btn.dataset.lrn;
  if (!lrn) return;

  try {
    if (action === "reset") {
      if (!confirm(`Reset password for ${lrn} to Student123?`)) return;

      const r = await fetch(`${BASE_URL}/api/admin/students/${encodeURIComponent(lrn)}/reset-password`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const out = await r.json();
      alert(out.message || (r.ok ? "Reset!" : "Failed"));
      return;
    }

    if (action === "disable" || action === "enable") {
      const verb = action === "disable" ? "Disable" : "Enable";
      if (!confirm(`${verb} student account ${lrn}?`)) return;

      const r = await fetch(`${BASE_URL}/api/admin/students/${encodeURIComponent(lrn)}/${action}`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      const out = await r.json();
      alert(out.message || (r.ok ? "Updated!" : "Failed"));
      if (r.ok) await loadAdminStudents();
      return;
    }

    if (action === "delete") {
      if (!confirm(`DELETE student ${lrn}?\n\nThis removes login + all enrollments.`)) return;

      const r = await fetch(`${BASE_URL}/api/admin/students/${encodeURIComponent(lrn)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const out = await r.json();
      alert(out.message || (r.ok ? "Deleted!" : "Failed"));
      if (r.ok) await loadAdminStudents();
      return;
    }
  } catch (err) {
    console.error(err);
    alert("Server/client error. Check console.");
  }
});

// =========================
// ADMIN: CREATE TEACHER
// =========================
window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("admin-create-teacher-btn");
  console.log("Admin create teacher button found?", !!btn);

  if (!btn) return;

  btn.addEventListener("click", async () => {
    console.log("CREATE TEACHER CLICKED ✅");
    alert("Button works. Now we connect it to the server.");
  });
});

