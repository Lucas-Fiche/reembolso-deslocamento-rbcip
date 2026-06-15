// ══════════════════════════════════════════════════════════════
// APPS SCRIPT — Registro de Deslocamento RBCIP
// ══════════════════════════════════════════════════════════════
//
// INSTRUÇÕES DE INSTALAÇÃO:
//
// 1. Crie uma planilha no Google Sheets (ela será o banco de dados).
//    - Copie o ID da planilha (está na URL: docs.google.com/spreadsheets/d/{ID}/edit)
//
// 2. Acesse https://script.google.com e crie um novo projeto.
//    - Cole este código inteiro no editor.
//    - Substitua o SPREADSHEET_ID abaixo pelo ID da sua planilha.
//
// 3. No Google Drive, crie uma pasta chamada "Comprovantes_Reembolso"
//    - Copie o ID da pasta (está na URL: drive.google.com/drive/folders/{ID})
//    - Substitua o DRIVE_FOLDER_ID abaixo.
//
// 4. Faça o deploy:
//    a) Clique em "Implantar" > "Nova implantação"
//    b) Tipo: "App da Web"
//    c) Executar como: "Eu" (sua conta)
//    d) Quem tem acesso: "Qualquer pessoa"
//    e) Clique em "Implantar" e autorize as permissões
//    f) Copie a URL gerada e cole na variável APPS_SCRIPT_URL do HTML
//
// 5. Na primeira execução, rode a função "setupPlanilha" manualmente
//    para criar os cabeçalhos automaticamente:
//    a) No editor, selecione "setupPlanilha" no dropdown de funções
//    b) Clique em "Executar"
//

// ══════════════════════════════════════════════════════════════



// 1. Primeiro, resgatamos o serviço de propriedades do script
var propriedades = PropertiesService.getScriptProperties();

// 2. Trocamos os "SEGREDOS" pelos valores salvos nas propriedades
// Usando os nomes exatos que você criou na imagem:
var SPREADSHEET_ID = propriedades.getProperty('PLANILHA_ID');
var DRIVE_FOLDER_ID = propriedades.getProperty('PASTA_DRIVE_ID');
// Senha do Painel Administrativo (defina em Configurações do projeto > Propriedades do script)
var PAINEL_SENHA = propriedades.getProperty('PAINEL_SENHA');
// E-mail do gestor para avisos automáticos (ex.: correção recebida). Opcional.
var ADMIN_EMAIL = propriedades.getProperty('ADMIN_EMAIL');
// Contato de suporte exibido nos e-mails e avisos do app
var CONTATO_BUSINESS = "+55 11 93623-3054";
// Geração de recibo (substitui o Autocrat). Defina nas Propriedades do script:
//   RECIBO_TEMPLATE_ID = ID do Google Doc modelo (com as tags <<...>>)
//   RECIBOS_FOLDER_ID  = ID da pasta no Drive onde os PDFs serão salvos
var RECIBO_TEMPLATE_ID = propriedades.getProperty('RECIBO_TEMPLATE_ID');
var RECIBOS_FOLDER_ID = propriedades.getProperty('RECIBOS_FOLDER_ID');

// 3. As demais variáveis continuam iguais, pois não são informações sensíveis
var ABA = "Registros";
var ABA_HISTORICO = "Histórico";
var PRECO_BASE = 6.79;
var LOCK_TIMEOUT = 15000; // 15s

// 36 colunas: A..AJ
// A=Proto B=Status C=CI_DH D=CI_Lat E=CI_Lng F=CI_Foto
// G=CO_DH H=CO_Lat I=CO_Lng J=CO_Foto K=Tempo
// L=Nome M=CPF N=Email O=Tel P=Veic Q=Placa
// R=IdaPlan S=IdaTexto T=IdaQtd
// U=VoltaPlan V=VoltaTexto W=VoltaQtd
// X=DistTotal Y=Pedagios Z=QtdPed AA=ValPed AB=CompPed
// AC=UsouEstim AD=PrecoBase AE=PrecoReal AF=Cupom
// AG=ValEstim AH=ValReal AI=ValTotal AJ=Validacao

function setupPlanilha() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var s = ss.getSheetByName(ABA); if (!s) s = ss.insertSheet(ABA);
  var h = ["Protocolo","Status","CI DH","CI Lat","CI Lng","CI Foto","CO DH","CO Lat","CO Lng","CO Foto","Tempo","Nome","CPF","E-mail","Telefone","Veículo","Placa","Ida Plan","Ida Trechos","Ida Qtd","Volta Plan","Volta Trechos","Volta Qtd","Dist Total (km)","Pedágios","Qtd Ped","Val Pedágios","Comprov Ped","Usou Estimativa?","Preço Base","Preço Real","Cupom Comb","Val Estimado","Val Real","Val Total","Validação","RG","Órgão Emissor","Recibo"];
  s.getRange(1,1,1,h.length).setValues([h]);
  s.getRange(1,1,1,h.length).setFontWeight("bold").setBackground("#1A3A5C").setFontColor("#FFF").setFontFamily("Arial").setFontSize(9).setHorizontalAlignment("center").setWrap(true);
  s.setFrozenRows(1);
  // Criar aba de histórico se não existir
  if (!ss.getSheetByName(ABA_HISTORICO)) {
    var hist = ss.insertSheet(ABA_HISTORICO);
    hist.getRange(1,1,1,h.length).setValues([h]);
    hist.getRange(1,1,1,h.length).setFontWeight("bold").setBackground("#4A5568").setFontColor("#FFF").setFontFamily("Arial").setFontSize(9).setHorizontalAlignment("center").setWrap(true);
    hist.setFrozenRows(1);
  }
  Logger.log("OK v5.1");
}

// ══════════════════════════════════════════════════════════════
// LOCK HELPER — garante que apenas 1 escrita por vez
// ══════════════════════════════════════════════════════════════
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT)) {
    return jr({success: false, error: "Servidor ocupado. Tente novamente em alguns segundos."});
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════════════════════════════════
// AUTENTICAÇÃO DO PAINEL ADMIN
// A senha NÃO fica no código do dashboard: o painel a recebe no login e
// a envia em cada requisição administrativa. Aqui validamos contra a
// PAINEL_SENHA guardada nas Propriedades do script (lado servidor).
// ══════════════════════════════════════════════════════════════
function authAdmin(token) {
  return !!PAINEL_SENHA && String(token || "") === String(PAINEL_SENHA);
}

// ══════════════════════════════════════════════════════════════
// ROUTERS
// ══════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    // Upload de imagem é I/O de Drive puro — NÃO usa lock (não toca na planilha)
    if (d.action === "upload_imagem") return doUploadImagem(d);
    // Operações de escrita na planilha passam pelo lock
    if (d.action === "checkin") return withLock(function(){ return doCheckin(d); });
    if (d.action === "parada") return withLock(function(){ return doParada(d); });
    if (d.action === "finalizar") return withLock(function(){ return doFinalizar(d); });
    if (d.action === "lancamento_posterior") return withLock(function(){ return doLancamentoPosterior(d); });
    if (d.action === "corrigir") return withLock(function(){ return doCorrigir(d); });
    if (d.action === "set_volta") return withLock(function(){ return doSetVolta(d); });
    // ── Ações ADMINISTRATIVAS: exigem a senha do painel (PAINEL_SENHA) ──
    if (d.action === "login_admin") return jr({success: authAdmin(d.token), auth: authAdmin(d.token)});
    if (d.action === "listar") {
      if (!authAdmin(d.token)) return jr({success: false, auth: false, error: "Não autorizado."});
      return listarRegistros(d.status || "");
    }
    if (d.action === "atualizar_status") {
      if (!authAdmin(d.token)) return jr({success: false, auth: false, error: "Não autorizado."});
      return withLock(function(){ return doAtualizarStatus(d); });
    }
    if (d.action === "editar_admin") {
      if (!authAdmin(d.token)) return jr({success: false, auth: false, error: "Não autorizado."});
      return withLock(function(){ return doEditarAdmin(d); });
    }
    if (d.action === "gerar_recibo") {
      if (!authAdmin(d.token)) return jr({success: false, auth: false, error: "Não autorizado."});
      return withLock(function(){ return doGerarRecibo(d); });
    }
    return jr({success: false, error: "Ação desconhecida"});
  } catch(err) { return jr({success: false, error: err.message}); }
}

