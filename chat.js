// ============================================
// 💬 CHAT — REALTIME ENGINE v2.0
// Optimistic UI · Offline Queue · Typing · Presence · Latency Logs
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
    signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
    collection, addDoc, deleteDoc, query, orderBy, limit, where,
    serverTimestamp, startAfter, getDocs
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
    getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import {
    getMessaging, getToken, onMessage, onTokenRefresh
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js';

const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyCIVshCdXm7Fp1X3kxGr5GZOF_jUBN3ChA',
    authDomain:        'chatmilhao.firebaseapp.com',
    projectId:         'chatmilhao',
    storageBucket:     'chatmilhao.firebasestorage.app',
    messagingSenderId: '411362756429',
    appId:             '1:411362756429:web:55059c1f443fe06a1bd904'
};

// ──────────────────────────────────────────────────────────────
// 📊 LATENCY LOGGER
// ──────────────────────────────────────────────────────────────
class LatencyLogger {
    #samples = new Map();
    #log     = [];

    markSend(id) {
        this.#samples.set(id, { sendMs: Date.now() });
    }

    markRendered(id) {
        const s = this.#samples.get(id);
        if (!s) return;
        const latency = Date.now() - s.sendMs;
        this.#log.push({ id, latency, ts: new Date().toISOString() });
        console.debug(`[Latency] ${id} → render em ${latency}ms`);
        this.#samples.delete(id);
        window.__chatLatency = this.#log;
        if (this.#log.length % 10 === 0) this.#report();
    }

    markConfirmed(tempId, realId, latencyMs) {
        console.debug(`[Latency] ${tempId} → Firestore confirmou (${realId}) em ${latencyMs}ms`);
    }

    #report() {
        const last10 = this.#log.slice(-10);
        const avg    = Math.round(last10.reduce((s, e) => s + e.latency, 0) / last10.length);
        console.group('[ChatApp Latency] Últimas 10 mensagens');
        console.table(last10);
        console.info(`Média: ${avg}ms`);
        console.groupEnd();
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
// 💬 CHAT APP
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
    #unsubCallIn   = null;
    #unsubCallOut  = null;

    // Estado do chat
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

    // Áudio
    #audio       = new Audio('./notification.mp3');
    #audioIn     = new Audio('./ring-chat.mp3');
    #remoteAudio = new Audio();

    // Gravação de voz
    #mediaRecorder = null;
    #audioChunks   = [];
    #isRecording   = false;

    // WebRTC
    #peerConn    = null;
    #localStream = null;
    #callDocId   = null;

    // Serviços
    #latency  = new LatencyLogger();
    #offlineQ = new OfflineQueue();
    #connMon  = null;
    #typing   = null;
    #presence = null;

    static #STUN  = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
    static #PAGE  = 50;

    constructor() {
        this.#app            = initializeApp(FIREBASE_CONFIG);
        this.#auth           = getAuth(this.#app);
        this.#db             = getFirestore(this.#app);
        this.#storage        = getStorage(this.#app);
        this.#googleProvider = new GoogleAuthProvider();
        this.#auth.languageCode = 'pt-BR';

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
        this.#initFCM();
    }

    // ── Util ──────────────────────────────────────────────
    #syncHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        const update = () => document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
        update();
        new ResizeObserver(update).observe(header);
    }

