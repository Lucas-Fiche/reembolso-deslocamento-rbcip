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
    if(d.action === "enviar_confirmacao_registro") return enviarConfirmacao(d);
    if(d.action === "upload_imagem") return uploadImagem(d);
    if(d.action === "gerar_recibo") return gerarReciboAction(d);
    return _jr({success:false, error:"Ação desconhecida"});
  }catch(err){ return _jr({success:false, error:String(err && err.message || err)}); }
}

// ── E-mail de confirmação ao registrar (enviado ao próprio motorista) ──
function enviarConfirmacao(d){
  if(!d.jwt || !d.protocolo) return _jr({success:false, error:"Dados incompletos."});
  var perfil = _sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length) return _jr({success:false, error:"Não autorizado."});
  var arr = _sbGet("vw_reembolsos?protocolo=eq." + encodeURIComponent(d.protocolo) +
    "&select=nome,email,val_total,val_real,val_pedagios,dist_total,usou_estimativa,preco_base,preco_real", d.jwt);
  if(!arr || !arr.length) return _jr({success:false, error:"Protocolo não encontrado."});
  var r = arr[0];
  if(!r.email) return _jr({success:true, enviado:false, motivo:"sem e-mail"});
  var dTot=Number(r.dist_total||0), vReal=Number(r.val_real||0), vTot=Number(r.val_total||0), tPed=Number(r.val_pedagios||0);
  var usouEstim = r.usou_estimativa===true;
  var pReal = usouEstim ? Number(r.preco_base||0) : Number(r.preco_real||r.preco_base||0);
  var rodape='<div style="margin-top:16px;padding:12px;background:#F4F6FA;border-radius:8px;border:1px solid #E2E8F0"><p style="font-size:13px;color:#475569;margin:0">📱 Qualquer problema ou dúvida, fale comigo: <strong>'+CONTATO_BUSINESS+'</strong></p></div>';
  try{
    MailApp.sendEmail({ to:r.email, subject:"📝 Reembolso registrado — "+d.protocolo,
      htmlBody:'<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto"><div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Reembolso Registrado</h2></div><div style="background:#F4F6FA;padding:20px;border-radius:0 0 10px 10px"><p>Olá <strong>'+(r.nome||"")+'</strong>, sua solicitação foi registrada com sucesso.</p><p>Protocolo: <strong>'+d.protocolo+'</strong></p><p>Distância: '+dTot+' km</p><p>Combustível (R$ '+pReal.toFixed(2)+'/L'+(usouEstim?' — estimativa':'')+'): R$ '+vReal.toFixed(2)+'</p>'+(tPed?'<p>Pedágios: R$ '+tPed.toFixed(2)+'</p>':'')+'<p style="font-size:20px;color:#1A3A5C;font-weight:700">Total: R$ '+vTot.toFixed(2)+'</p><hr style="border:none;border-top:1px solid #ddd;margin:16px 0"><div style="background:#DBEAFE;padding:12px;border-radius:8px;border:1px solid #93C5FD"><p style="font-size:13px;color:#1E40AF;margin:0">🕐 Prazo: até <strong>5 dias úteis</strong> para processamento.</p></div>'+rodape+'</div></div>' });
  }catch(err){ return _jr({success:false, error:"Falha no e-mail: "+String(err && err.message || err)}); }
  return _jr({success:true, enviado:true, para:r.email});
}

