// =====================================================================
//  Configuração do site. Preencha supabaseUrl e supabaseAnonKey depois de
//  criar o projeto no Supabase (veja SETUP.md). A chave "publishable"/"anon"
//  é pública por natureza: a segurança vem das regras do banco
//  (supabase/schema.sql), não dela. NUNCA coloque aqui a chave secret/service_role.
//  Enquanto estiverem vazias, o site abre em MODO DEMONSTRAÇÃO.
// =====================================================================
window.SITE_CONFIG = {
  supabaseUrl: "https://ciwcqsngxeqikaqkivlg.supabase.co",
  supabaseAnonKey: "sb_publishable_VGBqUMa41VTnXLMQ0zo3_A_ynop2Z_v", // chave publishable (pública)

  marca: { a: "Gaúcha", b: "Impressoras" },

  // WhatsApp da Gaúcha (DDI + DDD + número, só dígitos). O painel pode trocar em "Informações".
  whatsapp: "5553992023930",

  // Endereço (o painel pode trocar em "Informações")
  endereco: "Rua Coronel Onofre Pires, 57 A · Fragata · Pelotas/RS",

  // Horário de atendimento (horário de Brasília). 1 = segunda ... 5 = sexta
  horario: { dias: [1, 2, 3, 4, 5], abre: "08:30", fecha: "18:00", texto: "Seg a sex · 08:30 às 18:00" },

  // Tempo máximo de sessão do painel (o banco também confere isso)
  sessaoMinutos: 15,
};
