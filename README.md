# 🃏 Truco River

Um jogo de **Truco** multiplayer em tempo real moderno, responsivo e altamente customizável. Desenvolvido em **Node.js**, **Express** e **Socket.io** para o backend, e **HTML5**, **CSS3 (Vanilla)** e **JavaScript Moderno (ES6)** para o frontend.

O jogo implementa as regras clássicas do Truco (com opções de cantar Envido, Flor, Truco, Retruco e Vale 4), acompanhado de uma interface premium e opções de estilo visual personalizáveis.

---

## ✨ Funcionalidades

- 👥 **Multiplayer em Tempo Real**: Jogue com amigos criando salas privadas ou juntando-se a salas existentes via códigos de sala rápidos.
- ⚙️ **Modos de Jogo**: Suporta partidas **Individual (1v1)** ou em **Duplas (2v2)**.
- 🤖 **Bots Inteligentes (IA)**: Adicione Bots simuladores à sala para preencher vagas ou treinar suas habilidades individualmente.
- 🎨 **Estilo das Cartas Customizável**:
  - **Tradicional**: Baralho Espanhol clássico estilizado de alta definição.
  - **Pixel Art**: Deck estilo retrô pixelizado, ideal para entusiastas de jogos clássicos.
  - O estilo selecionado é persistido automaticamente no navegador via `localStorage` e renderizado em tempo real.
- 💬 **Lobby & Chat Integrado**: Converse com outros jogadores na sala de espera ou envie reações e provocações através do chat global da mesa.
- 🧮 **Marcador Rústico de Pontos**: Rastreador de pontos digital combinado com o marcador clássico de palitos/fósforos rústicos.
- ⚡ **Animações Fluidas & Premium**: Efeitos de distribuição e jogada de cartas projetados para serem suaves, leves e visualmente agradáveis.
- 🔊 **Efeitos Sonoros**: Sons integrados para cartas jogadas, vitória/derrota e anúncios de jogadas.

---

## 🛠️ Tecnologias Utilizadas

- **Servidor (Backend)**: Node.js, Express.
- **Comunicação Web**: Socket.io (WebSockets).
- **Interface (Frontend)**: HTML5 Semântico, CSS3 Moderno (Variáveis nativas, Flexbox/Grid, Keyframe Animations), Vanilla ES6 JavaScript.
- **Ícones & Fontes**: FontAwesome, Google Fonts (Cinzel Decorative & Outfit).

---

## 🚀 Como Executar o Projeto Localmente

### Pré-requisitos

Certifique-se de ter o **Node.js** (versão 16 ou superior) instalado em sua máquina.

### Passos para Configuração

1. Clone o repositório para a sua máquina local:
   ```bash
   git clone https://github.com/seu-usuario/truco-river.git
   cd truco-river
   ```

2. Instale as dependências necessárias:
   ```bash
   npm install
   ```

3. Inicie o servidor de desenvolvimento:
   ```bash
   npm start
   ```

4. Acesse o jogo no seu navegador:
   ```url
   http://localhost:3000
   ```

### Contas de jogador e amigos

Os jogadores podem criar conta (ou jogar como convidado), adicionar amigos e convidá-los para a sala.
Onde as contas ficam salvas depende de uma variável de ambiente:

- **Sem `DATABASE_URL`**: as contas ficam no arquivo `data/users.json` (ou em `DATA_DIR/users.json`).
  Bom para rodar localmente.
- **Com `DATABASE_URL`**: as contas ficam num banco **Postgres** (por exemplo Neon, Supabase ou o
  Postgres do Render). A tabela `truco_users` é criada sozinha na primeira vez.

> Em hospedagens com disco temporário, como o plano grátis do Render, o arquivo `data/users.json`
> é apagado a cada reinício. Nesses casos configure `DATABASE_URL` para não perder as contas.

Para conferir onde as contas estão sendo salvas, abra `/api/status` no servidor
(ex.: `https://truco-river.onrender.com/api/status`): `contasPersistentes: true` indica Postgres.

### Painel admin

A senha do painel admin vem da variável de ambiente `ADMIN_PASSWORD` (ela não fica no código,
porque o repositório é público). Sem essa variável o painel fica desligado.

---

## 🧪 Rodando os Testes do Motor do Jogo

O projeto conta com um conjunto de testes unitários para validar a lógica de ranking das cartas espanholas, regras de desempate das rodadas (vazas), pontuação de Envido/Flor e determinação do vencedor.

Para executar a suite de testes, utilize:
```bash
npm test
```

Desenvolvido para diversão e aprendizado! 🃏🏆
