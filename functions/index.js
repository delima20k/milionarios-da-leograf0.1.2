// ============================================================
// 🎱 Cloud Functions — Milionários da Leograf
//    Verifica resultado da Lotofácil e envia push via FCM
//    + Notificações de chat em tempo real
// ============================================================
'use strict';

const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest }         = require('firebase-functions/v2/https');
const { logger }           = require('firebase-functions');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging }     = require('firebase-admin/messaging');

initializeApp();

const db        = getFirestore();
const APP_URL   = 'https://delima20k.github.io/milionarios-da-leograf0.1.2/';
const API_URL   = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';
const STATE_DOC = 'app_state/lotofacil_last';

// ── 13 jogos do bolão (espelho fiel de script.js) ─────────────
// ATENÇÃO: manter sincronizado com a constante `jogos` em script.js
const JOGOS_BOLAO = [
    [ 1,  2,  3,  4,  5,  7, 11, 12, 14, 15, 17, 18, 21, 23, 25],
    [ 2,  4,  5,  6,  8,  9, 11, 12, 15, 17, 19, 20, 21, 22, 25],
    [ 1,  2,  4,  6,  9, 10, 11, 14, 15, 16, 17, 20, 22, 23, 25],
    [ 1,  4,  5,  7,  9, 10, 11, 12, 15, 17, 18, 20, 21, 22, 25],
    [ 1,  2,  4,  6,  8,  9, 11, 12, 15, 16, 17, 18, 20, 22, 23],
    [ 1,  2,  3,  5,  6,  9, 11, 12, 14, 18, 19, 20, 21, 23, 24],
    [ 1,  3,  4,  6,  8, 12, 13, 15, 16, 17, 19, 20, 21, 23, 24],
    [ 1,  2,  3,  4,  5,  6,  7,  9, 11, 13, 15, 17, 18, 19, 20],
    [ 1,  2,  3,  5,  7,  8,  9, 10, 11, 13, 15, 17, 18, 19, 21],
    [ 1,  2,  3,  4,  5,  6,  7,  9, 11, 12, 13, 16, 17, 20, 21],
    [ 1,  2,  3,  5,  6,  7, 10, 11, 13, 14, 17, 18, 20, 21, 22],
    [ 2,  3,  4,  6,  9, 10, 13, 14, 17, 19, 20, 21, 22, 23, 25],
    [ 2,  3,  4,  7,  9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 25]
];

// ── Helpers ──────────────────────────────────────────────────

async function buscarResultado() {
    const res = await fetch(API_URL, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`API retornou ${res.status}`);
    return res.json();
}

// Compara os 13 jogos do bolão contra as dezenas sorteadas.
// Retorna { maxPontos, jogosPremiados: [{numeroJogo, totalAcertos}] }
function calcularPontosBolao(listaDezenas) {
    const sorteadas = listaDezenas.map(n => parseInt(n, 10));
    let maxPontos = 0;
    const jogosPremiados = [];

    JOGOS_BOLAO.forEach((jogo, idx) => {
        const acertos = jogo.filter(n => sorteadas.includes(n)).length;
        if (acertos > maxPontos) maxPontos = acertos;
        if (acertos >= 11) jogosPremiados.push({ numeroJogo: idx + 1, totalAcertos: acertos });
    });

    return { maxPontos, jogosPremiados };
}

