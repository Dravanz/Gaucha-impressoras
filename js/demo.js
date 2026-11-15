// Conteúdo de exemplo: usado só enquanto o Supabase não está configurado (js/config.js).
(function () {
  const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  window.DEMO = {
    impressoras: [
      { id: "d1", nome: "EcoTank L3250", marca: "Epson", modelo: "L3250", categoria: "Jato de tinta", descricao: "Multifuncional colorida com tanque de tinta: imprime, copia e digitaliza. Ótima para escritório e eventos.", recursos: ["Colorida", "Wi-Fi", "Copia e digitaliza"], foto: "img/impressoras/tanque-de-tinta.svg", preco_dia: 45, desconto_pct: 0, desconto_longo_dias: 7, desconto_longo_pct: 15, minimo_dias: 1, destaque: true },
      { id: "d2", nome: "DCP-L5652DN", marca: "Brother", modelo: "DCP-L5652DN", categoria: "Multifuncional", descricao: "Laser monocromática robusta, frente e verso automático e alimentador para 50 folhas.", recursos: ["Laser", "Frente e verso", "Rede"], foto: "img/impressoras/multifuncional.svg", preco_dia: 70, desconto_pct: 10, desconto_longo_dias: 15, desconto_longo_pct: 20, minimo_dias: 2, destaque: true },
      { id: "d3", nome: "Laser 107w", marca: "HP", modelo: "107w", categoria: "Laser", descricao: "Compacta e rápida, ideal para documentos do dia a dia.", recursos: ["Laser", "Wi-Fi", "20 ppm"], foto: "img/impressoras/laser.svg", preco_dia: 35, desconto_pct: 0, minimo_dias: 1 },
      { id: "d4", nome: "ZD220", marca: "Zebra", modelo: "ZD220", categoria: "Etiquetas", descricao: "Térmica para etiquetas e códigos de barras. Perfeita para estoque e expedição.", recursos: ["Térmica", "USB", "Etiquetas até 104 mm"], foto: "img/impressoras/etiquetas.svg", preco_dia: 40, desconto_pct: 0, desconto_longo_dias: 10, desconto_longo_pct: 10, minimo_dias: 1 },
    ],
    ocupadas: [
      { impressora_id: "d1", inicio: d(3), fim: d(5), status: "aprovada" },
      { impressora_id: "d1", inicio: d(9), fim: d(10), status: "pendente" },
      { impressora_id: "d2", inicio: d(0), fim: d(2), status: "aprovada" },
      { impressora_id: "d2", inicio: d(12), fim: d(16), status: "pendente" },
      { impressora_id: "d3", inicio: d(6), fim: d(6), status: "pendente" },
    ],
    config: { whatsapp: "", email: "", endereco: "", instagram: "", horario: "" },
  };
})();
