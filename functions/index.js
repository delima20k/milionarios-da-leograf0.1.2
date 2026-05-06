// ============================================================
// 🎱 Cloud Functions — Milionários da Leograf
//    Verifica resultado da Lotofácil e envia push via FCM
// ============================================================
'use strict';

const { onSchedule }  = require('firebase-functions/v2/scheduler');
const { logger }      = require('firebase-functions');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging }   = require('firebase-admin/messaging');

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