// Monta título e corpo da push com base nos pontos do BOLÃO.
function montarNotificacao(resultado) {
    const dezenas  = resultado.listaDezenas || [];
    const concurso = resultado.numero;
    const data     = resultado.dataApuracao || '';
    const numeros  = dezenas.join(' · ');

    const { maxPontos, jogosPremiados } = calcularPontosBolao(dezenas);

    let titulo, corpo;

    if (maxPontos >= 15) {
        titulo = '👑 VOCÊS ACERTARAM 15 PONTOS!';
        corpo  = `Concurso ${concurso} · ${data}\n${numeros}\n\nParabéns, Milionários! Máximo de pontos! 🎉`;
    } else if (maxPontos === 14) {
        titulo = '🏅 Parabéns, vocês acertaram 14 pontos!';
        corpo  = `Concurso ${concurso} · ${data}\n${numeros}\n\n${jogosPremiados.length} jogo(s) com 14 pontos. Verifique no app!`;
    } else if (maxPontos === 13) {
        titulo = '🎯 Parabéns, vocês acertaram 13 pontos!';
        corpo  = `Concurso ${concurso} · ${data}\n${numeros}\n\n${jogosPremiados.length} jogo(s) com 13 pontos. Verifique no app!`;
    } else if (maxPontos >= 11) {
        titulo = `🎱 Resultado da Lotofácil — Concurso ${concurso}`;
        corpo  = `${data} · ${numeros}\n\nVocês acertaram ${maxPontos} pontos neste concurso.`;
    } else {
        titulo = `🎱 Resultado da Lotofácil — Concurso ${concurso}`;
        corpo  = `${data} · ${numeros}\n\nAbra o app para verificar os jogos!`;
    }

    logger.info(`[Bolão] Concurso ${concurso}: maxPontos=${maxPontos}, premiados=${jogosPremiados.length}`);
    return { titulo, corpo, concurso, dezenas, maxPontos, jogosPremiados };
}

// Envia push de resultado da Lotofácil para todos os tokens registrados.
async function enviarParaTodos({ titulo, corpo, concurso, maxPontos }) {
    const snap = await db.collection('fcmTokens').get();
    if (snap.empty) { logger.info('Nenhum token FCM registrado.'); return; }

    const tokens = snap.docs.map(d => d.id);
    logger.info(`[Lotofácil] Enviando push para ${tokens.length} token(s) — concurso ${concurso}`);

    await _sendMulticast(tokens, {
        data: {
            chatType:  'lotofacil',
            concurso:  String(concurso),
            maxPontos: String(maxPontos),
            link:      APP_URL,
            title:     titulo,
            body:      corpo
        },
        webpush: {
            headers: { Urgency: 'high' },
            notification: {
                title:    titulo,
                body:     corpo,
                icon:     APP_URL + 'icon-192.png',
                badge:    APP_URL + 'icon-192.png',
                tag:      'lotofacil-resultado',
                renotify: true,
                vibrate:  [300, 100, 300, 100, 600],
                requireInteraction: false,
                // data é preservado no notificationclick do SW para roteamento
                data: { url: APP_URL, chatType: 'lotofacil', concurso: String(concurso) }
            },
            fcmOptions: { link: APP_URL }
        },
        android: {
            priority: 'high',
            notification: { title: titulo, body: corpo, channelId: 'lotofacil', sound: 'default', defaultVibrateTimings: true }
        },
        apns: { payload: { aps: { sound: 'default', badge: 1, alert: { title: titulo, body: corpo } } } }
    }, 'Lotofácil Push');
}

// ── Scheduler principal — 21h40 BRT ──────────────────────────
exports.checkLotofacilResult = onSchedule(
    { schedule: '40 21 * * *', timeZone: 'America/Sao_Paulo', retryCount: 2 },
    async () => { await _verificarEEnviar(); }
);

// ── [TEMPORÁRIO] Endpoint HTTP para testar notificação manualmente ───────────
// ⚠️  REMOVER APÓS OS TESTES!
exports.testarNotificacaoLotofacil = onRequest(
    { region: 'us-central1' },
    async (req, res) => {
        try {
            await _verificarEEnviarForcado();
            res.json({ ok: true, mensagem: 'Notificação enviada com sucesso!' });
        } catch (e) {
            logger.error('[Teste] Erro ao enviar notificação:', e);
            res.status(500).json({ ok: false, erro: e.message });
        }
    }
);

// ── Backup — 23h00 BRT (caso API demore) ─────────────────────
exports.checkLotofacilResultBackup = onSchedule(
    { schedule: '0 23 * * *', timeZone: 'America/Sao_Paulo', retryCount: 1 },
    async () => { await _verificarEEnviar(); }
);

