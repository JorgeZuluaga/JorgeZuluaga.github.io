import re

file_path = "/Users/jzuluaga/Library/CloudStorage/GoogleDrive-zuluagajorge@gmail.com/Mi unidad/Dropbox/Personal/ArchivoPersonal/CurriculumVItae/jorgezuluaga/assets/app.js"
with open(file_path, "r") as f:
    content = f.read()

# Replace the courses rendering in renderTeaching
target_1 = """  const courses = profile.teaching?.courses ?? [];
  for (const c of courses) {
    const li = document.createElement("li");
    const title = c.title || "";
    const inst = c.institution || "";
    const level = c.level || "";
    const years = c.years || "";
    li.innerHTML = `<strong>${escapeHtml(title)}</strong>${
      inst ? ` — ${escapeHtml(inst)}` : ""
    }${level ? `, ${escapeHtml(level)}` : ""}${years ? `, ${escapeHtml(years)}` : ""}`;
    coursesEl.appendChild(li);
  }"""
replacement_1 = """  // Courses are now loaded from teaching-classroom.json in main()"""
content = content.replace(target_1, replacement_1)

# Inject the classroom logic in main
target_2 = """  const profile = await loadProfile().catch(() => null);
  renderTeaching(profile);

  const entries = await loadAll();"""
replacement_2 = """  const profile = await loadProfile().catch(() => null);
  renderTeaching(profile);

  const coursesEl = document.getElementById("teaching-courses");
  if (coursesEl) {
    try {
      const res = await fetch("./sources/teaching-classroom.json", { cache: "no-store" });
      if (res.ok) {
        const classroomCourses = await res.json();
        const udeACourses = classroomCourses.filter(c => c.section && c.section.includes("UdeA"));
        
        for (const c of udeACourses) {
          const li = document.createElement("li");
          const name = c.name || "";
          const section = c.section || "";
          const dateObj = new Date(c.creationTime);
          const dateStr = isNaN(dateObj) ? (c.creationTime || "") : dateObj.toLocaleDateString("es-CO");
          const students = c.enrollmentCount ?? 0;
          
          li.innerHTML = `<strong>${escapeHtml(name)}</strong> — ${escapeHtml(section)} (Creado: ${escapeHtml(dateStr)}, Estudiantes: ${students})`;
          coursesEl.appendChild(li);
        }
      }
    } catch (err) {
      console.error("Error loading classroom courses:", err);
    }
  }

  const entries = await loadAll();"""
content = content.replace(target_2, replacement_2)

with open(file_path, "w") as f:
    f.write(content)

print("Script execution complete")
