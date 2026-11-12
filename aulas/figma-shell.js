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
    requestAnimationFrame(() => {
      // Catálogo paginado na horizontal: troca de página em vez de rolar.
      if (window.__shmCatalogPage) window.__shmCatalogPage(section === "apps" ? "proj" : section === "papers" ? "papers" : "intro");
      else if (section !== "catalog") document.getElementById(section === "apps" ? "proj" : "papersSec")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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

/* Catálogo em páginas horizontais: Visão geral · uma página por fase · Projetos · Artigos.
   Os blocos originais continuam no lugar (ids e scripts intactos); só a visibilidade muda. */
(() => {
  const catalog = document.getElementById("catalog");
  const head = catalog?.querySelector(":scope > div");
  const phases = document.getElementById("phases");
  if (!catalog || !head || !phases) return;
  const KEY = "nocoes-prog-shm-pagina";
  const intro = [...head.children].filter(el => !["phases", "proj", "papersSec"].includes(el.id));
  const pages = () => {
    const list = [{ key: "intro", label: "Visão geral", els: intro }];
    [...phases.querySelectorAll(":scope > .phase")].forEach((ph, i) => {
      const label = ph.querySelector("h3")?.textContent?.trim() || "Fase " + (i + 1);
      list.push({ key: "f" + (i + 1), label, els: [ph], count: ph.querySelectorAll(".course").length });
    });
    list.push({ key: "proj", label: "Projetos integradores", els: [document.getElementById("proj")] });
    list.push({ key: "papers", label: "Artigos científicos", els: [document.getElementById("papersSec")] });
    return list;
  };
  let current = "intro";
  try { current = sessionStorage.getItem(KEY) || "intro"; } catch {}

  const bar = document.createElement("nav");
  bar.className = "cat-pager";
  bar.setAttribute("aria-label", "Páginas do catálogo");
  bar.innerHTML = '<button type="button" class="cp-arrow" data-dir="-1" aria-label="Página anterior">‹</button><div class="cp-tabs" role="tablist"></div><button type="button" class="cp-arrow" data-dir="1" aria-label="Próxima página">›</button>';
  const tabs = bar.querySelector(".cp-tabs");
  const foot = document.createElement("div");
  foot.className = "cat-pager-foot";
  const overview = document.createElement("div");
  overview.className = "cat-overview";
  head.prepend(bar);
  head.append(foot);
  intro.filter(el => el.classList.contains("summary") || el.id === "summary").forEach(el => el.after(overview));
  if (!overview.isConnected) intro[intro.length - 1]?.before(overview);
  intro.push(overview);
  // A visão geral vira um índice: um cartão por página do catálogo.
  const renderOverview = list => {
    overview.innerHTML = "";
    list.slice(1).forEach((pg, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "co-card";
      b.innerHTML = '<span class="co-n"></span><b></b><small></small>';
      b.querySelector(".co-n").textContent = String(i + 1).padStart(2, "0");
      b.querySelector("b").textContent = pg.label;
      b.querySelector("small").textContent = pg.count != null ? pg.count + (pg.count === 1 ? " curso" : " cursos") : pg.key === "proj" ? "aplicações que unem vários cursos" : "leituras recomendadas (SHM · SAGE)";
      b.addEventListener("click", () => show(pg.key));
      overview.append(b);
    });
  };
  let lastIndex = 0;
  function show(key, opts = {}) {
    const list = pages();
    let idx = list.findIndex(p => p.key === key);
    if (idx < 0) idx = 0;
    current = list[idx].key;
    try { sessionStorage.setItem(KEY, current); } catch {}
    const dir = idx >= lastIndex ? 1 : -1; lastIndex = idx;
    list.forEach((pg, i) => pg.els.forEach(el => {
      if (!el) return;
      el.classList.toggle("cat-off", i !== idx);
      if (i === idx && !opts.silent) { el.classList.remove("cat-in-l", "cat-in-r"); void el.offsetWidth; el.classList.add(dir > 0 ? "cat-in-r" : "cat-in-l"); }
    }));
    const navKey = current === "proj" ? "apps" : current === "papers" ? "papers" : "catalog";
    document.querySelectorAll("[data-study-nav]").forEach(el => { if (el.dataset.studyNav === navKey) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
    tabs.innerHTML = "";
    list.forEach((pg, i) => {
      const t = document.createElement("button");
      t.type = "button"; t.setAttribute("role", "tab"); t.className = "cp-tab";
      t.setAttribute("aria-selected", String(i === idx));
      t.textContent = i === 0 ? pg.label : (i < list.length - 2 ? (i) + ". " : "") + pg.label;
      t.addEventListener("click", () => show(pg.key));
      tabs.append(t);
    });
    tabs.children[idx]?.scrollIntoView?.({ block: "nearest", inline: "center" });
    bar.querySelector('[data-dir="-1"]').disabled = idx === 0;
    bar.querySelector('[data-dir="1"]').disabled = idx === list.length - 1;
    const prev = list[idx - 1], next = list[idx + 1];
    foot.innerHTML = "";
    const mk = (pg, cls, txt) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = txt; b.addEventListener("click", () => { show(pg.key); catalog.scrollIntoView({ block: "start" }); window.scrollTo?.(0, 0); }); return b; };
    if (prev) foot.append(mk(prev, "cpf-prev", "← " + prev.label));
    const pos = document.createElement("span"); pos.className = "cpf-pos"; pos.textContent = (idx + 1) + " / " + list.length; foot.append(pos);
    if (next) foot.append(mk(next, "pri cpf-next", next.label + " →"));
    if (idx === 0) renderOverview(list);
  }
  const step = d => { const list = pages(); const i = list.findIndex(p => p.key === current); const n = list[Math.max(0, Math.min(list.length - 1, i + d))]; if (n) show(n.key); };
  bar.addEventListener("click", e => { const a = e.target.closest(".cp-arrow"); if (a) step(+a.dataset.dir); });
  document.addEventListener("keydown", e => {
    if (catalog.hidden || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.("input,textarea,select,[contenteditable=true],.CodeMirror")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); step(-1); }
  });
  // Deslizar para os lados no toque.
  let sx = null, sy = 0;
  catalog.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  catalog.addEventListener("touchend", e => {
    if (sx == null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  // O catálogo é redesenhado ao voltar de um curso: reaplica a página atual.
  new MutationObserver(() => show(current, { silent: true })).observe(phases, { childList: true });
  window.__shmCatalogPage = key => show(key);
  show(current, { silent: true });
})();