// Versão forçada — ignora deduplicação, usada apenas pelo endpoint de teste.
async function _verificarEEnviarForcado() {
    const resultado   = await buscarResultado();
    const notificacao = montarNotificacao(resultado);
    await enviarParaTodos(notificacao);
    await db.doc(STATE_DOC).set({
        concurso:       notificacao.concurso,
        titulo:         notificacao.titulo,
        corpo:          notificacao.corpo,
        dezenas:        notificacao.dezenas,
        maxPontos:      notificacao.maxPontos,
        jogosPremiados: notificacao.jogosPremiados,
        notificadoEm:   FieldValue.serverTimestamp()
    });
    logger.info(`[Teste] Notificação enviada — concurso ${notificacao.concurso}`);
}

async function _verificarEEnviar() {
    const resultado = await buscarResultado();
    const concurso  = resultado.numero;

    // Deduplicação: ignora se este concurso já foi notificado
    const stateDoc = await db.doc(STATE_DOC).get();
    if (stateDoc.exists && stateDoc.data().concurso === concurso) {
        logger.info(`Concurso ${concurso} já notificado — pulando.`);
        return;
    }

    const notificacao = montarNotificacao(resultado);
    await enviarParaTodos(notificacao);

    // Persiste estado + dados do bolão para uso pelo front ao abrir pelo push
    await db.doc(STATE_DOC).set({
        concurso,
        titulo:         notificacao.titulo,
        corpo:          notificacao.corpo,
        dezenas:        notificacao.dezenas,
        maxPontos:      notificacao.maxPontos,
        jogosPremiados: notificacao.jogosPremiados,
        notificadoEm:   FieldValue.serverTimestamp()
    });
    logger.info(`✅ Notificação enviada — concurso ${concurso} (maxPontos=${notificacao.maxPontos})`);
}

// ── Helpers de push ──────────────────────────────────────────

// Loop de lotes + limpeza de tokens inválidos — reutilizado por todos os triggers de push.
async function _sendMulticast(tokens, message, logTag) {
    if (!tokens || tokens.length === 0) return;
    const lotes = [];
    for (let i = 0; i < tokens.length; i += 500) lotes.push(tokens.slice(i, i + 500));

    for (const lote of lotes) {
        const res   = await getMessaging().sendEachForMulticast({ tokens: lote, ...message });
        const batch = db.batch();
        res.responses.forEach((r, i) => {
            if (!r.success) {
                const code = r.error?.code || '';
                if (code.includes('registration-token-not-registered') ||
                    code.includes('invalid-registration-token')) {
                    batch.delete(db.collection('fcmTokens').doc(lote[i]));
                }
            }
        });
        await batch.commit();
        logger.info(`[${logTag}] → ${res.successCount} ok, ${res.failureCount} falhas`);
    }
}

// Constrói e envia um push de mensagem de chat (grupo ou privado).
async function _sendChatPush(tokens, title, body, chatType, senderId, senderName) {
    const tag = chatType === 'privado'
        ? 'chat-privado-' + (senderId || 'unknown')
        : 'chat-grupo';
    await _sendMulticast(tokens, {
        // data: campos extras para roteamento no foreground (onMessage no chat.js)
        data: { chatType, senderId: senderId || '', senderName: senderName || '', link: APP_URL, title, body },
        webpush: {
            headers: { Urgency: 'high' },
            // webpush.notification garante entrega no browser mesmo com app fechado.
            // O SW (onBackgroundMessage) só é acionado em mensagens data-only;
            // mas data-only não é confiável em todos os browsers Android.
            // Aqui usamos notification para máxima confiabilidade de entrega.
            notification: {
                title, body,
                icon:     APP_URL + 'icon-192.png',
                badge:    APP_URL + 'icon-192.png',
                tag,
                renotify: true,
                vibrate:  [200, 100, 200, 100, 400],
                requireInteraction: false,
                // data é preservado no notificationclick do SW para roteamento
                data: { url: APP_URL, chatType, senderId: senderId || '', senderName: senderName || '' }
            },
            fcmOptions: { link: APP_URL }
        },
        android: { priority: 'high', ttl: '60s', notification: { title, body, sound: 'default', channelId: 'chat-messages', defaultVibrateTimings: true } },
        apns:    { payload: { aps: { sound: 'default', badge: 1, contentAvailable: true, alert: { title, body } } } }
    }, `Chat Push ${chatType}`);
}