function doGet(e) {
  // Leituras não precisam de lock
  try {
    var a = e && e.parameter ? e.parameter.action : "status";
    if (a === "buscar_checkin") return buscarAberto(e.parameter.cpf || "");
    if (a === "verificar_status") return verificarStatus(e.parameter.protocolo || "");
    if (a === "buscar_viagem") return buscarViagem(e.parameter.protocolo || "");
    if (a === "buscar_revisao") return buscarRevisao(e.parameter.cpf || "");
    if (a === "buscar_situacao") return buscarSituacao(e.parameter.cpf || "");
    if (a === "carregar_pedido") return carregarPedido(e.parameter.protocolo || "");
    if (a === "listar") {
      // Endpoint sensível (retorna todos os dados): exige a senha do painel.
      if (!authAdmin(e.parameter.token)) return jr({success: false, auth: false, error: "Não autorizado."});
      return listarRegistros(e.parameter.status || "");
    }
    return jr({status: "ok", v: "5.1"});
  } catch(err) { return jr({success: false, error: err.message}); }
}

// ══════════════════════════════════════════════════════════════
// CHECK-IN — appendRow já é atômico, lock protege o findAberto
// ══════════════════════════════════════════════════════════════
function doCheckin(d) {
  var s = getSheet();
  if (!s) return jr({success: false, error: "Rode setupPlanilha."});
  var allData = s.getDataRange().getValues(); // 1 leitura
  var ex = findAbertoData(allData, d.cpf);
  if (ex) return jr({success: false, error: "Check-in aberto (" + ex.protocolo + ")."});

  var sub = getOrCreate(DriveApp.getFolderById(DRIVE_FOLDER_ID), d.protocolo);
  var foto = saveImg(sub, d.img_odometro_saida, "odometro_saida");

  var row = [d.protocolo, "ABERTO", fts(d.checkin_timestamp), d.checkin_lat||"", d.checkin_lng||"", foto,
    "","","","","", d.nome, d.cpf, d.email, d.telefone, d.veiculo, d.placa,
    d.ida_paradas||1, "", 0, d.volta_paradas||0, "", 0,
    0, "", 0, "", "", "", PRECO_BASE, "", "", "", "", "", "",
    d.rg||"", d.orgao||"", ""];   // AK=RG, AL=Órgão Emissor, AM=Recibo
  s.appendRow(row);

  // Formatar status — 1 chamada
  s.getRange(s.getLastRow(), 2).setBackground("#FFFBEB").setFontColor("#92400E").setFontWeight("bold");
  return jr({success: true, protocolo: d.protocolo});
}

// ══════════════════════════════════════════════════════════════
// UPLOAD DE IMAGEM — endpoint individual (envio fragmentado)
// Recebe base64, salva no Drive da viagem e devolve o link.
// Sem lock e sem leitura de planilha → rápido, evita timeout.
// ══════════════════════════════════════════════════════════════
function doUploadImagem(d) {
  try {
    if (!d.protocolo) return jr({success: false, error: "Protocolo ausente."});
    if (!d.base64) return jr({success: false, error: "Imagem ausente."});
    var sub = getOrCreate(DriveApp.getFolderById(DRIVE_FOLDER_ID), d.protocolo);
    var nome = (d.name || ("img_" + Date.now())).replace(/[^a-zA-Z0-9_\-]/g, "_");
    var link = saveImg(sub, d.base64, nome);
    if (!link || link === "ERRO") return jr({success: false, error: "Falha ao salvar imagem."});
    return jr({success: true, link: link});
  } catch (err) {
    return jr({success: false, error: err.message});
  }
}

// ══════════════════════════════════════════════════════════════
// PARADA — PING LEVE: só texto/GPS, nenhum anexo. Escreve 2 células.
// ══════════════════════════════════════════════════════════════
function doParada(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});
  var row = info.row;
  var rowData = info.data;

  var fase = d.fase || "ida";
  var colPlan = fase==="ida" ? 17 : 20; // 0-indexed: R=17, U=20
  var colTxt = fase==="ida" ? 18 : 21;
  var colQtd = fase==="ida" ? 19 : 22;

  var plan = rowData[colPlan] || 1;
  var done = rowData[colQtd] || 0;
  if (done >= plan) return jr({success: false, error: "Todas as paradas de " + fase + " já registradas."});

  var num = done + 1;
  // Ping leve: sem imagens. Os prints do Maps entram no CHECK-OUT.
  var entry = num+". "+(d.origem||"?")+" → "+(d.destino||"?")+" | "+(d.distancia_km||0)+" km | "+fts(d.timestamp)+" | GPS: "+(d.lat?Number(d.lat).toFixed(5)+","+Number(d.lng).toFixed(5):"N/A");

  var curTxt = rowData[colTxt] || "";
  var newTxt = curTxt ? curTxt + "\n" + entry : entry;

  // Batch: 2 células na mesma linha (texto + contagem)
  s.getRange(row, colTxt+1).setValue(newTxt);  // +1 porque getRange é 1-indexed
  s.getRange(row, colQtd+1).setValue(num);

  return jr({success: true, parada_num: num, restantes: plan-num, fase: fase});
}

// ══════════════════════════════════════════════════════════════
// SET VOLTA — 1 escrita
// ══════════════════════════════════════════════════════════════
function doSetVolta(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});
  s.getRange(info.row, 21).setValue(parseInt(d.volta_paradas) || 1); // col U
  return jr({success: true});
}

