// ============================================================
// 🎱 Cloud Functions — Milionários da Leograf
//    Verifica resultado da Lotofácil e envia push via FCM
//    + Notificações de chat em tempo real
// ============================================================
'use strict';

const { onSchedule }       = require('firebase-functions/v2/scheduler');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger }           = require('firebase-functions');
const { initializeApp }    = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging }     = require('firebase-admin/messaging');

initializeApp();

const db          = getFirestore();
const APP_URL     = 'https://delima20k.github.io/milionarios-da-leograf0.1.2/';
const API_URL     = 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil';
const STATE_DOC   = 'app_state/lotofacil_last';

// ── Helpers ─────────────────────────────────────────────────

async function buscarResultado() {
    const res = await fetch(API_URL, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) throw new Error(`API retornou ${res.status}`);
    return res.json();
}

function formatarMoeda(valor) {
    return Number(valor).toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL', minimumFractionDigits: 2
    });
}

function montarNotificacao(resultado) {
    const numeros  = (resultado.listaDezenas || []).join(' · ');
    const concurso = resultado.numero;
    const data     = resultado.dataApuracao || '';
    const rateo    = resultado.listaRateioPremio || [];

    // Busca ganhadores por faixa de acertos
    const faixa15 = rateo.find(r => r.descricaoFaixa === '15 acertos');
    const faixa14 = rateo.find(r => r.descricaoFaixa === '14 acertos');
    const faixa13 = rateo.find(r => r.descricaoFaixa === '13 acertos');

    const win15 = Number(faixa15?.numeroDeGanhadores || 0);
    const win14 = Number(faixa14?.numeroDeGanhadores || 0);
    const win13 = Number(faixa13?.numeroDeGanhadores || 0);

    let titulo = `🎱 Lotofácil — Concurso ${concurso} (${data})`;
    let corpo  = `Números sorteados:\n${numeros}`;

    if (win15 > 0) {
        const premio = formatarMoeda(faixa15.valorPremio);
        titulo = `🏆 JACKPOT! Alguém acertou 15 pontos na Lotofácil!`;
        corpo  = `Concurso ${concurso} · ${data}\n${numeros}\n\n🥇 ${win15} ganhador(es) de 15 acertos — Prêmio: ${premio}\nParabéns — você agora é um milionário? 🤑`;
    } else if (win14 > 0) {
        const premio = formatarMoeda(faixa14.valorPremio);
        corpo += `\n\n🎉 ${win14} ganhador(es) acertaram 14 pontos — Prêmio: ${premio}\nVerifique seu jogo!`;
    } else if (win13 > 0) {
        const premio = formatarMoeda(faixa13.valorPremio);
        corpo += `\n\n✨ ${win13} ganhador(es) acertaram 13 pontos — Prêmio: ${premio}`;
    } else {
        corpo += `\n\nNenhum vencedor de 15 pontos neste concurso. Boa sorte na próxima!`;
    }

    return { titulo, corpo, concurso };
}

async function enviarParaTodos({ titulo, corpo }) {
    const snap = await db.collection('fcmTokens').get();
    if (snap.empty) { logger.info('Nenhum token FCM registrado.'); return; }

    const tokens = snap.docs.map(d => d.id);
    logger.info(`Enviando push para ${tokens.length} token(s)`);

    // FCM aceita até 500 tokens por lote
    const lotes = [];
    for (let i = 0; i < tokens.length; i += 500) {
        lotes.push(tokens.slice(i, i + 500));
    }

    for (const lote of lotes) {
        const res = await getMessaging().sendEachForMulticast({
            tokens: lote,
            notification: { title: titulo, body: corpo },
            webpush: {
                notification: {
                    title:    titulo,
                    body:     corpo,
                    icon:     APP_URL + 'icon-192.png',
                    badge:    APP_URL + 'icon-192.png',
                    tag:      'lotofacil-resultado',
                    renotify: true,
                    vibrate:  [300, 100, 300, 100, 600]
                },
                fcmOptions: { link: APP_URL }
            },
            android: {
                priority: 'high',
                notification: { channelId: 'lotofacil', sound: 'default' }
            },
            apns: {
                payload: { aps: { sound: 'default', badge: 1 } }
            }
        });

        // Remove tokens inválidos do Firestore
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
        logger.info(`Lote enviado: ${res.successCount} ok, ${res.failureCount} falhas`);
    }
}

