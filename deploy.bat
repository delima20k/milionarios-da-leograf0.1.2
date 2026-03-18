@echo off
echo.
echo ========================================
echo  PWA MILINARIOS DA LEOGRAF - DEPLOY
echo ========================================
echo.

echo 🔍 Verificando arquivos necessarios...
if not exist "index.html" (
    echo ❌ ERRO: index.html nao encontrado
    pause
    exit /b 1
)

if not exist "manifest.json" (
    echo ❌ ERRO: manifest.json nao encontrado
    pause
    exit /b 1
)

if not exist "script.js" (
    echo ❌ ERRO: script.js nao encontrado
    pause
    exit /b 1
)

echo ✅ Todos os arquivos estao presentes!
echo.

echo 📦 Arquivos do PWA prontos para deploy:
echo    - index.html
echo    - manifest.json
echo    - script.js
echo    - service-worker.js
echo    - style.css
echo    - logo.svg
echo    - icon-192.png
echo    - icon-512.png
echo    - HOSPEDAGEM-GUIA.md
echo.

echo 🌐 OPCOES DE HOSPEDAGEM:
echo.
echo 1️⃣  GitHub Pages (RECOMENDADO)
echo     👉 Gratis, confiavel, facil de usar
echo     👉 URL: https://seu-usuario.github.io/repo-name
echo.
echo 2️⃣  Netlify
echo     👉 Deploy por drag-and-drop
echo     👉 URL personalizada disponivel
echo.
echo 3️⃣  Vercel
echo     👉 Profissional, muito rapido
echo     👉 Integração com Git
echo.

set /p escolha="Digite sua escolha (1, 2 ou 3): "

if "%escolha%"=="1" (
    echo.
    echo 🚀 GITHUB PAGES SELECIONADO
    echo.
    echo 📋 PROXIMOS PASSOS:
    echo 1. Acesse: https://github.com
    echo 2. Crie uma conta ou faça login
    echo 3. Clique em "New repository"
    echo 4. Nome: milinarios-da-leograf-pwa
    echo 5. Marque "Public" e "Add README"
    echo 6. Após criar, clique em "uploading an existing file"
    echo 7. Arraste todos os arquivos desta pasta
    echo 8. Vá em Settings > Pages
    echo 9. Source: "Deploy from branch" > "main" > Save
    echo.
    echo ⏰ Aguarde 5 minutos e acesse:
    echo    https://SEU-USUARIO.github.io/milinarios-da-leograf-pwa
) else if "%escolha%"=="2" (
    echo.
    echo 🌟 NETLIFY SELECIONADO
    echo.
    echo 📋 PROXIMOS PASSOS:
    echo 1. Acesse: https://netlify.com
    echo 2. Clique em "Sign up"
    echo 3. Na dashboard, clique "Add new site"
    echo 4. Selecione "Deploy manually"
    echo 5. Arraste esta pasta completa
    echo 6. Aguarde o upload terminar
    echo.
    echo ✨ Seu PWA estará online em minutos!
) else if "%escolha%"=="3" (
    echo.
    echo ⚡ VERCEL SELECIONADO
    echo.
    echo 📋 PROXIMOS PASSOS:
    echo 1. Instale Node.js: https://nodejs.org
    echo 2. Abra PowerShell nesta pasta
    echo 3. Execute: npm install -g vercel
    echo 4. Execute: vercel
    echo 5. Siga as instruções na tela
    echo.
    echo 🚀 Deploy profissional em minutos!
) else (
    echo ❌ Opcao invalida! Execute novamente.
)

echo.
echo 📱 APÓS O DEPLOY:
echo    - Teste o PWA no navegador
echo    - Compartilhe o link com o grupo
echo    - Instrua sobre instalação mobile
echo.

echo 🆘 Precisa de ajuda?
echo    - Consulte: HOSPEDAGEM-GUIA.md
echo    - Todos os passos detalhados estao la!
echo.

pause