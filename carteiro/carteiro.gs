// ══════════════════════════════════════════════════════════════════════════
// RBCIP — CARTEIRO (Apps Script isolado, só envia e-mails)
// ══════════════════════════════════════════════════════════════════════════
// Ponte da fase híbrida: o painel novo (Supabase) grava o status e chama este
// carteiro para disparar o e-mail de aviso ao pesquisador — IDÊNTICO ao atual.
//
// Este script NÃO toca no sistema de produção. É um projeto Apps Script novo,
// separado, dedicado só a enviar e-mail.
//
// SEGURANÇA (por que ninguém consegue abusar):
//   1) Confere no Supabase que quem chamou é ADMIN (usando o token do próprio
//      usuário logado — perfis.papel = 'admin').
//   2) Busca nome/e-mail/valor DO PRÓPRIO Supabase pelo protocolo — o
//      destinatário nunca vem do navegador, então não dá para mandar e-mail
//      para endereço arbitrário.
//
// CONFIGURAÇÃO (Configurações do projeto → Propriedades do script):
//   SUPABASE_URL              = https://oharmunvmkrtlfpgsgww.supabase.co
//   SUPABASE_PUBLISHABLE_KEY  = sb_publishable_...
// (São as MESMAS chaves públicas do web/config.js. Nada secreto aqui.)
// ══════════════════════════════════════════════════════════════════════════

var CONTATO_BUSINESS = "+55 11 93623-3054"; // mesmo contato dos e-mails atuais

function _props(){ return PropertiesService.getScriptProperties(); }
function _jr(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e){
  try{
    var d = JSON.parse(e.postData.contents);
    if(d.action === "enviar_aviso_status") return enviarAvisoStatus(d);
    return _jr({success:false, error:"Ação desconhecida"});
  }catch(err){ return _jr({success:false, error:String(err && err.message || err)}); }
}

function doGet(){ return _jr({status:"ok", carteiro:"rbcip", v:"1.0"}); }

// Faz um GET no PostgREST do Supabase usando o token do usuário (respeita a RLS)
function _sbGet(path, jwt){
  var url = _props().getProperty("SUPABASE_URL");
  var key = _props().getProperty("SUPABASE_PUBLISHABLE_KEY");
  var resp = UrlFetchApp.fetch(url + "/rest/v1/" + path, {
    method:"get",
    headers:{ "apikey": key, "Authorization":"Bearer " + jwt },
    muteHttpExceptions:true
  });
  if(resp.getResponseCode() !== 200) return null;
  try{ return JSON.parse(resp.getContentText()); }catch(_){ return null; }
}

