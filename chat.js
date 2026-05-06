// ============================================
// 💬 CHAT — FIREBASE (email magic link + Google)
// ============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
    getAuth,
    onAuthStateChanged,
    signInWithPopup,
    GoogleAuthProvider,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    signOut,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
    getFirestore,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    onSnapshot,
    collection,
    addDoc,
    deleteDoc,
    query,
    orderBy,
    limit,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ============================================
// ⚙️ CONFIGURAÇÃO FIREBASE
// ▶ Cole aqui as credenciais do seu projeto:
//   Firebase Console → Configurações do projeto
//   → Seus apps → SDK snippet → Config
// ============================================
const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyCIVshCdXm7Fp1X3kxGr5GZOF_jUBN3ChA',
    authDomain:        'chatmilhao.firebaseapp.com',
    projectId:         'chatmilhao',
    storageBucket:     'chatmilhao.firebasestorage.app',
    messagingSenderId: '411362756429',
    appId:             '1:411362756429:web:55059c1f443fe06a1bd904'
};

// ============================================
// 🔥 CLASSE PRINCIPAL
// ============================================
class ChatApp {
    #auth;
    #db;
    #googleProvider;
    #currentUser = null;
    #unsubMessages = null;
    #unsubUserDoc  = null;
    #unsubOnline   = null;
    #pendingEmail  = null; // email aguardando confirmação do link

    constructor() {
        const app = initializeApp(FIREBASE_CONFIG);
        this.#auth           = getAuth(app);
        this.#db             = getFirestore(app);
        this.#googleProvider = new GoogleAuthProvider();

        this.#syncHeaderHeight();
        this.#bindUI();
        this.#handleEmailLinkRedirect(); // verifica se voltou de um magic link
        this.#watchAuth();
        this.#bindPresenceEvents();
    }

