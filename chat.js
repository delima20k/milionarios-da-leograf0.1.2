// ============================================
// 💬 CHAT — FIREBASE (magic link + Google + grupo + privado + avatar upload)
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
    signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
    collection, addDoc, deleteDoc, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
    getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyCIVshCdXm7Fp1X3kxGr5GZOF_jUBN3ChA',
    authDomain:        'chatmilhao.firebaseapp.com',
    projectId:         'chatmilhao',
    storageBucket:     'chatmilhao.firebasestorage.app',
    messagingSenderId: '411362756429',
    appId:             '1:411362756429:web:55059c1f443fe06a1bd904'
};

class ChatApp {
    #auth;
    #db;
    #storage;
    #googleProvider;
    #currentUser   = null;
    #unsubGrpMsgs  = null;
    #unsubPrivMsgs = null;
    #unsubUserDoc  = null;
    #unsubOnline   = null;
    #unsubUsers    = null;
    #privatePeer        = null;
    #pendingVerifyEmail = null;
    #audio              = new Audio('./notification.mp3');

    constructor() {
        const app            = initializeApp(FIREBASE_CONFIG);
        this.#auth           = getAuth(app);
        this.#db             = getFirestore(app);
        this.#storage        = getStorage(app);
        this.#googleProvider = new GoogleAuthProvider();
        this.#auth.languageCode = 'pt-BR';
        this.#syncHeaderHeight();
        this.#bindUI();
        this.#watchAuth();
        this.#bindPresenceEvents();
    }

