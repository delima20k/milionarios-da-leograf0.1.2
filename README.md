# 🏆 Milionários da Leograf - PWA

Progressive Web App para verificação automática dos jogos da Lotofácil do bolão **"Milionários da Leograf"**.

## 🌟 Funcionalidades

- ✅ **Verificação Automática**: Todos os concursos desde o 3589 (13/01/2026)
- ✅ **Teimosinha 23x**: 18 jogos por 23 sorteios
- ✅ **Detecção Inteligente**: Encontra jogos com 11, 12, 13, 14 ou 15 pontos
- ✅ **Cálculo de Prêmios**: Valores reais da API da Caixa
- ✅ **Interface Responsiva**: Funciona perfeitamente em mobile e desktop
- ✅ **Offline**: Funciona sem internet após instalação
- ✅ **Atualização Automática**: Service Worker mantém o app sempre atual
- ✅ **Dados em Tempo Real**: Integração com API oficial da Lotofácil

## 🎯 Como Funciona

1. **Clique em "Verificar Todos os Concursos"**
2. **Sistema busca automaticamente**: Do concurso 3589 até o mais atual
3. **Análise completa**: Verifica os 18 jogos do bolão em cada sorteio
4. **Relatório detalhado**: Mostra acertos, prêmios e totais acumulados

## 📱 Instalação

### **Android:**
1. Abra no **Chrome**
2. Toque em **"Adicionar à tela inicial"**
3. Confirme a instalação

### **iPhone:**
1. Abra no **Safari**
2. Toque no ícone de **compartilhar**
3. Selecione **"Adicionar à Tela de Início"**

### **Desktop:**
1. Abra no **Chrome/Edge**
2. Clique no **ícone de instalação** na barra
3. Confirme **"Instalar"**

## 🚀 Deploy e Hospedagem

### **Opção 1: GitHub Pages (Recomendado)**
```bash
# Execute o script automatizado
deploy.bat

# Ou siga o guia completo
HOSPEDAGEM-GUIA.md
```

### **Opção 2: Teste Local**
```bash
# Testar antes de hospedar
testar-local.bat

# Abrirá em: http://localhost:8000
```

## 🎲 Jogos do Bolão

O sistema verifica automaticamente estes **18 jogos** (Teimosinha 23x a partir de 13/01/2026):

1. `[01,02,03,04,05,06,07,09,11,13,15,17,18,19,20]`
2. `[01,02,03,05,07,08,09,10,11,13,15,17,18,19,21]`
3. `[01,02,03,04,05,06,07,09,11,12,13,16,17,20,21]`
4. `[01,03,04,05,07,08,09,10,13,14,15,17,18,19,21]`
5. `[01,02,03,05,07,08,09,10,13,14,15,17,19,20,21]`
6. `[01,02,03,04,05,06,07,09,13,15,16,17,18,19,21]`
7. `[01,02,03,05,07,08,09,11,13,14,15,17,18,19,21]`
8. `[01,03,04,05,06,07,09,10,11,13,15,17,19,20,21]`
9. `[01,02,03,05,07,09,11,12,13,15,16,17,18,19,20]`
10. `[01,02,03,04,05,06,07,09,11,13,14,15,17,18,21]`
11. `[02,03,04,05,06,07,09,11,13,15,17,18,19,20,21]`
12. `[02,03,05,07,08,09,10,11,13,15,17,18,19,20,21]`
13. `[02,03,04,05,06,07,09,11,12,13,15,17,18,20,21]`
14. `[02,03,05,07,08,09,10,11,13,14,15,17,18,19,20]`
15. `[02,03,05,07,08,09,10,11,12,13,15,17,18,20,21]`
16. `[02,03,04,05,06,07,09,11,13,15,16,17,18,19,20]`
17. `[02,03,05,07,08,09,11,13,14,15,17,18,19,20,21]`
18. `[02,03,04,05,06,07,09,10,11,13,15,17,19,20,21]`

## 📊 Premiação

O sistema calcula automaticamente:
- **15 pontos**: Prêmio máximo (sena)
- **14 pontos**: Segunda faixa
- **13 pontos**: Terceira faixa  
- **12 pontos**: Quarta faixa
- **11 pontos**: Quinta faixa

## 🔧 Arquivos do Projeto

```
📁 milinarios-da-leograf001/
├── 📄 index.html          # Interface principal
├── 📄 manifest.json       # Configuração PWA
├── 📄 script.js           # Lógica de verificação
├── 📄 service-worker.js   # Cache e offline
├── 📄 style.css           # Estilos e animações
├── 🖼️ logo.svg            # Logo com leão e trevos
├── 🖼️ icon-192.png        # Ícone PWA 192x192
├── 🖼️ icon-512.png        # Ícone PWA 512x512
├── 📄 deploy.bat          # Script de deploy
├── 📄 testar-local.bat    # Servidor local
└── 📄 HOSPEDAGEM-GUIA.md  # Guia completo
```

## 🍀 Sobre o Bolão

**"Milionários da Leograf"** - Grupo de apostadores unidos pela sorte!

- 🗓️ **Início da Teimosinha**: 13/01/2026 (Concurso 3589)
- 🎲 **Teimosinha**: 23 sorteios
- 🎯 **18 jogos por concurso**: Sempre os mesmos números
- 📱 **Verificação automática**: Nunca mais perca um prêmio
- 💰 **Transparência total**: Todos os valores são oficiais

## 🆘 Suporte

- 📖 **Guia completo**: `HOSPEDAGEM-GUIA.md`
- 🔧 **Deploy automatizado**: `deploy.bat`
- 🧪 **Teste local**: `testar-local.bat`
- 💻 **Console do navegador**: F12 para logs detalhados

---

**🎊 Boa sorte nos sorteios! Que os números estejam sempre a nosso favor! �**