// ── Trigger: nova mensagem no grupo ─────────────────────────
// Envia push para todos os usuários exceto o remetente.
exports.onGroupMessage = onDocumentCreated(
    { document: 'messages/{msgId}', region: 'us-central1' },
    async (event) => {
        const data = event.data?.data();
        if (!data?.text && data?.type !== 'audio' && data?.type !== 'image') return;

        const senderUid  = data.uid  || '';
        const senderName = data.name || 'Alguém';
        const text       = data.type === 'audio' ? '🎤 Áudio' : data.type === 'image' ? '📷 Imagem' : (data.text || '');

        const snap   = await db.collection('fcmTokens').get();
        const tokens = snap.docs
            .filter(d => d.data().uid !== senderUid)
            .map(d => d.id);

        if (tokens.length === 0) return;
        await _sendChatPush(tokens, `💬 Grupo — ${senderName}`, text, 'grupo', senderUid, senderName);
        logger.info(`[Chat Grupo] Push enviado para ${tokens.length} token(s)`);
    }
);

// ── Trigger: nova mensagem privada ────────────────────────────
// chatId = uid1_uid2 (ordenados). Identifica destinatário pelo chatId.
exports.onPrivateMessage = onDocumentCreated(
    { document: 'privateChats/{chatId}/messages/{msgId}', region: 'us-central1' },
    async (event) => {
        const data = event.data?.data();
        if (!data?.text && data?.type !== 'audio' && data?.type !== 'image') return;

        const senderUid   = data.uid || '';
        // Usa receiverUid gravado no documento — mais confiável que split do chatId
        // (UIDs podem conter '_' em casos edge)
        const receiverUid = data.receiverUid || event.params.chatId.split('_').find(u => u !== senderUid);
        if (!receiverUid) return;

        const senderName = data.name || 'Alguém';
        const text       = data.type === 'audio' ? '🎤 Áudio' : data.type === 'image' ? '📷 Imagem' : (data.text || '');

        const snap   = await db.collection('fcmTokens').where('uid', '==', receiverUid).get();
        const tokens = snap.docs.map(d => d.id);

        if (tokens.length === 0) return;
        await _sendChatPush(tokens, `💬 ${senderName}`, text, 'privado', senderUid, senderName);
        logger.info(`[Chat Privado] Push enviado para ${tokens.length} token(s) do uid ${receiverUid}`);
    }
);

// ── Trigger: chamada recebida ────────────────────────────────
// Envia push somente no documento criado com status 'calling'.
exports.onCallCreated = onDocumentCreated(
    { document: 'calls/{callId}', region: 'us-central1' },
    async (event) => {
        const data = event.data?.data();
        if (!data || data.status !== 'calling') return;

        const calleeUid  = data.calleeId   || '';
        const callerName = data.callerName || 'Alguém';
        if (!calleeUid) return;

        const snap   = await db.collection('fcmTokens').where('uid', '==', calleeUid).get();
        const tokens = snap.docs.map(d => d.id);
        if (tokens.length === 0) return;

        await _sendMulticast(tokens, {
            notification: { title: `📞 ${callerName}`, body: 'Ligação recebida' },
            data: { chatType: 'chamada', senderId: data.callerId || '', senderName: callerName, link: APP_URL },
            webpush: {
                headers: { Urgency: 'high' },
                notification: {
                    title:    `📞 ${callerName}`,
                    body:     'Ligação recebida',
                    icon:     APP_URL + 'icon-192.png',
                    badge:    APP_URL + 'icon-192.png',
                    tag:      'chamada-recebida',
                    renotify: true,
                    vibrate:  [500, 200, 500, 200, 500]
                },
                fcmOptions: { link: APP_URL }
            },
            android: { priority: 'high', ttl: '30s', notification: { sound: 'default', channelId: 'chamadas' } },
            apns:    { payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } } }
        }, 'Chamada Push');
    }
);
