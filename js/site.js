// =====================================================================
//  Site público: carrega os dados e desenha cada página.
//  Todo texto vindo do banco entra via textContent (nunca innerHTML),
//  então não há como injetar HTML/JS pelo painel ou pelos formulários.
// =====================================================================
(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  const LIVE = !!(C.supabaseUrl && C.supabaseAnonKey);
  const db = LIVE ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: false } }) : null;
  const page = document.body.dataset.page;
  const $ = (id) => document.getElementById(id);

  // ---------- utilitários ----------
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const icon = (id) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("aria-hidden", "true"); const u = document.createElementNS("http://www.w3.org/2000/svg", "use"); u.setAttribute("href", "#" + id); s.append(u); return s; };
  const brl = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const SAFE_PATH = /^(impressoras|manutencao)\/[A-Za-z0-9_-]+\.(webp|jpe?g|png)$/;
  const LOCAL_PATH = /^img\/impressoras\/[a-z0-9-]+\.(webp|svg|png|jpg)$/; // imagens guardadas no próprio site
  const imgUrl = (p) => !p ? null : LOCAL_PATH.test(p) ? p : (LIVE && SAFE_PATH.test(p)) ? `${C.supabaseUrl}/storage/v1/object/public/imagens/${p}` : null;
  let toastT;
  const toast = (msg, err) => { const t = $("toast"); if (!t) return; t.textContent = msg; t.className = "toast show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 3600); };
  const fone = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? "55" + d : d; };
  const waLink = (num, text) => `https://wa.me/${num}${text ? "?text=" + encodeURIComponent(text) : ""}`;

  // ---------- datas (sempre no horário de Brasília) ----------
  const TZ = "America/Sao_Paulo";
  function agoraBR() {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { iso: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), hhmm: `${p.hour}:${p.minute}`, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
  }
  const D = (iso) => new Date(iso + "T12:00:00Z");
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((D(b) - D(a)) / 86400000);
  const br = (s) => s.split("-").reverse().join("/");
  const wdOf = (s) => D(s).getUTCDay();
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

  // ---------- horário de atendimento ----------
  const HR = C.horario || { dias: [1, 2, 3, 4, 5], abre: "08:30", fecha: "18:00" };
  const toMin = (t) => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
  function status() {
    const n = agoraBR(), abre = toMin(HR.abre), fecha = toMin(HR.fecha);
    const hojeUtil = HR.dias.includes(n.wd);
    if (hojeUtil && n.min >= abre && n.min < fecha) return { open: true, curto: "Aberto agora", longo: `Aberto agora · fecha às ${HR.fecha}`, n };
    if (hojeUtil && n.min < abre) return { open: false, curto: "Fechado", longo: `Fechado · abre hoje às ${HR.abre}`, n };
    let k = 1; while (k < 8 && !HR.dias.includes((n.wd + k) % 7)) k++;
    const quando = k === 1 ? "amanhã" : DIAS[(n.wd + k) % 7];
    return { open: false, curto: "Fechado", longo: `Fechado · abre ${quando} às ${HR.abre}`, n };
  }
  const led = () => { const s = status(); return h("span", { class: "led" + (s.open ? " is-open" : ""), title: s.longo }, h("i"), s.curto); };

  // ---------- dados ----------
  async function loadImpressoras() {
    if (!LIVE) return window.DEMO.impressoras.map((r) => ({ ativo: true, recursos: [], ...r }));
    const { data, error } = await db.from("impressoras").select("*").eq("ativo", true).order("ordem").order("criado_em");
    if (error) { console.error(error.message); return []; }
    return data;
  }
  async function loadOcupadas(id) {
    if (!LIVE) return window.DEMO.ocupadas.filter((o) => !id || o.impressora_id === id);
    const { data, error } = await db.rpc("datas_ocupadas", id ? { p_impressora: id } : {});
    if (error) { console.error(error.message); return []; }
    return data || [];
  }
  async function loadConfig() {
    if (!LIVE) return window.DEMO.config;
    const { data } = await db.from("config").select("chave, valor");
    return Object.fromEntries((data || []).map((r) => [r.chave, r.valor]));
  }

  // Preço de um período (mesma regra do banco: public.valor_periodo)
  const precoDia = (p) => Number(p.preco_dia) * (1 - (p.desconto_pct || 0) / 100);
  function calcular(p, dias) {
    const base = Number(p.preco_dia) * dias;
    const comDesc = precoDia(p) * dias;
    const longo = p.desconto_longo_dias && dias >= p.desconto_longo_dias ? (p.desconto_longo_pct || 0) : 0;
    const total = Math.round(comDesc * (1 - longo / 100) * 100) / 100;
    return { base, comDesc, longo, total };
  }

  // ---------- layout comum ----------
  let CFG = {}, WA = C.whatsapp;
  function chrome() {
    const links = [["./", "Início", "inicio", "home"], ["locacao.html", "Locação", "locacao", "printer"], ["manutencao.html", "Manutenção", "manutencao", "wrench"]];
    const brand = h("a", { href: "./", class: "brand", "aria-label": `${C.marca.a} ${C.marca.b} · início` },
      h("img", { class: "brand__logo", src: "img/logo-horizontal.svg", alt: `${C.marca.a} ${C.marca.b}`, width: "168", height: "40" }));
    const nav = h("header", { class: "nav" }, h("div", { class: "wrap nav__in" }, brand,
      h("nav", { class: "nav__links", "aria-label": "Páginas" }, links.map(([href, label, id]) => h("a", { href, "aria-current": page === id ? "page" : null, text: label }))),
      h("div", { class: "nav__right" }, led(), h("a", { href: "admin.html", class: "nav__login", rel: "nofollow", text: "Entrar" }))));
    const tabs = h("nav", { class: "tabbar", "aria-label": "Páginas" },
      links.map(([href, label, id, ic]) => h("a", { href, "aria-current": page === id ? "page" : null }, icon(ic), label)),
      h("a", { href: waLink(WA, "Olá, Gaúcha! Vim pelo site."), class: "is-wa", target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "WhatsApp"));
    document.body.prepend(nav);
    document.body.append(tabs);
  }

  function footer() {
    const ig = (CFG.instagram || "").replace(/[^A-Za-z0-9._]/g, "");
    const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(CFG.email || "") ? CFG.email : null;
    const telFmt = WA.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
    const ticket = h("div", { class: "foot__ticket" },
      h("h4", { text: "*** Cupom de contato ***" }),
      h("div", {}, h("a", { href: waLink(WA, "Olá, Gaúcha! Vim pelo site."), target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "WhatsApp " + telFmt)),
      mail && h("div", {}, h("a", { href: "mailto:" + mail }, icon("mail"), mail)),
      ig && h("div", {}, h("a", { href: `https://instagram.com/${ig}`, target: "_blank", rel: "noopener noreferrer" }, icon("ig"), "@" + ig)),
      CFG.endereco && h("div", {}, h("a", { href: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(CFG.endereco), target: "_blank", rel: "noopener noreferrer" }, icon("pin"), CFG.endereco)),
      h("hr"),
      h("div", { text: "HORÁRIO" }),
      h("div", { text: (CFG.horario || HR.texto || "").toUpperCase() }),
      h("hr"),
      h("div", { text: "LOCAÇÃO · MANUTENÇÃO" }),
      h("div", { class: "bar", "aria-hidden": "true" }));
    const foot = h("footer", { class: "foot" }, h("div", { class: "wrap" },
      !LIVE && h("p", { class: "notice", text: "Modo demonstração: conteúdo de exemplo. Preencha js/config.js com os dados do Supabase para usar o conteúdo real." }),
      h("div", { class: "foot__grid" },
        h("div", {}, h("img", { class: "foot__logo", src: "img/logo.svg", alt: `${C.marca.a} ${C.marca.b}`, width: "460", height: "231", loading: "lazy" }),
          h("p", { class: "text", text: "Todas as suas soluções de impressão em um só lugar: locação e manutenção de impressoras." })),
        ticket),
      h("div", { class: "foot__bottom" }, h("span", { text: `© ${new Date().getFullYear()} ${C.marca.a} ${C.marca.b}` }), h("span", { text: CFG.endereco || "Locação · Manutenção" }))));
    document.body.append(foot);
  }

  function reveal() {
    const els = document.querySelectorAll(".rv");
    if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  }

  // ---------- cartão de impressora ----------
  function card(p, ocup, onRent) {
    const hoje = agoraBR().iso;
    const busyToday = ocup.some((o) => o.impressora_id === p.id && o.inicio <= hoje && o.fim >= hoje);
    const src = imgUrl(p.foto);
    const pd = precoDia(p);
    const btn = h("button", { class: "btn btn--ink btn--sm", type: "button" }, "Ver datas e alugar");
    btn.addEventListener("click", () => onRent(p));
    return h("article", { class: "card" },
      h("div", { class: "card__img" },
        src ? h("img", { src, alt: `${p.marca} ${p.nome}`.trim(), loading: "lazy", decoding: "async" }) : h("span", { class: "card__ph", "aria-hidden": "true", text: (p.marca || p.nome || "·").charAt(0) }),
        p.desconto_pct > 0 && h("span", { class: "card__off", text: `-${p.desconto_pct}%` }),
        p.categoria && h("span", { class: "card__cat", text: p.categoria }),
        h("span", { class: "card__now" + (busyToday ? " is-busy" : "") }, h("i"), busyToday ? "Alugada hoje" : "Livre hoje")),
      h("div", { class: "card__body" },
        p.marca && h("span", { class: "card__brand", text: p.marca }),
        h("h3", { class: "card__name", text: p.nome }),
        p.descricao && h("p", { class: "card__desc", text: p.descricao }),
        (p.recursos || []).length > 0 && h("ul", { class: "feats" }, p.recursos.map((r) => h("li", { text: r })))),
      h("div", { class: "card__foot" },
        h("div", { class: "price" },
          p.desconto_pct > 0 && h("s", { text: brl(p.preco_dia) }),
          h("b", { text: brl(pd) }), h("small", { text: p.minimo_dias > 1 ? `por dia · mín. ${p.minimo_dias} dias` : "por dia" }),
          p.desconto_longo_dias && p.desconto_longo_pct > 0 && h("span", { class: "price__long", text: `${p.desconto_longo_pct}% off a partir de ${p.desconto_longo_dias} dias` })),
        btn));
  }

  // ---------- janela de locação ----------
  let dlg, P, OC = [], sel = { a: null, b: null }, mes, blocked = {};
  const MAX_DIAS = 120;

  function setupAluguel() {
    dlg = $("aluguel");
    if (!dlg) return;
    $("al-x").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => document.documentElement.classList.remove("lock"));
    $("al-form").addEventListener("submit", enviarReserva);
  }

  async function abrirAluguel(p) {
    P = p; sel = { a: null, b: null };
    const hoje = agoraBR().iso;
    mes = hoje.slice(0, 8) + "01";
    $("al-marca").textContent = [p.marca, p.categoria].filter(Boolean).join(" · ");
    $("al-nome").textContent = p.nome;
    const src = imgUrl(p.foto);
    $("al-thumb").replaceChildren(src ? h("img", { src, alt: "" }) : "");
    $("al-err").textContent = "";
    $("al-body").hidden = false;
    const old = dlg.querySelector(".done"); if (old) old.remove();
    $("cal").replaceChildren(h("p", { class: "cal__hint", text: "Carregando datas…" }));
    renderRecibo(); hint();
    document.documentElement.classList.add("lock");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    OC = await loadOcupadas(p.id);
    blocked = {};
    for (const o of OC) {
      for (let d = o.inicio; d <= o.fim; d = addDays(d, 1)) {
        if (blocked[d] !== "busy") blocked[d] = o.status === "aprovada" ? "busy" : "pend";
      }
    }
    renderCal();
  }

  const livre = (a, b) => { for (let d = a; d <= b; d = addDays(d, 1)) if (blocked[d]) return false; return true; };

  function renderCal() {
    const hoje = agoraBR().iso;
    const [y, m] = mes.split("-").map(Number);
    const first = mes, startWd = wdOf(first);
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const minMes = hoje.slice(0, 8) + "01";
    const maxMes = addDays(minMes, 366).slice(0, 8) + "01";
    const prev = h("button", { type: "button", "aria-label": "Mês anterior", disabled: mes <= minMes ? true : null }, icon("left"));
    const next = h("button", { type: "button", "aria-label": "Próximo mês", disabled: mes >= maxMes ? true : null }, icon("right"));
    prev.addEventListener("click", () => { mes = shiftMes(-1); renderCal(); });
    next.addEventListener("click", () => { mes = shiftMes(1); renderCal(); });
    const cells = [];
    for (let i = 0; i < startWd; i++) cells.push(h("span"));
    for (let n = 1; n <= daysIn; n++) {
      const d = `${y}-${String(m).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
      const past = d < hoje, st = blocked[d], wd = wdOf(d);
      const inSel = sel.a && d >= sel.a && d <= (sel.b || sel.a);
      const cls = ["day", past && "is-past", d === hoje && "is-today", st === "busy" && "is-busy", st === "pend" && "is-pend",
        (wd === 0 || wd === 6) && "is-wknd", inSel && "is-range", d === sel.a && "is-start", d === (sel.b || sel.a) && sel.a && "is-end"].filter(Boolean).join(" ");
      const label = `${n} de ${MESES[m - 1]}` + (st === "busy" ? ", reservado" : st === "pend" ? ", aguardando confirmação" : past ? ", indisponível" : "");
      const b = h("button", { type: "button", class: cls, "aria-label": label, "aria-pressed": inSel ? "true" : "false", disabled: past ? true : null, text: String(n) });
      b.addEventListener("click", () => clicarDia(d, b));
      cells.push(b);
    }
    $("cal").replaceChildren(
      h("div", { class: "cal__nav" }, prev, h("b", { text: `${MESES[m - 1]} ${y}` }), next),
      h("div", { class: "cal__wd", "aria-hidden": "true" }, ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((t) => h("span", { text: t }))),
      h("div", { class: "cal__days" }, cells));
  }
  function shiftMes(k) { const [y, m] = mes.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1, 12)); return iso(d); }

  function clicarDia(d, el) {
    if (blocked[d]) {
      el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake");
      return hint(blocked[d] === "busy" ? "Esse dia já está reservado. Escolha outra data." : "Esse dia está aguardando a confirmação de outro pedido.", true);
    }
    if (!sel.a || sel.b !== sel.a) sel = { a: d, b: d };
    else if (d > sel.a) {
      if (!livre(sel.a, d)) { sel = { a: d, b: d }; hint("O período passava por um dia ocupado. Começamos de novo a partir deste dia.", true); renderCal(); renderRecibo(); return; }
      if (diffDays(sel.a, d) + 1 > MAX_DIAS) { hint(`Para mais de ${MAX_DIAS} dias, fale com a Gaúcha no WhatsApp.`, true); return; }
      sel.b = d;
    } else sel = { a: d, b: d };
    renderCal(); renderRecibo(); hint();
  }

  function hint(msg, warn) {
    const el = $("cal-hint"); if (!el) return;
    if (msg) { el.textContent = msg; el.style.color = warn ? "var(--bad)" : ""; return; }
    el.style.color = "";
    if (!sel.a) el.textContent = "Toque no primeiro dia da locação.";
    else if (sel.a === sel.b) el.textContent = `Início em ${br(sel.a)}. Toque no último dia (ou deixe assim para 1 dia).`;
    else el.textContent = `De ${br(sel.a)} a ${br(sel.b)}. Toque em outro dia para recomeçar.`;
  }

  function renderRecibo() {
    const box = $("recibo");
    if (!sel.a) return box.replaceChildren(h("h4", { text: "Resumo" }), h("p", { class: "receipt__empty", text: "Escolha as datas no calendário." }), h("hr"), h("div", { class: "receipt__row" }, h("span", { text: "Diária" }), h("span", { text: brl(precoDia(P)) })));
    const dias = diffDays(sel.a, sel.b) + 1, c = calcular(P, dias);
    const rows = [
      h("div", { class: "receipt__row" }, h("span", { text: "Retirada" }), h("span", { text: `${br(sel.a)} (${DIAS[wdOf(sel.a)].slice(0, 3)})` })),
      h("div", { class: "receipt__row" }, h("span", { text: "Devolução" }), h("span", { text: `${br(sel.b)} (${DIAS[wdOf(sel.b)].slice(0, 3)})` })),
      h("div", { class: "receipt__row" }, h("span", { text: "Período" }), h("span", { text: `${dias} ${dias === 1 ? "dia" : "dias"}` })),
      h("hr"),
      h("div", { class: "receipt__row" }, h("span", { text: `${dias} × ${brl(P.preco_dia)}` }), h("span", { text: brl(c.base) })),
    ];
    if (P.desconto_pct > 0) rows.push(h("div", { class: "receipt__row is-off" }, h("span", { text: `Desconto ${P.desconto_pct}%` }), h("span", { text: "− " + brl(c.base - c.comDesc) })));
    if (c.longo) rows.push(h("div", { class: "receipt__row is-off" }, h("span", { text: `Período longo ${c.longo}%` }), h("span", { text: "− " + brl(c.comDesc - c.total) })));
    else if (P.desconto_longo_dias && P.desconto_longo_pct > 0) rows.push(h("div", { class: "receipt__row" }, h("span", { text: `Dica: ${P.desconto_longo_pct}% off a partir de ${P.desconto_longo_dias} dias` })));
    if (P.minimo_dias > dias) rows.push(h("div", { class: "receipt__row" }, h("span", { text: `Mínimo de ${P.minimo_dias} dias para esta impressora` })));
    rows.push(h("hr"), h("div", { class: "receipt__total" }, h("span", { text: "TOTAL ESTIMADO" }), h("b", { text: brl(c.total) })));
    box.replaceChildren(h("h4", { text: "Resumo da locação" }), ...rows);
  }

  const ERROS = {
    DATAS_OCUPADAS: "Alguém acabou de pedir essas datas. Atualizamos o calendário: escolha outro período.",
    DATA_PASSADA: "A data de início já passou.", DATAS_INVALIDAS: "Período inválido.", DATA_LONGE: "Escolha uma data dentro dos próximos 12 meses.",
    PERIODO_LONGO: `Para mais de ${MAX_DIAS} dias, fale com a Gaúcha no WhatsApp.`, TELEFONE_INVALIDO: "Confira o WhatsApp com DDD.",
    MUITOS_PEDIDOS: "Você já tem pedidos aguardando confirmação. Fale com a Gaúcha no WhatsApp.", IMPRESSORA_INDISPONIVEL: "Essa impressora não está mais disponível.",
  };
  const erroMsg = (e) => { const m = (e && e.message) || ""; const k = Object.keys(ERROS).find((x) => m.includes(x)); if (k) return ERROS[k]; const mm = m.match(/MINIMO_DIAS:(\d+)/); if (mm) return `O mínimo para esta impressora é ${mm[1]} dias.`; return "Não foi possível enviar agora. Tente de novo ou chame no WhatsApp."; };

  async function enviarReserva(e) {
    e.preventDefault();
    const f = $("al-form"), fd = new FormData(f), err = $("al-err");
    const v = (k) => String(fd.get(k) || "").trim();
    err.textContent = "";
    const nome = v("nome"), tel = fone(v("telefone")), email = v("email").toLowerCase();
    if (!sel.a) return (err.textContent = "Escolha as datas no calendário.");
    const dias = diffDays(sel.a, sel.b) + 1;
    if (dias < (P.minimo_dias || 1)) return (err.textContent = `O mínimo para esta impressora é ${P.minimo_dias} dias.`);
    if (nome.length < 2) return (err.textContent = "Informe seu nome.");
    if (!/^\d{12,13}$/.test(tel)) return (err.textContent = "Informe o WhatsApp com DDD, ex.: (53) 99999-9999.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = "E-mail inválido.");
    const btn = $("al-enviar"); btn.disabled = true;
    try {
      let r;
      if (LIVE) {
        const { data, error } = await db.rpc("solicitar_reserva", { p_impressora: P.id, p_inicio: sel.a, p_fim: sel.b, p_nome: nome, p_telefone: tel, p_email: email || null, p_empresa: v("empresa"), p_observacao: v("observacao") });
        if (error) {
          if (/DATAS_OCUPADAS/.test(error.message)) { const keep = P; await abrirAluguel(keep); }
          throw error;
        }
        r = data[0];
      } else {
        const c = calcular(P, dias);
        r = { codigo: "GI-DEMO" + Math.floor(Math.random() * 90 + 10), dias, valor: c.total, impressora: `${P.marca} ${P.nome}`.trim() };
        window.DEMO.ocupadas.push({ impressora_id: P.id, inicio: sel.a, fim: sel.b, status: "pendente" });
      }
      const msg = [`Olá, Gaúcha! Acabei de pedir uma locação pelo site.`, ``, `Pedido: ${r.codigo}`, `Impressora: ${r.impressora}`,
        `Período: ${br(sel.a)} a ${br(sel.b)} (${r.dias} ${r.dias === 1 ? "dia" : "dias"})`, `Valor estimado: ${brl(r.valor)}`, `Nome: ${nome}`,
        v("empresa") ? `Empresa: ${v("empresa")}` : null, v("observacao") ? `Obs.: ${v("observacao")}` : null, ``, `Aguardo a confirmação.`].filter((x) => x != null).join("\n");
      const url = waLink(WA, msg);
      const wa = h("a", { class: "btn btn--wa", href: url, target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "Avisar a Gaúcha no WhatsApp");
      const close = h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Fechar" });
      close.addEventListener("click", () => dlg.close());
      $("al-body").hidden = true;
      dlg.querySelector(".sheet__box").append(h("div", { class: "done" },
        h("div", { class: "done__ico", "aria-hidden": "true", text: "✓" }),
        h("h3", { text: "Pedido enviado!" }),
        h("code", { text: r.codigo }),
        h("p", { text: `As datas de ${br(sel.a)} a ${br(sel.b)} ficaram reservadas para você enquanto a Gaúcha confirma. Valor estimado: ${brl(r.valor)}.` }),
        h("p", { text: "Para agilizar, avise a Gaúcha no WhatsApp. Você recebe a confirmação por lá" + (email ? " e no seu e-mail." : ".") }),
        wa, close));
      f.reset();
      window.open(url, "_blank", "noopener");
      if (page === "locacao") refreshCatalog();
    } catch (ex) {
      console.error(ex);
      err.textContent = erroMsg(ex);
    } finally { btn.disabled = false; }
  }

  // ---------- páginas ----------
  let IMPS = [], OCUP = [], filtro = "Todas";
  async function refreshCatalog() { OCUP = await loadOcupadas(); drawCatalog(); }
  function drawCatalog() {
    const list = IMPS.filter((p) => filtro === "Todas" || p.categoria === filtro);
    $("catalogo").replaceChildren(...(list.length ? list.map((p) => card(p, OCUP, abrirAluguel)) : [h("p", { class: "empty", text: IMPS.length ? "Nenhuma impressora nesta categoria." : "Em breve novas impressoras para locação. Chame no WhatsApp para saber a disponibilidade." })]));
  }

  async function pageLocacao() {
    setupAluguel();
    [IMPS, OCUP] = await Promise.all([loadImpressoras(), loadOcupadas()]);
    const cats = ["Todas", ...new Set(IMPS.map((p) => p.categoria).filter(Boolean))];
    const fb = $("filtros");
    if (cats.length > 2) {
      fb.replaceChildren(...cats.map((c) => {
        const b = h("button", { class: "chip", type: "button", "aria-pressed": c === filtro ? "true" : "false", text: c });
        b.addEventListener("click", () => { filtro = c; fb.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); drawCatalog(); });
        return b;
      }));
    } else fb.hidden = true;
    drawCatalog();
    const want = new URLSearchParams(location.search).get("i");
    const p = want && IMPS.find((x) => x.id === want);
    if (p) abrirAluguel(p);
  }

  function lcd() {
    const el = $("lcd"); if (!el) return;
    const s = status(), n = s.n;
    el.replaceChildren(
      h("span", { class: "dim", text: `> STATUS ${n.hhmm} BRT` }),
      h("span", { class: "big", text: s.open ? "PRONTA ✓ ABERTO" : "EM ESPERA · FECHADO" }),
      h("span", { text: s.longo.toUpperCase() }),
      h("div", { class: "week", "aria-label": "Dias de atendimento" }, ["D", "S", "T", "Q", "Q", "S", "S"].map((t, i) => h("span", { class: [HR.dias.includes(i) && "on", i === n.wd && "today"].filter(Boolean).join(" "), text: t }))),
      h("span", { class: "dim", text: `SEG–SEX · ${HR.abre}–${HR.fecha}` }));
  }

  async function pageInicio() {
    setupAluguel();
    lcd(); setInterval(lcd, 30000);
    const btns = $("contato-btns");
    if (btns) btns.replaceChildren(
      h("a", { class: "btn btn--wa btn--sm", href: waLink(WA, "Olá, Gaúcha! Vim pelo site."), target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "Chamar no WhatsApp"),
      h("a", { class: "btn btn--sm", href: "manutencao.html" }, icon("wrench"), "Manutenção"));
    [IMPS, OCUP] = await Promise.all([loadImpressoras(), loadOcupadas()]);
    let dest = IMPS.filter((p) => p.destaque);
    if (!dest.length) dest = IMPS;
    dest = dest.slice(0, 3);
    $("destaques").replaceChildren(...(dest.length ? dest.map((p) => card(p, OCUP, abrirAluguel)) : [h("p", { class: "empty", text: "Em breve impressoras para locação." })]));
    const min = IMPS.length ? Math.min(...IMPS.map(precoDia)) : null;
    const st = document.querySelector("[data-min-price]");
    if (st) { if (min != null) st.textContent = brl(min).replace(",00", "") + "/dia"; else st.closest(".press__sticker").hidden = true; }
  }

  // ---------- manutenção ----------
  async function toWebp(file) {
    const bmp = await createImageBitmap(file);
    const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.8));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("FOTO");
    return blob;
  }

  function pageManutencao() {
    const s = status();
    $("mt-hora").textContent = s.open
      ? `Estamos atendendo agora (${HR.texto || "seg a sex, 08:30 às 18:00"}).`
      : `${s.longo}. Pode mandar mesmo assim: respondemos assim que abrir.`;
    const drop = $("mt-drop"), input = $("mt-foto");
    let foto = null;
    const reset = () => { foto = null; input.value = ""; drop.querySelectorAll("img, .drop__rm").forEach((x) => x.remove()); };
    input.addEventListener("change", () => {
      const f = input.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type) || f.size > 20 * 1024 * 1024) { toast("Use uma imagem de até 20 MB", true); reset(); return; }
      reset(); foto = f;
      const rm = h("button", { class: "btn btn--sm drop__rm", type: "button", text: "Remover" });
      rm.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); reset(); });
      drop.append(h("img", { src: URL.createObjectURL(f), alt: "Foto escolhida" }), rm);
    });

    $("mt-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), v = (k) => String(fd.get(k) || "").trim(), err = $("mt-err");
      err.textContent = "";
      const nome = v("nome"), tel = fone(v("telefone")), modelo = v("modelo"), desc = v("descricao"), email = v("email").toLowerCase();
      if (nome.length < 2) return (err.textContent = "Informe seu nome.");
      if (!/^\d{12,13}$/.test(tel)) return (err.textContent = "Informe o WhatsApp com DDD, ex.: (53) 99999-9999.");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return (err.textContent = "E-mail inválido.");
      if (modelo.length < 2) return (err.textContent = "Informe o modelo da impressora.");
      if (desc.length < 5) return (err.textContent = "Conte um pouco do que está acontecendo.");
      const btn = $("mt-enviar"); btn.disabled = true;
      let codigo = null, semFoto = false;
      try {
        if (LIVE) {
          let path = null;
          if (foto) {
            try {
              const blob = await toWebp(foto);
              path = `manutencao/${crypto.randomUUID()}.webp`;
              const up = await db.storage.from("imagens").upload(path, blob, { contentType: "image/webp", upsert: false });
              if (up.error) throw up.error;
            } catch (ex) { console.error(ex); path = null; semFoto = true; }
          }
          const { data, error } = await db.rpc("abrir_chamado", { p_nome: nome, p_telefone: tel, p_modelo: modelo, p_descricao: desc, p_foto: path, p_email: email || null });
          if (error) throw error;
          codigo = data;
        } else codigo = "GM-DEMO" + Math.floor(Math.random() * 90 + 10);
      } catch (ex) {
        console.error(ex);
        const m = (ex && ex.message) || "";
        err.textContent = /MUITOS_PEDIDOS/.test(m) ? "Você já abriu vários protocolos hoje. Fale com a Gaúcha no WhatsApp."
          : /TELEFONE_INVALIDO/.test(m) ? "Confira o WhatsApp com DDD." : /EMAIL_INVALIDO/.test(m) ? "E-mail inválido."
          : "Não foi possível enviar agora. Tente de novo em instantes ou chame no WhatsApp.";
        return;
      } finally { btn.disabled = false; }

      const st = status();
      const msg = `Olá, Gaúcha! Abri o protocolo de manutenção ${codigo} pelo site (${modelo}).`;
      $("mt-form").hidden = true;
      const again = h("button", { class: "btn btn--ghost btn--sm", type: "button", text: "Abrir outro protocolo" });
      again.addEventListener("click", () => { $("mt-done").hidden = true; $("mt-form").hidden = false; e.target.reset(); reset(); });
      $("mt-done").replaceChildren(
        h("div", { class: "done__ico", "aria-hidden": "true", text: "✓" }),
        h("h3", { text: "Protocolo aberto!" }),
        h("code", { text: codigo }),
        h("p", { text: `A Gaúcha já recebeu o seu pedido e vai analisar${st.open ? "" : " assim que abrir (" + st.longo.replace(/^Fechado · /, "") + ")"}. ` +
          `Você recebe a resposta ${email ? "no e-mail " + email + " ou " : ""}pelo WhatsApp informado. Guarde o número do protocolo.` }),
        semFoto ? h("p", { text: "Não conseguimos enviar a foto. Se quiser, mande depois pelo WhatsApp junto com o número do protocolo." }) : "",
        h("a", { class: "btn btn--sm btn--ghost", href: waLink(WA, msg), target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "Falar com a Gaúcha no WhatsApp"),
        again);
      $("mt-done").hidden = false;
      $("mt-done").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ---------- início ----------
  (async function init() {
    chrome();
    try { CFG = await loadConfig(); } catch { CFG = {}; }
    if (!CFG.endereco) CFG.endereco = C.endereco || "";
    const w = String(CFG.whatsapp || "").replace(/\D/g, "");
    if (/^\d{12,13}$/.test(w)) WA = w;
    document.querySelectorAll(".tabbar .is-wa").forEach((a) => (a.href = waLink(WA, "Olá, Gaúcha! Vim pelo site.")));
    footer();
    reveal();
    if (page === "inicio") pageInicio();
    else if (page === "locacao") pageLocacao();
    else if (page === "manutencao") pageManutencao();
  })();
})();
