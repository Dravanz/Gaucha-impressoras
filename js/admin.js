// =====================================================================
//  Painel administrativo — Gaúcha Impressoras
//  Segurança em camadas (igual ao blackwhite-site):
//   1. Login só por OAuth (Google), fluxo PKCE, sem senha guardada aqui.
//   2. Sessão no sessionStorage (some ao fechar a aba) e NÃO renovada:
//      após 15 min o painel desloga e pede login de novo.
//   3. O banco confere sozinho (RLS) se o e-mail está em equipe_admin e se a
//      sessão tem menos de 15 min. Mesmo burlando esta tela, nada muda.
//   4. Fotos são redimensionadas e convertidas para WebP antes do envio
//      (remove dados de GPS/EXIF e economiza espaço).
// =====================================================================
(function () {
  "use strict";
  const C = window.SITE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const MAX_MIN = C.sessaoMinutos || 15;
  const LIVE = !!(C.supabaseUrl && C.supabaseAnonKey);
  const DEMO = !LIVE && new URLSearchParams(location.search).has("demo");

  function hojeBR() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); }
  function addDays(s, n) { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

  if (!LIVE && !DEMO) {
    $("login-msg").textContent = "Supabase ainda não configurado: preencha js/config.js (veja SETUP.md). Enquanto isso, dá para conhecer o painel com dados de exemplo.";
    const b = $("btn-google");
    b.textContent = "Ver painel de demonstração";
    b.addEventListener("click", () => { location.search = "?demo"; });
    return;
  }

  const db = LIVE
    ? window.supabase.createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { flowType: "pkce", autoRefreshToken: false, persistSession: true, detectSessionInUrl: true, storage: window.sessionStorage } })
    : mockDb();

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
  const brl = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const SAFE_PATH = /^(impressoras|manutencao)\/[A-Za-z0-9_-]+\.(webp|jpe?g|png)$/;
  const LOCAL_PATH = /^img\/impressoras\/[a-z0-9-]+\.(webp|svg|png|jpg)$/;
  const mockUrls = {};
  const imgUrl = (p) => !p ? null : LOCAL_PATH.test(p) ? p : mockUrls[p] || (LIVE && SAFE_PATH.test(p) ? db.storage.from("imagens").getPublicUrl(p).data.publicUrl : null);
  const removeFile = (p) => p && SAFE_PATH.test(p) ? db.storage.from("imagens").remove([p]).catch(() => {}) : Promise.resolve();
  let toastT;
  const toast = (msg, err) => { const t = $("toast"); t.textContent = msg; t.className = "toast show" + (err ? " err" : ""); clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 3400); };
  const friendly = (e) => {
    const m = (e && (e.message || e.error_description)) || String(e);
    if (/sem_conflito|conflicting key|exclusion/i.test(m)) return "Essas datas já estão ocupadas por outro pedido pendente ou aprovado.";
    if (/row-level security|permission denied|42501|Unauthorized|JWT/i.test(m)) return "Sem permissão ou sessão expirada. Entre de novo.";
    if (/check constraint/i.test(m)) return "Algum campo está fora do permitido (tamanho ou valor). Confira e tente de novo.";
    return m;
  };
  const br = (s) => s ? s.split("-").reverse().join("/") : "";
  const brCurto = (s) => s ? s.slice(8, 10) + "/" + s.slice(5, 7) : "";
  const quando = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

  const fmtFone = (t) => String(t || "").replace(/^55(\d{2})(\d{4,5})(\d{4})$/, "($1) $2-$3");
  const wa = (num, text) => `https://wa.me/${num}?text=${encodeURIComponent(text)}`;
  const primeiro = (n) => String(n || "").trim().split(/\s+/)[0];

  // ---------- definição das abas ----------
  const CATS = ["Multifuncional", "Laser", "Jato de tinta", "Etiquetas", "Matricial", "Plotter", "Portátil"];
  const TABS = {
    reservas: { label: "Reservas", custom: drawReservas },
    agenda: { label: "Agenda", custom: drawAgenda },
    impressoras: { label: "Impressoras", table: "impressoras", folder: "impressoras", novo: "+ Nova impressora",
      sub: (r) => [r.marca, r.categoria, r.desconto_pct ? `${brl(r.preco_dia * (1 - r.desconto_pct / 100))}/dia (de ${brl(r.preco_dia)})` : `${brl(r.preco_dia)}/dia`].filter(Boolean).join(" · "),
      flags: (r) => [["Destaque", r.destaque], [`-${r.desconto_pct}%`, r.desconto_pct > 0, "m"], [`Mín. ${r.minimo_dias} dias`, r.minimo_dias > 1]],
      fields: [
        { k: "foto", t: "image", label: "Foto da impressora" },
        { k: "nome", t: "text", label: "Nome", req: true, max: 80, hint: "Ex.: EcoTank L3250" },
        { k: "marca", t: "select", label: "Marca", opts: ["Epson", "HP", "Brother", "Canon", "Samsung", "Ricoh", "Kyocera", "Lexmark", "Xerox", "Zebra", "Elgin"], free: true, max: 40 },
        { k: "modelo", t: "text", label: "Modelo (opcional)", max: 60 },
        { k: "categoria", t: "select", label: "Categoria", opts: CATS, def: "Multifuncional", free: true },
        { k: "descricao", t: "textarea", label: "Descrição", max: 600 },
        { k: "recursos", t: "tags", label: "Recursos", hint: "Separados por vírgula: Colorida, Wi-Fi, Frente e verso, A3" },
        { k: "preco_dia", t: "money", label: "Valor por dia (R$)", req: true },
        { k: "desconto_pct", t: "int", label: "Desconto na diária (%)", min: 0, max: 90, def: 0, hint: "0 = sem desconto. Aparece riscado no site com o selo de % OFF." },
        { k: "desconto_longo_dias", t: "int", label: "Desconto extra a partir de (dias)", min: 2, max: 365, hint: "Opcional. Ex.: 7 → locações de 7 dias ou mais ganham o desconto abaixo." },
        { k: "desconto_longo_pct", t: "int", label: "Desconto extra para período longo (%)", min: 0, max: 90, def: 0 },
        { k: "minimo_dias", t: "int", label: "Mínimo de dias por locação", min: 1, max: 60, def: 1 },
        { k: "ordem", t: "int", label: "Ordem de exibição", hint: "Menor aparece primeiro" },
        { k: "destaque", t: "bool", label: "Destaque (aparece na página inicial)" },
        { k: "ativo", t: "bool", label: "Visível no site (disponível para alugar)", def: true },
      ] },
    chamados: { label: "Manutenção", custom: drawChamados },
    config: { label: "Informações", table: "config", adminOnly: true, kv: true, custom: drawConfig },
    log: { label: "Log", adminOnly: true, custom: drawLog },
  };
  const CONFIG_KEYS = [["whatsapp", "WhatsApp da Gaúcha (com 55 e DDD, só números)"], ["email", "E-mail de contato"], ["instagram", "Instagram (sem @)"], ["endereco", "Endereço"], ["horario", "Horário (texto do rodapé)"]];

  // ---------- sessão ----------
  let papel = null, expiraEm = 0, timerT = null, current = "reservas", rows = [];

  async function sair(msg, deny) {
    clearInterval(timerT);
    if (DEMO) { location.search = ""; return; }
    await db.auth.signOut().catch(() => {});
    sessionStorage.clear();
    $("panel").hidden = true; $("login").hidden = false;
    if ($("dlg").open) $("dlg").close();
    if (msg) { $("login-msg").textContent = msg; $("login-msg").classList.add("is-err"); $("login-msg").classList.toggle("login__msg--deny", !!deny); }
  }

  function startTimer() {
    clearInterval(timerT);
    const tick = () => {
      const s = Math.max(0, Math.round((expiraEm - Date.now()) / 1000));
      $("timer").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      $("timer").classList.toggle("is-low", s < 120);
      if (s <= 0) sair("Sua sessão de 15 minutos terminou. Entre de novo.");
    };
    tick(); timerT = setInterval(tick, 1000);
  }

  async function boot() {
    if (DEMO) {
      papel = "admin"; expiraEm = Date.now() + MAX_MIN * 60000;
      $("who").textContent = "demonstração · admin";
      document.body.insertBefore(h("div", { class: "demo-bar", text: "Painel de demonstração: os dados são de exemplo e nada é salvo de verdade. Configure o Supabase (SETUP.md) para usar o painel real." }), $("panel"));
    } else {
      const { data: { session } } = await db.auth.getSession();
      if (!session) return;
      const { data, error } = await db.rpc("minha_sessao");
      const info = data && data[0];
      if (error || !info || !info.papel) {
        return sair(error ? friendly(error) : `Você não tem acesso ao painel com a conta ${session.user.email}. Peça ao administrador para liberar o seu e-mail.`, true);
      }
      papel = info.papel;
      expiraEm = Math.min(new Date(info.expira_em).getTime(), session.expires_at * 1000, Date.now() + MAX_MIN * 60000);
      $("who").textContent = `${session.user.email} · ${papel}`;
      history.replaceState(null, "", location.pathname);
    }
    $("login").hidden = true; $("panel").hidden = false;
    buildTabs(); startTimer(); open(current); refreshCounts();
  }

  if (LIVE) {
    $("btn-google").addEventListener("click", async () => {
      $("btn-google").disabled = true;
      const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: "select_account" } } });
      if (error) { $("btn-google").disabled = false; $("login-msg").textContent = friendly(error); $("login-msg").classList.add("is-err"); }
    });
  }
  $("btn-sair").addEventListener("click", () => sair("Você saiu do painel."));

  // ---------- abas ----------
  function buildTabs() {
    $("tabs").replaceChildren(...Object.entries(TABS).filter(([, t]) => !t.adminOnly || papel === "admin").map(([id, t]) => {
      const b = h("button", { type: "button", role: "tab", "aria-selected": id === current ? "true" : "false" }, t.label, h("span", { class: "count", hidden: true }));
      b.addEventListener("click", () => open(id));
      b.dataset.id = id;
      return b;
    }));
  }
  async function refreshCounts() {
    const set = (id, n) => { const el = $("tabs").querySelector(`[data-id="${id}"] .count`); if (el) { el.textContent = n; el.hidden = !n; } };
    const r = await db.from("reservas").select("id").eq("status", "pendente");
    const c = await db.from("chamados").select("id").eq("status", "aberto");
    set("reservas", r.data ? r.data.length : 0);
    set("chamados", c.data ? c.data.length : 0);
  }

  async function open(id) {
    current = id;
    const tab = TABS[id];
    $("tabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.id === id ? "true" : "false"));
    $("tab-title").textContent = tab.label;
    $("btn-novo").hidden = !tab.novo;
    if (tab.novo) $("btn-novo").textContent = tab.novo;
    $("rows").replaceChildren(h("p", { class: "empty", text: "Carregando…" }));
    if (tab.custom) return tab.custom();
    const { data, error } = await db.from(tab.table).select("*").order("ordem").order("criado_em");
    if (error) { $("rows").replaceChildren(h("p", { class: "empty", text: friendly(error) })); return; }
    rows = data;
    $("rows").replaceChildren(...(rows.length ? rows.map((r) => {
      const thumb = imgUrl(r.foto);
      const el = h("button", { type: "button", class: "row" + (r.ativo === false ? " is-off" : "") },
        h("span", { class: "row__img" }, thumb ? h("img", { src: thumb, alt: "", loading: "lazy" }) : null),
        h("span", {}, h("b", { text: r.nome }), h("small", { text: tab.sub ? tab.sub(r) || "" : "" })),
        h("span", { class: "row__flags" }, (tab.flags ? tab.flags(r) : []).filter(([, on]) => on).map(([l, , c]) => h("span", { class: "flag " + (c ? "flag--" + c : "flag--on"), text: l })),
          r.ativo === false ? h("span", { class: "flag", text: "Oculta" }) : null));
      el.addEventListener("click", () => edit(r));
      return el;
    }) : [h("p", { class: "empty", text: "Nada cadastrado ainda. Clique em + Nova impressora." })]));
  }

  // ---------- reservas ----------
  const ST = { pendente: "Pendente", aprovada: "Aprovada", recusada: "Recusada", cancelada: "Cancelada" };
  let filtroRes = "pendente";

  function msgCliente(r) {
    const per = `${br(r.inicio)} a ${br(r.fim)} (${r.dias} ${r.dias === 1 ? "dia" : "dias"})`;
    const ola = `Olá, ${primeiro(r.nome)}! Aqui é da ${C.marca.a} ${C.marca.b}.`;
    const extra = r.resposta ? `\n\n${r.resposta}` : "";
    if (r.status === "aprovada") return `${ola}\n\nSua locação foi CONFIRMADA ✅\n\nPedido: ${r.codigo}\nImpressora: ${r.impressora_nome}\nPeríodo: ${per}\nValor: ${brl(r.valor_final ?? r.valor_estimado)}${extra}\n\nQualquer dúvida é só responder esta mensagem.`;
    if (r.status === "recusada") return `${ola}\n\nInfelizmente não conseguimos confirmar o pedido ${r.codigo} (${r.impressora_nome}, ${per}).${r.resposta ? "\n\nMotivo: " + r.resposta : ""}\n\nSe quiser, podemos ver outra data ou outro modelo.`;
    if (r.status === "cancelada") return `${ola}\n\nA locação ${r.codigo} (${r.impressora_nome}, ${per}) foi cancelada.${extra}`;
    return `${ola}\n\nRecebemos seu pedido ${r.codigo} (${r.impressora_nome}, ${per}) e já estamos verificando. Logo confirmamos por aqui.`;
  }
  const assunto = (r) => ({ aprovada: `Locação confirmada · ${r.codigo}`, recusada: `Sobre o seu pedido ${r.codigo}`, cancelada: `Locação cancelada · ${r.codigo}` }[r.status] || `Seu pedido ${r.codigo}`);
  const avisos = (r) => [
    h("a", { class: "btn btn--wa btn--sm", href: wa(r.telefone, msgCliente(r)), target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "Avisar no WhatsApp"),
    r.email && h("a", { class: "btn btn--sm", href: `mailto:${r.email}?subject=${encodeURIComponent(assunto(r))}&body=${encodeURIComponent(msgCliente(r))}` }, icon("mail"), "Enviar e-mail"),
  ];

  async function drawReservas() {
    const { data, error } = await db.from("reservas").select("*").order("inicio", { ascending: false }).limit(500);
    if (error) return $("rows").replaceChildren(h("p", { class: "empty", text: friendly(error) }));
    const all = data || [];
    const counts = all.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
    const seg = h("div", { class: "seg", role: "group", "aria-label": "Filtrar" }, [...Object.keys(ST), "todas"].map((s) => {
      const b = h("button", { type: "button", "aria-pressed": s === filtroRes ? "true" : "false", text: s === "todas" ? `Todas (${all.length})` : `${ST[s]} (${counts[s] || 0})` });
      b.addEventListener("click", () => { filtroRes = s; drawReservas(); });
      return b;
    }));
    let list = all.filter((r) => filtroRes === "todas" || r.status === filtroRes);
    if (filtroRes === "pendente") list = list.sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const hint = h("p", { class: "adm__hint", text: filtroRes === "pendente" ? "Pedidos esperando sua decisão. Enquanto estão pendentes, as datas ficam bloqueadas no calendário do site." : "" });
    $("rows").replaceChildren(seg, hint, ...(list.length ? list.map(resCard) : [h("p", { class: "empty", text: filtroRes === "pendente" ? "Nenhum pedido pendente. 🎉" : "Nenhuma reserva aqui." })]));
  }

  function resCard(r) {
    const btns = [];
    const B = (label, cls, fn) => { const b = h("button", { type: "button", class: "btn btn--sm " + (cls || ""), text: label }); b.addEventListener("click", fn); return b; };
    if (r.status === "pendente") btns.push(B("Aprovar", "btn--ok", () => decidir(r, "aprovada")), B("Recusar", "btn--danger", () => decidir(r, "recusada")));
    if (r.status === "aprovada") btns.push(B("Ajustar valor", "", () => decidir(r, "aprovada")), B("Cancelar locação", "btn--danger", () => decidir(r, "cancelada")));
    if (r.status === "recusada" || r.status === "cancelada") btns.push(B("Reabrir como pendente", "btn--ghost", () => reabrir(r)));
    const valor = r.valor_final != null && Number(r.valor_final) !== Number(r.valor_estimado)
      ? h("b", {}, brl(r.valor_final), h("small", { class: "mono", text: ` (site: ${brl(r.valor_estimado)})` }))
      : h("b", { text: brl(r.valor_final ?? r.valor_estimado) });
    return h("article", { class: "res res--" + r.status },
      h("div", { class: "res__top" },
        h("div", {}, h("b", { text: r.impressora_nome || "Impressora excluída" }), h("small", { text: `${r.codigo} · pedido em ${quando(r.criado_em)}` })),
        h("span", { class: "st st--" + r.status, text: ST[r.status] })),
      h("div", { class: "res__grid" },
        h("div", {}, h("span", { text: "Período" }), h("b", { text: `${br(r.inicio)} → ${br(r.fim)} · ${r.dias} ${r.dias === 1 ? "dia" : "dias"}` })),
        h("div", {}, h("span", { text: "Valor" }), valor),
        h("div", {}, h("span", { text: "Cliente" }), h("b", { text: r.nome + (r.empresa ? ` · ${r.empresa}` : "") })),
        h("div", {}, h("span", { text: "Contato" }), h("b", {}, h("a", { href: wa(r.telefone, `Olá, ${primeiro(r.nome)}! Aqui é da ${C.marca.a} ${C.marca.b}, sobre o pedido ${r.codigo}.`), target: "_blank", rel: "noopener noreferrer", text: fmtFone(r.telefone) }), r.email ? h("small", { class: "mono", text: " · " + r.email }) : null))),
      r.observacao && h("p", { class: "res__obs", text: "Obs. do cliente: " + r.observacao }),
      r.resposta && h("p", { class: "res__obs", text: "Sua resposta: " + r.resposta }),
      r.decidido_em && h("small", { class: "mono text", text: `${ST[r.status]} em ${quando(r.decidido_em)}${r.decidido_por ? " por " + r.decidido_por : ""}` }),
      h("div", { class: "res__btns" }, btns, r.status !== "pendente" ? avisos(r) : null));
  }

  async function reabrir(r) {
    if (!confirm(`Reabrir o pedido ${r.codigo} como pendente? As datas voltam a ficar bloqueadas.`)) return;
    const res = await db.from("reservas").update({ status: "pendente" }).eq("id", r.id).select();
    if (res.error || !res.data?.length) return toast(res.error ? friendly(res.error) : "Sem permissão.", true);
    toast("Pedido reaberto"); drawReservas(); refreshCounts();
  }

  // Diálogo genérico
  let onSubmit = null, onDelete = null;
  function dialog({ title, body, save = "Salvar", del = null, saveCls = "btn--ink" }) {
    $("form-title").textContent = title;
    $("form-err").textContent = "";
    $("fields").replaceChildren(...body);
    $("form-foot").hidden = false;
    $("btn-salvar").textContent = save;
    $("btn-salvar").className = "btn btn--sm " + saveCls;
    $("btn-excluir").hidden = !del;
    onDelete = del;
    $("dlg").showModal();
  }

  function decidir(r, status) {
    const isAprova = status === "aprovada", ajuste = r.status === "aprovada" && isAprova;
    const valorIn = h("input", { type: "text", inputmode: "decimal", name: "valor_final", value: String(r.valor_final ?? r.valor_estimado).replace(".", ",") });
    const pct = [0, 5, 10, 15, 20, 25].map((p) => {
      const b = h("button", { type: "button", text: p ? `-${p}%` : "Valor do site" });
      b.addEventListener("click", () => { valorIn.value = (Math.round(r.valor_estimado * (1 - p / 100) * 100) / 100).toFixed(2).replace(".", ","); });
      return b;
    });
    const resp = h("textarea", { name: "resposta", maxlength: "300", placeholder: isAprova ? "Ex.: Pode retirar a partir das 9h. Levar documento com foto." : status === "recusada" ? "Ex.: A impressora estará em manutenção nessas datas." : "Ex.: Cancelado a pedido do cliente." });
    resp.value = r.resposta || "";
    const body = [
      h("div", { class: "sum" }, h("b", { text: r.impressora_nome }), h("br"), `${r.codigo} · ${br(r.inicio)} a ${br(r.fim)} (${r.dias} ${r.dias === 1 ? "dia" : "dias"})`, h("br"), `${r.nome} · ${fmtFone(r.telefone)}`, h("br"), `Valor calculado no site: ${brl(r.valor_estimado)}`),
      isAprova && h("label", { class: "f" }, h("span", { text: "Valor final da locação (R$)" }), valorIn, h("div", { class: "price-calc" }, pct), h("small", { text: "Aplique um desconto rápido ou digite o valor combinado com o cliente." })),
      h("label", { class: "f" }, h("span", { text: isAprova ? "Mensagem para o cliente (opcional)" : status === "recusada" ? "Motivo (opcional, vai na mensagem)" : "Observação (opcional)" }), resp),
    ];
    dialog({ title: ajuste ? "Ajustar locação" : isAprova ? "Aprovar locação" : status === "recusada" ? "Recusar pedido" : "Cancelar locação", body,
      save: ajuste ? "Salvar" : isAprova ? "Aprovar e confirmar datas" : status === "recusada" ? "Recusar e liberar datas" : "Cancelar e liberar datas",
      saveCls: isAprova ? "btn--ok" : "btn--danger" });
    onSubmit = async () => {
      const upd = { status, resposta: resp.value.trim().slice(0, 300) };
      if (isAprova) {
        const n = Number(valorIn.value.replace(/\s|R\$/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
        if (!isFinite(n) || n < 0 || n >= 10000000) throw new Error("Valor inválido");
        upd.valor_final = Math.round(n * 100) / 100;
      }
      const res = await db.from("reservas").update(upd).eq("id", r.id).select();
      if (res.error) throw res.error;
      if (!res.data?.length) throw new Error("Sem permissão ou sessão expirada. Entre de novo.");
      const nr = res.data[0];
      const msg = { aprovada: ajuste ? "Locação atualizada." : "Locação aprovada! As datas estão confirmadas.", recusada: "Pedido recusado. As datas foram liberadas.", cancelada: "Locação cancelada. As datas foram liberadas." }[status];
      $("fields").replaceChildren(h("div", { class: "notify" },
        h("p", {}, h("b", { text: msg })),
        h("p", { text: `Agora avise ${primeiro(nr.nome)}: o WhatsApp abre com a mensagem pronta${nr.email ? " (ou mande por e-mail)" : ""}.` }),
        avisos(nr)));
      $("form-foot").hidden = true;
      drawReservas(); refreshCounts();
      return true;
    };
  }

  // ---------- agenda (próximos 45 dias) ----------
  async function drawAgenda() {
    const hoje = hojeBR(), N = 45, fim = addDays(hoje, N - 1);
    const [imp, res] = await Promise.all([
      db.from("impressoras").select("*").order("ordem").order("criado_em"),
      db.from("reservas").select("*").order("inicio"),
    ]);
    if (imp.error || res.error) return $("rows").replaceChildren(h("p", { class: "empty", text: friendly(imp.error || res.error) }));
    const ativas = (res.data || []).filter((r) => (r.status === "pendente" || r.status === "aprovada") && r.fim >= hoje && r.inicio <= fim);
    const dias = Array.from({ length: N }, (_, i) => addDays(hoje, i));
    const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
    const head = h("tr", {}, h("th", { class: "nm", text: "Impressora" }), dias.map((d) => h("th", { class: wd(d) % 6 === 0 ? "wk" : null }, d.slice(8, 10), h("small", { text: "DSTQQSS"[wd(d)] }))));
    const linhas = (imp.data || []).map((p) => h("tr", {}, h("th", { class: "nm", title: p.nome, text: `${p.marca ? p.marca + " " : ""}${p.nome}` }), dias.map((d) => {
      const r = ativas.find((x) => x.impressora_id === p.id && x.inicio <= d && x.fim >= d);
      const td = h("td", { class: [r && (r.status === "aprovada" ? "a" : "p"), d === hoje && "today"].filter(Boolean).join(" ") || null });
      if (r) {
        const b = h("button", { type: "button", title: `${r.codigo} · ${r.nome} · ${brCurto(r.inicio)} a ${brCurto(r.fim)} · ${ST[r.status]}`, "aria-label": `${ST[r.status]}: ${r.nome}, ${br(r.inicio)} a ${br(r.fim)}` });
        b.addEventListener("click", () => { filtroRes = r.status; open("reservas"); });
        td.append(b);
      }
      return td;
    })));
    $("rows").replaceChildren(
      h("p", { class: "adm__hint", text: "Próximos 45 dias. Verde: aprovada · listrado amarelo: pendente. Toque num dia ocupado para ver o pedido." }),
      linhas.length ? h("div", { class: "ag" }, h("table", {}, h("thead", {}, head), h("tbody", {}, linhas))) : h("p", { class: "empty", text: "Cadastre impressoras para ver a agenda." }));
  }

  // ---------- chamados de manutenção ----------
  const STC = { aberto: "Novo", em_andamento: "Em andamento", concluido: "Concluído" };
  let filtroCh = "aberto";
  async function drawChamados() {
    const { data, error } = await db.from("chamados").select("*").order("criado_em", { ascending: false }).limit(300);
    if (error) return $("rows").replaceChildren(h("p", { class: "empty", text: friendly(error) }));
    const all = data || [];
    const seg = h("div", { class: "seg" }, [...Object.keys(STC), "todos"].map((s) => {
      const b = h("button", { type: "button", "aria-pressed": s === filtroCh ? "true" : "false", text: s === "todos" ? `Todos (${all.length})` : `${STC[s]} (${all.filter((c) => c.status === s).length})` });
      b.addEventListener("click", () => { filtroCh = s; drawChamados(); });
      return b;
    }));
    const list = all.filter((c) => filtroCh === "todos" || c.status === filtroCh);
    $("rows").replaceChildren(seg,
      h("p", { class: "adm__hint", text: "Pedidos enviados pelo formulário de manutenção do site (o cliente também foi direcionado para o WhatsApp)." }),
      ...(list.length ? list.map((c) => {
        const mv = (st, label, cls) => { const b = h("button", { type: "button", class: "btn btn--sm " + (cls || ""), text: label }); b.addEventListener("click", async () => {
          const r = await db.from("chamados").update({ status: st }).eq("id", c.id).select();
          if (r.error || !r.data?.length) return toast(r.error ? friendly(r.error) : "Sem permissão.", true);
          toast("Chamado atualizado"); drawChamados(); refreshCounts();
        }); return b; };
        const foto = imgUrl(c.foto);
        return h("article", { class: "res " + (c.status === "aberto" ? "res--pendente" : c.status === "concluido" ? "res--cancelada" : "res--aprovada") },
          h("div", { class: "res__top" }, h("div", {}, h("b", { text: c.modelo }), h("small", { text: `${c.codigo} · ${quando(c.criado_em)}` })), h("span", { class: "st " + (c.status === "aberto" ? "st--pendente" : c.status === "concluido" ? "st--cancelada" : "st--aprovada"), text: STC[c.status] })),
          h("div", { class: "res__grid" }, h("div", {}, h("span", { text: "Cliente" }), h("b", { text: c.nome })), h("div", {}, h("span", { text: "WhatsApp" }), h("b", { text: fmtFone(c.telefone) }))),
          h("p", { class: "res__obs", text: c.descricao }),
          foto && h("a", { href: foto, target: "_blank", rel: "noopener noreferrer" }, h("img", { class: "ch__img", src: foto, alt: "Foto enviada pelo cliente", loading: "lazy" })),
          h("div", { class: "res__btns" },
            c.status !== "em_andamento" && mv("em_andamento", "Em andamento"), c.status !== "concluido" && mv("concluido", "Concluído", "btn--ok"), c.status !== "aberto" && mv("aberto", "Voltar para novo", "btn--ghost"),
            h("a", { class: "btn btn--wa btn--sm", href: wa(c.telefone, `Olá, ${primeiro(c.nome)}! Aqui é da ${C.marca.a} ${C.marca.b}, sobre a manutenção da sua ${c.modelo} (chamado ${c.codigo}).`), target: "_blank", rel: "noopener noreferrer" }, icon("wa"), "Responder")));
      }) : [h("p", { class: "empty", text: "Nenhum chamado aqui." })]));
  }

  // ---------- informações ----------
  async function drawConfig() {
    const { data, error } = await db.from("config").select("*");
    if (error) return $("rows").replaceChildren(h("p", { class: "empty", text: friendly(error) }));
    const map = Object.fromEntries((data || []).map((r) => [r.chave, r.valor]));
    const form = h("form", { class: "dlg__body mt__card", novalidate: true },
      CONFIG_KEYS.map(([k, label]) => h("label", { class: "f" }, h("span", { text: label }), h("input", { type: "text", name: k, value: map[k] || "", maxlength: "500" }))),
      h("button", { class: "btn btn--ink btn--sm", type: "submit", text: "Salvar informações" }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const payload = CONFIG_KEYS.map(([k]) => ({ chave: k, valor: String(fd.get(k) || "").trim().slice(0, 500) }));
      const get = (k) => payload.find((p) => p.chave === k).valor;
      if (get("whatsapp") && !/^\d{12,13}$/.test(get("whatsapp"))) return toast("WhatsApp: use só números com 55 e DDD, ex.: 5553992023930", true);
      if (get("instagram") && !/^[A-Za-z0-9._]{1,30}$/.test(get("instagram"))) return toast("Instagram inválido", true);
      if (get("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get("email"))) return toast("E-mail inválido", true);
      const { error: err } = await db.from("config").upsert(payload);
      if (err) return toast(friendly(err), true);
      toast("Informações salvas");
    });
    $("rows").replaceChildren(form);
  }

  // ---------- log de alterações ----------
  const LOG_TABELAS = { config: "Informações", equipe_admin: "Acessos", impressoras: "Impressoras", reservas: "Reservas", chamados: "Manutenção" };
  const LOG_CAMPOS = { chave: "Campo", valor: "Valor", email: "E-mail", papel: "Papel", status: "Situação", valor_final: "Valor final", resposta: "Resposta", nota: "Nota", inicio: "Início", fim: "Fim", nome: "Nome", telefone: "Telefone", valor_estimado: "Valor do site", impressora_nome: "Impressora" };
  TABS.impressoras.fields.forEach((f) => { LOG_CAMPOS["impressoras." + f.k] = f.label.replace(/ \(.*\)$/, ""); });
  const ACOES = { criou: "Criou", alterou: "Alterou", excluiu: "Excluiu" };
  function logValor(k, v) {
    if (v == null || v === "") return "—";
    if (typeof v === "boolean") return v ? "sim" : "não";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (/^preco|^valor_/.test(k)) return brl(v);
    if (k === "foto") return String(v).split("/").pop();
    if (/_em$/.test(k) && !isNaN(Date.parse(v))) return quando(v);
    const t = typeof v === "object" ? JSON.stringify(v) : String(v);
    return t.length > 140 ? t.slice(0, 140) + "…" : t;
  }
  async function drawLog() {
    const { data, error } = await db.from("log_alteracoes").select("*").order("quando", { ascending: false }).limit(300);
    if (error) return $("rows").replaceChildren(h("p", { class: "empty", text: friendly(error) }));
    if (!data.length) return $("rows").replaceChildren(h("p", { class: "empty", text: "Nenhuma alteração registrada ainda." }));
    $("rows").replaceChildren(h("p", { class: "log__hint", text: `Últimas ${data.length} alterações. Só o admin vê esta aba.` }), ...data.map((l) => {
      const m = l.mudancas || {};
      const campo = (k) => LOG_CAMPOS[l.tabela + "." + k] || LOG_CAMPOS[k] || k;
      const linhas = l.acao === "alterou"
        ? Object.entries(m).map(([k, v]) => h("li", {}, h("span", { text: campo(k) }), h("s", { text: logValor(k, v && v.de) }), " → ", h("b", { text: logValor(k, v && v.para) })))
        : Object.entries(m).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => h("li", {}, h("span", { text: campo(k) }), h("b", { text: logValor(k, v) })));
      return h("article", { class: "log log--" + l.acao },
        h("div", { class: "log__head" },
          h("b", { text: `${ACOES[l.acao] || l.acao} · ${LOG_TABELAS[l.tabela] || l.tabela}${l.registro ? " · " + l.registro : ""}` }),
          h("small", { text: [quando(l.quando), l.email, l.ip ? "IP " + l.ip : null].filter(Boolean).join("  ·  ") })),
        linhas.length ? h("ul", { class: "log__diff" }, linhas) : null);
    }));
  }

  // ---------- formulário de impressora ----------
  let editing = null, pendingFile = null, removeFoto = false;

  function fieldEl(f, val) {
    const id = "f_" + f.k;
    if (f.t === "bool") return h("label", { class: "f f--check" }, h("input", { type: "checkbox", id, name: f.k, checked: (val ?? f.def ?? false) ? true : null }), h("span", { text: f.label }));
    let input;
    if (f.t === "textarea") { input = h("textarea", { id, name: f.k, maxlength: f.max }); input.value = val ?? ""; }
    else if (f.t === "select") {
      const opts = [...new Set([...(f.opts || []), ...(val ? [val] : [])])];
      input = [h("input", { type: "text", id, name: f.k, list: id + "_l", maxlength: f.max || 40, value: val ?? f.def ?? "" }), h("datalist", { id: id + "_l" }, opts.filter(Boolean).map((o) => h("option", { value: o })))];
    }
    else if (f.t === "money") input = h("input", { type: "text", inputmode: "decimal", id, name: f.k, placeholder: "0,00", value: val != null ? String(val).replace(".", ",") : "" });
    else if (f.t === "int") input = h("input", { type: "number", id, name: f.k, step: "1", min: f.min, max: f.max, value: val ?? f.def ?? (f.k === "ordem" ? 0 : "") });
    else if (f.t === "tags") input = h("input", { type: "text", id, name: f.k, value: (val || []).join(", ") });
    else if (f.t === "image") return imageField(f, val);
    else input = h("input", { type: "text", id, name: f.k, maxlength: f.max, value: val ?? "" });
    return h("label", { class: "f", for: id }, h("span", { text: f.label + (f.req ? " *" : "") }), input, f.hint && h("small", { text: f.hint }));
  }

  function imageField(f, val) {
    const thumb = h("div", { class: "f__thumb" });
    const show = (src) => thumb.replaceChildren(src ? h("img", { src, alt: "" }) : "");
    show(imgUrl(val));
    const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp" });
    const rm = h("button", { type: "button", class: "btn btn--sm btn--ghost", text: "Remover foto" });
    file.addEventListener("change", () => {
      const fl = file.files[0];
      if (!fl) return;
      if (!/^image\/(jpeg|png|webp)$/.test(fl.type)) { toast("Use JPG, PNG ou WebP", true); file.value = ""; return; }
      if (fl.size > 15 * 1024 * 1024) { toast("Imagem muito grande (máx. 15 MB)", true); file.value = ""; return; }
      pendingFile = fl; removeFoto = false; show(URL.createObjectURL(fl));
    });
    rm.addEventListener("click", () => { pendingFile = null; removeFoto = true; file.value = ""; show(null); });
    return h("div", { class: "f" }, h("span", { text: f.label }), h("div", { class: "f__pic" }, thumb, h("div", { class: "f__pic-btns" }, file, rm)),
      h("small", { text: "A foto é otimizada automaticamente (WebP, até 1600px). Fundo claro e a impressora inteira ficam melhor." }));
  }

  function edit(row) {
    const tab = TABS[current];
    editing = row; pendingFile = null; removeFoto = false;
    dialog({ title: row ? "Editar impressora" : "Nova impressora", body: tab.fields.map((f) => fieldEl(f, row ? row[f.k] : undefined)), del: row ? excluir : null });
    onSubmit = salvar;
  }
  $("btn-novo").addEventListener("click", () => edit(null));
  $("btn-fechar").addEventListener("click", () => $("dlg").close());

  function collect() {
    const tab = TABS[current], fd = new FormData($("form")), out = {};
    for (const f of tab.fields) {
      if (f.t === "image") continue;
      let v = fd.get(f.k);
      if (f.t === "bool") { out[f.k] = v === "on"; continue; }
      v = (v ?? "").toString().trim();
      if (f.req && !v) throw new Error(`Preencha: ${f.label}`);
      if (f.max && v.length > f.max) throw new Error(`${f.label}: máximo ${f.max} caracteres`);
      if (f.t === "money") {
        if (!v) { out[f.k] = null; continue; }
        const n = Number(v.replace(/\./g, "").replace(",", "."));
        if (!isFinite(n) || n < 0 || n >= 100000) throw new Error(`${f.label}: valor inválido`);
        out[f.k] = Math.round(n * 100) / 100;
      } else if (f.t === "int") {
        if (!v) { out[f.k] = f.def ?? (f.k === "ordem" ? 0 : null); continue; }
        const n = parseInt(v, 10);
        if (!Number.isInteger(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) throw new Error(`${f.label}: valor inválido`);
        out[f.k] = n;
      } else if (f.t === "tags") out[f.k] = v ? [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 12).map((s) => s.slice(0, 30)) : [];
      else out[f.k] = v;
    }
    if (out.desconto_longo_dias && !out.desconto_longo_pct) out.desconto_longo_dias = null;
    return out;
  }

  async function toWebp(file) {
    const bmp = await createImageBitmap(file);
    const max = 1600, scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.82));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("Não foi possível otimizar a imagem. Tente outra foto.");
    return blob;
  }

  async function salvar() {
    const tab = TABS[current];
    const data = collect();
    const oldFoto = editing?.foto || null;
    let uploaded = null;
    try {
      if (pendingFile) {
        const blob = await toWebp(pendingFile);
        const path = `${tab.folder}/${crypto.randomUUID()}.webp`;
        const { error } = await db.storage.from("imagens").upload(path, blob, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
        if (error) throw error;
        if (DEMO) mockUrls[path] = URL.createObjectURL(blob);
        uploaded = data.foto = path;
      } else if (removeFoto) data.foto = null;
      const res = editing ? await db.from(tab.table).update(data).eq("id", editing.id).select() : await db.from(tab.table).insert(data).select();
      if (res.error) throw res.error;
      if (!res.data?.length) throw new Error("Sem permissão ou sessão expirada. Entre de novo.");
      if (oldFoto && (uploaded || removeFoto)) await removeFile(oldFoto);
      toast("Salvo!"); open(current);
    } catch (err) {
      if (uploaded) await db.storage.from("imagens").remove([uploaded]).catch(() => {});
      throw err;
    }
  }

  async function excluir() {
    if (!editing || !confirm(`Excluir "${editing.nome}"? Não dá para desfazer. As reservas antigas continuam no histórico. Se quiser só tirar do site, desmarque "Visível no site".`)) return;
    const { data, error } = await db.from("impressoras").delete().eq("id", editing.id).select();
    if (error || !data?.length) { $("form-err").textContent = error ? friendly(error) : "Sem permissão ou sessão expirada."; return; }
    if (editing.foto) await removeFile(editing.foto);
    $("dlg").close(); toast("Excluída"); open(current);
  }

  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $("btn-salvar");
    $("form-err").textContent = "";
    btn.disabled = true;
    try { const keep = await onSubmit(); if (!keep) $("dlg").close(); }
    catch (err) { $("form-err").textContent = friendly(err); }
    finally { btn.disabled = false; }
  });
  $("btn-excluir").addEventListener("click", () => onDelete && onDelete());

  if (LIVE) db.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT" && !$("panel").hidden) sair("Sessão encerrada."); });
  boot();

  // =====================================================================
  //  Banco de mentira (só no painel de demonstração, sem Supabase)
  // =====================================================================
  function mockDb() {
    const hoje = hojeBR(), d = (n) => addDays(hoje, n), agora = new Date().toISOString();
    const imps = [
      { id: "d1", nome: "EcoTank L3250", marca: "Epson", modelo: "L3250", categoria: "Jato de tinta", descricao: "Multifuncional colorida com tanque de tinta.", recursos: ["Colorida", "Wi-Fi"], foto: "img/impressoras/tanque-de-tinta.svg", preco_dia: 45, desconto_pct: 0, desconto_longo_dias: 7, desconto_longo_pct: 15, minimo_dias: 1, destaque: true, ordem: 0, ativo: true },
      { id: "d2", nome: "DCP-L5652DN", marca: "Brother", modelo: "DCP-L5652DN", categoria: "Multifuncional", descricao: "Laser monocromática robusta.", recursos: ["Laser", "Frente e verso"], foto: "img/impressoras/multifuncional.svg", preco_dia: 70, desconto_pct: 10, desconto_longo_dias: 15, desconto_longo_pct: 20, minimo_dias: 2, destaque: true, ordem: 1, ativo: true },
      { id: "d3", nome: "Laser 107w", marca: "HP", modelo: "107w", categoria: "Laser", descricao: "Compacta e rápida.", recursos: ["Laser", "Wi-Fi"], foto: "img/impressoras/laser.svg", preco_dia: 35, desconto_pct: 0, minimo_dias: 1, destaque: false, ordem: 2, ativo: true },
      { id: "d4", nome: "ZD220", marca: "Zebra", modelo: "ZD220", categoria: "Etiquetas", descricao: "Térmica para etiquetas.", recursos: ["Térmica"], foto: "img/impressoras/etiquetas.svg", preco_dia: 40, desconto_pct: 0, desconto_longo_dias: 10, desconto_longo_pct: 10, minimo_dias: 1, destaque: false, ordem: 3, ativo: false },
    ].map((x) => ({ criado_em: agora, recursos: [], ...x }));
    const R = (o) => ({ id: crypto.randomUUID(), email: null, empresa: "", observacao: "", valor_final: null, resposta: "", decidido_em: null, decidido_por: null, criado_em: agora, ...o, dias: (new Date(o.fim) - new Date(o.inicio)) / 86400000 + 1 });
    const T = {
      impressoras: imps,
      reservas: [
        R({ codigo: "GI-K7P2QX", impressora_id: "d1", impressora_nome: "Epson EcoTank L3250", nome: "Mariana Souza", telefone: "5553999990001", email: "mariana@exemplo.com", empresa: "Escola Aquarela", observacao: "Precisamos para as provas finais.", inicio: d(9), fim: d(10), valor_estimado: 90, status: "pendente" }),
        R({ codigo: "GI-M3ZT8A", impressora_id: "d2", impressora_nome: "Brother DCP-L5652DN", nome: "Carlos Pereira", telefone: "5553999990002", inicio: d(12), fim: d(16), valor_estimado: 315, status: "pendente" }),
        R({ codigo: "GI-W9H4RB", impressora_id: "d3", impressora_nome: "HP Laser 107w", nome: "Ana Lima", telefone: "5553999990003", inicio: d(6), fim: d(6), valor_estimado: 35, status: "pendente" }),
        R({ codigo: "GI-A2C5DE", impressora_id: "d1", impressora_nome: "Epson EcoTank L3250", nome: "Rafael Costa", telefone: "5553999990004", email: "rafael@exemplo.com", inicio: d(3), fim: d(5), valor_estimado: 135, valor_final: 120, resposta: "Retirada a partir das 9h.", status: "aprovada", decidido_em: agora, decidido_por: "dono@exemplo.com" }),
        R({ codigo: "GI-B8F6GH", impressora_id: "d2", impressora_nome: "Brother DCP-L5652DN", nome: "Juliana Alves", telefone: "5553999990005", inicio: d(0), fim: d(2), valor_estimado: 189, status: "aprovada", decidido_em: agora }),
        R({ codigo: "GI-C4J7KL", impressora_id: "d3", impressora_nome: "HP Laser 107w", nome: "Pedro Rocha", telefone: "5553999990006", inicio: d(2), fim: d(3), valor_estimado: 70, status: "recusada", resposta: "Impressora em revisão nessas datas.", decidido_em: agora }),
      ],
      chamados: [
        { id: "c1", codigo: "GM-R5T8UV", nome: "Lucas Martins", telefone: "5553999990007", modelo: "Epson L3150", descricao: "Está imprimindo com listras brancas no preto, já fiz limpeza de cabeçote.", foto: null, status: "aberto", nota: "", criado_em: agora },
        { id: "c2", codigo: "GM-X2Y3ZA", nome: "Fernanda Dias", telefone: "5553999990008", modelo: "HP LaserJet M1132", descricao: "Papel enrosca na saída e aparece luz laranja piscando.", foto: null, status: "em_andamento", nota: "", criado_em: agora },
      ],
      config: [{ chave: "whatsapp", valor: C.whatsapp }, { chave: "horario", valor: "Seg a sex · 08:30 às 18:00" }],
      log_alteracoes: [],
    };
    const conflita = (row, all) => (row.status === "pendente" || row.status === "aprovada") && all.some((o) => o.id !== row.id && o.impressora_id === row.impressora_id && (o.status === "pendente" || o.status === "aprovada") && o.inicio <= row.fim && o.fim >= row.inicio);
    class Q {
      constructor(t) { this.t = t; this.f = []; this.o = []; this.op = "select"; this.n = null; }
      select() { return this; }
      eq(k, v) { this.f.push((r) => r[k] === v); return this; }
      order(k, o) { this.o.push([k, !o || o.ascending !== false]); return this; }
      limit(n) { this.n = n; return this; }
      insert(v) { this.op = "insert"; this.v = v; return this; }
      update(v) { this.op = "update"; this.v = v; return this; }
      delete() { this.op = "delete"; return this; }
      upsert(v) { this.op = "upsert"; this.v = v; return this; }
      run() {
        const tab = (T[this.t] = T[this.t] || []);
        const m = (r) => this.f.every((fn) => fn(r));
        if (this.op === "insert") { const r = { id: crypto.randomUUID(), criado_em: new Date().toISOString(), ...this.v }; tab.push(r); return { data: [r], error: null }; }
        if (this.op === "upsert") { for (const v of this.v) { const i = tab.findIndex((r) => r.chave === v.chave); i >= 0 ? (tab[i] = v) : tab.push(v); } return { data: this.v, error: null }; }
        if (this.op === "update") {
          const out = [];
          for (const r of tab.filter(m)) {
            const nr = { ...r, ...this.v };
            if (this.t === "reservas" && conflita(nr, tab)) return { data: null, error: { message: "conflicting key value violates exclusion constraint \"sem_conflito\"" } };
            if (this.t === "reservas" && nr.status !== r.status) { nr.decidido_em = new Date().toISOString(); nr.decidido_por = "demonstração"; }
            Object.assign(r, nr); out.push(r);
          }
          return { data: out, error: null };
        }
        if (this.op === "delete") { const out = tab.filter(m); T[this.t] = tab.filter((r) => !m(r)); return { data: out, error: null }; }
        let out = tab.filter(m).slice();
        for (const [k, asc] of this.o.slice().reverse()) out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        if (this.n) out = out.slice(0, this.n);
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    }
    return {
      from: (t) => new Q(t),
      rpc: async () => ({ data: [], error: null }),
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), getPublicUrl: (p) => ({ data: { publicUrl: mockUrls[p] || "" } }) }) },
      auth: { signOut: async () => {} },
    };
  }
})();