// ── Upload de imagem ao Drive (para o formulário do motorista) ──
// Segurança: exige um token de usuário AUTENTICADO no Supabase (a RLS de
// 'perfis' só devolve linha para quem está logado). Salva numa pasta do Drive
// e devolve o link público de visualização (para o painel exibir a foto).
function uploadImagem(d){
  if(!d.jwt || !d.base64) return _jr({success:false, error:"Dados incompletos."});
  var perfil = _sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length) return _jr({success:false, error:"Não autorizado."});
  var folderId = _props().getProperty("DRIVE_FOLDER_ID");
  if(!folderId) return _jr({success:false, error:"DRIVE_FOLDER_ID não configurado no carteiro."});
  try{
    var b64 = String(d.base64).replace(/^data:[^;]+;base64,/, "");
    var bytes = Utilities.base64Decode(b64);
    var nome = (d.protocolo?d.protocolo+"_":"") + (d.name||"foto") + ".jpg";
    var blob = Utilities.newBlob(bytes, "image/jpeg", nome);
    var file = DriveApp.getFolderById(folderId).createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return _jr({success:true, link:file.getUrl()});
  }catch(err){
    return _jr({success:false, error:"Falha no upload: " + String(err && err.message || err)});
  }
}

function doGet(){ return _jr({status:"ok", carteiro:"rbcip", v:"1.1"}); }

// Rode UMA vez no editor (menu ▶ Executar) para autorizar Drive + Docs.
function autorizar(){
  var d = DocumentApp.create("rbcip_autorizacao_temp");
  DriveApp.getFileById(d.getId()).setTrashed(true);
  return "Drive e Docs autorizados.";
}

