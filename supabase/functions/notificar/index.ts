// =====================================================================
//  OPCIONAL · Aviso automático por e-mail (Supabase Edge Function)
//  Disparada pelas tabelas "reservas" e "chamados" (supabase/webhooks.sql):
//   - novo pedido de locação  -> e-mail para o dono
//   - pedido aprovado/recusado/cancelado -> e-mail para o cliente (se informou)
//   - novo protocolo de manutenção -> e-mail para o dono
//   - manutenção aceita/recusada/concluída -> e-mail para o cliente (se informou)
//
//  Envio pelo GMAIL da Gaúcha (grátis, sem domínio próprio). Secrets:
//    GMAIL_USUARIO   ex.: gauchaimpressoras@gmail.com
//    GMAIL_SENHA_APP senha de app de 16 letras (Conta Google > Segurança >
//                    Verificação em duas etapas > Senhas de app)
//    EMAIL_DONO      e-mail que recebe os avisos (pode ser o mesmo Gmail)
//    WEBHOOK_SECRET  mesmo valor usado em supabase/webhooks.sql
//  Alternativa (domínio próprio verificado no Resend): sem os secrets do Gmail,
//  usa RESEND_API_KEY + EMAIL_REMETENTE ("Gaúcha Impressoras <avisos@dominio.com.br>").
// =====================================================================
import nodemailer from "npm:nodemailer@6.9.16";

const env = (k: string) => Deno.env.get(k) ?? "";
const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const br = (s: string) => s.split("-").reverse().join("/");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;

async function enviar(to: string, subject: string, linhas: string[]) {
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#15171b">
    <h2 style="color:#169b5b;margin:0 0 12px">Gaúcha Impressoras</h2>${linhas.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join("")}</div>`;
  const text = linhas.join("\n");

  if (env("GMAIL_USUARIO") && env("GMAIL_SENHA_APP")) {
    smtp ??= nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: env("GMAIL_USUARIO"), pass: env("GMAIL_SENHA_APP").replace(/\s/g, "") },
    });
    try {
      const info = await smtp.sendMail({ from: `"Gaúcha Impressoras" <${env("GMAIL_USUARIO")}>`, to, subject, text, html });
      console.log("Gmail enviado", to, info.messageId);
    } catch (e) { console.error("Gmail erro", to, String(e)); }
    return;
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("EMAIL_REMETENTE") || "Gaúcha Impressoras <onboarding@resend.dev>", to: [to], subject, html, text }),
  });
  if (!r.ok) console.error("Resend", r.status, await r.text());
}

Deno.serve(async (req) => {
  if (!env("WEBHOOK_SECRET") || req.headers.get("x-webhook-secret") !== env("WEBHOOK_SECRET")) return new Response("forbidden", { status: 403 });
  const { type, table, record: r, old_record: o } = await req.json();
  const dono = env("EMAIL_DONO");
  const periodo = r?.inicio ? `${br(r.inicio)} a ${br(r.fim)} (${r.dias} ${r.dias === 1 ? "dia" : "dias"})` : "";

  if (table === "reservas" && type === "INSERT" && dono) {
    await enviar(dono, `Novo pedido de locação · ${r.codigo}`, [
      `Pedido ${r.codigo} aguardando sua aprovação no painel.`, `Impressora: ${r.impressora_nome}`, `Período: ${periodo}`,
      `Valor estimado: ${brl(r.valor_estimado)}`, `Cliente: ${r.nome}${r.empresa ? " · " + r.empresa : ""}`, `WhatsApp: ${r.telefone}`,
      r.email ? `E-mail: ${r.email}` : "", r.observacao ? `Obs.: ${r.observacao}` : "",
    ].filter(Boolean));
  }
  if (table === "reservas" && type === "UPDATE" && r.status !== o?.status && r.email && ["aprovada", "recusada", "cancelada"].includes(r.status)) {
    const t = { aprovada: "Sua locação foi confirmada ✅", recusada: "Não conseguimos confirmar seu pedido", cancelada: "Sua locação foi cancelada" }[r.status as string]!;
    await enviar(r.email, `${t} · ${r.codigo}`, [
      `Olá, ${String(r.nome).split(" ")[0]}!`, t + ".", `Pedido: ${r.codigo}`, `Impressora: ${r.impressora_nome}`, `Período: ${periodo}`,
      r.status === "aprovada" ? `Valor: ${brl(r.valor_final ?? r.valor_estimado)}` : "", r.resposta ? r.resposta : "",
      "Qualquer dúvida, fale com a gente pelo WhatsApp (53) 99202-3930.",
    ].filter(Boolean));
  }
  if (table === "chamados" && type === "INSERT" && dono) {
    const foto = r.foto ? `${env("SUPABASE_URL")}/storage/v1/object/public/imagens/${r.foto}` : "";
    await enviar(dono, `Novo protocolo de manutenção · ${r.codigo}`, [
      `Protocolo ${r.codigo} aguardando análise no painel (aba Manutenção).`, `Modelo: ${r.modelo}`,
      `Cliente: ${r.nome} · WhatsApp ${r.telefone}`, r.email ? `E-mail: ${r.email}` : "", `Problema: ${r.descricao}`, foto ? `Foto: ${foto}` : "",
    ].filter(Boolean));
  }
  if (table === "chamados" && type === "UPDATE" && r.status !== o?.status && r.email && ["aceita", "recusada", "concluida"].includes(r.status)) {
    const t = { aceita: "Seu pedido de manutenção foi aceito ✅", recusada: "Não conseguimos atender seu pedido de manutenção", concluida: "Sua manutenção foi concluída ✅" }[r.status as string]!;
    await enviar(r.email, `${t} · ${r.codigo}`, [
      `Olá, ${String(r.nome).split(" ")[0]}!`, t + ".", `Protocolo: ${r.codigo}`, `Impressora: ${r.modelo}`,
      r.resposta ? (r.status === "recusada" ? `Motivo: ${r.resposta}` : r.resposta) : "",
      "Qualquer dúvida, fale com a gente pelo WhatsApp (53) 99202-3930.",
    ].filter(Boolean));
  }
  return new Response("ok");
});