// ── Função principal — 21:30 BRT ─────────────────────────────
exports.checkLotofacilResult = onSchedule(
    { schedule: '30 21 * * *', timeZone: 'America/Sao_Paulo', retryCount: 2 },
    async () => {
        await _verificarEEnviar();
    }
);

// ── Backup — 22:00 BRT (caso API demore) ────────────────────
exports.checkLotofacilResultBackup = onSchedule(
    { schedule: '0 22 * * *', timeZone: 'America/Sao_Paulo', retryCount: 1 },
    async () => {
        await _verificarEEnviar();
    }
);

async function _verificarEEnviar() {
    const resultado = await buscarResultado();
    const concurso  = resultado.numero;

    const stateDoc  = await db.doc(STATE_DOC).get();
    if (stateDoc.exists && stateDoc.data().concurso === concurso) {
        logger.info(`Concurso ${concurso} já notificado — pulando.`);
        return;
    }

    const notificacao = montarNotificacao(resultado);
    await enviarParaTodos(notificacao);
    await db.doc(STATE_DOC).set({
        concurso,
        titulo:      notificacao.titulo,
        corpo:       notificacao.corpo,
        notificadoEm: FieldValue.serverTimestamp()
    });
    logger.info(`✅ Notificação enviada — concurso ${concurso}`);
}

// ── Helpers de push para o chat ───────────────────────────────

async function _sendChatPush(tokens, title, body, chatType, senderId) {
    if (!tokens || tokens.length === 0) return;
    const lotes = [];
    for (let i = 0; i < tokens.length; i += 500) lotes.push(tokens.slice(i, i + 500));

    for (const lote of lotes) {
        const res = await getMessaging().sendEachForMulticast({
            tokens: lote,
            notification: { title, body },
            // data messages garantem wake-up mesmo no Android Doze Mode
            data: {
                chatType:  chatType,          // 'grupo' | 'privado'
                senderId:  senderId || '',
                link:      APP_URL
            },
            webpush: {
                headers: { Urgency: 'high' },
                notification: {
                    title, body,
                    icon:     APP_URL + 'icon-192.png',
                    badge:    APP_URL + 'icon-192.png',
                    tag:      'chat-' + chatType + (chatType === 'privado' ? '-' + (senderId || '') : ''),
                    renotify: true,
                    vibrate:  [200, 100, 200]
                },
                fcmOptions: { link: APP_URL }
            },
            android: {
                priority: 'high',
                ttl:      '60s',
                notification: { sound: 'default', channelId: 'chat-messages' }
            },
            apns: { payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } } }
        });

        // Remove tokens inválidos
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
        logger.info(`[Chat Push] ${chatType} → ${res.successCount} ok, ${res.failureCount} falhas`);
    }
}

// ── Notificação: mensagem no chat do grupo ───────────────────
exports.onGroupMessage = onDocumentCreated(
    { document: 'messages/{msgId}', region: 'us-central1' },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        const senderUid  = data.uid || '';
        const senderName = data.name || 'Alguém';
        const text       = data.type === 'audio' ? '🎤 Áudio' : (data.text || '');

        // Busca todos os tokens exceto o do remetente
        const snap   = await db.collection('fcmTokens').get();
        const tokens = snap.docs
            .filter(d => d.data().uid !== senderUid)
            .map(d => d.id);

        if (tokens.length === 0) return;
        await _sendChatPush(tokens, `💬 Grupo — ${senderName}`, text, 'grupo', senderUid);
        logger.info(`[Chat Grupo] Push enviado para ${tokens.length} token(s)`);
    }
);

// ── Notificação: mensagem privada ─────────────────────────────
exports.onPrivateMessage = onDocumentCreated(
    { document: 'privateChats/{chatId}/messages/{msgId}', region: 'us-central1' },
    async (event) => {
        const data = event.data?.data();
        if (!data) return;

        const receiverUid = data.receiverUid;
        if (!receiverUid) return;

        const senderName = data.name || 'Alguém';
        const text       = data.type === 'audio' ? '🎤 Áudio' : (data.text || '');

        // Busca os tokens do destinatário
        const snap   = await db.collection('fcmTokens').where('uid', '==', receiverUid).get();
        const tokens = snap.docs.map(d => d.id);

        if (tokens.length === 0) return;
        const senderUidPriv = data.uid || '';
        await _sendChatPush(tokens, `💬 ${senderName}`, text, 'privado', senderUidPriv);
        logger.info(`[Chat Privado] Push enviado para ${tokens.length} token(s) do uid ${receiverUid}`);
    }
);