// ── Recibo em PDF (a partir de um Doc modelo com tags <<...>>) ──
function dataPorExtenso(dt){
  var m=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return dt.getDate()+" de "+m[dt.getMonth()]+" de "+dt.getFullYear();
}
function valorPorExtenso(v){
  v=Number(v)||0; var reais=Math.floor(v+1e-9), centavos=Math.round((v-reais)*100);
  var u=["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  var d=["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  var c=["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function tres(n){ if(n===0)return""; if(n===100)return"cem"; var s=[],cent=Math.floor(n/100),resto=n%100; if(cent>0)s.push(c[cent]); if(resto>0){ if(resto<20)s.push(u[resto]); else{var dez=Math.floor(resto/10),uni=resto%10; s.push(d[dez]+(uni>0?" e "+u[uni]:""));} } return s.join(" e "); }
  function ext(n){ if(n===0)return"zero"; var p=[],mi=Math.floor(n/1000000),mil=Math.floor((n%1000000)/1000),r=n%1000; if(mi>0)p.push(mi===1?"um milhão":tres(mi)+" milhões"); if(mil>0)p.push(mil===1?"mil":tres(mil)+" mil"); if(r>0)p.push(tres(r)); return p.join(" e "); }
  var txt=""; if(reais>0)txt+=ext(reais)+(reais===1?" real":" reais");
  if(centavos>0){ if(reais>0)txt+=" e "; txt+=ext(centavos)+(centavos===1?" centavo":" centavos"); }
  if(reais===0&&centavos===0)txt="zero reais"; return txt;
}
function proximoNumeroRecibo(){ var n=parseInt(_props().getProperty("RECIBO_SEQ")||"0",10)+1; _props().setProperty("RECIBO_SEQ",String(n)); return ("00"+n).slice(-3); }

function gerarReciboAction(d){
  if(!d.jwt || !d.protocolo) return _jr({success:false, error:"Dados incompletos."});
  var perfil=_sbGet("perfis?select=papel", d.jwt);
  if(!perfil || !perfil.length || perfil[0].papel!=="admin") return _jr({success:false, error:"Não autorizado (apenas admin)."});
  var tid=_props().getProperty("RECIBO_TEMPLATE_ID"), fid=_props().getProperty("RECIBOS_FOLDER_ID");
  if(!tid || !fid) return _jr({success:false, error:"Recibo não configurado (RECIBO_TEMPLATE_ID / RECIBOS_FOLDER_ID)."});
  var arr=_sbGet("vw_reembolsos?protocolo=eq."+encodeURIComponent(d.protocolo)+"&select=nome,cpf,rg,orgao,val_total,dist_total,checkin_foto,checkout_foto,cupom_foto", d.jwt);
  if(!arr || !arr.length) return _jr({success:false, error:"Protocolo não encontrado."});
  var r=arr[0];
  try{
    var folder=DriveApp.getFolderById(fid);
    var num=proximoNumeroRecibo();
    var nomeLimpo=String(r.nome||"Sem nome").replace(/[\\\/:*?"<>|]/g," ").replace(/\s+/g," ").trim();
    var nomeArq="Recibo "+num+" - "+nomeLimpo;
    var copia=DriveApp.getFileById(tid).makeCopy(nomeArq, folder);
    var doc=DocumentApp.openById(copia.getId()), body=doc.getBody();
    var valorFmt="R$ "+(Number(r.val_total)||0).toFixed(2).replace(".",",");
    var descricao="reembolso de deslocamento referente ao Protocolo "+d.protocolo+" ("+(r.dist_total||0)+" km)";
    body.replaceText("<<Nome_Completo>>", r.nome||"");
    body.replaceText("<<RG>>", r.rg||"—");
    body.replaceText("<<Orgao_Emissor>>", r.orgao||"");
    body.replaceText("<<CPF>>", r.cpf||"");
    body.replaceText("<<Valor_Total>>", valorFmt);
    body.replaceText("<<Valor_Extenso>>", valorPorExtenso(r.val_total));
    body.replaceText("<<Descricao_Pagamento>>", descricao);
    body.replaceText("<<Chave_Pix>>", r.cpf||"");
    body.replaceText("<<Data_Atual>>", dataPorExtenso(new Date()));
    body.replaceText("<<Nome_Assinatura>>", r.nome||"");
    body.replaceText("<<N_Recibo>>", num);
    var links=[r.checkin_foto,r.checkout_foto,r.cupom_foto].filter(function(x){return x;});
    body.replaceText("<<Link Imagem Autocrat>>", links.length?links.join("\n"):"—");
    doc.saveAndClose();
    var blob=copia.getAs("application/pdf").setName(nomeArq+".pdf");
    var pdf=folder.createFile(blob);
    pdf.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    copia.setTrashed(true);
    var emails=_props().getProperty("EMAILS_RECIBO") || "lucas@rbcip.org,financeiro@rbcip.org,luiz.rocha@rbcip.org";
    if(emails){ try{ MailApp.sendEmail({ to:emails, subject:"Recibo de reembolso Nº "+num+" — "+(r.nome||"")+" ("+d.protocolo+")",
      htmlBody:'<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto"><div style="background:#1A3A5C;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><h2 style="margin:0;font-size:18px">Recibo de Reembolso</h2></div><div style="background:#fff;padding:20px;border-radius:0 0 10px 10px;border:1px solid #E2E8F0;border-top:none"><table style="width:100%;font-size:13px;color:#555;border-collapse:collapse"><tr><td style="padding:6px 0;font-weight:600">Recibo Nº</td><td style="padding:6px 0">'+num+'/'+new Date().getFullYear()+'</td></tr><tr><td style="padding:6px 0;font-weight:600">Protocolo</td><td style="padding:6px 0">'+d.protocolo+'</td></tr><tr><td style="padding:6px 0;font-weight:600">Beneficiário</td><td style="padding:6px 0">'+(r.nome||"")+'</td></tr><tr><td style="padding:6px 0;font-weight:600">CPF</td><td style="padding:6px 0">'+(r.cpf||"")+'</td></tr><tr><td style="padding:6px 0;font-weight:600">Valor</td><td style="padding:6px 0;font-weight:700;color:#1A3A5C">'+valorFmt+'</td></tr></table><p style="font-size:13px;color:#475569;margin:14px 0 0">📎 Recibo em PDF em anexo. <a href="'+pdf.getUrl()+'">Abrir no Drive</a></p></div></div>',
      attachments:[blob] }); }catch(eMail){} }
    return _jr({success:true, link:pdf.getUrl(), numero:num});
  }catch(err){ return _jr({success:false, error:"Falha no recibo: "+String(err && err.message || err)}); }
}

// ── Upload de imagem ao Drive (para o formulário do motorista) ──

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