// ══════════════════════════════════════════════════════════════
// FINALIZAR — batch de TODAS as atualizações em 1 chamada
// ══════════════════════════════════════════════════════════════
function doFinalizar(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});
  var row = info.row;
  var rowData = info.data;

  // Envio fragmentado: as imagens já foram enviadas ao Drive via
  // "upload_imagem". Aqui só recebemos os LINKS — payload leve, sem timeout.
  var lc = d.img_odometro_chegada_link || "";
  var lcup = d.img_cupom_link || "";

  var peds = d.pedagios || [], tPed = 0, pTxt = "", pLnk = [];
  for (var i = 0; i < peds.length; i++) {
    var v = parseFloat(peds[i].valor) || 0; tPed += v;
    var pl = peds[i].foto_link || "";
    var faseLbl = peds[i].fase ? "["+String(peds[i].fase).toUpperCase()+"] " : "";
    pLnk.push(pl);
    pTxt += (i+1)+". "+faseLbl+"R$ "+v.toFixed(2)+(pl?" | "+pl:"")+"\n";
  }

  // Anexar o link do Maps a cada trecho (1 print por parada registrada)
  var idaTxt = appendMapsLinks(rowData[18], d.maps_ida || []);
  var voltaTxt = appendMapsLinks(rowData[21], d.maps_volta || []);

  // Cálculos (km extraído dos textos ORIGINAIS, antes de anexar links)
  var dTot = extrairKm(rowData[18]) + extrairKm(rowData[21]); // ida + volta textos
  var con = d.veiculo === "Moto" ? 49 : 10;
  var usouEstim = d.usar_estimativa === true;
  var pReal = usouEstim ? PRECO_BASE : (parseFloat(d.preco_real) || PRECO_BASE);
  var vEst = (dTot/con) * PRECO_BASE, vReal = (dTot/con) * pReal, vTot = vReal + tPed;

  var tempo = "";
  if (d.checkin_timestamp_iso && d.checkout_timestamp) {
    var dm = Math.round((new Date(d.checkout_timestamp) - new Date(d.checkin_timestamp_iso)) / 60000);
    tempo = dm >= 60 ? Math.floor(dm/60)+"h"+("0"+(dm%60)).slice(-2)+"min" : dm+" min";
  }

  // Validação
  var fl = [];
  var ciL = rowData[3]; // CI_Lat
  if (!ciL || !d.checkout_lat) fl.push("GPS ausente");
  if (ciL && d.checkout_lat) {
    var gD = haversine(ciL, rowData[4], d.checkout_lat, d.checkout_lng);
    var tp = (rowData[19]||0) + (rowData[22]||0);
    if (gD < 0.5 && tp === 0) fl.push("Mesmo local sem paradas");
  }
  if (d.checkin_timestamp_iso && d.checkout_timestamp && (new Date(d.checkout_timestamp)-new Date(d.checkin_timestamp_iso))/60000 < 15) fl.push("Tempo<15min");
  if (vTot > 500) fl.push("Valor>R$500");
  if (!usouEstim && pReal > PRECO_BASE*1.3) fl.push("Preço/L 30%+ acima");
  var val = fl.length === 0 ? "✅ OK" : "⚠️ " + fl.join(" | ");

  // ── BATCH: montar array com todas as colunas e gravar de uma vez ──
  // Atualizar colunas B(2) a AJ(36) = 35 células a partir da col 2
  var updated = rowData.slice(); // cópia
  updated[1] = "COMPLETO";                   // B
  updated[6] = fts(d.checkout_timestamp);     // G
  updated[7] = d.checkout_lat || "";          // H
  updated[8] = d.checkout_lng || "";          // I
  updated[9] = lc;                            // J
  updated[10] = tempo;                        // K
  updated[18] = idaTxt;                       // S (trechos ida + links Maps)
  updated[21] = voltaTxt;                     // V (trechos volta + links Maps)
  updated[23] = dTot;                         // X
  updated[24] = pTxt.trim();                  // Y
  updated[25] = peds.length;                  // Z
  updated[26] = tPed.toFixed(2);              // AA
  updated[27] = pLnk.join("\n");              // AB
  updated[28] = usouEstim ? "Sim" : "Não";    // AC
  updated[29] = PRECO_BASE;                   // AD
  updated[30] = pReal;                        // AE
  updated[31] = lcup;                         // AF
  updated[32] = vEst.toFixed(2);              // AG
  updated[33] = vReal.toFixed(2);             // AH
  updated[34] = vTot.toFixed(2);              // AI
  updated[35] = val;                          // AJ

  // 1 ÚNICA chamada de escrita para toda a linha
  s.getRange(row, 1, 1, updated.length).setValues([updated]);

  // Formatação: 2 chamadas mínimas (status + validação)
  s.getRange(row, 2).setBackground("#ECFDF5").setFontColor("#065F46").setFontWeight("bold");
  var vc = s.getRange(row, 36);
  if (val === "✅ OK") vc.setBackground("#ECFDF5").setFontColor("#065F46");
  else vc.setBackground("#FEF2F2").setFontColor("#991B1B");

  // E-mail (async, não bloqueia)
  var em = rowData[13]; // email
  if (em) {
    try {
      MailApp.sendEmail({to: em, subject: "Reembolso "+d.protocolo+" — R$ "+vTot.toFixed(2),
        htmlBody: '<div style="font-family:Arial;max-width:500px;margin:0 auto"><div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Reembolso Registrado</h2></div><div style="background:#F4F6FA;padding:20px;border-radius:0 0 10px 10px"><p>Protocolo: <strong>'+d.protocolo+'</strong></p><p>Distância: '+dTot+' km</p><p>Combustível (R$ '+pReal.toFixed(2)+'/L'+(usouEstim?' — estimativa':'')+'): R$ '+vReal.toFixed(2)+'</p>'+(tPed?'<p>Pedágios: R$ '+tPed.toFixed(2)+'</p>':'')+'<p style="font-size:20px;color:#1A3A5C;font-weight:700">Total: R$ '+vTot.toFixed(2)+'</p><hr style="border:none;border-top:1px solid #ddd;margin:16px 0"><div style="background:#DBEAFE;padding:12px;border-radius:8px;border:1px solid #93C5FD"><p style="font-size:13px;color:#1E40AF;margin:0">🕐 Prazo: até <strong>5 dias úteis</strong> para processamento.</p></div>'+rodapeEmail()+'</div></div>'
      });
    } catch(ee) {}
  }
  return jr({success: true, protocolo: d.protocolo, valor_total: vTot.toFixed(2)});
}

// ══════════════════════════════════════════════════════════════
// LANÇAMENTO POSTERIOR — EXCEÇÃO
// Cria o registro COMPLETO de uma vez (check-in + paradas + check-out).
// Usado quando o motorista não pôde registrar durante o percurso, então
// GPS e horário são INFORMADOS MANUALMENTE (sem garantia). O pedido é
// sinalizado na coluna de Validação para conferência do gestor.
// As imagens já foram enviadas ao Drive via "upload_imagem" → recebemos só LINKS.
// ══════════════════════════════════════════════════════════════
function doLancamentoPosterior(d) {
  var s = getSheet();
  if (!s) return jr({success: false, error: "Rode setupPlanilha."});
  if (!d.protocolo) return jr({success: false, error: "Protocolo ausente."});

  var ida = d.ida || [], volta = d.volta || [];

  // Monta o texto dos trechos no MESMO formato das paradas (para o dashboard)
  function buildTexto(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var t = arr[i];
      var gps = (t.lat || t.lat === 0) && t.lng !== null && t.lng !== undefined
        ? Number(t.lat).toFixed(5) + "," + Number(t.lng).toFixed(5) + " (aprox)"
        : "N/A";
      var line = (i+1) + ". " + (t.origem||"?") + " → " + (t.destino||"?") +
        " | " + (parseFloat(t.km)||0) + " km | " + fts(t.timestamp) + " | GPS: " + gps;
      if (t.maps_link) line += " | Maps: " + t.maps_link;
      out.push(line);
    }
    return out.join("\n");
  }
  var idaTxt = buildTexto(ida), voltaTxt = buildTexto(volta);

  var dIda = 0; for (var i = 0; i < ida.length; i++) dIda += parseFloat(ida[i].km) || 0;
  var dVolta = 0; for (var i = 0; i < volta.length; i++) dVolta += parseFloat(volta[i].km) || 0;
  var dTot = dIda + dVolta;

  var con = d.veiculo === "Moto" ? 49 : 10;
  var usouEstim = d.usar_estimativa === true;
  var pReal = usouEstim ? PRECO_BASE : (parseFloat(d.preco_real) || PRECO_BASE);
  var vEst = (dTot/con) * PRECO_BASE, vReal = (dTot/con) * pReal;

  var peds = d.pedagios || [], tPed = 0, pTxt = "", pLnk = [];
  for (var i = 0; i < peds.length; i++) {
    var v = parseFloat(peds[i].valor) || 0; tPed += v;
    var pl = peds[i].foto_link || "";
    var faseLbl = peds[i].fase ? "["+String(peds[i].fase).toUpperCase()+"] " : "";
    pLnk.push(pl);
    pTxt += (i+1)+". "+faseLbl+"R$ "+v.toFixed(2)+(pl?" | "+pl:"")+"\n";
  }
  var vTot = vReal + tPed;

  var tempo = "";
  if (d.checkin_timestamp && d.checkout_timestamp) {
    var dm = Math.round((new Date(d.checkout_timestamp) - new Date(d.checkin_timestamp)) / 60000);
    if (dm >= 0) tempo = dm >= 60 ? Math.floor(dm/60)+"h"+("0"+(dm%60)).slice(-2)+"min" : dm+" min";
  }

  // Validação — SEMPRE sinaliza que é lançamento posterior (exceção)
  var fl = ["🕓 LANÇAMENTO POSTERIOR (GPS/horário informados manualmente)"];
  if (d.sem_odometro === true) fl.push("SEM foto do odômetro");
  if (vTot > 500) fl.push("Valor>R$500");
  if (!usouEstim && pReal > PRECO_BASE*1.3) fl.push("Preço/L 30%+ acima");
  var val = fl.join(" | ");

  var sub = getOrCreate(DriveApp.getFolderById(DRIVE_FOLDER_ID), d.protocolo);

  var row = [
    d.protocolo, "COMPLETO",
    fts(d.checkin_timestamp), d.checkin_lat||"", d.checkin_lng||"", d.img_odometro_saida_link||"",
    fts(d.checkout_timestamp), d.checkout_lat||"", d.checkout_lng||"", d.img_odometro_chegada_link||"", tempo,
    d.nome, d.cpf, d.email, d.telefone, d.veiculo, d.placa,
    ida.length || 1, idaTxt, ida.length,
    volta.length || 0, voltaTxt, volta.length,
    dTot, pTxt.trim(), peds.length, tPed.toFixed(2), pLnk.join("\n"),
    usouEstim ? "Sim" : "Não", PRECO_BASE, pReal, d.img_cupom_link||"",
    vEst.toFixed(2), vReal.toFixed(2), vTot.toFixed(2), val,
    d.rg||"", d.orgao||"", ""   // AK=RG, AL=Órgão Emissor, AM=Recibo
  ];
  s.appendRow(row);
  var lastRow = s.getLastRow();

  // Status verde (COMPLETO) e Validação em âmbar para destacar a exceção
  s.getRange(lastRow, 2).setBackground("#ECFDF5").setFontColor("#065F46").setFontWeight("bold");
  s.getRange(lastRow, 36).setBackground("#FFFBEB").setFontColor("#92400E").setFontWeight("bold");

  // E-mail de confirmação (não bloqueia)
  if (d.email) {
    try {
      MailApp.sendEmail({to: d.email, subject: "Reembolso "+d.protocolo+" — R$ "+vTot.toFixed(2)+" (lançamento posterior)",
        htmlBody: '<div style="font-family:Arial;max-width:500px;margin:0 auto"><div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Reembolso Registrado</h2></div><div style="background:#F4F6FA;padding:20px;border-radius:0 0 10px 10px"><div style="background:#FFFBEB;border:1px solid #FCD34D;border-radius:8px;padding:12px;margin-bottom:14px"><p style="font-size:13px;color:#92400E;margin:0">🕓 Registrado como <strong>lançamento posterior</strong> (GPS e horário informados manualmente). Passará por conferência do gestor.</p></div><p>Protocolo: <strong>'+d.protocolo+'</strong></p><p>Distância: '+dTot+' km</p><p>Combustível (R$ '+pReal.toFixed(2)+'/L'+(usouEstim?' — estimativa':'')+'): R$ '+vReal.toFixed(2)+'</p>'+(tPed?'<p>Pedágios: R$ '+tPed.toFixed(2)+'</p>':'')+'<p style="font-size:20px;color:#1A3A5C;font-weight:700">Total: R$ '+vTot.toFixed(2)+'</p><hr style="border:none;border-top:1px solid #ddd;margin:16px 0"><div style="background:#DBEAFE;padding:12px;border-radius:8px;border:1px solid #93C5FD"><p style="font-size:13px;color:#1E40AF;margin:0">🕐 Prazo: até <strong>5 dias úteis</strong> para processamento.</p></div>'+rodapeEmail()+'</div></div>'
      });
    } catch(ee) {}
  }

  return jr({success: true, protocolo: d.protocolo, valor_total: vTot.toFixed(2)});
}