    // ─── Ajusta --header-height dinamicamente ──────────────────────────────────────────
    #syncHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        const update = () =>
            document.documentElement.style.setProperty(
                '--header-height', `${header.offsetHeight}px`
            );
        update();
        new ResizeObserver(update).observe(header);
    }

    // ─── Autenticação ─────────────────────────────────────────────────────────────────
    #watchAuth() {
        onAuthStateChanged(this.#auth, user => this.#handleAuthChange(user));
    }

    // Processa retorno do magic link (o Firebase redireciona de volta após clicar no email)
    async #handleEmailLinkRedirect() {
        if (!isSignInWithEmailLink(this.#auth, window.location.href)) return;

        let email = localStorage.getItem('emailParaLogin');
        if (!email) {
            email = window.prompt('Por segurança, confirme seu email:');
        }
        if (!email) return;

        try {
            const result = await signInWithEmailLink(this.#auth, email, window.location.href);
            localStorage.removeItem('emailParaLogin');

            // Definir displayName se veio do magic link pela primeira vez
            const savedName = localStorage.getItem('nomeParaLogin');
            if (savedName && !result.user.displayName) {
                await updateProfile(result.user, { displayName: savedName });
                localStorage.removeItem('nomeParaLogin');
            }

            // Limpar o token do URL sem recarregar a página
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    async #handleAuthChange(user) {
        this.#cleanup();
        if (!user) { this.#showPanel('login'); return; }

        this.#currentUser = user;

        const userRef = doc(this.#db, 'users', user.uid);
        const snap    = await getDoc(userRef);

        if (!snap.exists()) {
            await setDoc(userRef, {
                name:      user.displayName || user.email.split('@')[0],
                email:     user.email,
                photoURL:  user.photoURL || '',
                approved:  false,
                online:    false,
                lastSeen:  serverTimestamp()
            });
        }

        // Observar aprovação em tempo real
        this.#unsubUserDoc = onSnapshot(userRef, docSnap => {
            if (!docSnap.exists()) return;
            const data = docSnap.data();
            if (data.approved) {
                this.#enterChat(data);
            } else {
                this.#showPanel('pending');
            }
        });
    }

    async #enterChat(userData) {
        this.#showPanel('chat');

        const name = userData.name || this.#currentUser.displayName || 'Usuário';
        document.getElementById('chatUserName').textContent = name;

        const avatar   = document.getElementById('chatAvatar');
        const initials = document.getElementById('chatAvatarInitials');
        if (userData.photoURL) {
            avatar.src             = userData.photoURL;
            avatar.style.display   = 'block';
            initials.style.display = 'none';
        } else {
            avatar.style.display   = 'none';
            initials.textContent   = name[0].toUpperCase();
            initials.style.display = 'flex';
        }

        await this.#setPresence(true);
        this.#subscribeMessages();
        this.#subscribeOnline();

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    // Envia magic link por email
    async #sendEmailLink() {
        const name  = document.getElementById('loginName')?.value.trim();
        const email = document.getElementById('loginEmail')?.value.trim();
        if (!email) { this.#showError('Digite seu email.'); return; }

        const actionCodeSettings = {
            url:              window.location.origin + window.location.pathname,
            handleCodeInApp:  true
        };

        try {
            this.#clearError();
            await sendSignInLinkToEmail(this.#auth, email, actionCodeSettings);
            localStorage.setItem('emailParaLogin', email);
            if (name) localStorage.setItem('nomeParaLogin', name);
            this.#pendingEmail = email;
            this.#showLinkSentScreen(email);
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    #showLinkSentScreen(email) {
        document.querySelectorAll('.chat-tab-panel').forEach(p => p.classList.add('chat-tab-panel--hidden'));
        document.getElementById('tabLinkSent')?.classList.remove('chat-tab-panel--hidden');
        const el = document.getElementById('linkSentEmail');
        if (el) el.textContent = email;
    }

    async #loginGoogle() {
        try {
            this.#clearError();
            await signInWithPopup(this.#auth, this.#googleProvider);
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    async #logout() {
        await this.#setPresence(false);
        await signOut(this.#auth);
    }

    // ─── Firestore: mensagens ──────────────────────────────────────────────────────────
    #subscribeMessages() {
        const q = query(
            collection(this.#db, 'messages'),
            orderBy('createdAt', 'asc'),
            limit(100)
        );

        let initialLoad = true;

        this.#unsubMessages = onSnapshot(q, snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    this.#renderMessage(change.doc.id, change.doc.data(), !initialLoad);
                }
                if (change.type === 'removed') {
                    document.getElementById(`msg-${change.doc.id}`)?.remove();
                }
            });
            initialLoad = false;
            this.#scrollToBottom();
        });
    }

    #renderMessage(id, data, notify = false) {
        if (document.getElementById(`msg-${id}`)) return;

        const isOwn = this.#currentUser && data.uid === this.#currentUser.uid;
        const time  = data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '';

        const avatarHtml = data.photoURL
            ? `<img src="${data.photoURL}" class="chat-msg-avatar" alt="">`
            : `<div class="chat-msg-avatar chat-msg-avatar--initials">${(data.name || '?')[0].toUpperCase()}</div>`;

        const el = document.createElement('div');
        el.id        = `msg-${id}`;
        el.className = `chat-msg ${isOwn ? 'chat-msg--own' : 'chat-msg--other'}`;
        el.innerHTML = `
            ${!isOwn ? avatarHtml : ''}
            <div class="chat-msg-bubble">
                ${!isOwn ? `<span class="chat-msg-name">${this.#esc(data.name || 'Anônimo')}</span>` : ''}
                <p class="chat-msg-text">${this.#esc(data.text)}</p>
                <span class="chat-msg-time">${time}</span>
                ${isOwn ? `<button class="chat-msg-delete" data-id="${id}" title="Apagar mensagem">🗑</button>` : ''}
            </div>
            ${isOwn ? avatarHtml : ''}
        `;

        el.querySelector('.chat-msg-delete')?.addEventListener('click', () => {
            this.#deleteMessage(id);
        });

        document.getElementById('chatMessages').appendChild(el);

        if (notify) this.#notificar(data.name, data.text);
    }

    async #sendMessage() {
        const input = document.getElementById('chatInput');
        const text  = input.value.trim();
        if (!text || !this.#currentUser) return;

        input.value        = '';
        input.style.height = 'auto';

        const name = document.getElementById('chatUserName')?.textContent || 'Usuário';

        await addDoc(collection(this.#db, 'messages'), {
            uid:       this.#currentUser.uid,
            name,
            photoURL:  this.#currentUser.photoURL || '',
            text,
            createdAt: serverTimestamp()
        });
    }

    async #deleteMessage(id) {
        if (!confirm('Apagar esta mensagem?')) return;
        await deleteDoc(doc(this.#db, 'messages', id));
    }

    // ─── Firestore: presença / online ────────────────────────────────────────────────
    async #setPresence(online) {
        if (!this.#currentUser) return;
        await updateDoc(doc(this.#db, 'users', this.#currentUser.uid), {
            online,
            lastSeen: serverTimestamp()
        }).catch(() => {});
    }

    #subscribeOnline() {
        this.#unsubOnline = onSnapshot(collection(this.#db, 'users'), snap => {
            const online = snap.docs
                .filter(d => d.data().online)
                .map(d => d.data().name || 'Usuário');

            document.getElementById('onlineCount').textContent = online.length;

            const list = document.getElementById('onlineUsersList');
            if (list) {
                list.innerHTML = online
                    .map(n => `<li>🟢 ${this.#esc(n)}</li>`)
                    .join('');
            }
        });
    }

    #bindPresenceEvents() {
        window.addEventListener('beforeunload', () => this.#setPresence(false));
        document.addEventListener('visibilitychange', () => {
            if (this.#currentUser) {
                this.#setPresence(!document.hidden);
            }
        });
    }

    // ─── Notificações ─────────────────────────────────────────────────────────────────
    #notificar(nome, texto) {
        const menu = document.getElementById('sideMenu');
        if (menu?.classList.contains('active')) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        new Notification(`💬 ${nome}`, { body: texto, icon: 'logo-header.png' });
    }

    // ─── UI helpers ─────────────────────────────────────────────────────────────────
    #showPanel(name) {
        const map = { login: 'chatLoginScreen', pending: 'chatPendingScreen', chat: 'chatScreen' };
        Object.values(map).forEach(id => document.getElementById(id)?.classList.add('chat-panel--hidden'));
        if (map[name]) document.getElementById(map[name])?.classList.remove('chat-panel--hidden');
        this.#clearError();
    }

    #scrollToBottom() {
        const el = document.getElementById('chatMessages');
        if (el) el.scrollTop = el.scrollHeight;
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

    #esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    #translateError(e) {
        const map = {
            'auth/invalid-email':          'Email inválido.',
            'auth/popup-closed-by-user':   'Login cancelado.',
            'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
            'auth/too-many-requests':      'Muitas tentativas. Aguarde um momento.',
            'auth/invalid-action-code':    'Link expirado ou já usado. Solicite um novo.',
            'auth/expired-action-code':    'Link expirado. Solicite um novo.',
            'auth/unauthorized-continue-uri': 'Domínio não autorizado no Firebase. Adicione-o em Authentication → Configurações → Domínios autorizados.'
        };
        return map[e.code] || `Erro: ${e.message}`;
    }

    #cleanup() {
        this.#unsubMessages?.(); this.#unsubMessages = null;
        this.#unsubUserDoc?.();  this.#unsubUserDoc  = null;
        this.#unsubOnline?.();   this.#unsubOnline   = null;
        if (this.#currentUser) {
            this.#setPresence(false);
            this.#currentUser = null;
        }
        const msgs = document.getElementById('chatMessages');
        if (msgs) msgs.innerHTML = '';
    }

    // ─── Bind de eventos da UI ─────────────────────────────────────────────────────
    #bindUI() {
        // Magic link
        document.getElementById('btnLoginEmail')?.addEventListener('click', () => this.#sendEmailLink());
        document.getElementById('btnResendLink')?.addEventListener('click', () => {
            // Volta para o formulário
            document.querySelectorAll('.chat-tab-panel').forEach(p => p.classList.add('chat-tab-panel--hidden'));
            document.getElementById('tabLogin')?.classList.remove('chat-tab-panel--hidden');
        });

        // Enter no campo de email dispara envio do link
        document.getElementById('loginEmail')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') this.#sendEmailLink();
        });

        // Google
        document.getElementById('btnLoginGoogle')?.addEventListener('click', () => this.#loginGoogle());

        // Logout
        document.getElementById('btnLogoutChat')?.addEventListener('click',    () => this.#logout());
        document.getElementById('btnLogoutPending')?.addEventListener('click', () => this.#logout());

        // Enviar mensagem
        document.getElementById('btnSendMsg')?.addEventListener('click', () => this.#sendMessage());
        document.getElementById('chatInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.#sendMessage();
            }
            requestAnimationFrame(() => {
                const el = document.getElementById('chatInput');
                if (!el) return;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            });
        });

        // Toggle lista de online
        document.getElementById('btnOnlineList')?.addEventListener('click', () => {
            document.getElementById('chatOnlinePanel')?.classList.toggle('chat-online-panel--hidden');
        });
    }
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────────────────────
const CHAT_READY = !FIREBASE_CONFIG.apiKey.includes('COLE_AQUI');

document.addEventListener('DOMContentLoaded', () => {
    if (CHAT_READY) {
        new ChatApp();
    } else {
        document.getElementById('chatLoginScreen')?.classList.remove('chat-panel--hidden');
        const err = document.getElementById('chatAuthError');
        if (err) {
            err.textContent = '⚙️ Chat em configuração. Cole as credenciais do Firebase em chat.js.';
            err.classList.remove('chat-auth-error--hidden');
        }
    }
});

    // ─── Ajusta --header-height dinamicamente ───────────────────────────────
    #syncHeaderHeight() {
        const header = document.querySelector('.header');
        if (!header) return;
        const update = () =>
            document.documentElement.style.setProperty(
                '--header-height', `${header.offsetHeight}px`
            );
        update();
        new ResizeObserver(update).observe(header);
    }

    // ─── Autenticação ────────────────────────────────────────────────────────
    #watchAuth() {
        onAuthStateChanged(this.#auth, user => this.#handleAuthChange(user));
    }

    async #handleAuthChange(user) {
        this.#cleanup();
        if (!user) { this.#showPanel('login'); return; }

        this.#currentUser = user;

        // Criar / buscar documento do usuário no Firestore
        const userRef = doc(this.#db, 'users', user.uid);
        const snap    = await getDoc(userRef);

        if (!snap.exists()) {
            await setDoc(userRef, {
                name:      user.displayName || user.email.split('@')[0],
                email:     user.email,
                photoURL:  user.photoURL || '',
                approved:  false,
                online:    false,
                lastSeen:  serverTimestamp()
            });
        }

        // Observar aprovação em tempo real
        this.#unsubUserDoc = onSnapshot(userRef, docSnap => {
            if (!docSnap.exists()) return;
            const data = docSnap.data();
            if (data.approved) {
                this.#enterChat(data);
            } else {
                this.#showPanel('pending');
            }
        });
    }

    async #enterChat(userData) {
        this.#showPanel('chat');

        // Atualiza UI com dados do usuário
        const name = userData.name || this.#currentUser.displayName || 'Usuário';
        document.getElementById('chatUserName').textContent = name;

        const avatar    = document.getElementById('chatAvatar');
        const initials  = document.getElementById('chatAvatarInitials');
        if (userData.photoURL) {
            avatar.src          = userData.photoURL;
            avatar.style.display = 'block';
            initials.style.display = 'none';
        } else {
            avatar.style.display  = 'none';
            initials.textContent  = name[0].toUpperCase();
            initials.style.display = 'flex';
        }

        await this.#setPresence(true);
        this.#subscribeMessages();
        this.#subscribeOnline();

        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }

    async #loginGoogle() {
        try {
            this.#clearError();
            await signInWithPopup(this.#auth, this.#googleProvider);
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    async #loginEmail() {
        const email    = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        if (!email || !password) { this.#showError('Preencha email e senha.'); return; }
        try {
            this.#clearError();
            await signInWithEmailAndPassword(this.#auth, email, password);
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    async #signupEmail() {
        const name     = document.getElementById('signupName')?.value.trim();
        const email    = document.getElementById('signupEmail')?.value.trim();
        const password = document.getElementById('signupPassword')?.value;
        if (!name || !email || !password) { this.#showError('Preencha todos os campos.'); return; }
        if (password.length < 6) { this.#showError('Senha deve ter no mínimo 6 caracteres.'); return; }
        try {
            this.#clearError();
            const { user } = await createUserWithEmailAndPassword(this.#auth, email, password);
            await updateProfile(user, { displayName: name });
        } catch (e) {
            this.#showError(this.#translateError(e));
        }
    }

    async #logout() {
        await this.#setPresence(false);
        await signOut(this.#auth);
    }

    // ─── Firestore: mensagens ────────────────────────────────────────────────
    #subscribeMessages() {
        const q = query(
            collection(this.#db, 'messages'),
            orderBy('createdAt', 'asc'),
            limit(100)
        );

        let initialLoad = true;

        this.#unsubMessages = onSnapshot(q, snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === 'added') {
                    this.#renderMessage(change.doc.id, change.doc.data(), !initialLoad);
                }
                if (change.type === 'removed') {
                    document.getElementById(`msg-${change.doc.id}`)?.remove();
                }
            });
            initialLoad = false;
            this.#scrollToBottom();
        });
    }

    #renderMessage(id, data, notify = false) {
        if (document.getElementById(`msg-${id}`)) return;

        const isOwn = this.#currentUser && data.uid === this.#currentUser.uid;
        const time  = data.createdAt?.toDate
            ? data.createdAt.toDate().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : '';

        const avatarHtml = data.photoURL
            ? `<img src="${data.photoURL}" class="chat-msg-avatar" alt="">`
            : `<div class="chat-msg-avatar chat-msg-avatar--initials">${(data.name || '?')[0].toUpperCase()}</div>`;

        const el = document.createElement('div');
        el.id        = `msg-${id}`;
        el.className = `chat-msg ${isOwn ? 'chat-msg--own' : 'chat-msg--other'}`;
        el.innerHTML = `
            ${!isOwn ? avatarHtml : ''}
            <div class="chat-msg-bubble">
                ${!isOwn ? `<span class="chat-msg-name">${this.#esc(data.name || 'Anônimo')}</span>` : ''}
                <p class="chat-msg-text">${this.#esc(data.text)}</p>
                <span class="chat-msg-time">${time}</span>
                ${isOwn ? `<button class="chat-msg-delete" data-id="${id}" title="Apagar mensagem">🗑</button>` : ''}
            </div>
            ${isOwn ? avatarHtml : ''}
        `;

        el.querySelector('.chat-msg-delete')?.addEventListener('click', () => {
            this.#deleteMessage(id);
        });

        document.getElementById('chatMessages').appendChild(el);

        if (notify) this.#notificar(data.name, data.text);
    }

    async #sendMessage() {
        const input = document.getElementById('chatInput');
        const text  = input.value.trim();
        if (!text || !this.#currentUser) return;

        input.value        = '';
        input.style.height = 'auto';

        const name = document.getElementById('chatUserName')?.textContent || 'Usuário';

        await addDoc(collection(this.#db, 'messages'), {
            uid:       this.#currentUser.uid,
            name,
            photoURL:  this.#currentUser.photoURL || '',
            text,
            createdAt: serverTimestamp()
        });
    }

    async #deleteMessage(id) {
        if (!confirm('Apagar esta mensagem?')) return;
        await deleteDoc(doc(this.#db, 'messages', id));
    }

    // ─── Firestore: presença / online ────────────────────────────────────────
    async #setPresence(online) {
        if (!this.#currentUser) return;
        await updateDoc(doc(this.#db, 'users', this.#currentUser.uid), {
            online,
            lastSeen: serverTimestamp()
        }).catch(() => {});
    }

    #subscribeOnline() {
        this.#unsubOnline = onSnapshot(collection(this.#db, 'users'), snap => {
            const online = snap.docs
                .filter(d => d.data().online)
                .map(d => d.data().name || 'Usuário');

            document.getElementById('onlineCount').textContent = online.length;

            const list = document.getElementById('onlineUsersList');
            if (list) {
                list.innerHTML = online
                    .map(n => `<li>🟢 ${this.#esc(n)}</li>`)
                    .join('');
            }
        });
    }

    #bindPresenceEvents() {
        window.addEventListener('beforeunload', () => this.#setPresence(false));
        document.addEventListener('visibilitychange', () => {
            if (this.#currentUser) {
                this.#setPresence(!document.hidden);
            }
        });
    }

    // ─── Notificações ────────────────────────────────────────────────────────
    #notificar(nome, texto) {
        const menu = document.getElementById('sideMenu');
        if (menu?.classList.contains('active')) return;
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        new Notification(`💬 ${nome}`, { body: texto, icon: 'logo-header.png' });
    }

    // ─── UI helpers ──────────────────────────────────────────────────────────
    #showPanel(name) {
        const map = { login: 'chatLoginScreen', pending: 'chatPendingScreen', chat: 'chatScreen' };
        Object.values(map).forEach(id => document.getElementById(id)?.classList.add('chat-panel--hidden'));
        if (map[name]) document.getElementById(map[name])?.classList.remove('chat-panel--hidden');
        this.#clearError();
    }

    #scrollToBottom() {
        const el = document.getElementById('chatMessages');
        if (el) el.scrollTop = el.scrollHeight;
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

    // Sanitização — apenas textContent em innerHTML nunca é usada com dado bruto
    #esc(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    #translateError(e) {
        const map = {
            'auth/email-already-in-use':   'Este email já está em uso.',
            'auth/invalid-email':          'Email inválido.',
            'auth/weak-password':          'Senha muito fraca (mín. 6 caracteres).',
            'auth/wrong-password':         'Senha incorreta.',
            'auth/user-not-found':         'Usuário não encontrado.',
            'auth/invalid-credential':     'Email ou senha incorretos.',
            'auth/popup-closed-by-user':   'Login cancelado.',
            'auth/network-request-failed': 'Sem conexão. Verifique sua internet.',
            'auth/too-many-requests':      'Muitas tentativas. Aguarde um momento.'
        };
        return map[e.code] || `Erro: ${e.message}`;
    }

    #cleanup() {
        this.#unsubMessages?.(); this.#unsubMessages = null;
        this.#unsubUserDoc?.();  this.#unsubUserDoc  = null;
        this.#unsubOnline?.();   this.#unsubOnline   = null;
        if (this.#currentUser) {
            this.#setPresence(false);
            this.#currentUser = null;
        }
        const msgs = document.getElementById('chatMessages');
        if (msgs) msgs.innerHTML = '';
    }

    // ─── Bind de eventos da UI ───────────────────────────────────────────────
    #bindUI() {
        // Google
        document.getElementById('btnLoginGoogle')?.addEventListener('click',  () => this.#loginGoogle());
        document.getElementById('btnSignupGoogle')?.addEventListener('click', () => this.#loginGoogle());

        // Email
        document.getElementById('btnLoginEmail')?.addEventListener('click', () => this.#loginEmail());
        document.getElementById('btnSignup')?.addEventListener('click',     () => this.#signupEmail());

        // Pressionar Enter nos campos de login
        ['loginPassword', 'loginEmail'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') this.#loginEmail();
            });
        });
        ['signupPassword'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', e => {
                if (e.key === 'Enter') this.#signupEmail();
            });
        });

        // Logout
        document.getElementById('btnLogoutChat')?.addEventListener('click',    () => this.#logout());
        document.getElementById('btnLogoutPending')?.addEventListener('click', () => this.#logout());

        // Enviar mensagem
        document.getElementById('btnSendMsg')?.addEventListener('click', () => this.#sendMessage());
        document.getElementById('chatInput')?.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.#sendMessage();
            }
            // Auto-resize textarea
            requestAnimationFrame(() => {
                const el = document.getElementById('chatInput');
                if (!el) return;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            });
        });

        // Toggle lista de online
        document.getElementById('btnOnlineList')?.addEventListener('click', () => {
            document.getElementById('chatOnlinePanel')?.classList.toggle('chat-online-panel--hidden');
        });

        // Tabs (login / cadastro)
        document.querySelectorAll('.chat-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('chat-tab--active'));
                document.querySelectorAll('.chat-tab-panel').forEach(p => p.classList.add('chat-tab-panel--hidden'));
                tab.classList.add('chat-tab--active');
                const target = tab.dataset.tab === 'tabLogin' ? 'tabLogin' : 'tabSignup';
                document.getElementById(target)?.classList.remove('chat-tab-panel--hidden');
                this.#clearError();
            });
        });
    }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const configured = !FIREBASE_CONFIG.apiKey.includes('COLE_AQUI');

    if (configured) {
        new ChatApp();
    } else {
        // Firebase ainda não configurado — exibe aviso
        document.getElementById('chatLoginScreen')?.classList.remove('chat-panel--hidden');
        const err = document.getElementById('chatAuthError');
        if (err) {
            err.textContent = '⚙️ Chat em configuração. Cole as credenciais do Firebase em chat.js.';
            err.classList.remove('chat-auth-error--hidden');
        }
        console.warn(
            '⚠️ Firebase não configurado.\n' +
            'Abra chat.js e preencha o objeto FIREBASE_CONFIG com as credenciais do seu projeto.'
        );
    }
});