    #esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    #scrollBottom(el) { if (el) el.scrollTop = el.scrollHeight; }

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
    #watchAuth() { onAuthStateChanged(this.#auth, u => this.#handleAuthChange(u)); }

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
        });
    }

    async #enterChat(userData) {
        this.#showPanel('chat');
        const name = userData.name || this.#currentUser.displayName || 'Usuário';
        const el   = document.getElementById('chatWelcomeText');
        if (el) el.textContent = 'Olá Milionário ' + name;
        this.#updateAvatarUI(userData.photoURL || '');
        this.#presence.start(this.#currentUser.uid);
        this.#subscribeOnline();
        this.#subscribeUsers();
        this.#listenForIncomingCalls();
        if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
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

    async #logout() { this.#presence.stop(); await signOut(this.#auth); }

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
    }

    #backToHome() {
        this.#unsubGrpMsgs?.();  this.#unsubGrpMsgs  = null;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        this.#privatePeer = null;
        this.#typing?.clear('group');
        document.getElementById('chatGroupPanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatPrivatePanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatHome')?.classList.remove('chat-home--hidden');
    }

    // ── Group Messages ────────────────────────────────────
    #subscribeGroupMessages() {
        const q    = query(collection(this.#db, 'messages'), orderBy('createdAt', 'asc'), limit(ChatApp.#PAGE));
        const msgs = document.getElementById('chatGroupMessages');
        let first  = true;
        this.#unsubGrpMsgs = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') {
                    if (this.#confirmedIds.has(c.doc.id)) return;
                    // Tenta associar a uma mensagem otimista pendente
                    const entry = [...this.#pendingMessages.values()].find(
                        p => !p.resolved && p.text === c.doc.data().text && p.uid === c.doc.data().uid
                    );
                    if (entry) {
                        this.#confirmPendingMessage(entry.tempId, c.doc.id);
                        entry.resolved = true;
                    } else {
                        this.#renderMsg(msgs, c.doc.id, c.doc.data(), !first, 'group');
                    }
                    if (!this.#grpOldestDoc) this.#grpOldestDoc = c.doc;
                }
                if (c.type === 'removed') document.getElementById('msg-' + c.doc.id)?.remove();
            });
            if (first) { first = false; this.#renderLoadMoreBtn(msgs, 'group'); }
            this.#scrollBottom(msgs);
        });
    }

    async #sendGroupMessage() {
        const input = document.getElementById('chatGroupInput');
        const text  = input?.value.trim();
        if (!text || !this.#currentUser) return;
        if (text.length > 2000) { alert('Mensagem muito longa. Máximo 2000 caracteres.'); return; }

        input.value = ''; input.style.height = 'auto';
        document.getElementById('btnMicGroup')?.classList.remove('btn-mic--hidden');
        document.getElementById('btnSendGroup')?.classList.add('btn-send--hidden');
        this.#typing?.clear('group');

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
        this.#pendingMessages.set(tempId, { tempId, text, uid: this.#currentUser.uid, colPath: 'messages', resolved: false });

        if (!this.#connMon.isOnline) {
            await this.#offlineQ.push({ tempId, colPath: 'messages', msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text } });
            this.#markMsgStatus(tempId, 'offline');
            return;
        }

        const sendMs = Date.now();
        try {
            const docRef = await addDoc(collection(this.#db, 'messages'), {
                uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL,
                text, createdAt: serverTimestamp()
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
        const q       = query(collection(this.#db, colPath), orderBy('createdAt', 'asc'), limit(ChatApp.#PAGE));
        const msgs    = document.getElementById('chatPrivateMessages');
        let first     = true;
        this.#unsubPrivMsgs = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added') {
                    const fid = 'priv-' + c.doc.id;
                    if (this.#confirmedIds.has(fid)) return;
                    const entry = [...this.#pendingMessages.values()].find(
                        p => !p.resolved && p.text === c.doc.data().text && p.uid === c.doc.data().uid
                    );
                    if (entry) {
                        this.#confirmPendingMessage(entry.tempId, fid);
                        entry.resolved = true;
                    } else {
                        this.#renderMsg(msgs, fid, c.doc.data(), !first, 'private');
                    }
                    if (!this.#privOldestDoc) this.#privOldestDoc = c.doc;
                }
                if (c.type === 'removed') document.getElementById('msg-priv-' + c.doc.id)?.remove();
            });
            if (first) { first = false; this.#renderLoadMoreBtn(msgs, 'private'); }
            this.#scrollBottom(msgs);
        });
    }

    async #sendPrivateMessage() {
        if (!this.#privatePeer || !this.#currentUser) return;
        const input = document.getElementById('chatPrivateInput');
        const text  = input?.value.trim();
        if (!text) return;
        if (text.length > 2000) { alert('Mensagem muito longa. Máximo 2000 caracteres.'); return; }

        input.value = ''; input.style.height = 'auto';
        document.getElementById('btnMicPrivate')?.classList.remove('btn-mic--hidden');
        document.getElementById('btnSendPrivate')?.classList.add('btn-send--hidden');
        this.#typing?.clear('private', this.#privatePeer.uid);

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
        this.#pendingMessages.set(tempId, { tempId, text, uid: this.#currentUser.uid, colPath, resolved: false });

        if (!this.#connMon.isOnline) {
            await this.#offlineQ.push({ tempId, colPath, msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text, receiverUid: msgData.receiverUid } });
            this.#markMsgStatus(tempId, 'offline');
            return;
        }

        const sendMs = Date.now();
        try {
            const docRef = await addDoc(collection(this.#db, colPath), {
                uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL,
                text, receiverUid: msgData.receiverUid, createdAt: serverTimestamp()
            });
            this.#confirmedIds.add('priv-' + docRef.id);
            this.#latency.markConfirmed(tempId, 'priv-' + docRef.id, Date.now() - sendMs);
            this.#confirmPendingMessage(tempId, 'priv-' + docRef.id);
        } catch (e) {
            console.error('[Chat] Erro ao enviar privado:', e);
            this.#markMsgStatus(tempId, 'failed');
            await this.#offlineQ.push({ tempId, colPath, msgData: { uid: msgData.uid, name: msgData.name, photoURL: msgData.photoURL, text, receiverUid: msgData.receiverUid } });
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
    }

    #markMsgStatus(id, status) {
        const el       = document.getElementById('msg-' + id);
        const statusEl = el?.querySelector('.chat-msg-status');
        if (!statusEl) return;
        const icons = { sending: '🕐', sent: '✓', delivered: '✓✓', read: '✓✓', offline: '📵', failed: '⚠️' };
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
        console.info(`[OfflineQueue] Reenviando ${queue.length} mensagem(s)...`);
        for (const item of queue) {
            try {
                const docRef = await addDoc(collection(this.#db, item.colPath), { ...item.msgData, createdAt: serverTimestamp() });
                this.#confirmedIds.add(docRef.id);
                const el = document.getElementById('msg-' + item.tempId);
                if (el) { el.id = 'msg-' + docRef.id; this.#markMsgStatus(docRef.id, 'sent'); }
                await this.#offlineQ.remove(item.tempId);
                console.info(`[OfflineQueue] ${item.tempId} → enviada`);
            } catch (e) { console.warn(`[OfflineQueue] Falha ${item.tempId}:`, e.message); }
        }
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
        docs.forEach(d => {
            const id = chatType === 'group' ? d.id : 'priv-' + d.id;
            if (!document.getElementById('msg-' + id)) {
                const el = this.#buildMsgElement(id, d.data(), d.data().uid === this.#currentUser?.uid, false, chatType);
                frag.appendChild(el);
            }
        });

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
            ? `<span class="chat-msg-status" data-status="${data.status || 'sent'}" title="Enviada">✓</span>`
            : '';
        const bodyHtml = (data.type === 'audio' && data.audioURL)
            ? this.#buildAudioPlayer(data.audioURL, time, isOwn)
            : `<p class="chat-msg-text">${this.#esc(data.text || '')}</p><span class="chat-msg-time">${time}</span>${statusHtml}`;

        const el     = document.createElement('div');
        el.id        = 'msg-' + id;
        el.className = 'chat-msg ' + (isOwn ? 'chat-msg--own' : 'chat-msg--other');
        if (data.status === 'sending') el.classList.add('chat-msg--sending');

        el.innerHTML =
            (!isOwn ? avHtml : '') +
            `<div class="chat-msg-bubble">` +
            (!isOwn ? `<span class="chat-msg-name">${this.#esc(data.name || 'Anônimo')}</span>` : '') +
            bodyHtml +
            (isOwn ? `<button class="chat-msg-delete" title="Apagar mensagem">🗑</button>` : '') +
            '</div>' +
            (isOwn ? avHtml : '');

        el.querySelector('.chat-msg-delete')?.addEventListener('click', () => {
            const realId = id.replace(/^priv-/, '').replace(/^tmp-[0-9a-f-]+$/, '');
            this.#deleteMessage(realId, type);
        });
        if (data.type === 'audio' && data.audioURL) this.#bindAudioPlayer(el);
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
        const fmt = s => `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
        audio.addEventListener('loadedmetadata', () => {
            durEl.textContent = fmt(audio.duration);
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
            durEl.textContent = fmt(audio.duration || 0);
        });
        playBtn.addEventListener('click', () => {
            if (audio.paused) { audio.play(); playBtn.textContent = '⏸️'; }
            else              { audio.pause(); playBtn.textContent = '▶️'; }
        });
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
                    return;
                }
                if (!data.approved || uid === this.#currentUser?.uid) {
                    const ex = this.#userCardMap.get(uid);
                    if (ex) { ex.remove(); this.#userCardMap.delete(uid); }
                    return;
                }
                if (c.type === 'added') {
                    const wrap = this.#buildUserCard(uid, data);
                    this.#userCardMap.set(uid, wrap);
                    container.appendChild(wrap);
                } else if (c.type === 'modified') {
                    const ex = this.#userCardMap.get(uid);
                    if (ex) {
                        this.#updateUserCard(ex, data);
                        // Atualiza indicador de typing
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
                }
            });
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

    // ── FCM ───────────────────────────────────────────────
    async #initFCM() {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return;
        if (Notification.permission === 'denied') return;
        try {
            const swReg = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
            this.#messaging = getMessaging(this.#app);
            if (Notification.permission !== 'granted') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') return;
            }
            // VAPID Key — gere em: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
            const VAPID_KEY = 'COLE_SUA_VAPID_KEY_AQUI';
            if (VAPID_KEY === 'COLE_SUA_VAPID_KEY_AQUI') {
                console.warn('[FCM] VAPID Key não configurada. Acesse: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair. Cole a chave em VAPID_KEY neste arquivo.');
                return;
            }
            const token = await getToken(this.#messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
            if (token) {
                await this.#saveFCMToken(token);
                // Auto-refresh do token
                onTokenRefresh(this.#messaging, async () => {
                    const newToken = await getToken(this.#messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
                    if (newToken) await this.#saveFCMToken(newToken);
                });
            }
            // Foreground push com tag correta por tipo
            onMessage(this.#messaging, payload => {
                const n    = payload.notification || {};
                const data = payload.data || {};
                const tag  = data.chatType === 'grupo'
                    ? 'chat-grupo'
                    : data.chatType === 'privado'
                        ? 'chat-privado-' + (data.senderId || '')
                        : 'lotofacil-resultado';
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.ready.then(reg =>
                        reg.showNotification(n.title || '🎱 Milionários da Leograf', {
                            body: n.body || '', icon: './icon-192.png', badge: './icon-192.png',
                            tag, renotify: true
                        })
                    );
                }
            });
        } catch (e) { console.warn('[FCM] Erro ao inicializar:', e.message); }
    }

    async #saveFCMToken(token) {
        await setDoc(doc(this.#db, 'fcmTokens', token), {
            uid: this.#currentUser?.uid || null, updatedAt: serverTimestamp()
        });
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
        const btn = document.getElementById(chatType === 'group' ? 'btnMicGroup' : 'btnMicPrivate');
        if (!btn) return;
        btn.classList.toggle('btn-mic--recording', recording);
        if (!recording) btn.classList.remove('btn-mic--locked');
        btn.title = recording ? 'Solte para enviar' : 'Segure para gravar';
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
        document.getElementById('btnAcceptCall').onclick = async () => {
            modal.classList.add('call-modal--hidden');
            await this.#acceptCall(callId, callerName);
        };
        document.getElementById('btnRejectCall').onclick = async () => {
            modal.classList.add('call-modal--hidden');
            await updateDoc(doc(this.#db, 'calls', callId), { status: 'rejected' }).catch(() => {});
        };
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
        this.#unsubCallIn?.();   this.#unsubCallIn   = null;
        this.#userCardMap.clear();
        this.#pendingMessages.clear();
        this.#confirmedIds.clear();
        if (this.#isRecording) this.#stopVoiceRecord();
        this.#endCall().catch(() => {});
        if (this.#currentUser) { this.#presence.stop(); this.#currentUser = null; }
        ['chatGroupMessages', 'chatPrivateMessages'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
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

        // Mic (pressionar/soltar + drag 20px p/ travar)
        const bindMic = (btnId, chatType) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            let startY = 0, locked = false;
            const setLocked = v => { locked = v; btn.classList.toggle('btn-mic--locked', v); btn.title = v ? 'Clique para parar e enviar' : 'Solte para enviar'; };
            const startRec  = () => { if (!this.#isRecording) this.#startVoiceRecord(chatType); };
            const stopRec   = () => { if (this.#isRecording) this.#stopVoiceRecord(); setLocked(false); };
            btn.addEventListener('mousedown',  e => { e.preventDefault(); if (locked) { stopRec(); return; } startY = e.clientY; startRec(); });
            btn.addEventListener('mousemove',  e => { if (!this.#isRecording || locked) return; if (startY - e.clientY >= 20) setLocked(true); });
            btn.addEventListener('mouseup',    () => { if (locked) return; stopRec(); });
            btn.addEventListener('mouseleave', () => { if (locked) return; if (this.#isRecording) stopRec(); });
            btn.addEventListener('touchstart',  e => { e.preventDefault(); if (locked) { stopRec(); return; } startY = e.touches[0].clientY; startRec(); }, { passive: false });
            btn.addEventListener('touchmove',   e => { e.preventDefault(); if (!this.#isRecording || locked) return; if (startY - e.touches[0].clientY >= 20) setLocked(true); }, { passive: false });
            btn.addEventListener('touchend',    e => { e.preventDefault(); if (locked) return; stopRec(); }, { passive: false });
            btn.addEventListener('touchcancel', e => { e.preventDefault(); locked = false; btn.classList.remove('btn-mic--locked'); stopRec(); }, { passive: false });
        };
        bindMic('btnMicGroup',   'group');
        bindMic('btnMicPrivate', 'private');

        // Toggle mic ↔ send + typing indicator
        const bindMicSendToggle = (inputId, micId, sendId, chatType, peerUidFn) => {
            const inp  = document.getElementById(inputId);
            const mic  = document.getElementById(micId);
            const send = document.getElementById(sendId);
            if (!inp || !mic || !send) return;
            inp.addEventListener('input', () => {
                const hasText = inp.value.trim().length > 0;
                mic.classList.toggle('btn-mic--hidden', hasText);
                send.classList.toggle('btn-send--hidden', !hasText);
            });
            inp.addEventListener('keydown', () => this.#typing?.onKeyDown(chatType, peerUidFn?.()));
            inp.addEventListener('blur',    () => this.#typing?.clear(chatType, peerUidFn?.()));
        };
        bindMicSendToggle('chatGroupInput',   'btnMicGroup',   'btnSendGroup',   'group',   null);
        bindMicSendToggle('chatPrivateInput', 'btnMicPrivate', 'btnSendPrivate', 'private', () => this.#privatePeer?.uid);

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

        // Navegação
        document.getElementById('btnOpenGroup')?.addEventListener('click',       () => this.#openGroupChat());
        document.getElementById('btnBackFromGroup')?.addEventListener('click',   () => this.#backToHome());
        document.getElementById('btnBackFromPrivate')?.addEventListener('click', () => this.#backToHome());

        // Chamada
        document.getElementById('btnEndCall')?.addEventListener('click', () => this.#endCall());

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
    }
}

document.addEventListener('DOMContentLoaded', () => { new ChatApp(); });

// Listener para Background Sync do service worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'DRAIN_QUEUE') {
            // O app recarrega a fila via ConnectionMonitor.onOnline; 
            // aqui disparamos via evento customizado caso necessário
            window.dispatchEvent(new Event('online'));
        }
    });
}