// ══════════════════════════════════════════════════════════════
// CORRIGIR — editor completo do pedido em revisão
// ══════════════════════════════════════════════════════════════

// Reconstrói o texto dos trechos preservando data/hora e GPS originais,
// trocando origem/destino/km e o print do Maps (se um novo link veio).
function montarTrechosCorr(arr, origLines) {
  var out = [];
  for (var i = 0; i < arr.length; i++) {
    var t = arr[i], orig = origLines[i] || "";
    var dh = "", gps = "N/A", origMaps = "";
    var mm = orig.match(/\|\s*([^|]+?)\s*\|\s*GPS:\s*([^|]+?)(?:\s*\|\s*Maps:\s*(.+))?$/);
    if (mm) { dh = mm[1].trim(); gps = mm[2].trim(); origMaps = mm[3] ? mm[3].trim() : ""; }
    var maps = t.maps_link || origMaps;
    var line = (i+1)+". "+(t.origem||"?")+" → "+(t.destino||"?")+" | "+(parseFloat(t.km)||0)+" km | "+dh+" | GPS: "+gps;
    if (maps) line += " | Maps: " + maps;
    out.push(line);
  }
  return out.join("\n");
}

function doCorrigir(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Não encontrado."});
  var row = info.row, rowData = info.data;
  if (String(rowData[1]).trim() !== "REVISÃO") return jr({success: false, error: "Não está em revisão."});

  var updated = rowData.slice();
  updated[1] = "CORRIGIDO";

  // ── Dados pessoais: sobrescreve apenas o que veio preenchido ──
  if (d.nome) updated[11] = d.nome;
  if (d.email) updated[13] = d.email;
  if (d.telefone) updated[14] = d.telefone;
  if (d.veiculo) updated[15] = d.veiculo;
  if (d.placa) updated[16] = d.placa;
  if (d.rg !== undefined) updated[36] = d.rg;
  if (d.orgao !== undefined) updated[37] = d.orgao;

  // ── Trechos: reconstrói preservando data/hora e GPS originais ──
  var origIda = String(rowData[18]||"").split("\n").filter(function(x){return x.trim();});
  var origVolta = String(rowData[21]||"").split("\n").filter(function(x){return x.trim();});
  var dist = 0;
  if (d.ida) { updated[18] = montarTrechosCorr(d.ida, origIda); updated[19] = d.ida.length; for (var i=0;i<d.ida.length;i++) dist += parseFloat(d.ida[i].km)||0; }
  else { dist += extrairKm(rowData[18]); }
  if (d.volta) { updated[21] = montarTrechosCorr(d.volta, origVolta); updated[22] = d.volta.length; for (var i=0;i<d.volta.length;i++) dist += parseFloat(d.volta[i].km)||0; }
  else { dist += extrairKm(rowData[21]); }
  updated[23] = dist;

  // ── Fotos: substitui só quando veio um link novo ──
  if (d.odo_saida_link) updated[5] = d.odo_saida_link;
  if (d.odo_chegada_link) updated[9] = d.odo_chegada_link;
  if (d.cupom_link) updated[31] = d.cupom_link;

  // ── Pedágios: substituição completa quando enviados ──
  var tP;
  if (d.pedagios) {
    var peds = d.pedagios, pTxt = "", pLnk = []; tP = 0;
    for (var i = 0; i < peds.length; i++) {
      var v = parseFloat(peds[i].valor)||0; tP += v;
      var pl = peds[i].foto_link || "";
      var faseLbl = peds[i].fase ? "["+String(peds[i].fase).toUpperCase()+"] " : "";
      pLnk.push(pl);
      pTxt += (i+1)+". "+faseLbl+"R$ "+v.toFixed(2)+(pl?" | "+pl:"")+"\n";
    }
    updated[24] = pTxt.trim(); updated[25] = peds.length; updated[26] = tP.toFixed(2); updated[27] = pLnk.join("\n");
  } else { tP = parseFloat(rowData[26]) || 0; }

  // ── Combustível e totais ──
  var usouEstim = d.usar_estimativa === true;
  var pR = usouEstim ? PRECO_BASE : (parseFloat(d.preco_real) || parseFloat(rowData[30]) || PRECO_BASE);
  if (d.usar_estimativa === true) updated[28] = "Sim"; else if (d.usar_estimativa === false) updated[28] = "Não";
  updated[30] = pR;
  var con = updated[15] === "Moto" ? 49 : 10;
  var vE = (dist/con)*PRECO_BASE, vR = (dist/con)*pR, vT = vR + tP;
  updated[32] = vE.toFixed(2); updated[33] = vR.toFixed(2); updated[34] = vT.toFixed(2);

  var descTxt = d.descricao ? String(d.descricao) : "Pedido corrigido pelo pesquisador";
  updated[35] = "🔄 " + descTxt;

  s.getRange(row, 1, 1, updated.length).setValues([updated]);
  s.getRange(row, 2).setBackground("#E0E7FF").setFontColor("#3730A3").setFontWeight("bold");

  // ── Notificar o gestor: a correção chegou e o pedido aguarda reanálise ──
  if (ADMIN_EMAIL) {
    try {
      MailApp.sendEmail({
        to: ADMIN_EMAIL,
        subject: "🔄 Correção recebida — " + d.protocolo + " (aguarda reanálise)",
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">'
          + '<div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">'
          + '<h2 style="margin:0;font-size:18px">Correção de Reembolso Recebida</h2></div>'
          + '<div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #E2E8F0;border-top:none">'
          + '<p style="font-size:14px;color:#333;margin:0 0 12px">O pesquisador <strong>'+(rowData[11]||"")+'</strong> enviou a correção solicitada. O pedido voltou para <strong>reanálise</strong> no painel.</p>'
          + '<table style="width:100%;font-size:13px;color:#555;border-collapse:collapse">'
          + '<tr><td style="padding:6px 0;font-weight:600">Protocolo</td><td style="padding:6px 0">'+d.protocolo+'</td></tr>'
          + '<tr><td style="padding:6px 0;font-weight:600">Novo total</td><td style="padding:6px 0;font-weight:700;color:#1A3A5C">R$ '+vT.toFixed(2)+'</td></tr>'
          + '<tr><td style="padding:6px 0;font-weight:600">O que foi corrigido</td><td style="padding:6px 0">'+descTxt+'</td></tr></table>'
          + '<div style="background:#EDE9FE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #C4B5FD">'
          + '<p style="font-size:13px;color:#5B21B6;margin:0">📋 Acesse o painel administrativo e reanalise o pedido (status <strong>CORRIGIDO</strong>).</p></div>'
          + '</div></div>'
      });
    } catch(e2) { Logger.log("Erro email correção: " + e2.message); }
  }

  return jr({success: true, protocolo: d.protocolo, valor_total: vT.toFixed(2)});
}

