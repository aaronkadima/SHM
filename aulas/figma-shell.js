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

/* Modo incorporado ao SHM Studio (?embed=studio): o Studio mantém sua barra superior,
   ferramentas laterais e barra de status; aqui ficam só o conteúdo e a navegação dos cursos. */
(() => {
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embed") === "studio" && window.parent !== window;
  const root = document.documentElement;
  const nav = document.querySelector(".study-nav");
  const list = document.getElementById("studyCourseList");
  const LAST = "trilha-dev-shm-ultimo-curso";

  // Busca de cursos na navegação lateral.
  if (nav && list) {
    const search = document.createElement("input");
    search.type = "search";
    search.className = "sn-search";
    search.placeholder = "Buscar curso…";
    search.setAttribute("aria-label", "Buscar curso na trilha");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      for (const b of list.querySelectorAll(".sn-course")) b.hidden = !!q && !b.textContent.toLowerCase().includes(q);
    });
    list.before(search);
  }

  // Continuar de onde parou: guarda o último curso aberto.
  const cards = () => [...document.querySelectorAll("#phases .course")];
  document.getElementById("catalog")?.addEventListener("click", e => {
    const card = e.target.closest(".course");
    const title = card?.querySelector("h4")?.textContent?.trim();
    if (title) try { localStorage.setItem(LAST, title); } catch {}
  });
  list?.addEventListener("click", e => {
    const b = e.target.closest(".sn-course");
    if (b) try { localStorage.setItem(LAST, b.textContent.slice(2).trim()); } catch {}
  });
  let last = ""; try { last = localStorage.getItem(LAST) || ""; } catch {}
  const target = last && cards().find(c => c.querySelector("h4")?.textContent?.trim() === last);
  const catalogHead = document.querySelector("#catalog > div");
  if (target && catalogHead) {
    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "resume-course";
    resume.innerHTML = '<span>Continuar de onde parou</span><b></b>';
    resume.querySelector("b").textContent = last;
    resume.addEventListener("click", () => target.click());
    catalogHead.append(resume);
  }

  if (!embedded) return;
  root.classList.add("studio-embed");
  const post = data => { try { window.parent.postMessage(data, location.origin); } catch {} };
  // Links para a plataforma voltam ao Studio pai, sem abrir uma segunda cópia dentro do iframe.
  for (const a of document.querySelectorAll('a[href^="../#/"]')) {
    a.addEventListener("click", e => { e.preventDefault(); post({ type: "shm-aulas:studio" }); });
  }
  // Créditos do rodapé passam para o fim da navegação lateral.
  const foot = document.querySelector(".study-nav .sn-foot");
  const toggle = document.getElementById("crToggle");
  if (foot && toggle) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "sn-credits"; btn.textContent = "Sobre o projeto e equipe";
    btn.addEventListener("click", () => { toggle.click(); document.getElementById("crPanel")?.scrollIntoView?.({ block: "nearest" }); });
    foot.before(btn);
  }
  // Gaveta de cursos em telas estreitas.
  if (nav) {
    const drawer = document.createElement("button");
    drawer.type = "button"; drawer.className = "sn-drawer-toggle"; drawer.textContent = "☰ Cursos";
    drawer.setAttribute("aria-expanded", "false");
    drawer.addEventListener("click", () => {
      const open = !root.classList.contains("sn-open");
      root.classList.toggle("sn-open", open); drawer.setAttribute("aria-expanded", String(open));
    });
    nav.addEventListener("click", e => { if (e.target.closest("button") && matchMedia("(max-width: 1100px)").matches) { root.classList.remove("sn-open"); drawer.setAttribute("aria-expanded", "false"); } });
    document.body.append(drawer);
  }
  // Breadcrumb do curso aparece no título do Studio.
  const crumb = document.getElementById("crumb");
  const sendCrumb = () => {
    const inPlayer = !document.getElementById("player")?.hidden;
    post({ type: "shm-aulas:crumb", crumb: inPlayer ? (document.getElementById("ctitle")?.textContent?.trim() || crumb?.textContent?.trim() || "") : "" });
  };
  if (crumb) new MutationObserver(sendCrumb).observe(crumb, { childList: true, characterData: true, subtree: true });
  const player = document.getElementById("player");
  if (player) new MutationObserver(sendCrumb).observe(player, { attributes: true, attributeFilter: ["hidden"] });
  sendCrumb();
})();
