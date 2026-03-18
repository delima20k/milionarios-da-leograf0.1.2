# 🌐 GUIA DE HOSPEDAGEM - PWA Milionários da Leograf

## 🚀 **MÉTODO 1: GITHUB PAGES (RECOMENDADO - GRÁTIS)**

### **Passo 1: Criar conta no GitHub**
1. Acesse: https://github.com
2. Clique em "Sign up" e crie sua conta
3. Confirme seu email

### **Passo 2: Criar repositório**
1. No GitHub, clique em "New repository" (botão verde)
2. Nome do repositório: `milinarios-da-leograf-pwa`
3. Marque: ✅ "Public"
4. Marque: ✅ "Add a README file"
5. Clique em "Create repository"

### **Passo 3: Subir os arquivos**
1. Na página do seu repositório, clique em "uploading an existing file"
2. Arraste todos os arquivos da pasta:
   - index.html
   - manifest.json
   - script.js
   - service-worker.js
   - style.css
   - logo.svg
   - icon-192.png
   - icon-512.png
3. Escreva uma mensagem: "Upload PWA files"
4. Clique em "Commit changes"

### **Passo 4: Ativar GitHub Pages**
1. No repositório, vá em "Settings" (aba superior)
2. No menu lateral, clique em "Pages"
3. Em "Source", selecione "Deploy from a branch"
4. Branch: "main"
5. Folder: "/ (root)"
6. Clique em "Save"

### **Passo 5: Acessar seu PWA**
Aguarde 2-5 minutos e seu PWA estará disponível em:
```
https://SEU-USUARIO.github.io/milinarios-da-leograf-pwa
```

---

## 🌟 **MÉTODO 2: NETLIFY (ALTERNATIVA GRÁTIS)**

### **Passo 1: Criar conta**
1. Acesse: https://netlify.com
2. Clique em "Sign up" 
3. Use sua conta GitHub ou crie nova

### **Passo 2: Deploy simples**
1. Na dashboard do Netlify, clique em "Add new site"
2. Selecione "Deploy manually"
3. Arraste a pasta completa do seu projeto
4. Aguarde o upload e deploy

### **Passo 3: URL personalizada (opcional)**
1. Clique no nome do site gerado
2. Vá em "Site settings" → "Change site name"
3. Coloque: `milinarios-da-leograf`
4. Seu PWA ficará em: `https://milinarios-da-leograf.netlify.app`

---

## 🔧 **MÉTODO 3: VERCEL (PROFISSIONAL GRÁTIS)**

### **Instalação via linha de comando:**
```powershell
# Instalar Vercel CLI
npm install -g vercel

# Na pasta do projeto
cd "c:\Users\delim\Desktop\milinarios-da-leograf001"

# Fazer deploy
vercel

# Seguir as instruções na tela
```

---

## 📱 **COMO COMPARTILHAR O PWA**

### **Para Android:**
1. Abra o link no Chrome
2. Aparecerá "Adicionar à tela inicial"
3. Confirme a instalação

### **Para iPhone:**
1. Abra o link no Safari
2. Toque no ícone de compartilhar
3. Selecione "Adicionar à Tela de Início"

### **Para Desktop:**
1. Abra o link no Chrome/Edge
2. Clique no ícone de instalação na barra de endereço
3. Confirme "Instalar"

---

## 🎯 **LINK PARA COMPARTILHAR**

Após hospedar, compartilhe assim:

```
🏆 MILIONÁRIOS DA LEOGRAF - PWA

📱 Instale nosso aplicativo de verificação da Lotofácil:
👉 https://SEU-LINK-AQUI

✅ Verifica automaticamente todos os concursos desde o 3525
✅ Funciona offline após instalação
✅ Atualização automática dos resultados
✅ Calcula prêmios de 11 a 15 pontos

📲 Como instalar:
• Android: Abra no Chrome → "Adicionar à tela inicial"
• iPhone: Abra no Safari → Compartilhar → "Adicionar à Tela"
• Computador: Abra no navegador → Ícone de instalação

🍀 Boa sorte nos sorteios!
```

---

## 🛠️ **ATUALIZAÇÕES FUTURAS**

Para atualizar o PWA após mudanças:
1. **GitHub Pages**: Faça upload dos arquivos novos
2. **Netlify**: Arraste a pasta atualizada
3. **Vercel**: Execute `vercel` novamente

⚡ **Dica:** O service worker garante que usuários recebam atualizações automaticamente!

---

## 🆘 **SUPORTE**

Se precisar de ajuda:
1. Verifique se todos os arquivos foram enviados
2. Aguarde 5-10 minutos para propagação
3. Teste em modo incógnito primeiro
4. Verifique o console do navegador (F12) para erros

🎊 **Parabéns! Seu PWA estará online e disponível para todos!**