// Situação mais recente de um CPF — usada no app do motorista (Recuperar Viagem)
// para acompanhar o andamento do protocolo após o envio.
function buscarSituacao(cpf) {
  if (!cpf) return jr({success: false, error: "CPF vazio"});
  var allData = getSheet().getDataRange().getValues();
  for (var i = allData.length-1; i >= 1; i--) {
    if (String(allData[i][12]).trim() === cpf.trim()) {
      var d = allData[i];
      var val = String(d[35] || "");
      var obs = "";
      var m = val.match(/ADMIN:\s*(.+)$/);   // observação do gestor, se houver
      if (m) obs = m[1].trim();
      return jr({success: true, found: true, situacao: {
        protocolo: d[0], status: String(d[1]).trim(), nome: d[11],
        valor_total: d[34] || "", checkin_dh: d[2] || "", checkout_dh: d[6] || "",
        observacao: obs
      }});
    }
  }
  return jr({success: true, found: false});
}

// Extrai origem/destino/km/Maps de cada trecho (para o editor de correção)
function parseTrechosFull(txt) {
  if (!txt) return [];
  var lines = String(txt).split("\n"), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim(); if (!l) continue;
    var rota = l.match(/^\d+\.\s*(.+?)\s*→\s*(.+?)\s*\|/);
    var km = l.match(/\|\s*([\d.]+)\s*km/);
    var maps = l.match(/Maps:\s*(\S+)/);
    out.push({ origem: rota?rota[1].trim():"", destino: rota?rota[2].trim():"", km: km?km[1]:"0", maps: maps?maps[1]:"" });
  }
  return out;
}

// EDIÇÃO ADMINISTRATIVA — o gestor corrige o pedido direto pelo painel
// (ex.: incluir uma parada esquecida). Recalcula distância e valores.
// Mantém o status atual; apenas registra "Editado pelo admin" na validação.
function doEditarAdmin(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});
  var row = info.row, rowData = info.data;
  var updated = rowData.slice();

  // Dados pessoais (inclui RG / Órgão Emissor, usados no recibo)
  if (d.nome !== undefined) updated[11] = d.nome;
  if (d.email !== undefined) updated[13] = d.email;
  if (d.telefone !== undefined) updated[14] = d.telefone;
  if (d.veiculo !== undefined && d.veiculo) updated[15] = d.veiculo;
  if (d.placa !== undefined) updated[16] = d.placa;
  if (d.rg !== undefined) updated[36] = d.rg;
  if (d.orgao !== undefined) updated[37] = d.orgao;

  // Trechos: reconstrói preservando data/hora e GPS originais; novos trechos
  // (parada esquecida) entram sem GPS/Maps. Distância recalculada pelos km.
  var origIda = String(rowData[18]||"").split("\n").filter(function(x){return x.trim();});
  var origVolta = String(rowData[21]||"").split("\n").filter(function(x){return x.trim();});
  var dist = 0;
  if (d.ida) { updated[18] = montarTrechosCorr(d.ida, origIda); updated[19] = d.ida.length; for (var i=0;i<d.ida.length;i++) dist += parseFloat(d.ida[i].km)||0; }
  else { dist += extrairKm(rowData[18]); }
  if (d.volta) { updated[21] = montarTrechosCorr(d.volta, origVolta); updated[22] = d.volta.length; for (var i=0;i<d.volta.length;i++) dist += parseFloat(d.volta[i].km)||0; }
  else { dist += extrairKm(rowData[21]); }
  updated[23] = dist;

  var usouEstim = String(updated[28]).trim() === "Sim";
  if (d.preco_real) updated[30] = parseFloat(d.preco_real) || updated[30];
  var pR = usouEstim ? PRECO_BASE : (parseFloat(updated[30]) || PRECO_BASE);
  var con = updated[15] === "Moto" ? 49 : 10;
  var tP = parseFloat(rowData[26]) || 0;
  var vE = (dist/con)*PRECO_BASE, vR = (dist/con)*pR, vT = vR + tP;
  updated[32] = vE.toFixed(2); updated[33] = vR.toFixed(2); updated[34] = vT.toFixed(2);

  updated[35] = (updated[35] ? updated[35] + " | " : "") + "✏️ Editado pelo admin" + (d.motivo ? ": " + d.motivo : "");

  s.getRange(row, 1, 1, updated.length).setValues([updated]);
  return jr({success: true, protocolo: d.protocolo, valor_total: vT.toFixed(2)});
}

// GERAR RECIBO NOVAMENTE — reemite o recibo (novo número) e atualiza o link
function doGerarRecibo(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});
  var updated = info.data;
  var rec = gerarRecibo({
    protocolo: updated[0], nome: updated[11], cpf: updated[12],
    rg: updated[36], orgao: updated[37], valor: updated[34],
    descricao: "reembolso de deslocamento referente ao Protocolo " + updated[0] + " (" + (updated[23] || 0) + " km)",
    imagens: comprovantesDaLinha(updated)
  });
  if (!rec) return jr({success: false, error: "Recibo não configurado. Defina RECIBO_TEMPLATE_ID e RECIBOS_FOLDER_ID nas Propriedades do script."});
  s.getRange(info.row, 39).setValue(rec.link);  // coluna AM (Recibo)
  return jr({success: true, protocolo: d.protocolo, recibo_link: rec.link, numero: rec.numero});
}

// Carrega o pedido completo para o editor de correção (app do motorista)
function carregarPedido(p) {
  if (!p) return jr({success: false, error: "Protocolo vazio"});
  var allData = getSheet().getDataRange().getValues();
  for (var i = allData.length-1; i >= 1; i--) {
    if (String(allData[i][0]).trim() === p.trim()) {
      var d = allData[i];
      var val = String(d[35]||""), m = val.match(/ADMIN:\s*(.+)$/), obs = m ? m[1].trim() : "";
      return jr({success: true, found: true, pedido: {
        protocolo: d[0], status: String(d[1]).trim(),
        nome: d[11], cpf: d[12], email: d[13], telefone: d[14], veiculo: d[15], placa: d[16],
        rg: d[36] || "", orgao: d[37] || "",
        ida: parseTrechosFull(d[18]), volta: parseTrechosFull(d[21]),
        dist_total: d[23], pedagios_texto: d[24]||"",
        usou_estimativa: d[28], preco_base: d[29], preco_real: d[30],
        checkin_foto: d[5]||"", checkout_foto: d[9]||"", cupom: d[31]||"",
        observacao: obs
      }});
    }
  }
  return jr({success: true, found: false});
}

// ══════════════════════════════════════════════════════════════
// BUSCAS (somente leitura, sem lock)
// ══════════════════════════════════════════════════════════════
function buscarAberto(cpf) {
  if (!cpf) return jr({success: false, error: "CPF vazio"});
  var allData = getSheet().getDataRange().getValues();
  var r = findAbertoData(allData, cpf);
  if (!r) return jr({success: true, found: false});
  return jr({success: true, found: true, checkin: r});
}

function verificarStatus(p) {
  if (!p) return jr({success: false});
  var allData = getSheet().getDataRange().getValues();
  for (var i = allData.length-1; i >= 1; i--)
    if (String(allData[i][0]).trim() === p.trim())
      return jr({success: true, status: String(allData[i][1]).trim()});
  return jr({success: true, status: "NAO_ENCONTRADO"});
}