    #syncHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        const update = () =>
            document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px');
        update();
        new ResizeObserver(update).observe(header);
    }

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
        const userRef = doc(this.#db, 'users', user.uid);
        const snap    = await getDoc(userRef);
        if (!snap.exists()) {
            await setDoc(userRef, {
                name: user.displayName || user.email.split('@')[0],
                email: user.email, photoURL: user.photoURL || '',
                approved: false, online: false, lastSeen: serverTimestamp()
            });
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
        const el = document.getElementById('chatWelcomeText');
        if (el) el.textContent = 'Olá Milionário ' + name;
        this.#updateAvatarUI(userData.photoURL || '');
        await this.#setPresence(true);
        this.#subscribeOnline();
        this.#subscribeUsers();
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
                url: window.location.origin + window.location.pathname
            });
        } catch (e) { this.#showError(this.#translateError(e)); }
    }

    async #loginGoogle() {
        try { this.#clearError(); await signInWithPopup(this.#auth, this.#googleProvider); }
        catch (e) { this.#showError(this.#translateError(e)); }
    }

    async #logout() { await this.#setPresence(false); await signOut(this.#auth); }

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

    #openGroupChat() {
        document.getElementById('chatHome')?.classList.add('chat-home--hidden');
        document.getElementById('chatPrivatePanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatGroupPanel')?.classList.remove('chat-conversation--hidden');
        document.getElementById('chatGroupMessages').innerHTML = '';
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
        this.#subscribePrivateMessages(peer.uid);
    }

    #backToHome() {
        this.#unsubGrpMsgs?.();  this.#unsubGrpMsgs  = null;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        this.#privatePeer = null;
        document.getElementById('chatGroupPanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatPrivatePanel')?.classList.add('chat-conversation--hidden');
        document.getElementById('chatHome')?.classList.remove('chat-home--hidden');
    }

    #subscribeGroupMessages() {
        const q    = query(collection(this.#db, 'messages'), orderBy('createdAt', 'asc'), limit(100));
        const msgs = document.getElementById('chatGroupMessages');
        let first  = true;
        this.#unsubGrpMsgs = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added')   this.#renderMsg(msgs, c.doc.id, c.doc.data(), !first, 'group');
                if (c.type === 'removed') document.getElementById('msg-' + c.doc.id)?.remove();
            });
            if (first) first = false;
            this.#scrollBottom(msgs);
        });
    }

    async #sendGroupMessage() {
        const input = document.getElementById('chatGroupInput');
        const text  = input?.value.trim();
        if (!text || !this.#currentUser) return;
        input.value = ''; input.style.height = 'auto';
        await addDoc(collection(this.#db, 'messages'), {
            uid: this.#currentUser.uid, name: this.#getDisplayName(),
            photoURL: this.#currentUser.photoURL || '', text, createdAt: serverTimestamp()
        });
    }

    #subscribePrivateMessages(peerUid) {
        const chatId = [this.#currentUser.uid, peerUid].sort().join('_');
        const colPath = 'privateChats/' + chatId + '/messages';
        const q      = query(collection(this.#db, colPath), orderBy('createdAt', 'asc'), limit(100));
        const msgs   = document.getElementById('chatPrivateMessages');
        let first    = true;
        this.#unsubPrivMsgs = onSnapshot(q, snap => {
            snap.docChanges().forEach(c => {
                if (c.type === 'added')   this.#renderMsg(msgs, 'priv-' + c.doc.id, c.doc.data(), !first, 'private');
                if (c.type === 'removed') document.getElementById('msg-priv-' + c.doc.id)?.remove();
            });
            if (first) first = false;
            this.#scrollBottom(msgs);
        });
    }

    async #sendPrivateMessage() {
        if (!this.#privatePeer || !this.#currentUser) return;
        const input  = document.getElementById('chatPrivateInput');
        const text   = input?.value.trim();
        if (!text) return;
        input.value = ''; input.style.height = 'auto';
        const chatId  = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
        const colPath = 'privateChats/' + chatId + '/messages';
        await addDoc(collection(this.#db, colPath), {
            uid: this.#currentUser.uid, name: this.#getDisplayName(),
            photoURL: this.#currentUser.photoURL || '', text, createdAt: serverTimestamp()
        });
    }

    #renderMsg(container, id, data, notify, type) {
        if (!container || document.getElementById('msg-' + id)) return;
        const isOwn  = this.#currentUser && data.uid === this.#currentUser.uid;
        const time   = data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '';
        const avHtml = data.photoURL
            ? `<img src="${data.photoURL}" class="chat-msg-avatar" alt="">`
            : `<div class="chat-msg-avatar chat-msg-avatar--initials">${(data.name || '?')[0].toUpperCase()}</div>`;
        const el     = document.createElement('div');
        el.id        = 'msg-' + id;
        el.className = 'chat-msg ' + (isOwn ? 'chat-msg--own' : 'chat-msg--other');
        el.innerHTML =
            (!isOwn ? avHtml : '') +
            `<div class="chat-msg-bubble">` +
            (!isOwn ? `<span class="chat-msg-name">${this.#esc(data.name || 'Anônimo')}</span>` : '') +
            `<p class="chat-msg-text">${this.#esc(data.text)}</p>` +
            `<span class="chat-msg-time">${time}</span>` +
            (isOwn ? `<button class="chat-msg-delete" title="Apagar mensagem">🗑</button>` : '') +
            '</div>' +
            (isOwn ? avHtml : '');
        el.querySelector('.chat-msg-delete')?.addEventListener('click', () => {
            const realId = id.replace(/^priv-/, '');
            this.#deleteMessage(realId, type);
        });
        container.appendChild(el);
        if (notify && data.uid !== this.#currentUser?.uid) this.#notificar(data.name, data.text);
    }

    async #deleteMessage(id, type) {
        if (!confirm('Apagar esta mensagem?')) return;
        if (type === 'group') {
            await deleteDoc(doc(this.#db, 'messages', id));
        } else if (type === 'private' && this.#privatePeer) {
            const chatId  = [this.#currentUser.uid, this.#privatePeer.uid].sort().join('_');
            const colPath = 'privateChats/' + chatId + '/messages';
            await deleteDoc(doc(this.#db, colPath, id));
        }
    }

    #getDisplayName() {
        const el = document.getElementById('chatWelcomeText');
        return (el?.textContent || '').replace('Olá Milionário ', '').trim() || 'Usuário';
    }

    async #setPresence(online) {
        if (!this.#currentUser) return;
        await updateDoc(doc(this.#db, 'users', this.#currentUser.uid), {
            online, lastSeen: serverTimestamp()
        }).catch(() => {});
    }

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

    #subscribeUsers() {
        if (this.#unsubUsers) return;
        this.#unsubUsers = onSnapshot(collection(this.#db, 'users'), snap => {
            const container = document.getElementById('chatUserCards');
            if (!container) return;
            container.innerHTML = '';
            snap.docs
                .filter(d => d.data().approved && d.id !== this.#currentUser?.uid)
                .forEach(d => {
                    const data = d.data();
                    const uid  = d.id;
                    const card = document.createElement('button');
                    card.className = 'chat-user-card';
                    const av = data.photoURL
                        ? `<img src="${data.photoURL}" class="chat-user-card-avatar" alt="">`
                        : `<div class="chat-user-card-avatar chat-user-card-avatar--initials">${(data.name || '?')[0].toUpperCase()}</div>`;
                    card.innerHTML = av +
                        `<span class="chat-user-card-name">${this.#esc(data.name || 'Usuário')}</span>` +
                        (data.online ? '<span class="chat-user-card-online">●</span>' : '');
                    card.addEventListener('click', () => this.#openPrivateChat({
                        uid, name: data.name || 'Usuário', photoURL: data.photoURL || ''
                    }));
                    container.appendChild(card);
                });
        });
    }

    #bindPresenceEvents() {
        window.addEventListener('beforeunload', () => this.#setPresence(false));
        document.addEventListener('visibilitychange', () => {
            if (this.#currentUser) this.#setPresence(!document.hidden);
        });
    }

    #notificar(nome, texto) {
        this.#audio.currentTime = 0;
        this.#audio.play().catch(() => {});
        const menu = document.getElementById('sideMenu');
        if (menu?.classList.contains('active')) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        new Notification('💬 ' + nome, { body: texto, icon: 'logo-header.png' });
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

    #showPanel(name) {
        const map = { login: 'chatLoginScreen', pending: 'chatPendingScreen', chat: 'chatScreen' };
        Object.values(map).forEach(id => document.getElementById(id)?.classList.add('chat-panel--hidden'));
        if (map[name]) document.getElementById(map[name])?.classList.remove('chat-panel--hidden');
        if (name === 'login') this.#switchTab('login');
        this.#clearError();
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

    #esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

    #cleanup() {
        this.#unsubGrpMsgs?.();  this.#unsubGrpMsgs  = null;
        this.#unsubPrivMsgs?.(); this.#unsubPrivMsgs = null;
        this.#unsubUserDoc?.();  this.#unsubUserDoc  = null;
        this.#unsubOnline?.();   this.#unsubOnline   = null;
        this.#unsubUsers?.();    this.#unsubUsers    = null;
        if (this.#currentUser) { this.#setPresence(false); this.#currentUser = null; }
        ['chatGroupMessages', 'chatPrivateMessages'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '';
        });
        this.#privatePeer = null;
    }

    #bindUI() {
        // Entrar
        document.getElementById('btnLoginSenha')?.addEventListener('click',   () => this.#loginWithPassword());
        document.getElementById('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.#loginWithPassword(); });
        document.getElementById('loginEmail')?.addEventListener('keydown',    e => { if (e.key === 'Enter') this.#loginWithPassword(); });
        document.getElementById('btnLoginGoogle')?.addEventListener('click',  () => this.#loginGoogle());
        // Cadastrar
        document.getElementById('btnCadastrar')?.addEventListener('click',       () => this.#registerWithPassword());
        document.getElementById('cadastroConfirm')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.#registerWithPassword(); });
        // Troca de abas
        document.getElementById('tabBtnLogin')?.addEventListener('click',    () => this.#switchTab('login'));
        document.getElementById('tabBtnCadastro')?.addEventListener('click', () => this.#switchTab('cadastro'));
        // Voltar ao login da tela de verificação
        document.getElementById('btnBackToLogin')?.addEventListener('click', () => this.#switchTab('login'));
        document.getElementById('btnLogoutChat')?.addEventListener('click',    () => this.#logout());
        document.getElementById('btnLogoutPending')?.addEventListener('click', () => this.#logout());
        document.getElementById('btnAvatarUpload')?.addEventListener('click', () =>
            document.getElementById('avatarUploadInput')?.click()
        );
        document.getElementById('avatarUploadInput')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (file) this.#uploadAvatar(file);
            e.target.value = '';
        });
        document.getElementById('btnOpenGroup')?.addEventListener('click',       () => this.#openGroupChat());
        document.getElementById('btnBackFromGroup')?.addEventListener('click',   () => this.#backToHome());
        document.getElementById('btnBackFromPrivate')?.addEventListener('click', () => this.#backToHome());
        document.getElementById('btnSendGroup')?.addEventListener('click',   () => this.#sendGroupMessage());
        document.getElementById('chatGroupInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#sendGroupMessage(); }
            requestAnimationFrame(() => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; });
        });
        document.getElementById('btnSendPrivate')?.addEventListener('click', () => this.#sendPrivateMessage());
        document.getElementById('chatPrivateInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.#sendPrivateMessage(); }
            requestAnimationFrame(() => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; });
        });
        document.getElementById('btnOnlineList')?.addEventListener('click', () =>
            document.getElementById('chatOnlinePanel')?.classList.toggle('chat-online-panel--hidden')
        );
    }
}

document.addEventListener('DOMContentLoaded', () => { new ChatApp(); });
