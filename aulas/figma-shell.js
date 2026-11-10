/* Navegação SHM Studio — os cursos originais continuam sendo a fonte de verdade. */
(() => {
  const home = document.getElementById("home");
  const panel = document.getElementById("studyCourseList");
  const getCards = () => [...document.querySelectorAll("#phases .course")];
  if (!home || !panel) return;
  const buttons = [];
  getCards().forEach((card, index) => {
    const title = card.querySelector("h4")?.textContent?.trim();
    if (!title) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sn-course";
    const num = document.createElement("span");
    num.setAttribute("aria-hidden", "true");
    num.textContent = String(index + 1).padStart(2, "0");
    button.append(num, document.createTextNode(title));
    button.addEventListener("click", () => {
      getCards()[index]?.click();
      sync("course");
    });
    panel.append(button);
    buttons.push(button);
  });
  const navItems = [...document.querySelectorAll("[data-study-nav]")];
  function sync(selection) {
    const inPlayer = !document.getElementById("player").hidden;
    const title = document.getElementById("ctitle").textContent.trim();
    const section = selection || (inPlayer ? "course" : "catalog");
    navItems.forEach(el => {
      if (el.dataset.studyNav === section) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
    buttons.forEach(button => {
      const active = inPlayer && button.textContent.slice(2).trim() === title;
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }
  function go(section) {
    home.click();
    if (section !== "catalog") {
      requestAnimationFrame(() => {
        document.getElementById(section === "apps" ? "proj" : "papersSec")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    requestAnimationFrame(() => sync(section));
  }
  navItems.forEach(el => {
    if (el.tagName !== "A") el.addEventListener("click", () => go(el.dataset.studyNav));
  });
  window.addEventListener("hashchange", () => requestAnimationFrame(() => sync()));
  window.addEventListener("popstate", () => requestAnimationFrame(() => sync()));
  document.getElementById("catalog")?.addEventListener("click", event => {
    if (event.target.closest(".course")) requestAnimationFrame(() => sync("course"));
  });
  document.getElementById("back")?.addEventListener("click", () => requestAnimationFrame(() => sync("catalog")));
  home.addEventListener("click", () => requestAnimationFrame(() => sync("catalog")));
  sync();
})();