function buscarViagem(p) {
  if (!p) return jr({success: false});
  var allData = getSheet().getDataRange().getValues();
  for (var i = allData.length-1; i >= 1; i--) {
    if (String(allData[i][0]).trim() === p.trim()) {
      var d = allData[i];
      return jr({success: true, found: true, viagem: {
        protocolo:d[0], status:d[1], nome:d[11], cpf:d[12], veiculo:d[15], placa:d[16],
        checkin_timestamp:d[2], ida_plan:d[17]||1, ida_texto:d[18]||"", ida_count:d[19]||0,
        volta_plan:d[20]||0, volta_texto:d[21]||"", volta_count:d[22]||0
      }});
    }
  }
  return jr({success: true, found: false});
}

function buscarRevisao(cpf) {
  if (!cpf) return jr({success: false, error: "CPF vazio"});
  var allData = getSheet().getDataRange().getValues();
  for (var i = allData.length-1; i >= 1; i--)
    if (String(allData[i][12]).trim() === cpf.trim() && String(allData[i][1]).trim() === "REVISÃO")
      return jr({success: true, found: true, pedido: {protocolo:allData[i][0], nome:allData[i][11], distancia_total:allData[i][23], preco_real:allData[i][30]}});
  return jr({success: true, found: false});
}

// ══════════════════════════════════════════════════════════════
// ARQUIVAMENTO — rodar periodicamente para manter performance
// Move viagens COMPLETO/CORRIGIDO com mais de 30 dias para aba Histórico
// Configurar trigger: Editar > Triggers > arquivar > Timer > Semanal
// ══════════════════════════════════════════════════════════════
function arquivar() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var s = ss.getSheetByName(ABA);
  var hist = ss.getSheetByName(ABA_HISTORICO);
  if (!s || !hist) { Logger.log("Abas não encontradas."); return; }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log("Lock timeout no arquivamento."); return; }

  try {
    var data = s.getDataRange().getValues();
    var agora = new Date();
    var limite = new Date(agora.getTime() - 30*24*60*60*1000); // 30 dias atrás
    var linhasRemover = [];

    for (var i = data.length-1; i >= 1; i--) {
      var status = String(data[i][1]).trim();
      if (status === "COMPLETO" || status === "CORRIGIDO") {
        // Verificar se o checkout (col G, index 6) tem mais de 30 dias
        var coDate = data[i][6];
        if (coDate) {
          // Tentar parsear a data DD/MM/YYYY HH:MM:SS
          var parts = String(coDate).match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (parts) {
            var dt = new Date(parts[3], parseInt(parts[2])-1, parseInt(parts[1]));
            if (dt < limite) {
              hist.appendRow(data[i]);
              linhasRemover.push(i+1); // 1-indexed
            }
          }
        }
      }
    }

    // Remover de baixo pra cima pra não deslocar índices
    for (var i = 0; i < linhasRemover.length; i++) {
      s.deleteRow(linhasRemover[i]);
    }

    Logger.log("Arquivadas " + linhasRemover.length + " linhas.");
  } finally {
    lock.releaseLock();
  }
}

// ══════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════

// Cache da sheet para evitar abrir múltiplas vezes
function getSheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(ABA);
}

// Busca em dados já carregados (sem nova leitura)
function findAbertoData(allData, cpf) {
  for (var i = allData.length-1; i >= 1; i--) {
    if (String(allData[i][12]).trim() === cpf.trim() && String(allData[i][1]).trim() === "ABERTO") {
      var d = allData[i];
      return {
        protocolo:d[0], nome:d[11], cpf:d[12], email:d[13], telefone:d[14],
        veiculo:d[15], placa:d[16], checkin_timestamp:d[2], checkin_lat:d[3], checkin_lng:d[4],
        ida_plan:d[17]||1, ida_count:d[19]||0, ida_texto:d[18]||"",
        volta_plan:d[20]||0, volta_count:d[22]||0, volta_texto:d[21]||""
      };
    }
  }
  return null;
}

function findByProtoData(allData, proto) {
  for (var i = allData.length-1; i >= 1; i--) {
    if (String(allData[i][0]).trim() === proto.trim()) {
      return { row: i+1, data: allData[i] };
    }
  }
  return null;
}

// Anexa " | Maps: <link>" a cada linha do texto de trechos, na ordem das paradas
function appendMapsLinks(txt, links) {
  if (!txt) return txt || "";
  var lines = String(txt).split("\n"), out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (l && links && links[i] && String(l).indexOf("Maps:") === -1) l += " | Maps: " + links[i];
    out.push(l);
  }
  return out.join("\n");
}

function extrairKm(txt) {
  var t = 0; if (!txt) return 0;
  var ms = String(txt).match(/\|\s*([\d.]+)\s*km/g);
  if (ms) for (var i = 0; i < ms.length; i++) t += parseFloat(ms[i].replace(/[^\d.]/g,"")) || 0;
  return t;
}

function saveImg(f, b64, name) {
  if (!b64) return "";
  try {
    var m = b64.match(/^data:(.+);base64,(.+)$/);
    if (!m) return "";
    var ext = ({"image/jpeg":".jpg","image/png":".png","image/webp":".webp"}[m[1]] || ".jpg");
    var fl = f.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name+ext));
    fl.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return fl.getUrl();
  } catch(e) { return "ERRO"; }
}

function getOrCreate(p, n) {
  var f = p.getFoldersByName(n);
  return f.hasNext() ? f.next() : p.createFolder(n);
}

function fts(iso) {
  if (!iso) return "";
  var d = new Date(iso), p = function(n) { return ("0"+n).slice(-2); };
  return p(d.getDate())+"/"+p(d.getMonth()+1)+"/"+d.getFullYear()+" "+p(d.getHours())+":"+p(d.getMinutes())+":"+p(d.getSeconds());
}

function haversine(a,b,c,d) {
  var R=6371, dL=(c-a)*Math.PI/180, dN=(d-b)*Math.PI/180;
  var x = Math.sin(dL/2)*Math.sin(dL/2) + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dN/2)*Math.sin(dN/2);
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

// Rodapé de contato para os e-mails enviados ao pesquisador
function rodapeEmail() {
  return '<div style="margin-top:16px;padding:12px;background:#F4F6FA;border-radius:8px;border:1px solid #E2E8F0">'
    + '<p style="font-size:13px;color:#475569;margin:0">📱 Qualquer problema ou dúvida, fale comigo: <strong>' + CONTATO_BUSINESS + '</strong></p></div>';
}

// ══════════════════════════════════════════════════════════════
// GERAÇÃO DE RECIBO (substitui o Autocrat)
// Copia um Google Doc modelo, troca as tags <<...>>, exporta em PDF,
// salva na pasta de recibos e devolve {link, blob, numero}.
// ══════════════════════════════════════════════════════════════
function dataPorExtenso(dt) {
  var meses = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return dt.getDate() + " de " + meses[dt.getMonth()] + " de " + dt.getFullYear();
}