function enviarAvisoStatus(d){
  var jwt = d.jwt, protocolo = d.protocolo, novo = d.novo_status, obs = d.observacao || "";
  if(!jwt || !protocolo || !novo) return _jr({success:false, error:"Dados incompletos."});

  // COMPLETO não notifica (igual ao sistema atual)
  if(novo === "COMPLETO") return _jr({success:true, enviado:false, motivo:"COMPLETO não envia e-mail"});

  // 1) Confere que quem chamou é ADMIN (a RLS só devolve o próprio perfil)
  var perfil = _sbGet("perfis?select=papel", jwt);
  if(!perfil || !perfil.length || perfil[0].papel !== "admin")
    return _jr({success:false, error:"Não autorizado (apenas admin)."});

  // 2) Busca o reembolso NO SUPABASE (destinatário nunca vem do navegador)
  var arr = _sbGet("vw_reembolsos?protocolo=eq." + encodeURIComponent(protocolo) + "&select=nome,email,val_total", jwt);
  if(!arr || !arr.length) return _jr({success:false, error:"Protocolo não encontrado."});
  var r = arr[0];
  if(!r.email) return _jr({success:true, enviado:false, motivo:"Reembolso sem e-mail cadastrado"});

  var nome = r.nome || "";
  var valTotal = (r.val_total != null) ? Number(r.val_total).toFixed(2) : "0.00";

  // ── Monta o e-mail IDÊNTICO ao doAtualizarStatus do sistema atual ──
  var assuntos = {
    "APROVADO":  "✅ Reembolso aprovado — " + protocolo,
    "PAGO":      "💰 Reembolso pago — " + protocolo,
    "REVISÃO":   "🔄 Reembolso em revisão — " + protocolo,
    "REPROVADO": "❌ Reembolso reprovado — " + protocolo,
    "REJEITADO": "❌ Reembolso reprovado — " + protocolo
  };
  var ceMap = {
    "APROVADO":  {bg:"#ECFDF5", border:"#10B981", color:"#065F46", icon:"✅", titulo:"Pedido Aprovado"},
    "PAGO":      {bg:"#CCFBF1", border:"#14B8A6", color:"#0F766E", icon:"💰", titulo:"Reembolso Pago"},
    "REVISÃO":   {bg:"#FFFBEB", border:"#F59E0B", color:"#92400E", icon:"🔄", titulo:"Pedido em Revisão"},
    "REPROVADO": {bg:"#FEF2F2", border:"#EF4444", color:"#991B1B", icon:"❌", titulo:"Pedido Reprovado"},
    "REJEITADO": {bg:"#FEF2F2", border:"#EF4444", color:"#991B1B", icon:"❌", titulo:"Pedido Reprovado"}
  };
  var ce = ceMap[novo];
  if(!ce) return _jr({success:false, error:"Status sem modelo de e-mail: " + novo});

  var obsHtml = obs
    ? '<div style="background:#F4F6FA;padding:12px;border-radius:8px;margin-top:12px;border-left:3px solid '+ce.border+'">'
      + '<p style="font-size:12px;color:#64748B;margin:0 0 4px;font-weight:600">Observação do gestor:</p>'
      + '<p style="font-size:14px;color:#1E293B;margin:0">' + obs + '</p></div>'
    : '';

  var instrucao = "";
  if(novo === "REVISÃO"){
    instrucao = '<div style="background:#DBEAFE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #93C5FD">'
      + '<p style="font-size:13px;color:#1E40AF;margin:0">📋 <strong>O que fazer:</strong> Acesse o app de registro, busque seu CPF na seção "Recuperar Viagem" e corrija os dados solicitados.</p></div>';
  } else if(novo === "REPROVADO" || novo === "REJEITADO"){
    instrucao = '<div style="background:#FEF2F2;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #FECACA">'
      + '<p style="font-size:13px;color:#991B1B;margin:0">Se discordar da decisão, entre em contato com o setor administrativo.</p></div>';
  } else if(novo === "APROVADO"){
    instrucao = '<div style="background:#DBEAFE;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #93C5FD">'
      + '<p style="font-size:13px;color:#1E40AF;margin:0">🕐 O pagamento será processado em até <strong>5 dias úteis</strong>.</p></div>';
  } else if(novo === "PAGO"){
    instrucao = '<div style="background:#CCFBF1;padding:12px;border-radius:8px;margin-top:12px;border:1px solid #99F6E4">'
      + '<p style="font-size:13px;color:#0F766E;margin:0">💰 O reembolso foi <strong>pago</strong>. Processo concluído — obrigado!</p></div>';
  }

  var rodape = '<div style="margin-top:16px;padding:12px;background:#F4F6FA;border-radius:8px;border:1px solid #E2E8F0">'
    + '<p style="font-size:13px;color:#475569;margin:0">📱 Qualquer problema ou dúvida, fale comigo: <strong>' + CONTATO_BUSINESS + '</strong></p></div>';

  try{
    MailApp.sendEmail({
      to: r.email,
      subject: assuntos[novo] || ("Atualização — " + protocolo),
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
        + '<tr><td style="padding:6px 0;font-weight:600">Novo Status</td><td style="padding:6px 0;font-weight:700;color:'+ce.color+'">'+novo+'</td></tr></table>'
        + obsHtml + instrucao + rodape
        + '</div></div>'
    });
  }catch(mailErr){
    return _jr({success:false, error:"Falha ao enviar e-mail: " + String(mailErr && mailErr.message || mailErr)});
  }

  return _jr({success:true, enviado:true, para:r.email});
}
