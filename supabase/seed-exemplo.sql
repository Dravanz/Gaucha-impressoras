-- OPCIONAL: cadastra impressoras de exemplo (as mesmas do modo demonstração).
-- Rode no SQL Editor depois do schema.sql. Depois edite ou apague pelo painel.
insert into public.impressoras (nome, marca, modelo, categoria, descricao, recursos, foto, preco_dia, desconto_pct, desconto_longo_dias, desconto_longo_pct, minimo_dias, destaque, ordem) values
  ('EcoTank L3250', 'Epson', 'L3250', 'Jato de tinta', 'Multifuncional colorida com tanque de tinta: imprime, copia e digitaliza.', '{Colorida,Wi-Fi,"Copia e digitaliza"}', 'img/impressoras/tanque-de-tinta.svg', 45, 0, 7, 15, 1, true, 0),
  ('DCP-L5652DN', 'Brother', 'DCP-L5652DN', 'Multifuncional', 'Laser monocromática robusta, frente e verso automático.', '{Laser,"Frente e verso",Rede}', 'img/impressoras/multifuncional.svg', 70, 10, 15, 20, 2, true, 1),
  ('Laser 107w', 'HP', '107w', 'Laser', 'Compacta e rápida, ideal para documentos do dia a dia.', '{Laser,Wi-Fi,"20 ppm"}', 'img/impressoras/laser.svg', 35, 0, null, 0, 1, false, 2),
  ('ZD220', 'Zebra', 'ZD220', 'Etiquetas', 'Térmica para etiquetas e códigos de barras.', '{Térmica,USB}', 'img/impressoras/etiquetas.svg', 40, 0, 10, 10, 1, false, 3);
