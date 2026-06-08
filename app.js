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
  var h = ["Protocolo","Status","CI DH","CI Lat","CI Lng","CI Foto","CO DH","CO Lat","CO Lng","CO Foto","Tempo","Nome","CPF","E-mail","Telefone","Veículo","Placa","Ida Plan","Ida Trechos","Ida Qtd","Volta Plan","Volta Trechos","Volta Qtd","Dist Total (km)","Pedágios","Qtd Ped","Val Pedágios","Comprov Ped","Usou Estimativa?","Preço Base","Preço Real","Cupom Comb","Val Estimado","Val Real","Val Total","Validação"];
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
    if (d.action === "corrigir") return withLock(function(){ return doCorrigir(d); });
    if (d.action === "set_volta") return withLock(function(){ return doSetVolta(d); });
    if (d.action === "atualizar_status") return withLock(function(){ return doAtualizarStatus(d); });
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
    if (a === "listar") return listarRegistros(e.parameter.status || "");
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
    0, "", 0, "", "", "", PRECO_BASE, "", "", "", "", "", ""];
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
        htmlBody: '<div style="font-family:Arial;max-width:500px;margin:0 auto"><div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Reembolso Registrado</h2></div><div style="background:#F4F6FA;padding:20px;border-radius:0 0 10px 10px"><p>Protocolo: <strong>'+d.protocolo+'</strong></p><p>Distância: '+dTot+' km</p><p>Combustível (R$ '+pReal.toFixed(2)+'/L'+(usouEstim?' — estimativa':'')+'): R$ '+vReal.toFixed(2)+'</p>'+(tPed?'<p>Pedágios: R$ '+tPed.toFixed(2)+'</p>':'')+'<p style="font-size:20px;color:#1A3A5C;font-weight:700">Total: R$ '+vTot.toFixed(2)+'</p><hr style="border:none;border-top:1px solid #ddd;margin:16px 0"><div style="background:#DBEAFE;padding:12px;border-radius:8px;border:1px solid #93C5FD"><p style="font-size:13px;color:#1E40AF;margin:0">🕐 Prazo: até <strong>5 dias úteis</strong> para processamento.</p></div></div></div>'
      });
    } catch(ee) {}
  }
  return jr({success: true, protocolo: d.protocolo, valor_total: vTot.toFixed(2)});
}

// ══════════════════════════════════════════════════════════════
// CORRIGIR — batch escrita
// ══════════════════════════════════════════════════════════════
function doCorrigir(d) {
  var s = getSheet();
  var allData = s.getDataRange().getValues();
  var info = findByProtoData(allData, d.protocolo);
  if (!info) return jr({success: false, error: "Não encontrado."});
  var row = info.row, rowData = info.data;
  if (String(rowData[1]).trim() !== "REVISÃO") return jr({success: false, error: "Não está em revisão."});

  var descTxt = (d.tipo||"") + (d.parada_ref ? " — "+d.parada_ref : "") + ": " + (d.descricao||"");
  var dist = parseFloat(d.distancia_total) || parseFloat(rowData[23]) || 0;
  var pR = parseFloat(d.preco_real) || parseFloat(rowData[30]) || PRECO_BASE;
  var con = rowData[15] === "Moto" ? 49 : 10;
  var tP = parseFloat(rowData[26]) || 0;
  var vE = (dist/con)*PRECO_BASE, vR = (dist/con)*pR, vT = vR + tP;

  // Batch: atualizar campos específicos via cópia da linha
  var updated = rowData.slice();
  updated[1] = "CORRIGIDO";
  if (d.distancia_total) updated[23] = dist;
  updated[30] = pR;
  updated[32] = vE.toFixed(2);
  updated[33] = vR.toFixed(2);
  updated[34] = vT.toFixed(2);
  updated[35] = "🔄 " + descTxt;

  s.getRange(row, 1, 1, updated.length).setValues([updated]);
  s.getRange(row, 2).setBackground("#E0E7FF").setFontColor("#3730A3").setFontWeight("bold");
  return jr({success: true, protocolo: d.protocolo, valor_total: vT.toFixed(2)});
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
      validacao: row[35]
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

  var novosStatus = ["COMPLETO", "REVISÃO", "REJEITADO", "APROVADO"];
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

  s.getRange(row, 1, 1, updated.length).setValues([updated]);

  // Cores por status
  var cores = {
    "COMPLETO": {bg: "#ECFDF5", fg: "#065F46"},
    "REVISÃO": {bg: "#FEF3C7", fg: "#92400E"},
    "REJEITADO": {bg: "#FEF2F2", fg: "#991B1B"},
    "APROVADO": {bg: "#DBEAFE", fg: "#1E40AF"}
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
      "REVISÃO": "🔄 Reembolso em revisão — " + protocolo,
      "REJEITADO": "❌ Reembolso recusado — " + protocolo
    };
    var ceMap = {
      "APROVADO": {bg:"#ECFDF5", border:"#10B981", color:"#065F46", icon:"✅", titulo:"Pedido Aprovado"},
      "REVISÃO": {bg:"#FFFBEB", border:"#F59E0B", color:"#92400E", icon:"🔄", titulo:"Pedido em Revisão"},
      "REJEITADO": {bg:"#FEF2F2", border:"#EF4444", color:"#991B1B", icon:"❌", titulo:"Pedido Recusado"}
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
    } else if (d.novo_status === "REJEITADO") {
      instrucao = '<div style="background:#FEF2F2;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #FECACA">'
        + '<p style="font-size:13px;color:#991B1B;margin:0">Se discordar da decisão, entre em contato com o setor administrativo.</p></div>';
    } else if (d.novo_status === "APROVADO") {
      instrucao = '<div style="background:#DBEAFE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #93C5FD">'
        + '<p style="font-size:13px;color:#1E40AF;margin:0">🕐 O pagamento será processado em até <strong>5 dias úteis</strong>.</p></div>';
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
          + obsHtml + instrucao
          + '</div></div>'
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
