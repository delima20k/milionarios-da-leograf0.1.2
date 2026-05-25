// ============================================
// 💬 CHAT — REALTIME ENGINE v2.0
// Optimistic UI · Offline Queue · Typing · Presence · Latency Logs
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
    signOut, updateProfile, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
    collection, addDoc, deleteDoc, query, orderBy, limit, where,
    serverTimestamp, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
    getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import {
    getMessaging, getToken, onMessage, deleteToken
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

// ──────────────────────────────────────────────────────────────
// 📞 GROUP CALL MANAGER — WebRTC full-mesh para chamadas em grupo
// ──────────────────────────────────────────────────────────────
// Firestore:
//   groupCalls/{callId}                             — metadado
//   groupCalls/{callId}/peers/{uid}                 — participantes
//   groupCalls/{callId}/signals/{lowerUid}_{higherUid} — offer/answer
//   groupCalls/{callId}/ice/{fromUid}_{toUid}/{id}  — ICE candidates
// Anti-glare: uid lexicograficamente menor é sempre o initiator (cria o offer)
class GroupCallManager {
    static #STUN = { iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
    ]};

    #db;
    #currentUser;
    #callDocId    = null;
    #localStream  = null;
    #peerConns    = new Map();  // peerUid → RTCPeerConnection
    #remoteAudios = new Map();  // peerUid → HTMLAudioElement
    #unsubs       = [];
    #isMuted      = false;
    #onParticipants;
    #onEnded;

    constructor(db, currentUser, { onParticipants, onEnded }) {
        this.#db            = db;
        this.#currentUser   = currentUser;
        this.#onParticipants = onParticipants;
        this.#onEnded        = onEnded;
    }

    get callDocId() { return this.#callDocId; }
    get isActive()  { return !!this.#localStream; }
    get isMuted()   { return this.#isMuted; }

    async startCall(callerName) {
        if (this.isActive) return;
        this.#localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const callRef = doc(collection(this.#db, 'groupCalls'));
        this.#callDocId = callRef.id;
        await setDoc(callRef, {
            callerId: this.#currentUser.uid, callerName,
            status: 'calling', createdAt: serverTimestamp()
        });
        await this.#joinRoom();
    }

    async joinCall(callId) {
        if (this.isActive) return;
        this.#callDocId   = callId;
        this.#localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await updateDoc(doc(this.#db, 'groupCalls', callId), { status: 'active' }).catch(() => {});
        await this.#joinRoom();
    }

    async leaveCall() {
        if (!this.#callDocId) return;
        await updateDoc(
            doc(this.#db, `groupCalls/${this.#callDocId}/peers/${this.#currentUser.uid}`),
            { status: 'left' }
        ).catch(() => {});
        this.#cleanup();
        this.#onEnded?.();
    }

    toggleMute() {
        if (!this.#localStream) return this.#isMuted;
        this.#isMuted = !this.#isMuted;
        this.#localStream.getAudioTracks().forEach(t => { t.enabled = !this.#isMuted; });
        return this.#isMuted;
    }

    async #joinRoom() {
        const uid  = this.#currentUser.uid;
        const name = this.#currentUser.displayName || 'Usuário';
        await setDoc(
            doc(this.#db, `groupCalls/${this.#callDocId}/peers/${uid}`),
            { name, status: 'joined', joinedAt: serverTimestamp() }
        );
        this.#listenForPeers();
        this.#listenForSignals();
    }

    #listenForPeers() {
        const col   = collection(this.#db, `groupCalls/${this.#callDocId}/peers`);
        const unsub = onSnapshot(col, snap => {
            const participants = snap.docs
                .filter(d => d.data().status === 'joined')
                .map(d => ({ uid: d.id, name: d.data().name }));
            this.#onParticipants?.(participants);

            snap.docChanges().forEach(c => {
                const peerUid = c.doc.id;
                if (peerUid === this.#currentUser.uid) return;
                const data = c.doc.data();
                if (c.type === 'removed' || data.status === 'left') {
                    this.#disconnectFromPeer(peerUid); return;
                }
                if (c.type === 'added' && data.status === 'joined') {
                    if (this.#peerConns.has(peerUid)) return;
                    // Anti-glare: uid menor é o initiator
                    if (this.#currentUser.uid < peerUid) this.#createOfferTo(peerUid);
                    // uid maior aguarda offer via #listenForSignals
                }
            });
        });
        this.#unsubs.push(unsub);
    }

    #listenForSignals() {
        const myUid = this.#currentUser.uid;
        const col   = collection(this.#db, `groupCalls/${this.#callDocId}/signals`);
        const unsub = onSnapshot(col, snap => {
            snap.docChanges().forEach(async c => {
                if (c.type !== 'added' && c.type !== 'modified') return;
                const [uid1, uid2] = c.doc.id.split('_');
                if (!uid1 || !uid2) return;
                const data = c.doc.data();
                // Sou responder (uid2) — recebo offer de uid1
                if (uid2 === myUid && data.offer && !data.answer && !this.#peerConns.has(uid1)) {
                    await this.#handleOffer(uid1, data.offer, c.doc.ref);
                }
                // Sou initiator (uid1) — recebo answer de uid2
                if (uid1 === myUid && data.answer) {
                    const pc = this.#peerConns.get(uid2);
                    if (pc && !pc.remoteDescription) {
                        await pc.setRemoteDescription(
                            new RTCSessionDescription(data.answer)
                        ).catch(e => console.warn('[GroupCall] setRemoteDesc:', e.message));
                    }
                }
            });
        });
        this.#unsubs.push(unsub);
    }

    async #createOfferTo(peerUid) {
        const pc     = this.#buildPC(peerUid);
        const myUid  = this.#currentUser.uid;
        const sigRef = doc(this.#db, `groupCalls/${this.#callDocId}/signals/${myUid}_${peerUid}`);
        this.#listenForIce(peerUid);
        pc.onicecandidate = async e => {
            if (e.candidate) {
                await addDoc(
                    collection(this.#db, `groupCalls/${this.#callDocId}/ice/${myUid}_${peerUid}`),
                    e.candidate.toJSON()
                ).catch(() => {});
            }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await setDoc(sigRef, { offer: { type: offer.type, sdp: offer.sdp } });
    }

    async #handleOffer(fromUid, offer, sigRef) {
        const pc    = this.#buildPC(fromUid);
        const myUid = this.#currentUser.uid;
        this.#listenForIce(fromUid);
        pc.onicecandidate = async e => {
            if (e.candidate) {
                await addDoc(
                    collection(this.#db, `groupCalls/${this.#callDocId}/ice/${myUid}_${fromUid}`),
                    e.candidate.toJSON()
                ).catch(() => {});
            }
        };
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await updateDoc(sigRef, { answer: { type: answer.type, sdp: answer.sdp } });
    }

    #listenForIce(fromUid) {
        const myUid = this.#currentUser.uid;
        const col   = collection(this.#db, `groupCalls/${this.#callDocId}/ice/${fromUid}_${myUid}`);
        const unsub = onSnapshot(col, snap => {
            snap.docChanges().forEach(async c => {
                if (c.type !== 'added') return;
                const pc = this.#peerConns.get(fromUid);
                await pc?.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(() => {});
            });
        });
        this.#unsubs.push(unsub);
    }

    #buildPC(peerUid) {
        if (this.#peerConns.has(peerUid)) return this.#peerConns.get(peerUid);
        const pc = new RTCPeerConnection(GroupCallManager.#STUN);
        this.#peerConns.set(peerUid, pc);
        this.#localStream.getTracks().forEach(t => pc.addTrack(t, this.#localStream));
        pc.ontrack = e => {
            let audio = this.#remoteAudios.get(peerUid);
            if (!audio) { audio = new Audio(); audio.autoplay = true; this.#remoteAudios.set(peerUid, audio); }
            if (e.streams?.[0]) { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); }
        };
        pc.oniceconnectionstatechange = () => {
            if (['disconnected', 'failed', 'closed'].includes(pc.iceConnectionState)) {
                this.#disconnectFromPeer(peerUid);
            }
        };
        return pc;
    }

    #disconnectFromPeer(uid) {
        const pc = this.#peerConns.get(uid);
        if (pc) { pc.close(); this.#peerConns.delete(uid); }
        const audio = this.#remoteAudios.get(uid);
        if (audio) { audio.srcObject = null; this.#remoteAudios.delete(uid); }
    }

    #cleanup() {
        this.#unsubs.forEach(u => u()); this.#unsubs = [];
        this.#peerConns.forEach(pc => pc.close()); this.#peerConns.clear();
        this.#remoteAudios.forEach(a => { a.srcObject = null; }); this.#remoteAudios.clear();
        this.#localStream?.getTracks().forEach(t => t.stop());
        this.#localStream = null;
        this.#callDocId   = null;
        this.#isMuted     = false;
    }
}

// ──────────────────────────────────────────────────────────────
// 🔐 E2E MANAGER — Criptografia de ponta a ponta (Web Crypto API)
// ──────────────────────────────────────────────────────────────
// Privado (1:1): ECDH P-256 → AES-256-GCM derivado por par de usuários
// Grupo:         AES-256-GCM com chave distribuída via Firestore
//                (chave cifrada individualmente com ECDH de cada membro)
class E2EManager {
    static #IDB_DB    = 'milionarios-e2e';
    static #IDB_STORE = 'keys';

    #privateKey;            // CryptoKey ECDH
    #publicKey;             // CryptoKey ECDH
    #publicKeyB64 = null;
    #derivedKeys  = new Map(); // peerPubB64 → CryptoKey AES-256-GCM
    #groupKey     = null;      // CryptoKey AES-256-GCM

    constructor(privateKey, publicKey) {
        this.#privateKey = privateKey;
        this.#publicKey  = publicKey;
    }

    static async load(uid) {
        const idb    = await E2EManager.#openIDB();
        const stored = await E2EManager.#idbGet(idb, uid);
        if (stored) {
            const priv = await crypto.subtle.importKey('pkcs8', stored.priv, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
            const pub  = await crypto.subtle.importKey('spki',  stored.pub,  { name: 'ECDH', namedCurve: 'P-256' }, true,  []);
            const mgr  = new E2EManager(priv, pub);
            if (stored.groupKey) {
                mgr.#groupKey = await crypto.subtle.importKey('raw', stored.groupKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            }
            return mgr;
        }
        const pair    = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
        const privBuf = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
        const pubBuf  = await crypto.subtle.exportKey('spki',  pair.publicKey);
        await E2EManager.#idbSet(idb, uid, { priv: privBuf, pub: pubBuf, groupKey: null });
        return new E2EManager(pair.privateKey, pair.publicKey);
    }

    get hasGroupKey() { return this.#groupKey !== null; }

    async exportPublicKey() {
        if (!this.#publicKeyB64) {
            const buf = await crypto.subtle.exportKey('spki', this.#publicKey);
            this.#publicKeyB64 = E2EManager.#bufToB64(buf);
        }
        return this.#publicKeyB64;
    }

    async generateGroupKey(uid) {
        this.#groupKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        await this.#persistGroupKey(uid);
    }

    async loadGroupKeyFrom(enc, fromPubB64, uid) {
        const sharedKey = await this.#deriveSharedKey(fromPubB64);
        const rawBuf    = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: E2EManager.#b64ToBuf(enc.iv) }, sharedKey, E2EManager.#b64ToBuf(enc.ct)
        );
        this.#groupKey = await crypto.subtle.importKey('raw', rawBuf, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        await this.#persistGroupKey(uid);
    }

    async encryptGroupKeyFor(theirPubB64) {
        const sharedKey = await this.#deriveSharedKey(theirPubB64);
        const raw       = await crypto.subtle.exportKey('raw', this.#groupKey);
        const iv        = crypto.getRandomValues(new Uint8Array(12));
        const ct        = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, raw);
        return { iv: E2EManager.#bufToB64(iv), ct: E2EManager.#bufToB64(ct) };
    }

    async encryptForPeer(plaintext, peerPubB64)  { return this.#gcmEncrypt(plaintext, await this.#deriveSharedKey(peerPubB64)); }
    async decryptFromPeer(enc, peerPubB64)        { return this.#gcmDecrypt(enc,       await this.#deriveSharedKey(peerPubB64)); }
    async encryptWithGroupKey(plaintext)           { return this.#gcmEncrypt(plaintext, this.#groupKey); }
    async decryptWithGroupKey(enc)                 { return this.#gcmDecrypt(enc,       this.#groupKey); }

    async #deriveSharedKey(peerPubB64) {
        if (this.#derivedKeys.has(peerPubB64)) return this.#derivedKeys.get(peerPubB64);
        const peerPub = await crypto.subtle.importKey('spki', E2EManager.#b64ToBuf(peerPubB64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const key     = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: peerPub }, this.#privateKey,
            { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
        );
        this.#derivedKeys.set(peerPubB64, key);
        return key;
    }

    async #gcmEncrypt(plaintext, key) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
        return { iv: E2EManager.#bufToB64(iv), ct: E2EManager.#bufToB64(ct) };
    }

    async #gcmDecrypt(enc, key) {
        const pt = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: E2EManager.#b64ToBuf(enc.iv) }, key, E2EManager.#b64ToBuf(enc.ct)
        );
        return new TextDecoder().decode(pt);
    }

    async #persistGroupKey(uid) {
        const idb = await E2EManager.#openIDB();
        const rec = (await E2EManager.#idbGet(idb, uid)) || {};
        const raw = await crypto.subtle.exportKey('raw', this.#groupKey);
        await E2EManager.#idbSet(idb, uid, { ...rec, groupKey: raw });
    }

    static #openIDB() {
        return new Promise((res, rej) => {
            const req = indexedDB.open(E2EManager.#IDB_DB, 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore(E2EManager.#IDB_STORE);
            req.onsuccess = e => res(e.target.result);
            req.onerror   = e => rej(e.target.error);
        });
    }

    static #idbGet(db, key) {
        return new Promise((res, rej) => {
            const tx  = db.transaction(E2EManager.#IDB_STORE, 'readonly');
            const req = tx.objectStore(E2EManager.#IDB_STORE).get(key);
            req.onsuccess = e => res(e.target.result ?? null);
            req.onerror   = e => rej(e.target.error);
        });
    }

    static #idbSet(db, key, val) {
        return new Promise((res, rej) => {
            const tx  = db.transaction(E2EManager.#IDB_STORE, 'readwrite');
            const req = tx.objectStore(E2EManager.#IDB_STORE).put(val, key);
            req.onsuccess = () => res();
            req.onerror   = e => rej(e.target.error);
        });
    }

    static #bufToB64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)));
    }

    static #b64ToBuf(b64) {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return buf.buffer;
    }
}

// ──────────────────────────────────────────────────────────────
// 📡 P2P CHANNEL — Entrega direta via WebRTC DataChannel (chat 1:1)
// ──────────────────────────────────────────────────────────────
// Firestore (sinalização):
//   p2pSignals/{chatId}                — { offer?, answer? }
//   p2pSignals/{chatId}/ice/{uid}/{id} — ICE candidates
// Anti-glare: uid lexicograficamente menor cria o offer
class P2PChannel {
    static #STUN    = { iceServers: [
        { urls: 'stun:stun.l.google.com:19302'  },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
    ]};
    static #TIMEOUT       = 6000;  // ms antes de desistir da conexão P2P
    static #HEARTBEAT_MS  = 25_000;
    static #MAX_RECONNECT = 3;

    #db;
    #myUid;
    #peerUid;
    #chatId;
    #pc      = null;
    #channel = null;
    #unsubs  = [];
    #onMessage;
    #onStateChange;
    #onReconnecting;

    // heartbeat
    #heartbeatTimer  = null;
    #pongMissed      = 0;
    // reconnect
    #reconnectCount  = 0;
    #reconnectTimer  = null;
    #destroyed       = false;

    constructor(db, myUid, peerUid, chatId, { onMessage, onStateChange, onReconnecting } = {}) {
        this.#db             = db;
        this.#myUid          = myUid;
        this.#peerUid        = peerUid;
        this.#chatId         = chatId;
        this.#onMessage      = onMessage      || (() => {});
        this.#onStateChange  = onStateChange  || (() => {});
        this.#onReconnecting = onReconnecting || (() => {});
    }

    get isOpen() { return this.#channel?.readyState === 'open'; }

    async connect() {
        this.#_closeInternals();
        this.#pc     = new RTCPeerConnection(P2PChannel.#STUN);
        const sigRef = doc(this.#db, 'p2pSignals', this.#chatId);
        const isInit = this.#myUid < this.#peerUid; // anti-glare

        // ICE candidates numa coleção plana de 3 segmentos (Firestore exige ímpar).
        // O campo fromUid permite filtrar candidatos do peer no listener.
        this.#pc.onicecandidate = async e => {
            if (!e.candidate) return;
            await addDoc(collection(this.#db, 'p2pSignals', this.#chatId, 'ice'),
                { ...e.candidate.toJSON(), fromUid: this.#myUid });
        };
        this.#pc.onconnectionstatechange = () => {
            const state = this.#pc.connectionState;
            this.#onStateChange(state);
            if (['failed', 'disconnected'].includes(state)) this.#scheduleReconnect();
            if (state === 'closed') this.#_closeInternals();
        };

        if (isInit) {
            this.#channel = this.#pc.createDataChannel('chat', { ordered: true });
            this.#setupChannel();
            const offer = await this.#pc.createOffer();
            await this.#pc.setLocalDescription(offer);
            await setDoc(sigRef, { offer: { type: offer.type, sdp: offer.sdp } }, { merge: true });
            const unsubSig = onSnapshot(sigRef, async snap => {
                const data = snap.data();
                if (data?.answer && !this.#pc.currentRemoteDescription) {
                    await this.#pc.setRemoteDescription(data.answer).catch(() => {});
                }
            });
            this.#unsubs.push(unsubSig);
        } else {
            this.#pc.ondatachannel = e => { this.#channel = e.channel; this.#setupChannel(); };
            const unsubSig = onSnapshot(sigRef, async snap => {
                const data = snap.data();
                if (data?.offer && !this.#pc.currentRemoteDescription) {
                    await this.#pc.setRemoteDescription(data.offer).catch(() => {});
                    const answer = await this.#pc.createAnswer();
                    await this.#pc.setLocalDescription(answer);
                    await setDoc(sigRef, { answer: { type: answer.type, sdp: answer.sdp } }, { merge: true });
                }
            });
            this.#unsubs.push(unsubSig);
        }

        const iceRef   = query(
            collection(this.#db, 'p2pSignals', this.#chatId, 'ice'),
            where('fromUid', '==', this.#peerUid)
        );
        const unsubIce = onSnapshot(iceRef, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') {
                    const { fromUid: _f, ...candidate } = c.doc.data();
                    this.#pc.addIceCandidate(candidate).catch(() => {});
                }
            });
        });
        this.#unsubs.push(unsubIce);

        setTimeout(() => { if (!this.isOpen) this.#_closeInternals(); }, P2PChannel.#TIMEOUT);
    }

    send(data) {
        if (!this.isOpen) return false;
        this.#channel.send(data);
        return true;
    }

    /** Destrói permanentemente o canal (não tenta reconectar). */
    close() {
        this.#destroyed = true;
        clearTimeout(this.#reconnectTimer);
        this.#_closeInternals();
    }

    // Fecha conexão interna sem marcar como destroyed (permite reconnect)
    #_closeInternals() {
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
        this.#pongMissed     = 0;
        this.#unsubs.forEach(u => u());
        this.#unsubs = [];
        this.#channel?.close();
        this.#pc?.close();
        this.#channel = null;
        this.#pc      = null;
    }

    #scheduleReconnect() {
        if (this.#destroyed) return;
        if (this.#reconnectCount >= P2PChannel.#MAX_RECONNECT) {
            this.#destroyed = true; // fallback permanente para Firestore
            return;
        }
        const delay = 2 ** (this.#reconnectCount + 1) * 1000; // 2s, 4s, 8s
        this.#reconnectCount++;
        this.#onReconnecting(this.#reconnectCount);
        clearTimeout(this.#reconnectTimer);
        this.#reconnectTimer = setTimeout(() => {
            if (!this.#destroyed) this.connect().catch(() => {});
        }, delay);
    }

    #setupChannel() {
        this.#channel.onopen = () => {
            this.#reconnectCount = 0; // reset contador ao reconectar com sucesso
            this.#onStateChange('open');
            this.#startHeartbeat();
        };
        this.#channel.onclose   = () => { this.#onStateChange('closed'); };
        this.#channel.onmessage = e  => {
            if (e.data === '{"type":"ping"}') {
                this.#channel?.readyState === 'open' && this.#channel.send('{"type":"pong"}');
                return;
            }
            if (e.data === '{"type":"pong"}') {
                this.#pongMissed = 0;
                return;
            }
            this.#onMessage(e.data);
        };
    }

    #startHeartbeat() {
        clearInterval(this.#heartbeatTimer);
        this.#pongMissed    = 0;
        this.#heartbeatTimer = setInterval(() => {
            if (!this.isOpen) { clearInterval(this.#heartbeatTimer); return; }
            this.#pongMissed++;
            if (this.#pongMissed >= 3) {
                clearInterval(this.#heartbeatTimer);
                this.#_closeInternals();
                this.#scheduleReconnect();
                return;
            }
            this.#channel.send('{"type":"ping"}');
        }, P2PChannel.#HEARTBEAT_MS);
    }
}

// ──────────────────────────────────────────────────────────────
// 📤 MEDIA UPLOADER — compressão, E2E e upload com progresso
// ──────────────────────────────────────────────────────────────
// Comprime imagens via Canvas API (WebP), gera thumbnails para imagens e
// vídeos, cifra o arquivo com AES-256-GCM antes do upload (E2E real) e
// usa uploadBytesResumable para suportar pausa/retomada/cancelamento.
class MediaUploader {
    static #LIMITS  = { image: 20 * 1024 * 1024, video: 100 * 1024 * 1024, default: 50 * 1024 * 1024 };
    static #RETRIES = 3;
    static #MIME_MAP = {
        'image/': 'image', 'video/': 'video', 'audio/': 'audio',
        'application/pdf': 'pdf', 'image/gif': 'gif'
    };

    #storage;
    #e2e;
    #uid;
    #activeTask = null; // UploadTask em andamento (pausa/cancelamento)

    constructor(storage, e2e, uid) {
        this.#storage = storage;
        this.#e2e     = e2e;
        this.#uid     = uid;
    }

    /** Retorna 'image'|'video'|'audio'|'pdf'|'document'|'gif' */
    static resolveType(mime) {
        if (mime === 'image/gif') return 'gif';
        for (const [prefix, type] of Object.entries(MediaUploader.#MIME_MAP)) {
            if (mime.startsWith(prefix)) return type;
        }
        return 'document';
    }

    /** Valida tamanho. Lança Error com mensagem amigável se inválido. */
    static validate(file) {
        const type  = MediaUploader.resolveType(file.type);
        const limit = MediaUploader.#LIMITS[type] ?? MediaUploader.#LIMITS.default;
        if (file.size > limit) throw new Error(`Arquivo muito grande. Limite: ${Math.round(limit / 1024 / 1024)}MB`);
    }

    /**
     * Faz upload completo do arquivo.
     * @param {File} file
     * @param {(pct: number) => void} onProgress  — 0–100
     * @returns {Promise<Object>} resultado com url, thumbnailUrl, tipo, chave E2E, etc.
     */
    async upload(file, onProgress = () => {}) {
        MediaUploader.validate(file);
        const type = MediaUploader.resolveType(file.type);

        // 1. Compressão / thumbnail (paralelo quando ambos usam createImageBitmap)
        let uploadFile   = file;
        let thumbnailUrl = null;
        if (type === 'image') {
            // Cria o bitmap uma única vez e passa para ambas as funções
            const bmp = await createImageBitmap(file);
            const [compressed, thumbBlob] = await Promise.all([
                this.#compressImageFromBitmap(bmp, file.name),
                this.#generateImageThumbnailFromBitmap(bmp)
            ]);
            bmp.close();
            uploadFile   = compressed;
            thumbnailUrl = await this.#uploadRaw(thumbBlob, `thumbnails/${this.#uid}/${Date.now()}_thumb.webp`);
        } else if (type === 'video') {
            const thumbBlob = await this.#generateVideoThumbnail(file).catch(() => null);
            if (thumbBlob) thumbnailUrl = await this.#uploadRaw(thumbBlob, `thumbnails/${this.#uid}/${Date.now()}_vthumb.webp`);
        }

        // 2. Cifrar
        const arrayBuf = await uploadFile.arrayBuffer();
        const { encrypted, keyB64, ivB64 } = await this.#encryptBuffer(arrayBuf);

        // 3. Upload cifrado com progresso e retry
        const ext      = uploadFile.name?.split('.').pop() || 'bin';
        const path     = `media/${this.#uid}/${Date.now()}_${type}.${ext}`;
        const encBlob  = new Blob([encrypted], { type: 'application/octet-stream' });
        const url      = await this.#uploadWithRetry(encBlob, path, onProgress);

        return {
            url, thumbnailUrl,
            type, fileName: file.name, fileSize: file.size, mimeType: file.type,
            mediaKey: keyB64, mediaIv: ivB64
        };
    }

    pause()  { this.#activeTask?.pause(); }
    resume() { this.#activeTask?.resume(); }
    cancel() { this.#activeTask?.cancel(); this.#activeTask = null; }

    // ── Compressão ───────────────────────────────────────────
    // Ambos os métodos recebem um ImageBitmap já criado (não criam outro),
    // permitindo chamá-los em paralelo sem decodificar a imagem duas vezes.
    async #compressImageFromBitmap(bmp) {
        const MAX    = 1280;
        const ratio  = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
        const canvas = Object.assign(document.createElement('canvas'), {
            width:  Math.round(bmp.width  * ratio),
            height: Math.round(bmp.height * ratio)
        });
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        return new Promise(res => canvas.toBlob(b => res(b), 'image/webp', 0.82));
    }

    async #generateImageThumbnailFromBitmap(bmp) {
        const SIZE   = 200;
        const ratio  = Math.min(SIZE / bmp.width, SIZE / bmp.height);
        const canvas = Object.assign(document.createElement('canvas'), {
            width:  Math.round(bmp.width  * ratio),
            height: Math.round(bmp.height * ratio)
        });
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        return new Promise(res => canvas.toBlob(b => res(b), 'image/webp', 0.7));
    }

    async #generateVideoThumbnail(file) {
        return new Promise((resolve, reject) => {
            const video  = document.createElement('video');
            const objUrl = URL.createObjectURL(file);
            video.preload = 'metadata';
            video.muted   = true;
            video.src     = objUrl;
            video.addEventListener('loadeddata', () => {
                video.currentTime = Math.min(1, video.duration / 10);
            });
            video.addEventListener('seeked', () => {
                const canvas = Object.assign(document.createElement('canvas'), {
                    width: 320, height: Math.round(320 * (video.videoHeight / video.videoWidth))
                });
                canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(objUrl);
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas vazio')), 'image/webp', 0.7);
            });
            video.addEventListener('error', () => { URL.revokeObjectURL(objUrl); reject(new Error('vídeo inválido')); });
        });
    }

    // ── Criptografia ─────────────────────────────────────────
    async #encryptBuffer(arrayBuf) {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const iv  = crypto.getRandomValues(new Uint8Array(12));
        const ct  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuf);
        const raw = await crypto.subtle.exportKey('raw', key);
        return {
            encrypted: ct,
            keyB64:    MediaUploader.#bufToB64(raw),
            ivB64:     MediaUploader.#bufToB64(iv.buffer)
        };
    }

    /** Descriptografa URL de mídia baixada para um Blob URL temporário. */
    static async decryptMedia(url, keyB64, ivB64) {
        const res       = await fetch(url);
        const encrypted = await res.arrayBuffer();
        const key       = await crypto.subtle.importKey('raw', MediaUploader.#b64ToBuf(keyB64), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const iv        = MediaUploader.#b64ToBuf(ivB64);
        const plain     = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, encrypted);
        return URL.createObjectURL(new Blob([plain]));
    }

    // ── Upload ───────────────────────────────────────────────
    async #uploadRaw(blob, path) {
        const storRef = ref(this.#storage, path);
        const snap    = await uploadBytes(storRef, blob);
        return getDownloadURL(snap.ref);
    }

    async #uploadWithRetry(blob, path, onProgress) {
        let lastErr;
        for (let attempt = 0; attempt < MediaUploader.#RETRIES; attempt++) {
            if (attempt > 0) await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
            try {
                return await this.#uploadResumable(blob, path, onProgress);
            } catch (e) {
                lastErr = e;
                if (e.code === 'storage/canceled') throw e; // cancelado → não tenta de novo
            }
        }
        throw lastErr;
    }

    #uploadResumable(blob, path, onProgress) {
        return new Promise((resolve, reject) => {
            const storRef = ref(this.#storage, path);
            const task    = uploadBytesResumable(storRef, blob);
            this.#activeTask = task;
            task.on('state_changed',
                snap => onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
                err  => reject(err),
                ()   => getDownloadURL(task.snapshot.ref).then(resolve).catch(reject)
            );
        });
    }

    static #bufToB64(buf) {
        return btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer)));
    }

    static #b64ToBuf(b64) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
    }
}

// ──────────────────────────────────────────────────────────────
// 😊 EMOJI GIF PICKER — seletor de emojis, GIFs e stickers
// ──────────────────────────────────────────────────────────────
// Não depende de API externa. GIFs são URLs Tenor públicas curadas.
// Stickers são emojis Unicode grandes estilizados.
// Recentes persistidos em localStorage.
class EmojiGifPicker {
    static #RECENT_MAX = 20;
    static #EMOJI_RECENT_KEY = 'egp-emoji-recents';
    static #GIF_RECENT_KEY   = 'egp-gif-recents';

    static #EMOJI_CATEGORIES = [
        { label: '🕐 Recentes', id: 'recents',     emojis: [] },
        { label: '😀 Rostos',   id: 'faces',
          emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'] },
        { label: '👋 Gestos',   id: 'gestures',
          emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁️','👅','👄','💋','🫦'] },
        { label: '🐱 Animais',  id: 'animals',
          emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦗','🕷️','🦂','🐢','🦎','🐍','🐲','🦕','🦖','🦎','🐳','🐋','🦈','🦑','🐙','🦞','🦀','🐠','🐟','🐡','🐬','🦭','🐊','🐆','🐅','��','🦧','🐘','🦛','🦏','🐪','🦒','🦓','🦌','🐂','🐃','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦘','🐕','🐩','🦮','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'] },
        { label: '🍕 Comidas',  id: 'food',
          emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🫘','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🫖','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾'] },
        { label: '⚽ Esportes', id: 'sports',
          emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏑','🏏','🥅','⛳','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','🏄','🚣','🧗','🚴','🏇','🤺','🏊','🤽','🏌️','🏇','🧘','🛼','🛻','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎟️','🎫'] },
        { label: '🌍 Viagem',   id: 'travel',
          emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🏍️','🛵','🛺','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🛑','🚧','⚓','🛟','⛵','🚤','🛥️','🛳️','🚢','✈️','🛩️','🛫','🛬','🪂','💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🪄','🏖️','🏕️','🏔️','🗻','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏭','🗼','🗽','⛪','🕌','🛕','🕍','🕋','⛩️','🗾','🎑','🏞️','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙️','🌃','🌌','🌉','🌁'] },
        { label: '💡 Objetos',  id: 'objects',
          emojis: ['💌','🔮','🪄','🧿','🪬','🧸','🪆','🪅','🎎','🎏','🎐','🎀','🎁','🎗️','🎟️','🎫','🎖️','🏆','📱','📲','💻','🖥️','🖨️','🖱️','⌨️','🖲️','💾','💿','📀','🧮','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🧭','⏱️','⌚','🕰️','⏳','📡','🔋','🔌','💡','🔦','🕯️','🗑️','💰','💴','💵','💶','💷','💸','💳','🪙','💹','📈','📉','📊','📋','📌','📍','✂️','🗃️','🗄️','🗑️','🔒','🔓','🔑','🗝️','🔨','🪓','⛏️','⚒️','🛠️','🗡️','⚔️','🛡️','🪚','🔧','🪛','🔩','⚙️','🗜️','🪝','🧲','🪜','⚗️','🧪','🧫','🔬','🔭','📡','💈','🚿','🛁','🪠','🧴','🧷','🧹','🧺','🧻','🪣','🧼','🫧'] },
        { label: '🔣 Símbolos', id: 'symbols',
          emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🔇','🔕','🔃','🔄','🔙','🔛','🔝','🛗','🚩','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️'] }
    ];

    // GIFs hospedados no Giphy CDN (sem API key para img src).
    static #GIF_CATEGORIES = [
        { label: '😂 Reação',   id: 'reacao',   gifs: [
            { url: 'https://media.giphy.com/media/ZqlvCTNHpqrio/giphy.gif',        label: 'LOL' },
            { url: 'https://media.giphy.com/media/7rzbxdu0ZEXLy/giphy.gif',        label: 'Palmas' },
            { url: 'https://media.giphy.com/media/GCvktC0KFy9l6/giphy.gif',        label: 'Joinha' },
            { url: 'https://media.giphy.com/media/XsUtdIeJ0MWMo/giphy.gif',        label: 'Facepalm' },
            { url: 'https://media.giphy.com/media/xT0xeJpnrWC4XWblEk/giphy.gif',   label: 'Incrível' },
            { url: 'https://media.giphy.com/media/RrVzUOXldFe8M/giphy.gif',        label: 'Não sei' }
        ]},
        { label: '🎉 Diversão', id: 'diversao', gifs: [
            { url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',    label: 'Dança' },
            { url: 'https://media.giphy.com/media/xUPGcguWZHRC49irss/giphy.gif',   label: 'Festa' },
            { url: 'https://media.giphy.com/media/3o7abBPhHHubOzZs28/giphy.gif',   label: 'Vitória' },
            { url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',   label: 'Celebrar' },
            { url: 'https://media.giphy.com/media/3oEjI789af0AVurF60/giphy.gif',   label: 'Feliz' },
            { url: 'https://media.giphy.com/media/5GoVLqeAOie9jQBen7/giphy.gif',   label: 'Animado' }
        ]},
        { label: '👋 Saudação', id: 'saudacao', gifs: [
            { url: 'https://media.giphy.com/media/3oEjHAUOqG3lSS0f1C/giphy.gif',   label: 'Oi' },
            { url: 'https://media.giphy.com/media/l0MYzv4jkRfmJR4sE/giphy.gif',   label: 'Tchau' },
            { url: 'https://media.giphy.com/media/3oEjHnbgEJOOT4LCSU/giphy.gif',  label: 'Bom dia' },
            { url: 'https://media.giphy.com/media/xUOrvVrImGvNe/giphy.gif',       label: 'Boa noite' },
            { url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajEsU/giphy.gif',  label: 'Bem-vindo' },
            { url: 'https://media.giphy.com/media/QYWKPNjMzNh3sT4xGY/giphy.gif',  label: 'Aceno' }
        ]},
        { label: '❤️ Love',     id: 'love',     gifs: [
            { url: 'https://media.giphy.com/media/l0MYzdXqnprgq4Lby/giphy.gif',   label: 'Corações' },
            { url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajEsU/giphy.gif',  label: 'Love' },
            { url: 'https://media.giphy.com/media/od0qFVDJiJGcU/giphy.gif',       label: 'Abraço' },
            { url: 'https://media.giphy.com/media/xT4uQhzQ2RA2j9JFHi/giphy.gif',  label: 'Beijo' },
            { url: 'https://media.giphy.com/media/3oEjHU2msImBHpFoqs/giphy.gif',  label: 'Fofo' },
            { url: 'https://media.giphy.com/media/ICOgUNjpvO0eAzon5b/giphy.gif',  label: 'Gatinho' }
        ]},
        { label: '😮 Surpresa', id: 'surpresa', gifs: [
            { url: 'https://media.giphy.com/media/12NsCGnTKf3Zyn/giphy.gif',      label: 'Wow' },
            { url: 'https://media.giphy.com/media/3oFyJLyhTSuQEiK5OU/giphy.gif', label: 'OMG' },
            { url: 'https://media.giphy.com/media/5VIDEHmWnFXG4/giphy.gif',      label: 'Chocado' },
            { url: 'https://media.giphy.com/media/hEc4k5pN17GZq/giphy.gif',      label: 'What?!' },
            { url: 'https://media.giphy.com/media/3oFzlXAgLEp9xEL0Da/giphy.gif', label: 'Noooo' },
            { url: 'https://media.giphy.com/media/xUOwGhOrBioLpbHLjy/giphy.gif', label: 'Sério?' }
        ]}
    ];

    static #STICKER_CATEGORIES = [
        { label: '😂 Humor',  emojis: ['😂','🤣','💀','🥲','😭','🤡','🥴','😵','🤯','🫠','🫢','🫣','😶‍🌫️'] },
        { label: '❤️ Amor',   emojis: ['❤️','🥰','😍','💕','💘','💝','💋','🫶','🤍','💜','💛','🧡','💚'] },
        { label: '🎉 Festa',  emojis: ['🎉','🎊','🥳','🎈','🎁','🏆','🥇','🎆','🎇','✨','🌟','💫','⭐'] },
        { label: '👍 Reação', emojis: ['👍','👎','👏','🙌','🤝','🫡','💯','✅','❌','‼️','⁉️','❓','❗'] },
        { label: '🤔 Pensando', emojis: ['🤔','😏','🙄','😒','😤','🤨','🫤','😑','😐','🤐','😶','🫥'] },
        { label: '🔥 Fire',   emojis: ['🔥','💥','⚡','🌊','🌈','☄️','🌪️','💨','🫧','🌙','⭐','🌞','🌝'] }
    ];

    #panel     = null; // elemento DOM (lazy)
    #onPick    = null;
    #activeTab = 'emoji';
    #activeEmojiCat = 'faces';
    #activeGifCat   = 'reacao';
    #activeStickerCat = 0;
    #searchTimer = null;

    /**
     * Exibe o picker acima de anchorEl.
     * @param {HTMLElement} anchorEl
     * @param {(payload:{type,value}) => void} onPick
     */
    show(anchorEl, onPick) {
        this.#onPick = onPick;
        if (!this.#panel) this.#buildPanel();
        this.#updateRecents();
        document.body.appendChild(this.#panel);
        this.#panel.classList.remove('emoji-gif-panel--hidden');
        this.#positionPanel(anchorEl);

        // Fecha ao clicar fora
        const outsideHandler = e => {
            if (!this.#panel.contains(e.target) && e.target !== anchorEl) {
                this.hide();
                document.removeEventListener('pointerdown', outsideHandler);
            }
        };
        setTimeout(() => document.addEventListener('pointerdown', outsideHandler), 10);
    }

    hide() { this.#panel?.classList.add('emoji-gif-panel--hidden'); }

    // ── Build DOM ─────────────────────────────────────────────
    #buildPanel() {
        const el = document.createElement('div');
        el.className = 'emoji-gif-panel emoji-gif-panel--hidden';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Seletor de emoji e GIF');

        el.innerHTML = `
          <div class="egp-tabs" role="tablist">
            <button class="egp-tab egp-tab--active" data-tab="emoji" role="tab">😀 Emoji</button>
            <button class="egp-tab" data-tab="gif"   role="tab">🎬 GIF</button>
            <button class="egp-tab" data-tab="sticker" role="tab">🌟 Sticker</button>
          </div>
          <div class="egp-search-wrap">
            <input class="egp-search" type="search" placeholder="Buscar emoji..." autocomplete="off" spellcheck="false">
          </div>
          <div class="egp-cat-bar" id="egpCatBar"></div>
          <div class="egp-body" id="egpBody"></div>
        `;

        el.querySelectorAll('.egp-tab').forEach(btn => {
            btn.addEventListener('click', () => this.#switchTab(btn.dataset.tab));
        });

        const search = el.querySelector('.egp-search');
        search.addEventListener('input', () => {
            clearTimeout(this.#searchTimer);
            this.#searchTimer = setTimeout(() => this.#doSearch(search.value.trim()), 200);
        });

        this.#panel = el;
        this.#renderTab('emoji');
    }

    #positionPanel(anchor) {
        const rect = anchor.getBoundingClientRect();
        const panelH = 380;
        const top  = rect.top - panelH - 8;
        this.#panel.style.position = 'fixed';
        this.#panel.style.left     = Math.max(8, Math.min(rect.left, window.innerWidth - 348)) + 'px';
        this.#panel.style.top      = (top < 8 ? rect.bottom + 8 : top) + 'px';
        this.#panel.style.zIndex   = '9999';
    }

    #switchTab(tab) {
        this.#activeTab = tab;
        this.#panel.querySelectorAll('.egp-tab').forEach(b => b.classList.toggle('egp-tab--active', b.dataset.tab === tab));
        const search = this.#panel.querySelector('.egp-search');
        search.placeholder = tab === 'emoji' ? 'Buscar emoji...' : tab === 'gif' ? 'Buscar GIF...' : 'Buscar sticker...';
        search.value = '';
        this.#renderTab(tab);
    }

    #renderTab(tab) {
        const catBar = this.#panel.querySelector('#egpCatBar');
        const body   = this.#panel.querySelector('#egpBody');

        if (tab === 'emoji') {
            catBar.innerHTML = EmojiGifPicker.#EMOJI_CATEGORIES.map(c =>
                `<button class="egp-cat-btn${c.id === this.#activeEmojiCat ? ' egp-cat-btn--active':''}" data-cat="${c.id}" title="${c.label}">${c.emojis?.[0] ?? '🕐'}</button>`
            ).join('');
            catBar.querySelectorAll('.egp-cat-btn').forEach(b => {
                b.addEventListener('click', () => {
                    this.#activeEmojiCat = b.dataset.cat;
                    this.#renderEmojiGrid(b.dataset.cat);
                    catBar.querySelectorAll('.egp-cat-btn').forEach(x => x.classList.toggle('egp-cat-btn--active', x === b));
                });
            });
            this.#renderEmojiGrid(this.#activeEmojiCat);
        } else if (tab === 'gif') {
            catBar.innerHTML = EmojiGifPicker.#GIF_CATEGORIES.map(c =>
                `<button class="egp-cat-btn${c.id === this.#activeGifCat ? ' egp-cat-btn--active':''}" data-cat="${c.id}" title="${c.label}">${c.label.split(' ')[0]}</button>`
            ).join('');
            catBar.querySelectorAll('.egp-cat-btn').forEach(b => {
                b.addEventListener('click', () => {
                    this.#activeGifCat = b.dataset.cat;
                    this.#renderGifGrid(b.dataset.cat);
                    catBar.querySelectorAll('.egp-cat-btn').forEach(x => x.classList.toggle('egp-cat-btn--active', x === b));
                });
            });
            this.#renderGifGrid(this.#activeGifCat);
        } else {
            catBar.innerHTML = EmojiGifPicker.#STICKER_CATEGORIES.map((c, i) =>
                `<button class="egp-cat-btn${i === this.#activeStickerCat ? ' egp-cat-btn--active':''}" data-idx="${i}" title="${c.label}">${c.emojis[0]}</button>`
            ).join('');
            catBar.querySelectorAll('.egp-cat-btn').forEach(b => {
                b.addEventListener('click', () => {
                    this.#activeStickerCat = +b.dataset.idx;
                    this.#renderStickerGrid(this.#activeStickerCat);
                    catBar.querySelectorAll('.egp-cat-btn').forEach(x => x.classList.toggle('egp-cat-btn--active', x === b));
                });
            });
            this.#renderStickerGrid(this.#activeStickerCat);
        }
    }

    #renderEmojiGrid(catId) {
        const cat    = EmojiGifPicker.#EMOJI_CATEGORIES.find(c => c.id === catId);
        const emojis = catId === 'recents'
            ? JSON.parse(localStorage.getItem(EmojiGifPicker.#EMOJI_RECENT_KEY) || '[]')
            : (cat?.emojis ?? []);
        const body = this.#panel.querySelector('#egpBody');
        body.innerHTML = `<div class="egp-emoji-grid">${
            emojis.map(e => `<button class="egp-emoji-item" title="${e}">${e}</button>`).join('')
        }</div>`;
        body.querySelectorAll('.egp-emoji-item').forEach(b => {
            b.addEventListener('click', () => this.#pickEmoji(b.textContent));
        });
    }

    #renderGifGrid(catId) {
        const cat  = EmojiGifPicker.#GIF_CATEGORIES.find(c => c.id === catId);
        const gifs = cat?.gifs ?? [];
        const body = this.#panel.querySelector('#egpBody');
        body.innerHTML = `<div class="egp-gif-grid">${
            gifs.map(g => `<button class="egp-gif-item" title="${g.label}"><img loading="lazy" src="${g.url}" alt="${g.label}" onerror="this.closest('.egp-gif-item').style.display='none'"></button>`).join('')
        }</div>`;
        body.querySelectorAll('.egp-gif-item').forEach((b, i) => {
            b.addEventListener('click', () => this.#pickGif(gifs[i]));
        });
    }

    #renderStickerGrid(idx) {
        const cat  = EmojiGifPicker.#STICKER_CATEGORIES[idx] ?? EmojiGifPicker.#STICKER_CATEGORIES[0];
        const body = this.#panel.querySelector('#egpBody');
        body.innerHTML = `<div class="egp-sticker-grid">${
            cat.emojis.map(e => `<button class="egp-sticker-item" title="${e}">${e}</button>`).join('')
        }</div>`;
        body.querySelectorAll('.egp-sticker-item').forEach(b => {
            b.addEventListener('click', () => {
                this.hide();
                this.#onPick?.({ type: 'sticker', value: b.textContent });
            });
        });
    }

    #doSearch(query) {
        if (!query) { this.#renderTab(this.#activeTab); return; }
        const body = this.#panel.querySelector('#egpBody');
        if (this.#activeTab === 'emoji' || this.#activeTab === 'sticker') {
            const all = EmojiGifPicker.#EMOJI_CATEGORIES.flatMap(c => c.emojis ?? []);
            const matches = all.filter(e => e.codePointAt(0).toString(16).includes(query.toLowerCase()) || true).slice(0, 80);
            // Busca simples: filtra emojis cujas categorias contenham o termo
            const results = EmojiGifPicker.#EMOJI_CATEGORIES
                .filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
                .flatMap(c => c.emojis ?? []);
            const final = results.length ? results.slice(0, 80) : matches.slice(0, 80);
            body.innerHTML = `<div class="egp-emoji-grid">${final.map(e => `<button class="egp-emoji-item">${e}</button>`).join('')}</div>`;
            body.querySelectorAll('.egp-emoji-item').forEach(b => b.addEventListener('click', () => this.#pickEmoji(b.textContent)));
        } else {
            const all = EmojiGifPicker.#GIF_CATEGORIES.flatMap(c => c.gifs);
            const matches = all.filter(g => g.label.toLowerCase().includes(query.toLowerCase()));
            body.innerHTML = `<div class="egp-gif-grid">${matches.map(g => `<button class="egp-gif-item" title="${g.label}"><img loading="lazy" src="${g.url}" alt="${g.label}"></button>`).join('')}</div>`;
            body.querySelectorAll('.egp-gif-item').forEach((b, i) => b.addEventListener('click', () => this.#pickGif(matches[i])));
        }
    }

    #pickEmoji(emoji) {
        this.hide();
        this.#saveRecent(EmojiGifPicker.#EMOJI_RECENT_KEY, emoji);
        this.#onPick?.({ type: 'emoji', value: emoji });
    }

    #pickGif(gif) {
        this.hide();
        this.#saveRecent(EmojiGifPicker.#GIF_RECENT_KEY, gif.url);
        this.#onPick?.({ type: 'gif', value: gif.url, label: gif.label });
    }

    #saveRecent(key, value) {
        const arr = JSON.parse(localStorage.getItem(key) || '[]').filter(v => v !== value);
        arr.unshift(value);
        localStorage.setItem(key, JSON.stringify(arr.slice(0, EmojiGifPicker.#RECENT_MAX)));
    }

    #updateRecents() {
        const cat = EmojiGifPicker.#EMOJI_CATEGORIES.find(c => c.id === 'recents');
        if (cat) cat.emojis = JSON.parse(localStorage.getItem(EmojiGifPicker.#EMOJI_RECENT_KEY) || '[]');
    }
}

// ──────────────────────────────────────────────────────────────
// 🖼 FILE MESSAGE RENDERER — renderização de mensagens de mídia
// ──────────────────────────────────────────────────────────────
// Todos os métodos são estáticos. Singleton para o lightbox.
class FileMessageRenderer {
    static #lightboxEl = null;
    static #blobUrls   = new Set(); // Blob URLs abertos — revogar ao fechar lightbox

    /** Retorna HTML do corpo da mensagem para tipos de mídia. */
    static buildBody(data, isOwn, time, statusHtml, esc) {
        switch (data.type) {
            case 'image':    return FileMessageRenderer.#buildImageBubble(data, time, statusHtml, isOwn, esc);
            case 'video':    return FileMessageRenderer.#buildVideoBubble(data, time, statusHtml, isOwn, esc);
            case 'gif':      return FileMessageRenderer.#buildGifBubble(data, time, statusHtml, esc);
            case 'pdf':      return FileMessageRenderer.#buildPdfBubble(data, time, statusHtml, esc);
            case 'document': return FileMessageRenderer.#buildDocBubble(data, time, statusHtml, esc);
            case 'audio':    return null; // tratado pelo buildAudioPlayer existente
            case 'sticker':  return FileMessageRenderer.#buildStickerBubble(data);
            default:         return null;
        }
    }

    static #buildImageBubble(data, time, statusHtml, isOwn, esc) {
        const thumb = data.thumbnailUrl || data.mediaUrl || '';
        const name  = esc(data.fileName || 'imagem');
        return `
          <div class="msg-media msg-media-image" data-media-url="${esc(data.mediaUrl)}" data-key="${esc(data.mediaKey||'')}" data-iv="${esc(data.mediaIv||'')}" data-type="image" title="${name}">
            <img class="msg-media-img" src="${esc(thumb)}" alt="${name}" loading="lazy">
            <div class="msg-media-overlay"><span class="msg-media-icon">🔍</span></div>
            ${data.mediaKey ? '<span class="msg-media-lock" title="Cifrado E2E">🔒</span>' : ''}
          </div>
          <span class="chat-msg-time">${time}</span>${statusHtml}`;
    }

    static #buildVideoBubble(data, time, statusHtml, isOwn, esc) {
        const poster = data.thumbnailUrl ? esc(data.thumbnailUrl) : '';
        const name   = esc(data.fileName || 'vídeo');
        return `
          <div class="msg-media msg-media-video" data-media-url="${esc(data.mediaUrl)}" data-key="${esc(data.mediaKey||'')}" data-iv="${esc(data.mediaIv||'')}" data-type="video" title="${name}">
            <div class="msg-media-video-thumb" style="${poster ? `background-image:url('${poster}')` : ''}">
              <button class="msg-media-play-btn" aria-label="Reproduzir vídeo">▶</button>
              ${data.mediaKey ? '<span class="msg-media-lock">🔒</span>' : ''}
            </div>
          </div>
          <span class="chat-msg-time">${time}</span>${statusHtml}`;
    }

    static #buildGifBubble(data, time, statusHtml, esc) {
        const src = esc(data.mediaUrl || data.gifUrl || '');
        return `
          <div class="msg-media msg-media-gif">
            <img class="msg-media-gif-img" src="${src}" alt="GIF" loading="lazy">
            <span class="msg-media-gif-badge">GIF</span>
          </div>
          <span class="chat-msg-time">${time}</span>${statusHtml}`;
    }

    static #buildPdfBubble(data, time, statusHtml, esc) {
        const name = esc(data.fileName || 'documento.pdf');
        const size = FileMessageRenderer.#fmtSize(data.fileSize);
        return `
          <div class="msg-media msg-media-pdf" data-media-url="${esc(data.mediaUrl)}" data-key="${esc(data.mediaKey||'')}" data-iv="${esc(data.mediaIv||'')}">
            <span class="msg-media-doc-icon">📄</span>
            <div class="msg-media-doc-info">
              <span class="msg-media-doc-name" title="${name}">${name}</span>
              <span class="msg-media-doc-size">${size}${data.mediaKey ? ' · 🔒' : ''}</span>
            </div>
            <button class="msg-media-download-btn" title="Baixar PDF">⬇️</button>
          </div>
          <span class="chat-msg-time">${time}</span>${statusHtml}`;
    }

    static #buildDocBubble(data, time, statusHtml, esc) {
        const name = esc(data.fileName || 'arquivo');
        const size = FileMessageRenderer.#fmtSize(data.fileSize);
        const icon = FileMessageRenderer.#docIcon(data.fileName || '');
        return `
          <div class="msg-media msg-media-document" data-media-url="${esc(data.mediaUrl)}" data-key="${esc(data.mediaKey||'')}" data-iv="${esc(data.mediaIv||'')}">
            <span class="msg-media-doc-icon">${icon}</span>
            <div class="msg-media-doc-info">
              <span class="msg-media-doc-name" title="${name}">${name}</span>
              <span class="msg-media-doc-size">${size}${data.mediaKey ? ' · 🔒' : ''}</span>
            </div>
            <button class="msg-media-download-btn" title="Baixar arquivo">⬇️</button>
          </div>
          <span class="chat-msg-time">${time}</span>${statusHtml}`;
    }

    static #buildStickerBubble(data) {
        return `<span class="msg-sticker">${data.text || ''}</span>`;
    }

    /** Abre lightbox para imagem ou vídeo (com descriptografia se necessário). */
    static async openLightbox(mediaUrl, mediaKey, mediaIv, type) {
        if (!FileMessageRenderer.#lightboxEl) FileMessageRenderer.#createLightbox();
        const lightbox = FileMessageRenderer.#lightboxEl;
        const inner    = lightbox.querySelector('.lightbox-inner');
        inner.innerHTML = '<div class="lightbox-loading">⏳ Carregando...</div>';
        lightbox.showModal();

        try {
            let blobUrl = mediaUrl;
            if (mediaKey && mediaIv) {
                // Usa cache LRU para evitar re-fetch + re-decrypt
                blobUrl = await _decryptCache.getOrDecrypt(mediaUrl, mediaKey, mediaIv);
            }
            if (type === 'video') {
                inner.innerHTML = `<video src="${blobUrl}" controls autoplay class="lightbox-video"></video>`;
            } else {
                inner.innerHTML = `<img src="${blobUrl}" class="lightbox-img" alt="Imagem">`;
            }
        } catch {
            inner.innerHTML = '<div class="lightbox-loading">❌ Erro ao carregar mídia</div>';
        }
    }

    static #createLightbox() {
        const dlg = document.createElement('dialog');
        dlg.className = 'media-lightbox';
        dlg.innerHTML = `
          <button class="lightbox-close" aria-label="Fechar">✕</button>
          <div class="lightbox-inner"></div>`;
        dlg.querySelector('.lightbox-close').addEventListener('click', () => FileMessageRenderer.#closeLightbox());
        dlg.addEventListener('click', e => { if (e.target === dlg) FileMessageRenderer.#closeLightbox(); });
        document.body.appendChild(dlg);
        FileMessageRenderer.#lightboxEl = dlg;
    }

    static #closeLightbox() {
        FileMessageRenderer.#lightboxEl?.close();
        FileMessageRenderer.#lightboxEl.querySelector('.lightbox-inner').innerHTML = '';
        FileMessageRenderer.#blobUrls.forEach(u => URL.revokeObjectURL(u));
        FileMessageRenderer.#blobUrls.clear();
    }

    /** Vincula eventos de clique nas bolhas de mídia renderizadas. */
    static bindMediaEvents(msgEl) {
        // Lightbox para imagem
        msgEl.querySelector('.msg-media-image')?.addEventListener('click', e => {
            const el = e.currentTarget;
            FileMessageRenderer.openLightbox(el.dataset.mediaUrl, el.dataset.key, el.dataset.iv, 'image');
        });

        // Player de vídeo inline
        msgEl.querySelector('.msg-media-play-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            const el = e.currentTarget.closest('.msg-media-video');
            FileMessageRenderer.openLightbox(el.dataset.mediaUrl, el.dataset.key, el.dataset.iv, 'video');
        });

        // Download de PDF/documento
        msgEl.querySelectorAll('.msg-media-download-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const media = btn.closest('[data-media-url]');
                const { mediaUrl, key, iv } = media.dataset;
                btn.textContent = '⏳';
                try {
                    let blobUrl = mediaUrl;
                    if (key && iv) {
                        blobUrl = await MediaUploader.decryptMedia(mediaUrl, key, iv);
                    }
                    const a = Object.assign(document.createElement('a'), {
                        href: blobUrl, download: media.querySelector('.msg-media-doc-name')?.textContent || 'arquivo'
                    });
                    document.body.appendChild(a); a.click(); a.remove();
                    if (key) setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
                } catch { btn.textContent = '❌'; } finally { btn.textContent = '⬇️'; }
            });
        });
    }

    static #docIcon(name) {
        const ext = name.split('.').pop()?.toLowerCase();
        const MAP = { pdf:'📄', xlsx:'📊', xls:'📊', docx:'📝', doc:'📝', pptx:'📊', ppt:'📊', zip:'🗜️', rar:'🗜️', txt:'📃', csv:'📊', mp3:'🎵', ogg:'🎵', wav:'🎵' };
        return MAP[ext] ?? '📎';
    }

    static #fmtSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024)        return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }
}

const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyCIVshCdXm7Fp1X3kxGr5GZOF_jUBN3ChA',
    authDomain:        'chatmilhao.firebaseapp.com',
    projectId:         'chatmilhao',
    storageBucket:     'chatmilhao.firebasestorage.app',
    messagingSenderId: '411362756429',
    appId:             '1:411362756429:web:55059c1f443fe06a1bd904'
};

// ──────────────────────────────────────────────────────────────
// 📊 PERF LOGGER — rastreamento de latência e performance
// Circular buffer por categoria, exposto em window.__perfLog
// ──────────────────────────────────────────────────────────────
class PerfLogger {
    static #CAP = 200; // máx entradas por categoria
    static #SAMPLE_TTL = 30_000; // 30s sem confirmação → limpa sample

    #samples = new Map();  // id → { sendMs, ttlTimer }
    #buckets = new Map();  // categoria → Array (circular, máx #CAP)

    constructor() {
        window.__perfLog = {
            summary: () => this.summary(),
            report:  () => this.report(),
            raw:     this.#buckets
        };
    }

    markSend(id) {
        const ttlTimer = setTimeout(() => this.#samples.delete(id), PerfLogger.#SAMPLE_TTL);
        this.#samples.set(id, { sendMs: Date.now(), ttlTimer });
    }

    markRendered(id) {
        const s = this.#samples.get(id);
        if (!s) return;
        clearTimeout(s.ttlTimer);
        this.#record('msg-render', Date.now() - s.sendMs);
        this.#samples.delete(id);
    }

    markConfirmed(tempId, realId, latencyMs) {
        this.#record('msg-firestore', latencyMs);
    }

    recordCategory(cat, valueMs) {
        this.#record(cat, valueMs);
    }

    #record(cat, valueMs) {
        if (!this.#buckets.has(cat)) this.#buckets.set(cat, []);
        const arr = this.#buckets.get(cat);
        if (arr.length >= PerfLogger.#CAP) arr.shift(); // circular: remove o mais antigo
        arr.push({ v: valueMs, ts: Date.now() });
    }

    summary() {
        const result = {};
        for (const [cat, arr] of this.#buckets) {
            if (!arr.length) continue;
            const avg = Math.round(arr.reduce((s, e) => s + e.v, 0) / arr.length);
            const max = Math.max(...arr.map(e => e.v));
            const min = Math.min(...arr.map(e => e.v));
            result[cat] = { avg, min, max, count: arr.length };
        }
        return result;
    }

    report() {
        const s = this.summary();
        console.group('[PerfLogger] Resumo de performance');
        console.table(s);
        console.groupEnd();
        return s;
    }
}

// ──────────────────────────────────────────────────────────────
// 📦 OFFLINE QUEUE — IndexedDB
// ──────────────────────────────────────────────────────────────
class OfflineQueue {
    #db = null;
    static DB_NAME = 'chat-offline-queue';
    static STORE   = 'messages';
    static VERSION = 1;

    async init() {
        return new Promise((resolve) => {
            const req = indexedDB.open(OfflineQueue.DB_NAME, OfflineQueue.VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(OfflineQueue.STORE)) {
                    const store = db.createObjectStore(OfflineQueue.STORE, { keyPath: 'tempId' });
                    store.createIndex('ts', 'ts', { unique: false });
                }
            };
            req.onsuccess = e => { this.#db = e.target.result; resolve(); };
            req.onerror   = () => resolve();
        });
    }

    async push(item) {
        if (!this.#db) return;
        return new Promise(resolve => {
            const tx = this.#db.transaction(OfflineQueue.STORE, 'readwrite');
            tx.objectStore(OfflineQueue.STORE).put({ ...item, ts: Date.now() });
            tx.oncomplete = resolve;
        });
    }

    async getAll() {
        if (!this.#db) return [];
        return new Promise(resolve => {
            const tx  = this.#db.transaction(OfflineQueue.STORE, 'readonly');
            const req = tx.objectStore(OfflineQueue.STORE).index('ts').getAll();
            req.onsuccess = e => resolve(e.target.result || []);
            req.onerror   = () => resolve([]);
        });
    }

    async remove(tempId) {
        if (!this.#db) return;
        return new Promise(resolve => {
            const tx = this.#db.transaction(OfflineQueue.STORE, 'readwrite');
            tx.objectStore(OfflineQueue.STORE).delete(tempId);
            tx.oncomplete = resolve;
        });
    }
}

// ──────────────────────────────────────────────────────────────
// 🌐 CONNECTION MONITOR
// ──────────────────────────────────────────────────────────────
class ConnectionMonitor {
    #onOnline  = null;
    #onOffline = null;
    #banner    = null;
    #hideTimer = null;

    constructor({ onOnline, onOffline }) {
        this.#onOnline  = onOnline;
        this.#onOffline = onOffline;
        this.#banner    = document.getElementById('connectionBanner');
        window.addEventListener('online',  () => this.#handleOnline());
        window.addEventListener('offline', () => this.#handleOffline());
        if (!navigator.onLine) this.#handleOffline();
    }

    #handleOnline() {
        this.#showBanner('online');
        clearTimeout(this.#hideTimer);
        this.#onOnline?.();
        this.#hideTimer = setTimeout(() => this.#hideBanner(), 3000);
    }

    #handleOffline() {
        this.#showBanner('offline');
        this.#onOffline?.();
    }

    #showBanner(state) {
        if (!this.#banner) return;
        this.#banner.dataset.state = state;
        this.#banner.textContent   = state === 'offline'
            ? '🔴 Sem conexão — mensagens serão enviadas ao reconectar'
            : '🟢 Reconectado!';
        this.#banner.classList.remove('conn-banner--hidden');
    }

    #hideBanner() { this.#banner?.classList.add('conn-banner--hidden'); }

    get isOnline() { return navigator.onLine; }
}

// ──────────────────────────────────────────────────────────────
// ⌨️ TYPING MANAGER
// ──────────────────────────────────────────────────────────────
class TypingManager {
    #db;
    #uid;
    #debounceTimer = null;
    static EXPIRE_MS = 5000;

    constructor(db, uid) { this.#db = db; this.#uid = uid; }

    onKeyDown(chatType, peerUid = null) {
        clearTimeout(this.#debounceTimer);
        this.#write(chatType, peerUid, true);
        this.#debounceTimer = setTimeout(() => this.#write(chatType, peerUid, false), 3000);
    }

    clear(chatType, peerUid = null) {
        clearTimeout(this.#debounceTimer);
        this.#write(chatType, peerUid, false);
    }

    #write(chatType, peerUid, isTyping) {
        if (!this.#uid) return;
        const payload = {};
        if (chatType === 'group') {
            payload.typingGroup = isTyping ? Date.now() : null;
        } else if (peerUid) {
            payload[`typingTo_${peerUid}`] = isTyping ? Date.now() : null;
        }
        updateDoc(doc(this.#db, 'users', this.#uid), payload).catch(() => {});
    }

    isTyping(userData, chatType, myUid, peerUid = null) {
        const now = Date.now();
        if (chatType === 'group') {
            const ts = userData.typingGroup;
            return !!(ts && (now - ts) < TypingManager.EXPIRE_MS);
        } else if (peerUid) {
            const ts = userData[`typingTo_${myUid}`];
            return !!(ts && (now - ts) < TypingManager.EXPIRE_MS);
        }
        return false;
    }
}

// ──────────────────────────────────────────────────────────────
// 👁 PRESENCE MANAGER
// ──────────────────────────────────────────────────────────────
class PresenceManager {
    #db;
    #uid = null;
    #heartbeatTimer = null;
    static HEARTBEAT_MS = 30_000;

    constructor(db) { this.#db = db; }

    start(uid) {
        if (this.#uid === uid) return;     // ja iniciado para este usuario — previne loop
        if (this.#uid) this.stop();        // limpa sessao anterior
        this.#uid = uid;
        this.#setOnline(true);
        this.#heartbeatTimer = setInterval(() => this.#heartbeat(), PresenceManager.HEARTBEAT_MS);
        window.addEventListener('beforeunload',       () => this.#setOnline(false));
        document.addEventListener('visibilitychange', () => this.#setOnline(!document.hidden));
    }

    stop() {
        this.#setOnline(false);
        clearInterval(this.#heartbeatTimer);
        this.#uid = null;
    }

    #heartbeat() {
        if (!this.#uid || document.hidden) return;
        updateDoc(doc(this.#db, 'users', this.#uid), { lastSeen: serverTimestamp() }).catch(() => {});
    }

    #setOnline(online) {
        if (!this.#uid) return;
        updateDoc(doc(this.#db, 'users', this.#uid), { online, lastSeen: serverTimestamp() }).catch(() => {});
    }
}

// ──────────────────────────────────────────────────────────────
// � MESSAGE RATE LIMITER — token bucket (anti-flood)
// 5 tokens; recarrega 1 a cada 500ms (≈ 2/s sustentado)
// ──────────────────────────────────────────────────────────────
class MessageRateLimiter {
    static #CAPACITY    = 5;
    static #REFILL_MS   = 500; // +1 token a cada 500ms

    #tokens = MessageRateLimiter.#CAPACITY;
    #timer  = null;

    constructor() {
        this.#timer = setInterval(() => {
            if (this.#tokens < MessageRateLimiter.#CAPACITY) this.#tokens++;
        }, MessageRateLimiter.#REFILL_MS);
    }

    /** Retorna true se pode enviar, false se throttled. */
    consume() {
        if (this.#tokens > 0) { this.#tokens--; return true; }
        return false;
    }

    destroy() { clearInterval(this.#timer); }
}

// ──────────────────────────────────────────────────────────────
// 🗄️ DECRYPT CACHE — LRU de 20 entradas para blobUrls decifrados
// Evita re-fetch + re-decrypt ao reabrir o lightbox para a mesma mídia
// ──────────────────────────────────────────────────────────────
class DecryptCache {
    static #CAP = 20;

    #cache = new Map(); // url → { blobUrl, ts }

    async getOrDecrypt(url, keyB64, ivB64) {
        if (this.#cache.has(url)) {
            const entry = this.#cache.get(url);
            entry.ts = Date.now(); // atualiza timestamp (LRU touch)
            return entry.blobUrl;
        }
        const blobUrl = await MediaUploader.decryptMedia(url, keyB64, ivB64);
        this.#insert(url, blobUrl);
        return blobUrl;
    }

    #insert(url, blobUrl) {
        if (this.#cache.size >= DecryptCache.#CAP) {
            // Evicta o menos recentemente usado
            let lruKey = null;
            let lruTs  = Infinity;
            for (const [k, v] of this.#cache) {
                if (v.ts < lruTs) { lruTs = v.ts; lruKey = k; }
            }
            if (lruKey) {
                URL.revokeObjectURL(this.#cache.get(lruKey).blobUrl);
                this.#cache.delete(lruKey);
            }
        }
        this.#cache.set(url, { blobUrl, ts: Date.now() });
    }

    clear() {
        this.#cache.forEach(v => URL.revokeObjectURL(v.blobUrl));
        this.#cache.clear();
    }
}

// Instância singleton do cache de descriptografia (compartilhada entre FileMessageRenderer e ChatApp)
const _decryptCache = new DecryptCache();

// ──────────────────────────────────────────────────────────────
// �💬 CHAT APP
// ──────────────────────────────────────────────────────────────
class ChatApp {
    // Firebase
    #app; #auth; #db; #storage; #messaging = null;
    #googleProvider;
    #currentUser = null;

    // Listeners Firestore
    #unsubGrpMsgs  = null;
    #unsubPrivMsgs = null;
    #unsubUserDoc  = null;
    #unsubOnline   = null;
    #unsubUsers    = null;
    #unsubInbox    = null;
    #unsubCallIn   = null;
    #unsubCallOut  = null;

    // Estado do chat
    #chatInitialized    = false;
    #privatePeer        = null;
    #pendingVerifyEmail = null;

    // Optimistic UI
    #pendingMessages = new Map(); // tempId → {text, uid, colPath, resolved}
    #confirmedIds    = new Set(); // docIds já confirmados (evita duplos)

    // Paginação
    #grpOldestDoc  = null;
    #privOldestDoc = null;

    // Mapa de cards de usuário (update incremental)
    #userCardMap = new Map();
    // Dados brutos dos usuários (para read receipts e typing)
    #userDataMap = new Map();

    // Áudio
    #audio       = new Audio('./notification.mp3');
    #audioIn     = new Audio('./ring-chat.mp3');
    #remoteAudio = new Audio();
    #ringTone    = new Audio('./ring-chat.mp3');

    // Ring de chamada recebida
    #ringVibrateTimer = null;

    // Gravação de voz
    #mediaRecorder = null;
    #audioChunks   = [];
    #isRecording   = false;

    // WebRTC — 1:1
    #peerConn    = null;
    #localStream = null;
    #callDocId   = null;

    // Chamada em grupo
    #groupCall        = null;
    #unsubGroupCallIn = null;
    #isAdmin          = false;

    // E2E encryption + P2P DataChannel
    #e2e                = null;
    #p2pChannel         = null;
    #p2pReceivedIds     = new Set();
    #groupKeyHolders    = new Set();
    #unsubGroupKeyStore = null;

    // Media / Emoji
    #mediaUploader     = null;
    #emojiPicker       = null;
    #pendingUploadTask = null;  // MediaUploader ativo (para cancel)
    #pendingBlobUrls   = [];    // Blob URLs de preview a revogar no cleanup

    // Timers
    #tokenRenewalTimer = null;
    #currentFcmToken   = null;
    #pendingNavigation = null; // navegação pendente ao abrir app via clique de notificação

    // Serviços
    #latency  = new PerfLogger();
    #offlineQ = new OfflineQueue();
    #connMon  = null;
    #typing   = null;
    #presence = null;
    #rateLimiter = new MessageRateLimiter();

    // Índice secundário tempId → entry (O(1) lookup no snapshot handler)
    #pendingByTempId = new Map();

    // rAF de scroll pendente
    #_scrollRafId = null;

    static #STUN  = { iceServers: [
        { urls: 'stun:stun.l.google.com:19302'  },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' }
    ]};
    static #PAGE  = 50;

    constructor() {
        this.#app            = initializeApp(FIREBASE_CONFIG);
        this.#auth           = getAuth(this.#app);
        this.#db             = getFirestore(this.#app);
        this.#storage        = getStorage(this.#app);
        this.#googleProvider = new GoogleAuthProvider();
        this.#auth.languageCode = 'pt-BR';
        // Mantém sessão no IndexedDB — persiste após fechar/reabrir o browser
        setPersistence(this.#auth, browserLocalPersistence).catch(() => {});

        this.#presence = new PresenceManager(this.#db);

        this.#offlineQ.init().then(() => {
            if (navigator.onLine) this.#drainOfflineQueue();
        });

        this.#connMon = new ConnectionMonitor({
            onOnline:  () => this.#drainOfflineQueue(),
            onOffline: () => {}
        });

        this.#syncHeaderHeight();
        this.#bindUI();
        this.#watchAuth();
    }

    // ── Util ──────────────────────────────────────────────
    #syncHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        let debounce = null;
        const update = () => document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
        update();
        new ResizeObserver(() => {
            clearTimeout(debounce);
            debounce = setTimeout(update, 50);
        }).observe(header);
    }

    #esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    #scrollBottom(el) {
        if (!el) return;
        // Só rola se o usuário já estava perto do fundo (não interrompe leitura de msgs antigas)
        const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        if (!nearBottom) return;
        cancelAnimationFrame(this.#_scrollRafId);
        this.#_scrollRafId = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }

    #showError(msg) {
        const el = document.getElementById('chatAuthError');
        if (!el) return;
        el.textContent = msg;
        el.classList.remove('chat-auth-error--hidden');
    }

    #clearError() {
        const el = document.getElementById('chatAuthError');
        if (!el) return;
        el.textContent = '';
        el.classList.add('chat-auth-error--hidden');
    }

    #translateError(e) {
        const map = {
            'auth/invalid-email':             'Email inválido.',
            'auth/popup-closed-by-user':      'Login cancelado.',
            'auth/network-request-failed':    'Sem conexão. Verifique sua internet.',
            'auth/too-many-requests':         'Muitas tentativas. Aguarde um momento.',
            'auth/invalid-action-code':       'Link expirado ou já usado. Solicite um novo.',
            'auth/expired-action-code':       'Link expirado. Solicite um novo.',
            'auth/unauthorized-continue-uri': 'Domínio não autorizado no Firebase.',
            'auth/wrong-password':            'Senha incorreta.',
            'auth/invalid-credential':        'Email ou senha incorretos.',
            'auth/user-not-found':            'Nenhuma conta encontrada com este email.',
            'auth/email-already-in-use':      'Este email já possui uma conta. Faça login.',
            'auth/weak-password':             'Senha muito fraca. Use no mínimo 6 caracteres.',
            'auth/user-disabled':             'Esta conta foi desativada.'
        };
        return map[e.code] || 'Erro: ' + e.message;
    }

    #getDisplayName() {
        const el = document.getElementById('chatWelcomeText');
        return (el?.textContent || '').replace('Olá Milionário ', '').trim() || 'Usuário';
    }

    // ── Auth ──────────────────────────────────────────────
    #watchAuth() {
        onAuthStateChanged(this.#auth, u => this.#handleAuthChange(u));
    }

    async #handleAuthChange(user) {
        this.#cleanup();
        if (!user) {
            if (this.#pendingVerifyEmail) {
                const e = this.#pendingVerifyEmail;
                this.#pendingVerifyEmail = null;
                this.#showPanel('login');
                this.#showVerifyScreen(e);
            } else {
                this.#showPanel('login');
            }
            return;
        }
        const isPasswordOnly = user.providerData.every(p => p.providerId === 'password');
        if (!user.emailVerified && isPasswordOnly) {
            this.#pendingVerifyEmail = user.email;
            await signOut(this.#auth);
            return;
        }
        this.#currentUser = user;
        this.#typing      = new TypingManager(this.#db, user.uid);

        try {
            const userRef = doc(this.#db, 'users', user.uid);
            const snap    = await getDoc(userRef);
            if (!snap.exists()) {
                await setDoc(userRef, {
                    name: user.displayName || user.email.split('@')[0],
                    email: user.email, photoURL: user.photoURL || '',
                    approved: true, online: false, lastSeen: serverTimestamp()
                });
            } else if (!snap.data().approved) {
                await updateDoc(userRef, { approved: true });
            }
            this.#unsubUserDoc = onSnapshot(userRef, d => {
                if (!d.exists()) return;
                const data = d.data();
                if (data.approved) this.#enterChat(data);
                else this.#showPanel('pending');
            }, e => this.#showError('Erro de conexão: ' + this.#translateError(e)));
        } catch (e) {
            this.#showError('Erro ao entrar: ' + this.#translateError(e));
        }
    }

    async #enterChat(userData) {
        this.#showPanel('chat');
        const name = userData.name || this.#currentUser.displayName || 'Usuário';
        const el   = document.getElementById('chatWelcomeText');
        if (el) el.textContent = 'Olá Milionário ' + name;
        this.#updateAvatarUI(userData.photoURL || '');
        // Guard: presence.start() escreve no Firestore → dispara onSnapshot(userRef)
        // → #enterChat chamado novamente → loop infinito → cascade 400 no WebChannel
        if (this.#chatInitialized) return;
        this.#chatInitialized = true;
        await this.#initE2E();
        this.#presence.start(this.#currentUser.uid);
        this.#subscribeOnline();
        this.#subscribeUsers();
        this.#subscribeInbox();
        this.#isAdmin = userData.role === 'admin';
        this.#listenForIncomingCalls();
        this.#listenForGroupCall();
        // initFCM aqui garante que o token seja salvo com o uid correto do usuário
        this.#initFCM();
        // Consome navegação pendente de clique em push (app estava fechado)
        if (this.#pendingNavigation) {
            const nav = this.#pendingNavigation;
            this.#pendingNavigation = null;
            // Delay para #subscribeUsers popular #userDataMap antes de navegar
            setTimeout(() => this.#navigateToChat(nav.chatType, nav.senderId, nav.senderName), 800);
        }
    }

    async #loginWithPassword() {
        const email = document.getElementById('loginEmail')?.value.trim();
        const pass  = document.getElementById('loginPassword')?.value;
        if (!email || !pass) { this.#showError('Preencha email e senha.'); return; }
        try {
            this.#clearError();
            const cred = await signInWithEmailAndPassword(this.#auth, email, pass);
            if (!cred.user.emailVerified) {
                await signOut(this.#auth);
                this.#showError('Confirme seu email antes de entrar. Verifique sua caixa de entrada.');
            }
        } catch (e) { this.#showError(this.#translateError(e)); }
    }

    async #registerWithPassword() {
        const name    = document.getElementById('cadastroName')?.value.trim();
        const email   = document.getElementById('cadastroEmail')?.value.trim();
        const pass    = document.getElementById('cadastroPassword')?.value;
        const confirm = document.getElementById('cadastroConfirm')?.value;
        if (!name)                    { this.#showError('Digite seu nome.'); return; }
        if (!email)                   { this.#showError('Digite seu email.'); return; }
        if (!pass || pass.length < 6) { this.#showError('Senha deve ter no mínimo 6 caracteres.'); return; }
        if (pass !== confirm)         { this.#showError('As senhas não coincidem.'); return; }
        try {
            this.#clearError();
            const cred = await createUserWithEmailAndPassword(this.#auth, email, pass);
            await updateProfile(cred.user, { displayName: name });
            await sendEmailVerification(cred.user, {
                url: 'https://delima20k.github.io/milionarios-da-leograf0.1.2/',
                handleCodeInApp: false
            });
        } catch (e) { this.#showError(this.#translateError(e)); }
    }

    async #loginGoogle() {
        try { this.#clearError(); await signInWithPopup(this.#auth, this.#googleProvider); }
        catch (e) { this.#showError(this.#translateError(e)); }
    }

    async #logout() { this.#presence.stop(); await this.#deleteFCMToken(); await signOut(this.#auth); }

    // ── Avatar ────────────────────────────────────────────
    #updateAvatarUI(photoURL) {
        const avatar   = document.getElementById('chatAvatar');
        const initials = document.getElementById('chatAvatarInitials');
        const welcome  = document.getElementById('chatWelcomeText');
        const letter   = (welcome?.textContent || 'U').replace('Olá Milionário ', '')[0]?.toUpperCase() || 'U';
        if (photoURL) {
            avatar.src = photoURL; avatar.style.display = 'block'; initials.style.display = 'none';
        } else {
            avatar.style.display = 'none'; initials.textContent = letter; initials.style.display = 'flex';
        }
    }

    async #uploadAvatar(file) {
        if (!this.#currentUser || !file) return;
        const btn = document.getElementById('btnAvatarUpload');
        if (btn) btn.disabled = true;
        try {
            const storageRef = ref(this.#storage, 'avatars/' + this.#currentUser.uid);
            const snap       = await uploadBytes(storageRef, file);
            const url        = await getDownloadURL(snap.ref);
            await updateProfile(this.#currentUser, { photoURL: url });
            await updateDoc(doc(this.#db, 'users', this.#currentUser.uid), { photoURL: url });
            this.#updateAvatarUI(url);
        } catch { alert('Erro ao enviar foto. Verifique se o Firebase Storage está ativo.'); }
        finally { if (btn) btn.disabled = false; }
    }

    // ── UI Panels ─────────────────────────────────────────
    #showPanel(name) {
        const map = { login: 'chatLoginScreen', pending: 'chatPendingScreen', chat: 'chatScreen' };
        Object.values(map).forEach(id => document.getElementById(id)?.classList.add('chat-panel--hidden'));
        if (map[name]) document.getElementById(map[name])?.classList.remove('chat-panel--hidden');
        if (name === 'login') this.#switchTab('login');
        this.#clearError();
    }

    #switchTab(tab) {
        document.querySelectorAll('.chat-tab-panel').forEach(p => p.classList.add('chat-tab-panel--hidden'));
        document.getElementById(tab === 'login' ? 'tabLogin' : 'tabCadastro')?.classList.remove('chat-tab-panel--hidden');
        document.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('chat-tab--active'));
        document.getElementById(tab === 'login' ? 'tabBtnLogin' : 'tabBtnCadastro')?.classList.add('chat-tab--active');
        this.#clearError();
    }

    #showVerifyScreen(email) {
        document.querySelectorAll('.chat-tab-panel').forEach(p => p.classList.add('chat-tab-panel--hidden'));
        document.getElementById('tabVerifyEmail')?.classList.remove('chat-tab-panel--hidden');
        document.querySelectorAll('.chat-tab').forEach(b => b.classList.remove('chat-tab--active'));
        const el = document.getElementById('verifyEmailAddr');
        if (el) el.textContent = email;
    }

    // ── Chat Navigation ───────────────────────────────────
    #openGroupChat() {
        document.getElementById('chatHome')?.classList.add('chat-home--hidden');
        document.getElementById('chatPrivatePanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatGroupPanel')?.classList.remove('chat-conversation--hidden');
        document.getElementById('chatGroupMessages').innerHTML = '';
        this.#grpOldestDoc = null;
        this.#unsubGrpMsgs?.(); this.#unsubGrpMsgs = null;
        this.#subscribeGroupMessages();
    }

    #openPrivateChat(peer) {
        this.#privatePeer = peer;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        document.getElementById('chatHome')?.classList.add('chat-home--hidden');
        document.getElementById('chatGroupPanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatPrivatePanel')?.classList.remove('chat-conversation--hidden');
        const t = document.getElementById('chatPrivateTitle');
        if (t) t.textContent = '💬 ' + peer.name;
        document.getElementById('chatPrivateMessages').innerHTML = '';
        this.#privOldestDoc = null;
        this.#subscribePrivateMessages(peer.uid);
        this.#clearInboxBadge(peer.uid);
        // Sinaliza ao remetente que estou visualizando este chat (read receipt)
        if (this.#currentUser) {
            updateDoc(doc(this.#db, 'users', this.#currentUser.uid), {
                viewingChat: peer.uid
            }).catch(() => {});
        }
        // Aplica read receipt imediatamente se peer já tem o chat aberto conosco
        const peerData = this.#userDataMap.get(peer.uid);
        if (peerData) {
            const msgs = document.getElementById('chatPrivateMessages');
            if (peerData.viewingChat === this.#currentUser?.uid) {
                setTimeout(() => this.#markAllOwnMsgsAs(msgs, 'read'), 150);
            } else if (peerData.online) {
                setTimeout(() => this.#markAllOwnMsgsAs(msgs, 'delivered'), 150);
            }
        }

        // Estabelecer canal P2P direto (WebRTC DataChannel) para entrega instantânea
        this.#p2pChannel?.close();
        this.#p2pChannel    = null;
        this.#p2pReceivedIds.clear();
        if (this.#currentUser) {
            const chatId = [this.#currentUser.uid, peer.uid].sort().join('_');
            this.#p2pChannel = new P2PChannel(this.#db, this.#currentUser.uid, peer.uid, chatId, {
                onMessage:     raw   => this.#handleP2PMessage(raw),
                onStateChange: state => console.info('[P2P] Canal:', state)
            });
            this.#p2pChannel.connect().catch(e => console.warn('[P2P] Falha na conexão:', e.message));
        }
    }

    #backToHome() {
        this.#unsubGrpMsgs?.();  this.#unsubGrpMsgs  = null;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        if (this.#currentUser && this.#privatePeer) {
            updateDoc(doc(this.#db, 'users', this.#currentUser.uid), { viewingChat: '' }).catch(() => {});
        }
        this.#privatePeer = null;
        this.#p2pChannel?.close();
        this.#p2pChannel = null;
        this.#p2pReceivedIds.clear();
        this.#typing?.clear('group');
        this.#updateTypingBar('group',   []);
        this.#updateTypingBar('private', []);
        document.getElementById('chatGroupPanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatPrivatePanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatHome')?.classList.remove('chat-home--hidden');
    }

    // ── Group Messages ────────────────────────────────────
    #subscribeGroupMessages() {
        // orderBy desc → janela sempre inclui as msgs mais recentes (fix real-time)
        const q    = query(collection(this.#db, 'messages'), orderBy('createdAt', 'desc'), limit(ChatApp.#PAGE));
        const msgs = document.getElementById('chatGroupMessages');
        let first  = true;
        this.#unsubGrpMsgs = onSnapshot(q, snap => {
            const changes = snap.docChanges();
            let hasNew = false;

            // Primeiro snapshot chega em desc → inverter para renderizar na ordem cronológica
            const batch = first ? [...changes].reverse() : changes;

            batch.forEach(c => {
                if (c.type === 'added') {
                    if (this.#confirmedIds.has(c.doc.id)) return;
                    const notify = !first;
                    this.#decryptMsg(c.doc.data(), 'group').then(data => {
                        const entry = this.#pendingByTempId.get(data.tempId);
                        if (entry && !entry.resolved) {
                            this.#confirmPendingMessage(entry.tempId, c.doc.id);
                            entry.resolved = true;
                        } else {
                            this.#renderMsg(msgs, c.doc.id, data, notify, 'group');
                        }
                        this.#pruneConfirmedIds();
                    });
                    if (!this.#grpOldestDoc) this.#grpOldestDoc = c.doc;
                    hasNew = true;
                }
                if (c.type === 'removed') document.getElementById('msg-' + c.doc.id)?.remove();
            });

            if (first) { first = false; this.#renderLoadMoreBtn(msgs, 'group'); }
            if (hasNew) this.#scrollBottom(msgs);
        }, e => console.error('[Chat] Erro no listener de grupo:', e.message));
    }

    async #sendGroupMessage() {
        const input = document.getElementById('chatGroupInput');
        const text  = input?.value.trim();
        if (!text || !this.#currentUser) return;
        if (text.length > 2000) { alert('Mensagem muito longa. Máximo 2000 caracteres.'); return; }
        if (!this.#rateLimiter.consume()) {
            input.disabled = true;
            setTimeout(() => { input.disabled = false; input.focus(); }, 1000);
            return;
        }

        input.value = ''; input.style.height = 'auto';
        document.getElementById('micWrapGroup')?.classList.remove('mic-wrap--hidden');
        document.getElementById('btnSendGroup')?.classList.add('btn-send--hidden');
        this.#typing?.clear('group');

        // Cifrar texto (E2E) antes de criar o tempId
        const enc = this.#e2e?.hasGroupKey
            ? await this.#e2e.encryptWithGroupKey(text).catch(() => null)
            : null;

        const tempId  = 'tmp-' + crypto.randomUUID();
        const msgData = {
            uid: this.#currentUser.uid, name: this.#getDisplayName(),
            photoURL: this.#currentUser.photoURL || '', text, createdAt: null, status: 'sending'
        };

        // Optimistic UI — aparece instantaneamente
        const msgs = document.getElementById('chatGroupMessages');
        this.#latency.markSend(tempId);
        this.#renderOptimisticMsg(msgs, tempId, msgData);
        this.#latency.markRendered(tempId);
        const entry = { tempId, text, uid: this.#currentUser.uid, colPath: 'messages', resolved: false };
        this.#pendingMessages.set(tempId, entry);
        this.#pendingByTempId.set(tempId, entry);

        if (!this.#connMon.isOnline) {
            await this.#offlineQ.push({ tempId, colPath: 'messages', msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text: enc ? null : text, enc, tempId } });
            this.#markMsgStatus(tempId, 'offline');
            return;
        }

        const sendMs = Date.now();
        try {
            const docRef = await addDoc(collection(this.#db, 'messages'), {
                uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL,
                text: enc ? null : text, enc, tempId, createdAt: serverTimestamp()
            });
            this.#confirmedIds.add(docRef.id);
            this.#latency.markConfirmed(tempId, docRef.id, Date.now() - sendMs);
            this.#confirmPendingMessage(tempId, docRef.id);
        } catch (e) {
            console.error('[Chat] Erro ao enviar:', e);
            this.#markMsgStatus(tempId, 'failed');
            await this.#offlineQ.push({ tempId, colPath: 'messages', msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text } });
        }
    }

    // ── Private Messages ──────────────────────────────────
    #subscribePrivateMessages(peerUid) {
        const chatId  = [this.#currentUser.uid, peerUid].sort().join('_');
        const colPath = 'privateChats/' + chatId + '/messages';
        // orderBy desc → janela sempre inclui as msgs mais recentes (fix real-time)
        const q       = query(collection(this.#db, colPath), orderBy('createdAt', 'desc'), limit(ChatApp.#PAGE));
        const msgs    = document.getElementById('chatPrivateMessages');
        let first     = true;
        this.#unsubPrivMsgs = onSnapshot(q, snap => {
            let hasNew = false;
            // Primeiro snapshot chega em desc → inverter para renderizar na ordem cronológica
            const batch = first ? [...snap.docChanges()].reverse() : snap.docChanges();
            batch.forEach(c => {
                if (c.type === 'added') {
                    const fid     = 'priv-' + c.doc.id;
                    const rawData = c.doc.data();
                    if (this.#confirmedIds.has(fid)) return;
                    // Mensagem já entregue via P2P DataChannel: só atualiza o ID do elemento
                    if (rawData.tempId && this.#p2pReceivedIds.has(rawData.tempId)) {
                        this.#p2pReceivedIds.delete(rawData.tempId);
                        const p2pEl = document.getElementById('msg-p2p-' + rawData.tempId);
                        if (p2pEl) p2pEl.id = 'msg-' + fid;
                        if (!this.#privOldestDoc) this.#privOldestDoc = c.doc;
                        return;
                    }
                    const notify = !first;
                    this.#decryptMsg(rawData, 'private').then(data => {
                        const entry = this.#pendingByTempId.get(data.tempId);
                        if (entry && !entry.resolved) {
                            this.#confirmPendingMessage(entry.tempId, fid);
                            entry.resolved = true;
                        } else {
                            this.#renderMsg(msgs, fid, data, notify, 'private');
                        }
                        this.#pruneConfirmedIds();
                        this.#pruneP2PReceivedIds();
                    });
                    if (!this.#privOldestDoc) this.#privOldestDoc = c.doc;
                    hasNew = true;
                }
                if (c.type === 'removed') document.getElementById('msg-priv-' + c.doc.id)?.remove();
            });
            if (first) { first = false; this.#renderLoadMoreBtn(msgs, 'private'); }
            if (hasNew) this.#scrollBottom(msgs);
        }, e => console.error('[Chat] Erro no listener privado:', e.message));
    }


    async #sendPrivateMessage() {
        if (!this.#privatePeer || !this.#currentUser) return;
        const input = document.getElementById('chatPrivateInput');
        const text  = input?.value.trim();
        if (!text) return;
        if (text.length > 2000) { alert('Mensagem muito longa. Máximo 2000 caracteres.'); return; }
        if (!this.#rateLimiter.consume()) {
            input.disabled = true;
            setTimeout(() => { input.disabled = false; input.focus(); }, 1000);
            return;
        }

        input.value = ''; input.style.height = 'auto';
        document.getElementById('micWrapPrivate')?.classList.remove('mic-wrap--hidden');
        document.getElementById('btnSendPrivate')?.classList.add('btn-send--hidden');
        this.#typing?.clear('private', this.#privatePeer.uid);

        // Cifrar texto (E2E) antes de criar o tempId
        const peerPub = this.#userDataMap.get(this.#privatePeer.uid)?.publicKey;
        const enc = (this.#e2e && peerPub)
            ? await this.#e2e.encryptForPeer(text, peerPub).catch(() => null)
            : null;

        const chatId  = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
        const colPath = 'privateChats/' + chatId + '/messages';
        const tempId  = 'tmp-' + crypto.randomUUID();
        const msgData = {
            uid: this.#currentUser.uid, name: this.#getDisplayName(),
            photoURL: this.#currentUser.photoURL || '', text,
            receiverUid: this.#privatePeer.uid, createdAt: null, status: 'sending'
        };

        const msgs = document.getElementById('chatPrivateMessages');
        this.#latency.markSend(tempId);
        this.#renderOptimisticMsg(msgs, tempId, msgData);
        this.#latency.markRendered(tempId);
        const privEntry = { tempId, text, uid: this.#currentUser.uid, colPath, resolved: false };
        this.#pendingMessages.set(tempId, privEntry);
        this.#pendingByTempId.set(tempId, privEntry);

        if (!this.#connMon.isOnline) {
            await this.#offlineQ.push({ tempId, colPath, msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text: enc ? null : text, enc, tempId, receiverUid: msgData.receiverUid } });
            this.#markMsgStatus(tempId, 'offline');
            return;
        }

        // Entrega P2P via DataChannel (quando canal estiver aberto)
        if (this.#p2pChannel?.isOpen && enc) {
            this.#p2pChannel.send(JSON.stringify({
                type: 'chat', enc, name: this.#getDisplayName(),
                photoURL: this.#currentUser.photoURL || '', tempId
            }));
        }

        const sendMs = Date.now();
        try {
            const docRef = await addDoc(collection(this.#db, colPath), {
                uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL,
                text: enc ? null : text, enc, tempId, receiverUid: msgData.receiverUid, createdAt: serverTimestamp()
            });
            this.#confirmedIds.add('priv-' + docRef.id);
            this.#latency.markConfirmed(tempId, 'priv-' + docRef.id, Date.now() - sendMs);
            this.#confirmPendingMessage(tempId, 'priv-' + docRef.id);
            // Atualiza metadado da conversa para notificar o destinatário na home
            setDoc(doc(this.#db, 'privateChats', chatId), {
                lastText:    enc ? '🔒 Mensagem cifrada' : text,
                senderUid:   this.#currentUser.uid,
                senderName:  this.#getDisplayName(),
                receiverUid: this.#privatePeer.uid,
                updatedAt:   serverTimestamp(),
                unreadFor:   this.#privatePeer.uid
            }, { merge: true }).catch(() => {});
        } catch (e) {
            console.error('[Chat] Erro ao enviar privado:', e);
            this.#markMsgStatus(tempId, 'failed');
            await this.#offlineQ.push({ tempId, colPath, msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text: enc ? null : text, enc, tempId, receiverUid: msgData.receiverUid } });
        }
    }

    // ── Optimistic UI ─────────────────────────────────────
    #renderOptimisticMsg(container, tempId, data) {
        if (!container) return;
        const el = this.#buildMsgElement(tempId, data, true, false, 'optimistic');
        container.appendChild(el);
        this.#scrollBottom(container);
    }

    #confirmPendingMessage(tempId, realId) {
        const el = document.getElementById('msg-' + tempId);
        if (el) {
            el.id = 'msg-' + realId;
            this.#markMsgStatus(realId, 'sent');
        }
        this.#pendingMessages.delete(tempId);
        this.#pendingByTempId.delete(tempId);
    }

    // Mantém confirmedIds abaixo de 500 entradas (evita crescimento ilimitado)
    #pruneConfirmedIds() {
        if (this.#confirmedIds.size <= 500) return;
        const arr     = [...this.#confirmedIds];
        const pruned  = new Set(arr.slice(arr.length - 300));
        this.#confirmedIds = pruned;
    }

    // Mantém p2pReceivedIds abaixo de 200 entradas
    #pruneP2PReceivedIds() {
        if (this.#p2pReceivedIds.size <= 200) return;
        const arr = [...this.#p2pReceivedIds];
        this.#p2pReceivedIds = new Set(arr.slice(arr.length - 100));
    }

    #markMsgStatus(id, status) {
        const el       = document.getElementById('msg-' + id);
        const statusEl = el?.querySelector('.chat-msg-status');
        if (!statusEl) return;
        const icons = { sending: '🕐', sent: '✔', delivered: '✔✔', read: '✔✔', offline: '📵', failed: '⚠️' };
        statusEl.textContent  = icons[status] || '';
        statusEl.dataset.status = status;
        statusEl.title = ({
            sending: 'Enviando...', sent: 'Enviada', delivered: 'Entregue',
            read: 'Lida', offline: 'Na fila (sem conexão)', failed: 'Falha — clique para reenviar'
        })[status] || '';
        if (status === 'failed') {
            statusEl.style.cursor = 'pointer';
            statusEl.onclick = () => this.#retryFailedMessage(id);
        }
    }

    // Atualiza todas as mensagens próprias num container para o status dado (só avança, nunca regride)
    #markAllOwnMsgsAs(container, status) {
        const ORDER = ['sending', 'sent', 'delivered', 'read'];
        container?.querySelectorAll('.chat-msg--own .chat-msg-status').forEach(el => {
            const cur = el.dataset.status || 'sent';
            if (ORDER.indexOf(status) > ORDER.indexOf(cur)) {
                const msgEl = el.closest('.chat-msg');
                if (msgEl) this.#markMsgStatus(msgEl.id.replace(/^msg-/, ''), status);
            }
        });
    }

    async #retryFailedMessage(id) {
        const queue = await this.#offlineQ.getAll();
        const item  = queue.find(q => q.tempId === id || 'msg-' + q.tempId === 'msg-' + id);
        if (!item) return;
        this.#markMsgStatus(id, 'sending');
        try {
            const docRef = await addDoc(collection(this.#db, item.colPath), { ...item.msgData, createdAt: serverTimestamp() });
            await this.#offlineQ.remove(item.tempId);
            this.#confirmedIds.add(docRef.id);
            this.#confirmPendingMessage(id, docRef.id);
        } catch { this.#markMsgStatus(id, 'failed'); }
    }

    async #drainOfflineQueue() {
        const queue = await this.#offlineQ.getAll();
        if (!queue.length) return;
        console.info(`[OfflineQueue] Reenviando ${queue.length} mensagem(s) em lotes de 5...`);
        const BATCH = 5;
        for (let i = 0; i < queue.length; i += BATCH) {
            await Promise.all(queue.slice(i, i + BATCH).map(item => this.#drainItem(item)));
            if (i + BATCH < queue.length) await new Promise(r => setTimeout(r, 200));
        }
    }

    async #drainItem(item) {
        try {
            const docRef  = await addDoc(collection(this.#db, item.colPath), { ...item.msgData, createdAt: serverTimestamp() });
            const isPriv  = item.colPath.startsWith('privateChats/');
            const fid     = isPriv ? 'priv-' + docRef.id : docRef.id;
            this.#confirmedIds.add(fid);
            const el = document.getElementById('msg-' + item.tempId);
            if (el) { el.id = 'msg-' + fid; this.#markMsgStatus(fid, 'sent'); }
            await this.#offlineQ.remove(item.tempId);
        } catch (e) { console.warn(`[OfflineQueue] Falha ${item.tempId}:`, e.message); }
    }

    // ── Load More (paginação) ─────────────────────────────
    #renderLoadMoreBtn(container, chatType) {
        container.querySelector('.chat-load-more')?.remove();
        const btn = document.createElement('button');
        btn.className   = 'chat-load-more';
        btn.textContent = '↑ Carregar mensagens anteriores';
        btn.addEventListener('click', () => this.#loadMoreMessages(chatType, container, btn));
        container.insertBefore(btn, container.firstChild);
    }

    async #loadMoreMessages(chatType, container, btn) {
        const oldestDoc = chatType === 'group' ? this.#grpOldestDoc : this.#privOldestDoc;
        if (!oldestDoc) { btn?.remove(); return; }

        let colRef;
        if (chatType === 'group') {
            colRef = collection(this.#db, 'messages');
        } else {
            const chatId = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
            colRef = collection(this.#db, 'privateChats/' + chatId + '/messages');
        }

        const q    = query(colRef, orderBy('createdAt', 'desc'), startAfter(oldestDoc), limit(ChatApp.#PAGE));
        const snap = await getDocs(q);
        if (snap.empty) { btn?.remove(); return; }

        const docs = [...snap.docs].reverse();
        const frag = document.createDocumentFragment();
        for (const d of docs) {
            const id = chatType === 'group' ? d.id : 'priv-' + d.id;
            if (!document.getElementById('msg-' + id)) {
                const data = await this.#decryptMsg(d.data(), chatType);
                const el   = this.#buildMsgElement(id, data, data.uid === this.#currentUser?.uid, false, chatType);
                frag.appendChild(el);
            }
        }

        const prevH = container.scrollHeight;
        container.insertBefore(frag, btn ? btn.nextSibling : container.firstChild);
        container.scrollTop += container.scrollHeight - prevH;

        if (chatType === 'group') this.#grpOldestDoc  = docs[0];
        else                      this.#privOldestDoc = docs[0];

        if (snap.docs.length < ChatApp.#PAGE) btn?.remove();
    }

    // ── Render ────────────────────────────────────────────
    #buildMsgElement(id, data, isOwn, notify, type) {
        const time = data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
            : '';
        const avHtml = data.photoURL
            ? `<img src="${data.photoURL}" class="chat-msg-avatar" alt="">`
            : `<div class="chat-msg-avatar chat-msg-avatar--initials">${(data.name || '?')[0].toUpperCase()}</div>`;
        const statusHtml = isOwn
            ? `<span class="chat-msg-status" data-status="${data.status || 'sent'}" title="Enviada">✔</span>`
            : '';
        const bodyHtml = (data.type === 'audio' && data.audioURL)
            ? this.#buildAudioPlayer(data.audioURL, time, isOwn)
            : (data.type === 'sticker' && data.text)
            ? (FileMessageRenderer.buildBody(data, isOwn, time, statusHtml, s => this.#esc(s)) ?? `<p class="chat-msg-text">${this.#esc(data.text || '')}</p><span class="chat-msg-time">${time}</span>${statusHtml}`)
            : (data.type && data.type !== 'audio' && data.mediaUrl)
            ? (FileMessageRenderer.buildBody(data, isOwn, time, statusHtml, s => this.#esc(s)) ?? `<p class="chat-msg-text">${this.#esc(data.text || '')}</p><span class="chat-msg-time">${time}</span>${statusHtml}`)
            : `<p class="chat-msg-text">${this.#esc(data.text || '')}</p><span class="chat-msg-time">${time}</span>${statusHtml}`;

        const el     = document.createElement('div');
        el.id        = 'msg-' + id;
        el.className = 'chat-msg ' + (isOwn ? 'chat-msg--own' : 'chat-msg--other');
        if (data.status === 'sending') el.classList.add('chat-msg--sending');

        const canDelete = (isOwn || this.#isAdmin) && type !== 'optimistic' && !id.startsWith('tmp-');
        const deleteTitle = isOwn ? 'Apagar mensagem' : '⚠️ Admin: apagar para todos';
        el.innerHTML =
            (!isOwn ? avHtml : '') +
            `<div class="chat-msg-bubble">` +
            (!isOwn ? `<span class="chat-msg-name">${this.#esc(data.name || 'Anônimo')}</span>` : '') +
            bodyHtml +
            (canDelete ? `<button class="chat-msg-delete" title="${deleteTitle}">🗑</button>` : '') +
            '</div>' +
            (isOwn ? avHtml : '');

        el.querySelector('.chat-msg-delete')?.addEventListener('click', () => {
            const realId = id.replace(/^priv-/, '').replace(/^tmp-[0-9a-f-]+$/, '');
            this.#deleteMessage(realId, type);
        });
        if (data.type === 'audio' && data.audioURL) this.#bindAudioPlayer(el);
        if (data.type && data.type !== 'audio') FileMessageRenderer.bindMediaEvents(el);
        return el;
    }

    #renderMsg(container, id, data, notify, type) {
        if (!container || document.getElementById('msg-' + id)) return;
        const isOwn = this.#currentUser && data.uid === this.#currentUser.uid;
        const el    = this.#buildMsgElement(id, data, isOwn, notify, type);
        container.appendChild(el);
        if (notify && data.uid !== this.#currentUser?.uid) this.#notificar(data.name, data.text);
    }

    // ── Audio Player ──────────────────────────────────────
    #buildAudioPlayer(audioURL, time, isOwn) {
        const BARS     = [4,7,12,18,22,26,22,18,14,10,16,20,24,20,16,12,8,14,18,22,18,14,10,8,6,4];
        const barsHtml = BARS.map((h, i) => `<div class="cap-bar" style="height:${h}px" data-idx="${i}"></div>`).join('');
        return `<div class="chat-audio-player" data-src="${audioURL}">
                <button class="cap-play-btn" title="Play">▶️</button>
                <div class="cap-waveform-wrap">
                    <div class="cap-bars">${barsHtml}<div class="cap-dot"></div></div>
                    <div class="cap-footer">
                        <span class="cap-duration">0:00</span>
                        <span class="cap-time">${time}</span>
                    </div>
                </div>
            </div>`;
    }

    #bindAudioPlayer(msgEl) {
        const player  = msgEl.querySelector('.chat-audio-player');
        if (!player)  return;
        const playBtn = player.querySelector('.cap-play-btn');
        const bars    = [...player.querySelectorAll('.cap-bar')];
        const dot     = player.querySelector('.cap-dot');
        const durEl   = player.querySelector('.cap-duration');
        const audio   = new Audio(player.dataset.src);
        let barsW     = 0;
        const fmt = s => {
            if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
            return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
        };
        audio.addEventListener('loadedmetadata', () => {
            if (isFinite(audio.duration)) durEl.textContent = fmt(audio.duration);
            barsW = bars.reduce((acc, b) => acc + b.offsetWidth + 2, 0);
        });
        audio.addEventListener('timeupdate', () => {
            if (!audio.duration) return;
            const pct    = audio.currentTime / audio.duration;
            const played = Math.floor(pct * bars.length);
            bars.forEach((b, i) => b.classList.toggle('cap-bar--played', i < played));
            if (!barsW) barsW = bars.reduce((acc, b) => acc + b.offsetWidth + 2, 0);
            dot.style.left    = Math.round(pct * barsW) + 'px';
            durEl.textContent = fmt(audio.currentTime);
        });
        audio.addEventListener('ended', () => {
            playBtn.textContent = '▶️';
            bars.forEach(b => b.classList.remove('cap-bar--played'));
            dot.style.left    = '0px';
            const dur = isFinite(audio.duration) ? audio.duration : audio.currentTime;
            durEl.textContent = fmt(dur);
        });
        playBtn.addEventListener('click', () => {
            if (audio.paused) { audio.play(); playBtn.textContent = '⏸️'; }
            else              { audio.pause(); playBtn.textContent = '▶️'; }
        });
    }

    // ── Media sending ─────────────────────────────────────
    /** Abre input de arquivo para o chat especificado. */
    #openFilePicker(chatType) {
        const input = document.getElementById('mediaFileInput');
        if (!input) return;
        input.dataset.chatType = chatType;
        input.accept = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';
        input.click();
    }

    /** Recebe o arquivo selecionado e exibe o preview bar. */
    async #handleFileSelected(file, chatType) {
        try {
            MediaUploader.validate(file);
        } catch (e) {
            alert(e.message);
            return;
        }
        const type   = MediaUploader.resolveType(file.type);
        const objUrl = URL.createObjectURL(file);
        this.#pendingBlobUrls.push(objUrl);
        this.#showPreviewBar(file, objUrl, type, chatType);
    }

    /** Mostra a barra de preview antes do envio. */
    #showPreviewBar(file, objUrl, type, chatType) {
        const barId = chatType === 'group' ? 'filePreviewGroup' : 'filePreviewPrivate';
        const bar   = document.getElementById(barId);
        if (!bar) return;

        const isImg  = type === 'image' || type === 'gif';
        const isVid  = type === 'video';
        const thumb  = isImg ? `<img src="${objUrl}" class="preview-thumb" alt="">` :
                       isVid ? `<video src="${objUrl}" class="preview-thumb" muted></video>` :
                               `<span class="preview-icon">${FileMessageRenderer['_docIcon_'](file.name)}</span>`;

        bar.innerHTML = `
          <div class="preview-content">
            ${thumb}
            <div class="preview-info">
              <span class="preview-name">${this.#esc(file.name)}</span>
              <span class="preview-size">${this.#fmtSize(file.size)}</span>
              <div class="preview-progress" id="previewProgress${chatType}" style="display:none">
                <div class="preview-progress-bar" id="previewProgressBar${chatType}"></div>
                <span class="preview-pct" id="previewPct${chatType}">0%</span>
              </div>
            </div>
          </div>
          <div class="preview-actions">
            <button class="preview-btn preview-btn--send" id="sendPreview${chatType.charAt(0).toUpperCase()+chatType.slice(1)}" title="Enviar">✔ Enviar</button>
            <button class="preview-btn preview-btn--cancel" id="cancelPreview${chatType.charAt(0).toUpperCase()+chatType.slice(1)}" title="Cancelar">✕</button>
          </div>`;

        bar.dataset.pendingUrl  = objUrl;
        bar.dataset.pendingName = file.name;
        bar.dataset.pendingSize = file.size;
        bar.dataset.pendingMime = file.type;
        bar.dataset.pendingType = type;
        bar.__pendingFile       = file; // File reference para upload
        bar.classList.remove('file-preview-bar--hidden');

        // Re-bind dos botões (foram recriados)
        bar.querySelector(`#sendPreview${chatType.charAt(0).toUpperCase()+chatType.slice(1)}`)
            ?.addEventListener('click', () => this.#confirmSendPreview(chatType));
        bar.querySelector(`#cancelPreview${chatType.charAt(0).toUpperCase()+chatType.slice(1)}`)
            ?.addEventListener('click', () => this.#cancelPreview(chatType));
    }

    /** Cancela preview e revoga o Blob URL associado. */
    #cancelPreview(chatType) {
        const bar = document.getElementById(chatType === 'group' ? 'filePreviewGroup' : 'filePreviewPrivate');
        if (!bar) return;
        const url = bar.dataset.pendingUrl;
        if (url) {
            URL.revokeObjectURL(url);
            this.#pendingBlobUrls = this.#pendingBlobUrls.filter(u => u !== url);
        }
        bar.__pendingFile = null;
        bar.innerHTML = '';
        bar.classList.add('file-preview-bar--hidden');
        this.#pendingUploadTask?.cancel();
        this.#pendingUploadTask = null;
    }

    /** Inicia o upload e envia a mensagem de mídia após conclusão. */
    async #confirmSendPreview(chatType) {
        const bar  = document.getElementById(chatType === 'group' ? 'filePreviewGroup' : 'filePreviewPrivate');
        if (!bar || !bar.__pendingFile || !this.#mediaUploader) return;
        const file = bar.__pendingFile;

        // Exibe barra de progresso
        const progWrap = bar.querySelector(`#previewProgress${chatType}`);
        const progBar  = bar.querySelector(`#previewProgressBar${chatType}`);
        const pctEl    = bar.querySelector(`#previewPct${chatType}`);
        if (progWrap) progWrap.style.display = 'flex';

        // Desabilita botões durante upload
        bar.querySelectorAll('.preview-btn--send').forEach(b => { b.disabled = true; b.textContent = '⏳'; });

        this.#pendingUploadTask = this.#mediaUploader;
        let result;
        try {
            result = await this.#mediaUploader.upload(file, pct => {
                if (progBar) progBar.style.width = pct + '%';
                if (pctEl)   pctEl.textContent   = pct + '%';
            });
        } catch (e) {
            if (e.code !== 'storage/canceled') alert('Erro ao enviar arquivo: ' + (e.message || ''));
            bar.querySelectorAll('.preview-btn--send').forEach(b => { b.disabled = false; b.textContent = '✔ Enviar'; });
            if (progWrap) progWrap.style.display = 'none';
            return;
        } finally {
            this.#pendingUploadTask = null;
        }

        // Esconde preview
        this.#cancelPreview(chatType);

        // Envia mensagem com metadados da mídia
        await this.#sendMediaMessage(result, chatType);
    }

    /** Envia mensagem de mídia (após upload). */
    async #sendMediaMessage(result, chatType) {
        if (!this.#currentUser) return;
        const base = {
            uid:        this.#currentUser.uid,
            name:       this.#currentUser.displayName || 'Anônimo',
            photoURL:   this.#currentUser.photoURL || '',
            type:       result.type,
            mediaUrl:   result.url,
            thumbnailUrl: result.thumbnailUrl || null,
            fileName:   result.fileName,
            fileSize:   result.fileSize,
            mimeType:   result.mimeType,
            mediaKey:   result.mediaKey,
            mediaIv:    result.mediaIv,
            text:       null,
            createdAt:  serverTimestamp(),
            status:     'sent'
        };

        if (chatType === 'group') {
            await addDoc(collection(this.#db, 'messages'), base).catch(console.error);
        } else if (chatType === 'private' && this.#privatePeer) {
            const ids    = [this.#currentUser.uid, this.#privatePeer.uid].sort();
            const chatId = ids.join('_');
            const colRef = collection(this.#db, 'privateChats', chatId, 'messages');
            await addDoc(colRef, base).catch(console.error);
        }
    }

    /** Abre o seletor de emoji/GIF para o chat indicado. */
    #openEmojiPicker(anchorEl, chatType) {
        if (!this.#emojiPicker) this.#emojiPicker = new EmojiGifPicker();
        this.#emojiPicker.show(anchorEl, payload => {
            if (payload.type === 'emoji') {
                // Inserir emoji no input
                const inputId = chatType === 'group' ? 'chatGroupInput' : 'chatPrivateInput';
                const inp = document.getElementById(inputId);
                if (inp) {
                    const { selectionStart: s, selectionEnd: e, value: v } = inp;
                    inp.value = v.slice(0, s) + payload.value + v.slice(e);
                    inp.selectionStart = inp.selectionEnd = s + payload.value.length;
                    inp.dispatchEvent(new Event('input', { bubbles: true }));
                    inp.focus();
                }
            } else if (payload.type === 'gif') {
                // GIF como mensagem
                const gifResult = {
                    type: 'gif', url: payload.value, thumbnailUrl: null,
                    fileName: 'gif', fileSize: 0, mimeType: 'image/gif',
                    mediaKey: null, mediaIv: null
                };
                this.#sendMediaMessage({ ...gifResult, url: payload.value }, chatType);
            } else if (payload.type === 'sticker') {
                // Sticker como mensagem de texto com tipo=sticker
                this.#sendStickerMessage(payload.value, chatType);
            }
        });
    }

    /** Envia um sticker (emoji grande) como mensagem. */
    async #sendStickerMessage(emoji, chatType) {
        if (!this.#currentUser) return;
        const base = {
            uid:       this.#currentUser.uid,
            name:      this.#currentUser.displayName || 'Anônimo',
            photoURL:  this.#currentUser.photoURL || '',
            type:      'sticker',
            text:      emoji,
            createdAt: serverTimestamp(),
            status:    'sent'
        };
        if (chatType === 'group') {
            await addDoc(collection(this.#db, 'messages'), base).catch(console.error);
        } else if (chatType === 'private' && this.#privatePeer) {
            const ids    = [this.#currentUser.uid, this.#privatePeer.uid].sort();
            const chatId = ids.join('_');
            await addDoc(collection(this.#db, 'privateChats', chatId, 'messages'), base).catch(console.error);
        }
    }

    #fmtSize(bytes) {
        if (!bytes) return '';
        if (bytes < 1024)        return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    // ── Delete ────────────────────────────────────────────
    async #deleteMessage(id, type) {
        if (!confirm('Apagar esta mensagem?')) return;
        if (type === 'group') {
            await deleteDoc(doc(this.#db, 'messages', id));
        } else if (this.#privatePeer) {
            const chatId = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
            await deleteDoc(doc(this.#db, 'privateChats/' + chatId + '/messages', id));
        }
    }

    // ── Inbox (mensagens privadas não lidas) ─────────────
    #subscribeInbox() {
        if (this.#unsubInbox) return;
        const q = query(
            collection(this.#db, 'privateChats'),
            where('unreadFor', '==', this.#currentUser.uid)
        );
        this.#unsubInbox = onSnapshot(q, snap => {
            snap.docChanges().forEach(change => {
                const data      = change.doc.data();
                const senderUid = data.senderUid;
                const wrap      = this.#userCardMap.get(senderUid);
                if (!wrap) return;
                if (change.type === 'added' || change.type === 'modified') {
                    if (!wrap.querySelector('.chat-inbox-badge')) {
                        const badge = document.createElement('span');
                        badge.className   = 'chat-inbox-badge';
                        badge.textContent = '🔴';
                        wrap.querySelector('.chat-user-card')?.appendChild(badge);
                    }
                } else if (change.type === 'removed') {
                    wrap.querySelector('.chat-inbox-badge')?.remove();
                }
            });
        });
    }

    #clearInboxBadge(peerUid) {
        this.#userCardMap.get(peerUid)?.querySelector('.chat-inbox-badge')?.remove();
        const chatId = [this.#currentUser.uid, peerUid].sort().join('_');
        updateDoc(doc(this.#db, 'privateChats', chatId), { unreadFor: '' }).catch(() => {});
    }

    // ── Presence & Online ─────────────────────────────────
    #subscribeOnline() {
        if (this.#unsubOnline) return;
        this.#unsubOnline = onSnapshot(collection(this.#db, 'users'), snap => {
            const online = snap.docs.filter(d => d.data().online).map(d => d.data().name || 'Usuário');
            const c = document.getElementById('onlineCount');
            if (c) c.textContent = online.length;
            const l = document.getElementById('onlineUsersList');
            if (l) l.innerHTML = online.map(n => '<li>🟢 ' + this.#esc(n) + '</li>').join('');
        });
    }

    // ── Users List (incremental) ──────────────────────────
    #subscribeUsers() {
        if (this.#unsubUsers) return;
        this.#unsubUsers = onSnapshot(collection(this.#db, 'users'), snap => {
            const container = document.getElementById('chatUserCards');
            if (!container) return;
            snap.docChanges().forEach(c => {
                const uid  = c.doc.id;
                const data = c.doc.data();
                if (c.type === 'removed') {
                    this.#userCardMap.get(uid)?.remove();
                    this.#userCardMap.delete(uid);
                    this.#userDataMap.delete(uid);
                    return;
                }
                if (!data.approved || uid === this.#currentUser?.uid) {
                    const ex = this.#userCardMap.get(uid);
                    if (ex) { ex.remove(); this.#userCardMap.delete(uid); }
                    this.#userDataMap.delete(uid);
                    return;
                }
                this.#userDataMap.set(uid, data);
                if (c.type === 'added') {
                    const wrap = this.#buildUserCard(uid, data);
                    this.#userCardMap.set(uid, wrap);
                    container.appendChild(wrap);
                } else if (c.type === 'modified') {
                    const ex = this.#userCardMap.get(uid);
                    if (ex) {
                        this.#updateUserCard(ex, data);
                        // Typing nos cards (home)
                        const typingEl = ex.querySelector('.chat-user-typing');
                        if (typingEl) {
                            const isTyping = this.#typing?.isTyping(data, 'group', this.#currentUser?.uid);
                            typingEl.classList.toggle('typing--active', !!isTyping);
                        }
                    } else {
                        const wrap = this.#buildUserCard(uid, data);
                        this.#userCardMap.set(uid, wrap);
                        container.appendChild(wrap);
                    }
                    // ── Typing indicator na área do chat ──────────────
                    // Grupo: verifica se alguém está digitando
                    if (this.#userCardMap.size >= 1) {
                        const groupTypers = [...this.#userDataMap.entries()]
                            .filter(([u, d]) => u !== this.#currentUser?.uid && this.#typing?.isTyping(d, 'group', this.#currentUser?.uid))
                            .map(([, d]) => d.name || 'Alguém');
                        this.#updateTypingBar('group', groupTypers);
                    }
                    // Privado: verifica se o peer atual está digitando para mim
                    if (this.#privatePeer?.uid === uid) {
                        const isTypingPriv = this.#typing?.isTyping(data, 'private', this.#currentUser?.uid, uid);
                        this.#updateTypingBar('private', isTypingPriv ? [data.name || this.#privatePeer.name || 'Alguém'] : []);
                    }
                    // ── Read receipts (chat privado) ───────────────────
                    if (this.#privatePeer?.uid === uid && this.#currentUser) {
                        const msgs = document.getElementById('chatPrivateMessages');
                        if (data.viewingChat === this.#currentUser.uid) {
                            this.#markAllOwnMsgsAs(msgs, 'read');
                        } else if (data.online) {
                            // Peer está online mas não visualizando este chat → entregue
                            this.#markAllOwnMsgsAs(msgs, 'delivered');
                        }
                    }
                }
            });
            // Distribuir chave de grupo E2E para usuários que ainda não a têm
            this.#distributeGroupKey().catch(() => {});
        });
    }

    #buildUserCard(uid, data) {
        const wrap    = document.createElement('div');
        wrap.className = 'chat-user-card-wrap';
        wrap.dataset.uid = uid;
        const card    = document.createElement('button');
        card.className = 'chat-user-card';
        const av = data.photoURL
            ? `<img src="${data.photoURL}" class="chat-user-card-avatar" alt="">`
            : `<div class="chat-user-card-avatar chat-user-card-avatar--initials">${(data.name||'?')[0].toUpperCase()}</div>`;
        card.innerHTML = av +
            `<span class="chat-user-card-name">${this.#esc(data.name || 'Usuário')}</span>` +
            `<span class="chat-user-card-presence${data.online ? ' chat-user-card-online' : ''}">●</span>` +
            `<span class="chat-user-typing">digitando...</span>`;
        card.addEventListener('click', () => this.#openPrivateChat({ uid, name: data.name || 'Usuário', photoURL: data.photoURL || '' }));
        const callBtn = document.createElement('button');
        callBtn.className   = 'btn-user-call';
        callBtn.title       = 'Ligar para ' + (data.name || 'Usuário');
        callBtn.textContent = '📞';
        callBtn.addEventListener('click', () => this.#startCall({ uid, name: data.name || 'Usuário' }));
        wrap.appendChild(card);
        wrap.appendChild(callBtn);
        return wrap;
    }

    #updateUserCard(wrap, data) {
        const presenceEl = wrap.querySelector('.chat-user-card-presence');
        if (presenceEl) presenceEl.classList.toggle('chat-user-card-online', !!data.online);
        const nameEl = wrap.querySelector('.chat-user-card-name');
        if (nameEl) nameEl.textContent = data.name || 'Usuário';
    }

    // Mostra/oculta a barra de digitação animada no chat (grupo ou privado)
    // Só aparece se houver pelo menos 1 outro usuário (userCardMap.size >= 1)
    #updateTypingBar(chatType, typers) {
        const barId = chatType === 'group' ? 'chatGroupTypingBar' : 'chatPrivateTypingBar';
        const bar   = document.getElementById(barId);
        if (!bar) return;
        if (!typers.length || this.#userCardMap.size < 1) { bar.innerHTML = ''; return; }
        const name = this.#esc(typers[0]);
        bar.innerHTML =
            `<span class="chat-typing-name">${name} está digitando</span>` +
            `<span class="chat-typing-dots"><span></span><span></span><span></span></span>`;
    }

    // ── Notificar ─────────────────────────────────────────
    #notificar(nome, texto) {
        const chatOpen = document.getElementById('sideMenu')?.classList.contains('active');
        if (chatOpen) {
            this.#audioIn.currentTime = 0;
            this.#audioIn.play().catch(() => {});
            setTimeout(() => { this.#audioIn.pause(); this.#audioIn.currentTime = 0; }, 1000);
            return;
        }
        this.#audio.currentTime = 0;
        this.#audio.play().catch(() => {});
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const title = '💬 ' + nome;
        const body  = texto || '🎵 Mensagem de áudio';
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready
                .then(reg => reg.showNotification(title, {
                    body, icon: './logo.svg', badge: './logo.svg',
                    tag: 'milionarios-chat-' + Date.now(), renotify: true, vibrate: [200, 100, 200]
                }))
                .catch(() => new Notification(title, { body, icon: './logo.svg' }));
        } else {
            new Notification(title, { body, icon: './logo.svg' });
        }
    }

    // ── Navegação via push ─────────────────────────────────
    // Roteamento após clique em push (grupo, privado; chamada foca sem navegar)
    #navigateToChat(chatType, senderId, senderName) {
        if (chatType === 'grupo')   { this.#openGroupChat(); return; }
        if (chatType === 'privado') {
            const peer = this.#userDataMap.get(senderId);
            this.#openPrivateChat({ uid: senderId, name: peer?.name || senderName || 'Usuário', photoURL: peer?.photoURL || '' });
        }
    }

    // ── FCM ───────────────────────────────────────────────
    async #initFCM() {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
        if (Notification.permission === 'denied') return;
        try {
            // Usa o SW já ativo (service-worker.js) em vez de registrar firebase-messaging-sw.js
            // separadamente — dois SWs no mesmo escopo causam conflito: FCM nunca recebe pushes.
            const swReg = await navigator.serviceWorker.ready;
            this.#messaging = getMessaging(this.#app);
            if (Notification.permission !== 'granted') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
            }
            // VAPID Key — Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
            const VAPID_KEY = 'BG0Ua4-wcya75XDbahFWpwqs61cLiIs63OiW0Xa2jFiVcCUJ_L2Kse8dI8DGaz8nStPOykMnN2L97Q1gk7a1les';
            // Detecta troca de SW: o FCM SDK cacheia o token no IndexedDB vinculado à
            // push subscription do SW anterior. Se o SW mudou (ex: firebase-messaging-sw.js
            // → service-worker.js), a subscription antiga foi invalidada pelo browser ao
            // desregistrar o SW. deleteToken() limpa o cache e força nova subscription.
            const SW_URL_KEY   = 'fcm-sw-url';
            const currentSwUrl = swReg.active?.scriptURL || '';
            if (localStorage.getItem(SW_URL_KEY) !== currentSwUrl) {
                try { await deleteToken(this.#messaging); } catch { /* token pode não existir ainda */ }
                localStorage.setItem(SW_URL_KEY, currentSwUrl);
            }
            const token = await getToken(this.#messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
            if (token) {
                this.#currentFcmToken = token;
                await this.#saveFCMToken(token);
                // Renova o token a cada 7 dias (SDK modular não tem onTokenRefresh).
                // Armazena o ID para cancelar no logout e evitar leak.
                clearInterval(this.#tokenRenewalTimer);
                this.#tokenRenewalTimer = setInterval(async () => {
                    try {
                        const renewed = await getToken(this.#messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
                        if (renewed) { this.#currentFcmToken = renewed; await this.#saveFCMToken(renewed); }
                    } catch { /* silencioso */ }
                }, 7 * 24 * 60 * 60 * 1000);
            }
            // Foreground push — usa swReg já resolvido (closure) e tag correta por tipo
            onMessage(this.#messaging, payload => {
                const n    = payload.notification || {};
                const data = payload.data || {};
                // Chamada no foreground: o Firestore listener já exibe o modal/banner.
                // Não duplicar com uma 2ª notificação push sobreposta.
                if (data.chatType === 'chamada' || data.chatType === 'chamada-grupo') return;
                // payload.notification só é populado se 'notification' estiver no nível raiz do FCM.
                // Com webpush.notification, usa data.title/data.body como fonte principal.
                // n.title/n.body populados quando notification está no nível raiz do FCM (foreground)
                const title   = n.title || data.title || '🎱 Milionários da Leograf';
                const body    = n.body  || data.body  || '';
                const tag     = data.chatType === 'grupo'
                    ? 'chat-grupo'
                    : data.chatType === 'privado'
                        ? 'chat-privado-' + (data.senderId || '')
                        : 'lotofacil-resultado';
                const vibrate = data.chatType ? [200, 100, 200, 100, 400] : [300, 100, 300, 100, 600];
                // Vibração direta — mais confiável em Android que a opção da notificação
                if (_userHasInteracted && 'vibrate' in navigator) navigator.vibrate(vibrate);
                swReg.showNotification(title, {
                    body, icon: './icon-192.png', badge: './icon-192.png',
                    tag, renotify: true, vibrate,
                    data: { chatType: data.chatType || '', senderId: data.senderId || '', senderName: data.senderName || '', concurso: data.concurso || '' }
                });
            });
        } catch (e) { console.warn('[FCM] Erro ao inicializar:', e.message); }
    }

    async #saveFCMToken(token) {
        let deviceId = localStorage.getItem('fcm-device-id');
        if (!deviceId) {
            deviceId = crypto.randomUUID();
            localStorage.setItem('fcm-device-id', deviceId);
        }
        await setDoc(doc(this.#db, 'fcmTokens', token), {
            uid: this.#currentUser?.uid || null, updatedAt: serverTimestamp(),
            deviceId, userAgent: navigator.userAgent
        });
    }

    async #deleteFCMToken() {
        if (!this.#messaging || !this.#currentFcmToken) return;
        try {
            await deleteToken(this.#messaging);
            await deleteDoc(doc(this.#db, 'fcmTokens', this.#currentFcmToken));
        } catch { /* token pode já ter expirado */ }
        this.#currentFcmToken = null;
    }

    // ── Voz ───────────────────────────────────────────────
    async #startVoiceRecord(chatType) {
        if (this.#isRecording) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 }
            });
            this.#audioChunks = [];
            const PREFERRED = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
            const mimeType  = PREFERRED.find(t => MediaRecorder.isTypeSupported(t)) || '';
            const options   = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 };
            this.#mediaRecorder = new MediaRecorder(stream, options);
            this.#mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.#audioChunks.push(e.data); };
            this.#mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(t => t.stop());
                const blob = new Blob(this.#audioChunks, { type: mimeType || 'audio/webm' });
                this.#audioChunks = [];
                await this.#uploadVoiceMsg(blob, chatType);
                this.#isRecording = false;
                this.#updateMicUI(chatType, false);
            };
            this.#mediaRecorder.start(100);
            this.#isRecording = true;
            this.#updateMicUI(chatType, true);
        } catch { alert('Permita o acesso ao microfone para enviar áudios.'); }
    }

    #stopVoiceRecord() {
        if (this.#isRecording && this.#mediaRecorder?.state !== 'inactive') this.#mediaRecorder.stop();
    }

    #updateMicUI(chatType, recording) {
        const isGroup = chatType === 'group';
        const btn     = document.getElementById(isGroup ? 'btnMicGroup'      : 'btnMicPrivate');
        const stopBtn = document.getElementById(isGroup ? 'btnMicStopGroup'  : 'btnMicStopPrivate');
        const track   = document.getElementById(isGroup ? 'micTrackGroup'    : 'micTrackPrivate');
        if (!btn) return;
        btn.classList.toggle('btn-mic--recording', recording);
        stopBtn?.classList.toggle('btn-mic-stop--hidden', !recording);
        if (recording) {
            // Mantém o botão elevado e oculta o trilho (já serviu sua função)
            btn.style.transform = 'translateY(-16px)';
            if (track) { track.style.height = '0'; track.style.opacity = '0'; }
        } else {
            btn.style.transform = '';
            btn.classList.remove('btn-mic--locked');
            if (track) { track.style.height = '0'; track.style.opacity = '0'; }
        }
        btn.title = recording ? 'Gravando — clique em ⏹ para enviar' : 'Arraste para cima para gravar';
    }

    async #uploadVoiceMsg(blob, chatType) {
        if (!this.#currentUser) return;
        const ext     = blob.type.includes('webm') ? 'webm' : 'mp4';
        const path    = `voiceMessages/${this.#currentUser.uid}/${Date.now()}.${ext}`;
        const storRef = ref(this.#storage, path);
        const snap    = await uploadBytes(storRef, blob);
        const url     = await getDownloadURL(snap.ref);
        const msgData = {
            uid: this.#currentUser.uid, name: this.#getDisplayName(),
            photoURL: this.#currentUser.photoURL || '', text: '🎤 Áudio',
            type: 'audio', audioURL: url, createdAt: serverTimestamp()
        };
        if (chatType === 'group') {
            await addDoc(collection(this.#db, 'messages'), msgData);
        } else if (chatType === 'private' && this.#privatePeer) {
            const chatId = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
            msgData.receiverUid = this.#privatePeer.uid;
            await addDoc(collection(this.#db, 'privateChats/' + chatId + '/messages'), msgData);
        }
    }

    // ── E2E Encryption ────────────────────────────────────
    async #initE2E() {
        if (!this.#currentUser) return;
        try {
            this.#e2e = await E2EManager.load(this.#currentUser.uid);
            const pubKey = await this.#e2e.exportPublicKey();
            await updateDoc(doc(this.#db, 'users', this.#currentUser.uid), { publicKey: pubKey }).catch(() => {});
            this.#listenForGroupKeyStore();
            // Inicializa uploader de mídia após E2E disponível
            this.#mediaUploader = new MediaUploader(this.#storage, this.#e2e, this.#currentUser.uid);
            if (!this.#emojiPicker) this.#emojiPicker = new EmojiGifPicker();
        } catch (e) {
            console.error('[E2E] Erro ao inicializar:', e);
            this.#e2e = null;
        }
    }

    #listenForGroupKeyStore() {
        if (!this.#currentUser || !this.#e2e) return;
        this.#unsubGroupKeyStore?.(); this.#unsubGroupKeyStore = null;
        const docRef = doc(this.#db, 'groupKeyStore', this.#currentUser.uid);
        this.#unsubGroupKeyStore = onSnapshot(docRef, async snap => {
            if (!snap.exists() || this.#e2e?.hasGroupKey) return;
            const { enc, fromPub } = snap.data();
            if (!enc || !fromPub) return;
            try {
                await this.#e2e.loadGroupKeyFrom(enc, fromPub, this.#currentUser.uid);
            } catch (e) {
                console.warn('[E2E] Falha ao importar chave de grupo:', e.message);
            }
        });
    }

    async #distributeGroupKey() {
        if (!this.#e2e || !this.#currentUser) return;
        if (!this.#e2e.hasGroupKey) {
            await this.#e2e.generateGroupKey(this.#currentUser.uid);
        }
        const myPub = await this.#e2e.exportPublicKey();
        for (const [uid, data] of this.#userDataMap.entries()) {
            if (uid === this.#currentUser.uid) continue;
            if (this.#groupKeyHolders.has(uid)) continue;
            if (!data.publicKey) continue;
            try {
                const enc = await this.#e2e.encryptGroupKeyFor(data.publicKey);
                await setDoc(doc(this.#db, 'groupKeyStore', uid), { enc, fromPub: myPub });
                this.#groupKeyHolders.add(uid);
            } catch (e) {
                console.warn('[E2E] Erro ao distribuir chave para', uid, ':', e.message);
            }
        }
    }

    async #decryptMsg(rawData, chatType) {
        if (!rawData.enc || !this.#e2e) return rawData;
        try {
            let plaintext;
            if (chatType === 'group') {
                plaintext = await this.#e2e.decryptWithGroupKey(rawData.enc);
            } else {
                const senderPub = rawData.uid === this.#currentUser?.uid
                    ? this.#userDataMap.get(this.#privatePeer?.uid)?.publicKey
                    : this.#userDataMap.get(rawData.uid)?.publicKey;
                if (!senderPub) return rawData;
                plaintext = await this.#e2e.decryptFromPeer(rawData.enc, senderPub);
            }
            return { ...rawData, text: plaintext };
        } catch {
            return { ...rawData, text: '🔒 [não foi possível decifrar]' };
        }
    }

    async #handleP2PMessage(raw) {
        try {
            const msg = JSON.parse(raw);
            if (msg.type !== 'chat' || !msg.enc || !this.#e2e || !this.#privatePeer) return;
            const senderPub = this.#userDataMap.get(this.#privatePeer.uid)?.publicKey;
            if (!senderPub) return;
            const text = await this.#e2e.decryptFromPeer(msg.enc, senderPub);
            const msgs = document.getElementById('chatPrivateMessages');
            if (!msgs) return;
            this.#p2pReceivedIds.add(msg.tempId);
            this.#renderMsg(msgs, 'p2p-' + msg.tempId, {
                uid:      this.#privatePeer.uid,
                name:     msg.name,
                photoURL: msg.photoURL || '',
                text,
                createdAt: null
            }, true, 'private');
        } catch (e) {
            console.warn('[P2P] Mensagem inválida:', e.message);
        }
    }

    // ── Group Call ────────────────────────────────────────
    #listenForGroupCall() {
        this.#unsubGroupCallIn?.(); this.#unsubGroupCallIn = null;
        const q = query(
            collection(this.#db, 'groupCalls'),
            where('status', '==', 'calling')
        );
        this.#unsubGroupCallIn = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type !== 'added') return;
                const data = c.doc.data();
                if (data.callerId === this.#currentUser.uid) return;
                if (this.#groupCall?.isActive || this.#peerConn) return;
                this.#showGroupCallInvite(c.doc.id, data.callerName || 'Alguém');
            });
        });
    }

    #showGroupCallInvite(callId, callerName) {
        const banner = document.getElementById('groupCallInvite');
        const nameEl = document.getElementById('groupCallInviteName');
        if (!banner || !nameEl) return;
        nameEl.textContent = callerName;
        banner.classList.remove('group-call-invite--hidden');
        document.getElementById('btnJoinGroupCall').onclick = async () => {
            banner.classList.add('group-call-invite--hidden');
            await this.#joinGroupCall(callId);
        };
        document.getElementById('btnDismissGroupCall').onclick = () => {
            banner.classList.add('group-call-invite--hidden');
        };
    }

    async #startGroupCall() {
        if (this.#groupCall?.isActive) { alert('Você já está em uma chamada de grupo.'); return; }
        if (this.#peerConn) { alert('Você já está em uma chamada individual.'); return; }
        try {
            this.#groupCall = new GroupCallManager(this.#db, this.#currentUser, {
                onParticipants: p => this.#updateGroupCallBar(p),
                onEnded:        () => this.#onGroupCallEnded()
            });
            await this.#groupCall.startCall(this.#getDisplayName());
            this.#updateGroupCallBar([{ uid: this.#currentUser.uid, name: this.#getDisplayName() }]);
        } catch (e) {
            console.error('[GroupCall] Erro ao iniciar:', e);
            alert('Não foi possível iniciar a chamada. Permita o acesso ao microfone.');
            this.#groupCall = null;
        }
    }

    async #joinGroupCall(callId) {
        if (this.#groupCall?.isActive) return;
        if (this.#peerConn) { alert('Você já está em uma chamada individual.'); return; }
        try {
            this.#groupCall = new GroupCallManager(this.#db, this.#currentUser, {
                onParticipants: p => this.#updateGroupCallBar(p),
                onEnded:        () => this.#onGroupCallEnded()
            });
            await this.#groupCall.joinCall(callId);
        } catch (e) {
            console.error('[GroupCall] Erro ao entrar:', e);
            alert('Não foi possível entrar na chamada. Permita o acesso ao microfone.');
            this.#groupCall = null;
        }
    }

    async #leaveGroupCall() {
        await this.#groupCall?.leaveCall();
    }

    #toggleMute() {
        if (!this.#groupCall) return;
        const isMuted = this.#groupCall.toggleMute();
        const btn = document.getElementById('btnToggleMute');
        if (btn) btn.textContent = isMuted ? '🔈 Desmutar' : '🔇 Mudo';
    }

    #updateGroupCallBar(participants) {
        const bar = document.getElementById('groupCallBar');
        if (!bar) return;
        bar.classList.remove('group-call-bar--hidden');
        const el = document.getElementById('groupCallParticipants');
        if (el) {
            el.innerHTML = participants
                .map(p => `<span class="group-call-participant">${this.#esc(p.name)}</span>`)
                .join('');
        }
    }

    #onGroupCallEnded() {
        document.getElementById('groupCallBar')?.classList.add('group-call-bar--hidden');
        document.getElementById('groupCallInvite')?.classList.add('group-call-invite--hidden');
        const btn = document.getElementById('btnToggleMute');
        if (btn) btn.textContent = '🔇 Mudo';
        this.#groupCall = null;
    }

    // ── WebRTC ────────────────────────────────────────────
    #listenForIncomingCalls() {
        if (!this.#currentUser) return;
        this.#unsubCallIn?.(); this.#unsubCallIn = null;
        const q = query(
            collection(this.#db, 'calls'),
            where('calleeId', '==', this.#currentUser.uid),
            where('status',   '==', 'calling')
        );
        this.#unsubCallIn = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') this.#showIncomingCall(c.doc.id, c.doc.data().callerName || 'Alguém');
            });
        });
    }

    #showIncomingCall(callId, callerName) {
        const modal  = document.getElementById('callModal');
        const nameEl = document.getElementById('callModalName');
        if (!modal || !nameEl) return;
        nameEl.textContent = callerName;
        modal.classList.remove('call-modal--hidden');
        // Inicia ringtone em loop + vibração contínua
        this.#ringTone.loop        = true;
        this.#ringTone.currentTime = 0;
        this.#ringTone.play().catch(() => {});
        this.#startCallVibration();
        document.getElementById('btnAcceptCall').onclick = async () => {
            this.#stopCallRing();
            modal.classList.add('call-modal--hidden');
            await this.#acceptCall(callId, callerName);
        };
        document.getElementById('btnRejectCall').onclick = async () => {
            this.#stopCallRing();
            modal.classList.add('call-modal--hidden');
            await updateDoc(doc(this.#db, 'calls', callId), { status: 'rejected' }).catch(() => {});
        };
    }

    // Padrão de vibração contínua enquanto o telefone toca (1 ciclo = 1600ms)
    #startCallVibration() {
        if (!('vibrate' in navigator) || !_userHasInteracted) return;
        const pattern = [500, 300, 500, 300];
        try { navigator.vibrate(pattern); } catch { /* ignore */ }
        this.#ringVibrateTimer = setInterval(() => {
            if (!_userHasInteracted) return;
            try { navigator.vibrate(pattern); } catch { /* ignore */ }
        }, 1600);
    }

    // Para o ringtone, a vibração e limpa o timer
    #stopCallRing() {
        this.#ringTone.pause();
        this.#ringTone.currentTime = 0;
        clearInterval(this.#ringVibrateTimer);
        this.#ringVibrateTimer = null;
        if (_userHasInteracted) try { navigator.vibrate?.(0); } catch { /* ignore */ }
    }

    async #startCall(peer) {
        if (this.#peerConn) { alert('Você já está em uma chamada.'); return; }
        try {
            this.#localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.#peerConn    = new RTCPeerConnection(ChatApp.#STUN);
            this.#localStream.getTracks().forEach(t => this.#peerConn.addTrack(t, this.#localStream));
            this.#peerConn.ontrack = e => { this.#remoteAudio.srcObject = e.streams[0]; this.#remoteAudio.play().catch(() => {}); };
            this.#peerConn.oniceconnectionstatechange = () => {
                if (['disconnected','failed','closed'].includes(this.#peerConn?.iceConnectionState)) this.#endCall();
            };
            const callRef   = doc(collection(this.#db, 'calls'));
            this.#callDocId = callRef.id;
            this.#peerConn.onicecandidate = async e => {
                if (e.candidate) await addDoc(collection(this.#db, 'calls', this.#callDocId, 'callerCandidates'), e.candidate.toJSON());
            };
            const offer = await this.#peerConn.createOffer();
            await this.#peerConn.setLocalDescription(offer);
            await setDoc(callRef, {
                callerId: this.#currentUser.uid, callerName: this.#getDisplayName(),
                calleeId: peer.uid, offer: { type: offer.type, sdp: offer.sdp },
                status: 'calling', createdAt: serverTimestamp()
            });
            this.#showCallBar('calling', peer.name);
            this.#unsubCallOut = onSnapshot(callRef, async snap => {
                const data = snap.data();
                if (!data) return;
                if (data.status === 'rejected' || data.status === 'ended') { this.#endCall(); return; }
                if (data.status === 'active' && data.answer && !this.#peerConn?.remoteDescription) {
                    await this.#peerConn.setRemoteDescription(new RTCSessionDescription(data.answer));
                    this.#showCallBar('active', peer.name);
                }
            });
            onSnapshot(collection(this.#db, 'calls', this.#callDocId, 'calleeCandidates'), snap => {
                snap.docChanges().forEach(async c => {
                    if (c.type === 'added') await this.#peerConn?.addIceCandidate(new RTCIceCandidate(c.doc.data()));
                });
            });
        } catch (e) { console.error('Erro ao iniciar chamada:', e); this.#endCall(); }
    }

    async #acceptCall(callId, callerName) {
        try {
            this.#callDocId   = callId;
            this.#localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.#peerConn    = new RTCPeerConnection(ChatApp.#STUN);
            this.#localStream.getTracks().forEach(t => this.#peerConn.addTrack(t, this.#localStream));
            this.#peerConn.ontrack = e => { this.#remoteAudio.srcObject = e.streams[0]; this.#remoteAudio.play().catch(() => {}); };
            this.#peerConn.oniceconnectionstatechange = () => {
                if (['disconnected','failed','closed'].includes(this.#peerConn?.iceConnectionState)) this.#endCall();
            };
            const callRef  = doc(this.#db, 'calls', callId);
            const callSnap = await getDoc(callRef);
            await this.#peerConn.setRemoteDescription(new RTCSessionDescription(callSnap.data().offer));
            this.#peerConn.onicecandidate = async e => {
                if (e.candidate) await addDoc(collection(this.#db, 'calls', callId, 'calleeCandidates'), e.candidate.toJSON());
            };
            const answer = await this.#peerConn.createAnswer();
            await this.#peerConn.setLocalDescription(answer);
            await updateDoc(callRef, { answer: { type: answer.type, sdp: answer.sdp }, status: 'active' });
            onSnapshot(collection(this.#db, 'calls', callId, 'callerCandidates'), snap => {
                snap.docChanges().forEach(async c => {
                    if (c.type === 'added') await this.#peerConn?.addIceCandidate(new RTCIceCandidate(c.doc.data()));
                });
            });
            this.#showCallBar('active', callerName);
        } catch (e) { console.error('Erro ao aceitar chamada:', e); this.#endCall(); }
    }

    #showCallBar(status, name) {
        const bar = document.getElementById('callBar');
        if (!bar) return;
        const nameEl   = document.getElementById('callBarName');
        const statusEl = document.getElementById('callBarStatus');
        if (nameEl)   nameEl.textContent   = name;
        if (statusEl) statusEl.textContent = status === 'calling' ? 'Chamando...' : '🟢 Em chamada';
        bar.classList.remove('call-bar--hidden');
    }

    async #endCall() {
        this.#stopCallRing();
        this.#peerConn?.close(); this.#peerConn = null;
        this.#localStream?.getTracks().forEach(t => t.stop()); this.#localStream = null;
        this.#remoteAudio.srcObject = null;
        this.#unsubCallOut?.(); this.#unsubCallOut = null;
        if (this.#callDocId) {
            await updateDoc(doc(this.#db, 'calls', this.#callDocId), { status: 'ended' }).catch(() => {});
            this.#callDocId = null;
        }
        document.getElementById('callBar')?.classList.add('call-bar--hidden');
        document.getElementById('callModal')?.classList.add('call-modal--hidden');
    }

    // ── Cleanup ───────────────────────────────────────────
    #cleanup() {
        this.#unsubGrpMsgs?.();  this.#unsubGrpMsgs  = null;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        this.#unsubUserDoc?.();  this.#unsubUserDoc  = null;
        this.#unsubOnline?.();   this.#unsubOnline   = null;
        this.#unsubUsers?.();    this.#unsubUsers    = null;
        this.#unsubInbox?.();    this.#unsubInbox    = null;
        this.#unsubCallIn?.();        this.#unsubCallIn        = null;
        this.#unsubGroupCallIn?.(); this.#unsubGroupCallIn = null;
        this.#unsubGroupKeyStore?.(); this.#unsubGroupKeyStore = null;
        clearInterval(this.#tokenRenewalTimer); this.#tokenRenewalTimer = null;
        this.#stopCallRing();
        if (this.#groupCall?.isActive) this.#groupCall.leaveCall().catch(() => {});
        this.#groupCall = null;
        this.#isAdmin   = false;
        this.#p2pChannel?.close();
        this.#p2pChannel = null;
        this.#p2pReceivedIds.clear();
        this.#groupKeyHolders.clear();
        this.#e2e = null;
        // Cancelar upload pendente e revogar Blob URLs de preview
        this.#pendingUploadTask?.cancel();
        this.#pendingUploadTask = null;
        this.#pendingBlobUrls.forEach(u => URL.revokeObjectURL(u));
        this.#pendingBlobUrls = [];
        this.#mediaUploader = null;
        _decryptCache.clear();
        this.#chatInitialized = false;
        this.#userCardMap.clear();
        this.#userDataMap.clear();
        this.#pendingMessages.clear();
        this.#pendingByTempId.clear();
        this.#confirmedIds.clear();
        if (this.#isRecording) this.#stopVoiceRecord();
        this.#endCall().catch(() => {});
        if (this.#currentUser) {
            updateDoc(doc(this.#db, 'users', this.#currentUser.uid), { viewingChat: '' }).catch(() => {});
            this.#presence.stop();
            this.#currentUser = null;
        }
        ['chatGroupMessages', 'chatPrivateMessages'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
        this.#updateTypingBar('group',   []);
        this.#updateTypingBar('private', []);
        this.#privatePeer = null;
    }

    // ── Bind UI ───────────────────────────────────────────
    #bindUI() {
        // Auth
        document.getElementById('btnLoginSenha')?.addEventListener('click',   () => this.#loginWithPassword());
        document.getElementById('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.#loginWithPassword(); });
        document.getElementById('loginEmail')?.addEventListener('keydown',    e => { if (e.key === 'Enter') this.#loginWithPassword(); });
        document.getElementById('btnLoginGoogle')?.addEventListener('click',  () => this.#loginGoogle());
        document.getElementById('btnCadastrar')?.addEventListener('click',       () => this.#registerWithPassword());
        document.getElementById('cadastroConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.#registerWithPassword(); });
        document.getElementById('tabBtnLogin')?.addEventListener('click',    () => this.#switchTab('login'));
        document.getElementById('tabBtnCadastro')?.addEventListener('click', () => this.#switchTab('cadastro'));
        document.getElementById('btnBackToLogin')?.addEventListener('click', () => this.#switchTab('login'));

        // Mic — arraste para cima ≥1rem para iniciar gravação
        const bindMic = (btnId, stopBtnId, trackId, chatType) => {
            const btn     = document.getElementById(btnId);
            const stopBtn = document.getElementById(stopBtnId);
            const track   = document.getElementById(trackId);
            if (!btn) return;
            const THRESHOLD = 15; // 15px
            let startY = 0, dragging = false;

            const cancelDrag = () => {
                dragging = false;
                btn.style.transform = '';
                if (track) { track.style.height = '0'; track.style.opacity = '0'; }
            };

            // Stop button: para gravação e envia áudio
            stopBtn?.addEventListener('click', () => { if (this.#isRecording) this.#stopVoiceRecord(); });

            // Mouse
            btn.addEventListener('mousedown', e => {
                if (this.#isRecording) return;
                e.preventDefault();
                startY = e.clientY; dragging = true;
            });
            const onMouseMove = e => {
                if (!dragging || this.#isRecording) return;
                const delta = Math.max(0, Math.min(startY - e.clientY, THRESHOLD));
                btn.style.transform = `translateY(-${delta}px)`;
                if (track) { track.style.height = delta + 'px'; track.style.opacity = delta > 0 ? '1' : '0'; }
            };
            const onMouseUp = e => {
                if (!dragging) return;
                const delta = startY - e.clientY;
                dragging = false;
                if (delta >= THRESHOLD && !this.#isRecording) {
                    this.#startVoiceRecord(chatType);
                } else {
                    cancelDrag();
                }
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup',   onMouseUp);

            // Touch
            btn.addEventListener('touchstart', e => {
                if (this.#isRecording) return;
                e.preventDefault();
                startY = e.touches[0].clientY; dragging = true;
            }, { passive: false });
            btn.addEventListener('touchmove', e => {
                if (!dragging || this.#isRecording) return;
                e.preventDefault();
                const delta = Math.max(0, Math.min(startY - e.touches[0].clientY, THRESHOLD));
                btn.style.transform = `translateY(-${delta}px)`;
                if (track) { track.style.height = delta + 'px'; track.style.opacity = delta > 0 ? '1' : '0'; }
            }, { passive: false });
            btn.addEventListener('touchend', e => {
                if (!dragging) return;
                e.preventDefault();
                const delta = startY - e.changedTouches[0].clientY;
                dragging = false;
                if (delta >= THRESHOLD && !this.#isRecording) {
                    this.#startVoiceRecord(chatType);
                } else {
                    cancelDrag();
                }
            }, { passive: false });
            btn.addEventListener('touchcancel', e => { e.preventDefault(); cancelDrag(); }, { passive: false });
        };
        bindMic('btnMicGroup',   'btnMicStopGroup',   'micTrackGroup',   'group');
        bindMic('btnMicPrivate', 'btnMicStopPrivate', 'micTrackPrivate', 'private');

        // Toggle mic-wrap ↔ send + typing indicator
        const bindMicSendToggle = (inputId, micWrapId, sendId, chatType, peerUidFn) => {
            const inp     = document.getElementById(inputId);
            const micWrap = document.getElementById(micWrapId);
            const send    = document.getElementById(sendId);
            if (!inp || !micWrap || !send) return;
            inp.addEventListener('input', () => {
                const hasText = inp.value.trim().length > 0;
                micWrap.classList.toggle('mic-wrap--hidden', hasText);
                send.classList.toggle('btn-send--hidden', !hasText);
            });
            inp.addEventListener('keydown', () => this.#typing?.onKeyDown(chatType, peerUidFn?.()));
            inp.addEventListener('blur',    () => this.#typing?.clear(chatType, peerUidFn?.()));
        };
        bindMicSendToggle('chatGroupInput',   'micWrapGroup',   'btnSendGroup',   'group',   null);
        bindMicSendToggle('chatPrivateInput', 'micWrapPrivate', 'btnSendPrivate', 'private', () => this.#privatePeer?.uid);

        // Send
        document.getElementById('btnSendGroup')?.addEventListener('click',    () => this.#sendGroupMessage());
        document.getElementById('chatGroupInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#sendGroupMessage(); }
            requestAnimationFrame(() => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; });
        });
        document.getElementById('btnSendPrivate')?.addEventListener('click',    () => this.#sendPrivateMessage());
        document.getElementById('chatPrivateInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#sendPrivateMessage(); }
            requestAnimationFrame(() => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; });
        });

        // Attach + Emoji
        document.getElementById('btnAttachGroup')?.addEventListener('click',   () => this.#openFilePicker('group'));
        document.getElementById('btnAttachPrivate')?.addEventListener('click', () => this.#openFilePicker('private'));
        document.getElementById('btnEmojiGroup')?.addEventListener('click',    e => this.#openEmojiPicker(e.currentTarget, 'group'));
        document.getElementById('btnEmojiPrivate')?.addEventListener('click',  e => this.#openEmojiPicker(e.currentTarget, 'private'));
        document.getElementById('mediaFileInput')?.addEventListener('change',  e => {
            const file = e.target.files?.[0];
            const chat = e.target.dataset.chatType || 'group';
            if (file) this.#handleFileSelected(file, chat);
            e.target.value = '';
        });
        document.getElementById('cancelPreviewGroup')?.addEventListener('click',   () => this.#cancelPreview('group'));
        document.getElementById('cancelPreviewPrivate')?.addEventListener('click', () => this.#cancelPreview('private'));
        document.getElementById('sendPreviewGroup')?.addEventListener('click',     () => this.#confirmSendPreview('group'));
        document.getElementById('sendPreviewPrivate')?.addEventListener('click',   () => this.#confirmSendPreview('private'));

        // Navegação
        document.getElementById('btnOpenGroup')?.addEventListener('click',       () => this.#openGroupChat());
        document.getElementById('btnBackFromGroup')?.addEventListener('click',   () => this.#backToHome());
        document.getElementById('btnBackFromPrivate')?.addEventListener('click', () => this.#backToHome());

        // Chamada 1:1
        document.getElementById('btnEndCall')?.addEventListener('click', () => this.#endCall());

        // Chamada em grupo
        document.getElementById('btnGroupCall')?.addEventListener('click',     () => this.#startGroupCall());
        document.getElementById('btnLeaveGroupCall')?.addEventListener('click', () => this.#leaveGroupCall());
        document.getElementById('btnToggleMute')?.addEventListener('click',     () => this.#toggleMute());

        // Logout
        document.getElementById('btnLogoutChat')?.addEventListener('click',    () => this.#logout());
        document.getElementById('btnLogoutPending')?.addEventListener('click', () => this.#logout());

        // Avatar
        document.getElementById('btnAvatarUpload')?.addEventListener('click', () =>
            document.getElementById('avatarUploadInput')?.click()
        );
        document.getElementById('avatarUploadInput')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (file) this.#uploadAvatar(file);
            e.target.value = '';
        });

        // Online panel
        document.getElementById('btnOnlineList')?.addEventListener('click', () =>
            document.getElementById('chatOnlinePanel')?.classList.toggle('chat-online-panel--hidden')
        );

        // Chamada: aceitar/rejeitar via clique em botão da notificação push
        window.addEventListener('call-action', e => {
            const { type, callId, senderName } = e.detail || {};
            if (!callId) return;
            document.getElementById('callModal')?.classList.add('call-modal--hidden');
            this.#stopCallRing();
            if (type === 'ACCEPT_CALL') {
                this.#acceptCall(callId, senderName || 'Alguém').catch(() => {});
            } else if (type === 'REJECT_CALL') {
                updateDoc(doc(this.#db, 'calls', callId), { status: 'rejected' }).catch(() => {});
            }
        });

        // Roteamento após clique em notificação push
        window.addEventListener('navigate-to-chat', e => {
            const { chatType, senderId, senderName } = e.detail || {};
            if (!chatType) return;
            if (!this.#currentUser) {
                // App ainda inicializando (aberto via clique de push) — adiar até #enterChat
                this.#pendingNavigation = { chatType, senderId, senderName };
                return;
            }
            this.#navigateToChat(chatType, senderId, senderName);
        });
    }
}

// Rastreia se o usuário já interagiu — necessário antes de navigator.vibrate()
let _userHasInteracted = false;
['click', 'keydown', 'touchstart', 'pointerdown'].forEach(ev =>
    document.addEventListener(ev, () => { _userHasInteracted = true; }, { once: true, capture: true })
);

document.addEventListener('DOMContentLoaded', () => { new ChatApp(); });

// Listener para mensagens do service worker (Background Sync + FCM Navigate)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'DRAIN_QUEUE') {
            // O app recarrega a fila via ConnectionMonitor.onOnline; 
            // aqui disparamos via evento customizado caso necessário
            window.dispatchEvent(new Event('online'));
        }
        if (e.data?.type === 'ACCEPT_CALL') {
            window.dispatchEvent(new CustomEvent('call-action', {
                detail: { type: 'ACCEPT_CALL', callId: e.data.callId, senderName: e.data.senderName }
            }));
        }
        if (e.data?.type === 'REJECT_CALL') {
            window.dispatchEvent(new CustomEvent('call-action', {
                detail: { type: 'REJECT_CALL', callId: e.data.callId }
            }));
        }
        if (e.data?.type === 'NAVIGATE_TO_CHAT') {
            window.dispatchEvent(new CustomEvent('navigate-to-chat', { detail: e.data }));
        }
        if (e.data?.type === 'NAVIGATE_TO_LOTOFACIL') {
            window.dispatchEvent(new CustomEvent('navigate-to-lotofacil', {
                detail: { concurso: e.data.concurso }
            }));
        }
    });
}