function valorPorExtenso(v) {
  v = Number(v) || 0;
  var reais = Math.floor(v + 1e-9);
  var centavos = Math.round((v - reais) * 100);
  var u = ["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  var d = ["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  var c = ["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function tres(n) {
    if (n === 0) return "";
    if (n === 100) return "cem";
    var s = [], cent = Math.floor(n/100), resto = n%100;
    if (cent > 0) s.push(c[cent]);
    if (resto > 0) {
      if (resto < 20) s.push(u[resto]);
      else { var dez = Math.floor(resto/10), uni = resto%10; s.push(d[dez] + (uni > 0 ? " e " + u[uni] : "")); }
    }
    return s.join(" e ");
  }
  function ext(n) {
    if (n === 0) return "zero";
    var partes = [];
    var milhoes = Math.floor(n/1000000), milhares = Math.floor((n%1000000)/1000), resto = n%1000;
    if (milhoes > 0) partes.push(milhoes === 1 ? "um milhão" : tres(milhoes) + " milhões");
    if (milhares > 0) partes.push(milhares === 1 ? "mil" : tres(milhares) + " mil");
    if (resto > 0) partes.push(tres(resto));
    return partes.join(" e ");
  }
  var txt = "";
  if (reais > 0) txt += ext(reais) + (reais === 1 ? " real" : " reais");
  if (centavos > 0) { if (reais > 0) txt += " e "; txt += ext(centavos) + (centavos === 1 ? " centavo" : " centavos"); }
  if (reais === 0 && centavos === 0) txt = "zero reais";
  return txt;
}

function proximoNumeroRecibo() {
  var n = parseInt(propriedades.getProperty('RECIBO_SEQ') || "0", 10) + 1;
  propriedades.setProperty('RECIBO_SEQ', String(n));
  return ("00" + n).slice(-3);
}

function blobFromDriveUrl(url) {
  try {
    var m = String(url).match(/[-\w]{25,}/);  // ID do arquivo no Drive
    if (!m) return null;
    return DriveApp.getFileById(m[0]).getBlob();
  } catch (e) { return null; }
}

// Substitui <<Link Imagem Autocrat>> pelos comprovantes da viagem (pág. 2)
function inserirComprovantes(body, imagens) {
  var found = body.findText("<<Link Imagem Autocrat>>");
  if (!found) return;
  var el = found.getElement();
  el.asText().setText("");                 // limpa o placeholder
  var par = el.getParent();
  var parent = par.getParent();
  var at;
  try { at = parent.getChildIndex(par) + 1; } catch (e) { return; }
  for (var i = 0; i < imagens.length; i++) {
    var blob = blobFromDriveUrl(imagens[i].url);
    if (!blob) continue;
    try {
      var cap = parent.insertParagraph(at++, imagens[i].label);
      cap.editAsText().setBold(true).setFontSize(9);
      var imgPar = parent.insertParagraph(at++, "");
      var inl = imgPar.appendInlineImage(blob);
      var w = inl.getWidth(), hh = inl.getHeight(), maxW = 380;
      if (w > maxW) { inl.setWidth(maxW); inl.setHeight(Math.round(hh * maxW / w)); }
    } catch (e) {}
  }
}

// dados: {protocolo,nome,cpf,rg,orgao,valor,descricao,imagens:[{label,url}]}
function gerarRecibo(dados) {
  if (!RECIBO_TEMPLATE_ID || !RECIBOS_FOLDER_ID) return null;  // não configurado → ignora
  try {
    var folder = DriveApp.getFolderById(RECIBOS_FOLDER_ID);
    var num = proximoNumeroRecibo();
    var nomeArq = "Recibo_" + num + "_" + dados.protocolo;
    var copia = DriveApp.getFileById(RECIBO_TEMPLATE_ID).makeCopy(nomeArq, folder);
    var doc = DocumentApp.openById(copia.getId());
    var body = doc.getBody();
    var valorFmt = "R$ " + (Number(dados.valor) || 0).toFixed(2).replace(".", ",");
    body.replaceText("<<Nome_Completo>>", dados.nome || "");
    body.replaceText("<<RG>>", dados.rg || "—");
    body.replaceText("<<Orgao_Emissor>>", dados.orgao || "");
    body.replaceText("<<CPF>>", dados.cpf || "");
    body.replaceText("<<Valor_Total>>", valorFmt);
    body.replaceText("<<Valor_Extenso>>", valorPorExtenso(dados.valor));
    body.replaceText("<<Descricao_Pagamento>>", dados.descricao || "reembolso de deslocamento");
    body.replaceText("<<Chave_Pix>>", dados.cpf || "");
    body.replaceText("<<Data_Atual>>", dataPorExtenso(new Date()));
    body.replaceText("<<Nome_Assinatura>>", dados.nome || "");
    body.replaceText("<<N_Recibo>>", num);
    inserirComprovantes(body, dados.imagens || []);
    doc.saveAndClose();
    var blob = copia.getAs("application/pdf").setName(nomeArq + ".pdf");
    var pdf = folder.createFile(blob);
    pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    copia.setTrashed(true);  // remove o Doc temporário; fica só o PDF
    return { link: pdf.getUrl(), blob: blob, numero: num };
  } catch (e) {
    Logger.log("Erro ao gerar recibo: " + e.message);
    return null;
  }
}

// Monta a lista de comprovantes (odômetro, Maps, cupom) a partir da linha
function comprovantesDaLinha(rowData) {
  var imgs = [];
  if (rowData[5]) imgs.push({label: "Odômetro — saída", url: rowData[5]});
  if (rowData[9]) imgs.push({label: "Odômetro — chegada", url: rowData[9]});
  var mIda = String(rowData[18] || "").match(/Maps:\s*(\S+)/g) || [];
  for (var i = 0; i < mIda.length; i++) imgs.push({label: "Maps — ida " + (i+1), url: mIda[i].replace(/Maps:\s*/, "")});
  var mVolta = String(rowData[21] || "").match(/Maps:\s*(\S+)/g) || [];
  for (var i = 0; i < mVolta.length; i++) imgs.push({label: "Maps — volta " + (i+1), url: mVolta[i].replace(/Maps:\s*/, "")});
  if (rowData[31]) imgs.push({label: "Cupom combustível", url: rowData[31]});
  return imgs;
}

function jr(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// ENDPOINTS DO DASHBOARD ADMIN
// Adicione este código ao FINAL do seu app.js existente
// Depois faça nova implantação do Apps Script
// ══════════════════════════════════════════════════════════════

// ── Adicione estas linhas dentro da função doGet, antes do return final ──
// if (a === "listar") return listarRegistros(e.parameter.status || "");
// if (a === "atualizar_status") return ... // (este vai no doPost)

// ══════════════════════════════════════════════════════════════
// LISTAR REGISTROS — retorna todos os dados para o dashboard
// Chamada: GET ?action=listar ou ?action=listar&status=COMPLETO
// ══════════════════════════════════════════════════════════════
function listarRegistros(statusFiltro) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var headers = allData[0];
  var registros = [];

  for (var i = 1; i < allData.length; i++) {
    var row = allData[i];
    var status = String(row[1]).trim();

    // Filtrar por status se fornecido
    if (statusFiltro && statusFiltro !== "" && status !== statusFiltro) continue;

    // Parsear GPS das paradas
    var paradasIda = parseParadasGPS(row[18]);
    var paradasVolta = parseParadasGPS(row[21]);

    registros.push({
      protocolo: row[0],
      status: status,
      checkin_dh: row[2],
      checkin_lat: row[3],
      checkin_lng: row[4],
      checkin_foto: row[5],
      checkout_dh: row[6],
      checkout_lat: row[7],
      checkout_lng: row[8],
      checkout_foto: row[9],
      tempo: row[10],
      nome: row[11],
      cpf: row[12],
      email: row[13],
      telefone: row[14],
      veiculo: row[15],
      placa: row[16],
      ida_plan: row[17],
      ida_texto: row[18],
      ida_qtd: row[19],
      ida_gps: paradasIda,
      volta_plan: row[20],
      volta_texto: row[21],
      volta_qtd: row[22],
      volta_gps: paradasVolta,
      dist_total: row[23],
      pedagios: row[24],
      qtd_pedagios: row[25],
      val_pedagios: row[26],
      usou_estimativa: row[28],
      preco_base: row[29],
      preco_real: row[30],
      cupom: row[31],
      val_estimado: row[32],
      val_real: row[33],
      val_total: row[34],
      validacao: row[35],
      rg: row[36] || "",
      orgao: row[37] || "",
      recibo_link: row[38] || ""
    });
  }

  return jr({success: true, total: registros.length, registros: registros});
}

// Extrai coordenadas GPS do texto das paradas
function parseParadasGPS(texto) {
  if (!texto) return [];
  var result = [];
  var lines = String(texto).split("\n");
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (!l) continue;
    var gpsMatch = l.match(/GPS:\s*([-\d.]+)\s*,\s*([-\d.]+)/);
    var kmMatch = l.match(/\|\s*([\d.]+)\s*km/);
    var routeMatch = l.match(/\d+\.\s*(.+?)\s*→\s*(.+?)\s*\|/);
    result.push({
      lat: gpsMatch ? parseFloat(gpsMatch[1]) : null,
      lng: gpsMatch ? parseFloat(gpsMatch[2]) : null,
      km: kmMatch ? parseFloat(kmMatch[1]) : 0,
      origem: routeMatch ? routeMatch[1].trim() : "",
      destino: routeMatch ? routeMatch[2].trim() : "",
      texto: l
    });
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// ATUALIZAR STATUS — para o admin aprovar/rejeitar/revisar
// ══════════════════════════════════════════════════════════════

function doAtualizarStatus(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Protocolo não encontrado."});

  var novosStatus = ["COMPLETO", "REVISÃO", "REJEITADO", "REPROVADO", "APROVADO", "PAGO"];
  if (novosStatus.indexOf(d.novo_status) === -1) {
    return jr({success: false, error: "Status inválido: " + d.novo_status});
  }

  var row = info.row;
  var updated = info.data.slice();
  updated[1] = d.novo_status;

  // Se há observação do admin, adicionar na validação
  if (d.observacao) {
    updated[35] = (updated[35] ? updated[35] + " | " : "") + "ADMIN: " + d.observacao;
  }

  // ── Recibo: gera ao marcar como PAGO (se ainda não houver um) ──
  var reciboBlob = null;
  if (d.novo_status === "PAGO" && !updated[38]) {
    var rec = gerarRecibo({
      protocolo: d.protocolo, nome: updated[11], cpf: updated[12],
      rg: updated[36], orgao: updated[37], valor: updated[34],
      descricao: "reembolso de deslocamento referente ao Protocolo " + d.protocolo + " (" + (updated[23] || 0) + " km)",
      imagens: comprovantesDaLinha(updated)
    });
    if (rec) { updated[38] = rec.link; reciboBlob = rec.blob; }
  }

  s.getRange(row, 1, 1, updated.length).setValues([updated]);

  // Cores por status
  var cores = {
    "COMPLETO": {bg: "#ECFDF5", fg: "#065F46"},
    "REVISÃO": {bg: "#FEF3C7", fg: "#92400E"},
    "REJEITADO": {bg: "#FEF2F2", fg: "#991B1B"},
    "REPROVADO": {bg: "#FEF2F2", fg: "#991B1B"},
    "APROVADO": {bg: "#DBEAFE", fg: "#1E40AF"},
    "PAGO": {bg: "#CCFBF1", fg: "#0F766E"}
  };
  var cor = cores[d.novo_status] || {bg: "#F4F6FA", fg: "#333"};
  s.getRange(row, 2).setBackground(cor.bg).setFontColor(cor.fg).setFontWeight("bold");

  // ── Notificar pesquisador por e-mail ──
  var email = updated[13];     // coluna N
  var nome = updated[11];      // coluna L
  var protocolo = d.protocolo;
  var valTotal = updated[34] || "0.00";

  if (email && d.novo_status !== "COMPLETO") {
    var assuntos = {
      "APROVADO": "✅ Reembolso aprovado — " + protocolo,
      "PAGO": "💰 Reembolso pago — " + protocolo,
      "REVISÃO": "🔄 Reembolso em revisão — " + protocolo,
      "REJEITADO": "❌ Reembolso reprovado — " + protocolo,
      "REPROVADO": "❌ Reembolso reprovado — " + protocolo
    };
    var ceMap = {
      "APROVADO": {bg:"#ECFDF5", border:"#10B981", color:"#065F46", icon:"✅", titulo:"Pedido Aprovado"},
      "PAGO": {bg:"#CCFBF1", border:"#14B8A6", color:"#0F766E", icon:"💰", titulo:"Reembolso Pago"},
      "REVISÃO": {bg:"#FFFBEB", border:"#F59E0B", color:"#92400E", icon:"🔄", titulo:"Pedido em Revisão"},
      "REJEITADO": {bg:"#FEF2F2", border:"#EF4444", color:"#991B1B", icon:"❌", titulo:"Pedido Reprovado"},
      "REPROVADO": {bg:"#FEF2F2", border:"#EF4444", color:"#991B1B", icon:"❌", titulo:"Pedido Reprovado"}
    };
    var ce = ceMap[d.novo_status];

    var obsHtml = d.observacao
      ? '<div style="background:#F4F6FA;padding:12px;border-radius:8px;margin-top:12px;border-left:3px solid '+ce.border+'">'
        + '<p style="font-size:12px;color:#64748B;margin:0 0 4px;font-weight:600">Observação do gestor:</p>'
        + '<p style="font-size:14px;color:#1E293B;margin:0">' + d.observacao + '</p></div>'
      : '';

    var instrucao = "";
    if (d.novo_status === "REVISÃO") {
      instrucao = '<div style="background:#DBEAFE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #93C5FD">'
        + '<p style="font-size:13px;color:#1E40AF;margin:0">📋 <strong>O que fazer:</strong> Acesse o app de registro, busque seu CPF na seção "Recuperar Viagem" e corrija os dados solicitados.</p></div>';
    } else if (d.novo_status === "REJEITADO" || d.novo_status === "REPROVADO") {
      instrucao = '<div style="background:#FEF2F2;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #FECACA">'
        + '<p style="font-size:13px;color:#991B1B;margin:0">Se discordar da decisão, entre em contato com o setor administrativo.</p></div>';
    } else if (d.novo_status === "APROVADO") {
      instrucao = '<div style="background:#DBEAFE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #93C5FD">'
        + '<p style="font-size:13px;color:#1E40AF;margin:0">🕐 O pagamento será processado em até <strong>5 dias úteis</strong>.</p></div>';
    } else if (d.novo_status === "PAGO") {
      instrucao = '<div style="background:#CCFBF1;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #99F6E4">'
        + '<p style="font-size:13px;color:#0F766E;margin:0">💰 O reembolso foi <strong>pago</strong>. Processo concluído — obrigado!</p>'
        + (reciboBlob ? '<p style="font-size:13px;color:#0F766E;margin:8px 0 0">📎 O <strong>recibo</strong> está em anexo neste e-mail.</p>' : '')
        + '</div>';
    }

    try {
      MailApp.sendEmail({
        to: email,
        subject: assuntos[d.novo_status] || "Atualização — " + protocolo,
        htmlBody: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">'
          + '<div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">'
          + '<h2 style="margin:0;font-size:18px">Atualização de Reembolso</h2></div>'
          + '<div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #E2E8F0;border-top:none">'
          + '<div style="background:'+ce.bg+';border:1px solid '+ce.border+';border-radius:8px;padding:16px;text-align:center;margin-bottom:16px">'
          + '<div style="font-size:28px;margin-bottom:6px">'+ce.icon+'</div>'
          + '<div style="font-size:18px;font-weight:700;color:'+ce.color+'">'+ce.titulo+'</div></div>'
          + '<p style="font-size:14px;color:#333;margin:0 0 8px">Olá <strong>'+nome+'</strong>,</p>'
          + '<p style="font-size:14px;color:#555;margin:0 0 12px">Seu pedido de reembolso foi atualizado.</p>'
          + '<table style="width:100%;font-size:13px;color:#555;border-collapse:collapse">'
          + '<tr><td style="padding:6px 0;font-weight:600">Protocolo</td><td style="padding:6px 0">'+protocolo+'</td></tr>'
          + '<tr><td style="padding:6px 0;font-weight:600">Valor</td><td style="padding:6px 0;font-weight:700;color:#1A3A5C">R$ '+valTotal+'</td></tr>'
          + '<tr><td style="padding:6px 0;font-weight:600">Novo Status</td><td style="padding:6px 0;font-weight:700;color:'+ce.color+'">'+d.novo_status+'</td></tr></table>'
          + obsHtml + instrucao + rodapeEmail()
          + '</div></div>',
        attachments: reciboBlob ? [reciboBlob] : []
      });
    } catch(emailErr) {
      Logger.log("Erro email status: " + emailErr.message);
    }
  }

  return jr({success: true, protocolo: d.protocolo, novo_status: d.novo_status});
}


// ══════════════════════════════════════════════════════════════
// INSTRUÇÕES DE INTEGRAÇÃO
// ══════════════════════════════════════════════════════════════
//
// 1. Cole todo este código no FINAL do seu app.js
//
// 2. Na função doGet, adicione ANTES do "return jr({status:'ok'...})":
//
//    if (a === "listar") return listarRegistros(e.parameter.status || "");
//
// 3. Na função doPost, adicione DENTRO do try:
//
//    if (d.action === "atualizar_status") return withLock(function(){ return doAtualizarStatus(d); });
//
// 4. Faça nova implantação do Apps Script
// ══════════════════════════════════════════════════════════════
